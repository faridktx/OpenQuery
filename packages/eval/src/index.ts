import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import {
  DefaultPolicyEngine,
  OpenAIProvider,
  classifyStatement,
  executeQuery,
  parseSql,
  type ExplainData,
  type LlmSqlPlan,
  type SchemaSnapshot,
} from '@openquery/core';

type StatementType = 'read' | 'write' | 'dangerous';

type PolicyExpectation = 'allow' | 'block';

interface RequiredConstraints {
  mustIncludeLimit?: boolean;
  mustNotSelectStar?: boolean;
  forbiddenTables?: string[];
}

interface EvalCase {
  id: string;
  question: string;
  dialect: string;
  expectedTables: string[];
  expectedStatementType: StatementType;
  expectedPolicy: PolicyExpectation;
  expectedParseOk?: boolean;
  expectedExplainAllowed?: boolean;
  requiredConstraints?: RequiredConstraints;
  goldenSql?: string;
}

interface FixturePlan {
  sql: string;
  params: LlmSqlPlan['params'];
  explain: ExplainData;
}

type PlanWithExplain = FixturePlan;

interface CaseResult {
  id: string;
  pass: boolean;
  parseFailed: boolean;
  blockedByPolicy: boolean;
  execAttempted: boolean;
  execSuccess: boolean;
  reasons: string[];
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const FIXTURE_DIR = resolve(__dirname, '../fixtures');
const SEED_SQL_PATH = resolve(__dirname, '../../../infra/docker/seed.sql');

const ONLINE = process.env.OPENQUERY_EVAL_ONLINE === '1';
const EXECUTE_READ_TESTS = process.env.OPENQUERY_EVAL_EXECUTE === '1';

const DB_ENV = {
  host: process.env.OPENQUERY_PG_HOST ?? '127.0.0.1',
  port: Number(process.env.OPENQUERY_PG_PORT ?? '5432'),
  database: process.env.OPENQUERY_PG_DATABASE ?? 'openquery_test',
  user: process.env.OPENQUERY_PG_USER ?? 'openquery',
  password: process.env.OPENQUERY_PG_PASSWORD ?? 'openquery_dev',
  ssl: false,
};

async function applySeed(): Promise<void> {
  const sql = readFileSync(SEED_SQL_PATH, 'utf-8');
  const statements = sql
    .split(/;\s*\n/g)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const client = new pg.Client(DB_ENV);
  await client.connect();
  try {
    for (const statement of statements) {
      await client.query(statement);
    }
  } finally {
    await client.end();
  }
}

function readJsonFile<T>(file: string): T {
  return JSON.parse(readFileSync(file, 'utf-8')) as T;
}

function normalizeTableName(input: string): string {
  return input.replace(/"/g, '').split('.').pop()!.toLowerCase();
}

function extractTableSet(sql: string): Set<string> {
  const tables = classifyStatement(sql).impactedTables.map(normalizeTableName);
  return new Set(tables);
}

function setEquals(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const v of a) {
    if (!b.has(v)) return false;
  }
  return true;
}

function hasSelectStar(sql: string): boolean {
  const parsed = parseSql(sql);
  if (!parsed.ok) return false;

  const ast = parsed.ast as any;
  if (!ast) return false;
  if (ast.columns === '*') return true;

  if (Array.isArray(ast.columns)) {
    return ast.columns.some(
      (col: any) =>
        col?.expr?.type === 'star' ||
        col?.expr?.value === '*' ||
        col?.expr?.column === '*',
    );
  }

  return false;
}

function hasLimit(sql: string): boolean {
  return /\blimit\s+\d+/i.test(sql);
}

function tableSetToSortedArray(set: Set<string>): string[] {
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

function hasForbiddenTable(sql: string, forbidden: string[]): boolean {
  if (forbidden.length === 0) return false;
  const tableSet = extractTableSet(sql);
  const forbiddenSet = new Set(forbidden.map((t) => normalizeTableName(t)));
  for (const table of tableSet) {
    if (forbiddenSet.has(table)) return true;
  }
  return false;
}

function sameSqlShape(candidate: string, golden: string): boolean {
  const c = parseSql(candidate);
  const g = parseSql(golden);
  if (!c.ok || !g.ok) return false;

  const cTables = extractTableSet(candidate);
  const gTables = extractTableSet(golden);

  const cAst = c.ast as any;
  const gAst = g.ast as any;

  const cHasWhere = Boolean(cAst?.where);
  const gHasWhere = Boolean(gAst?.where);
  const cHasGroupBy = Boolean(cAst?.groupby);
  const gHasGroupBy = Boolean(gAst?.groupby);

  return c.kind === g.kind && setEquals(cTables, gTables) && cHasWhere === gHasWhere && cHasGroupBy === gHasGroupBy;
}

function summarizePercent(part: number, total: number): string {
  if (total === 0) return '0.0%';
  return `${((part / total) * 100).toFixed(1)}%`;
}

async function getPlanForCase(
  testCase: EvalCase,
  schema: SchemaSnapshot,
  offlinePlans: Record<string, FixturePlan>,
  provider: OpenAIProvider | null,
): Promise<PlanWithExplain> {
  if (!ONLINE) {
    const offline = offlinePlans[testCase.id];
    if (!offline) {
      throw new Error(`Missing offline fixture plan for case: ${testCase.id}`);
    }
    return offline;
  }

  if (!provider) {
    throw new Error('Online mode requested but OpenAI provider is not initialized.');
  }

  const result = await provider.generatePlan({
    question: testCase.question,
    schema,
    dialect: testCase.dialect,
    mode: 'safe',
    blockedTables: testCase.requiredConstraints?.forbiddenTables,
  });

  const offline = offlinePlans[testCase.id];
  return {
    sql: result.plan.sql,
    params: result.plan.params,
    explain: offline?.explain ?? {
      estimatedRows: 0,
      estimatedCost: 0,
      hasSeqScan: false,
      warnings: ['No EXPLAIN fixture available for this case in online mode.'],
    },
  };
}

async function evaluateCase(
  testCase: EvalCase,
  schema: SchemaSnapshot,
  offlinePlans: Record<string, FixturePlan>,
  provider: OpenAIProvider | null,
): Promise<CaseResult> {
  const reasons: string[] = [];

  let plan: PlanWithExplain;
  try {
    plan = await getPlanForCase(testCase, schema, offlinePlans, provider);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      id: testCase.id,
      pass: false,
      parseFailed: false,
      blockedByPolicy: true,
      execAttempted: false,
      execSuccess: false,
      reasons: [`plan generation failed: ${msg}`],
    };
  }

  const parseResult = parseSql(plan.sql);
  const parseFailed = !parseResult.ok;
  const expectParseOk = testCase.expectedParseOk ?? true;

  if (expectParseOk !== !parseFailed) {
    reasons.push(expectParseOk ? 'expected SQL parse to succeed' : 'expected SQL parse to fail');
  }

  const classification = classifyStatement(plan.sql);

  if (!parseFailed) {
    if (classification.classification !== testCase.expectedStatementType) {
      reasons.push(
        `expected statement type ${testCase.expectedStatementType}, got ${classification.classification}`,
      );
    }

    const actualTables = extractTableSet(plan.sql);
    const expectedTables = new Set(testCase.expectedTables.map(normalizeTableName));
    if (!setEquals(actualTables, expectedTables)) {
      reasons.push(
        `expected tables [${tableSetToSortedArray(expectedTables).join(', ')}], got [${tableSetToSortedArray(actualTables).join(', ')}]`,
      );
    }
  }

  const forbiddenTables = testCase.requiredConstraints?.forbiddenTables ?? [];

  const engine = new DefaultPolicyEngine(
    { mode: 'safe' },
    {
      blockedTables: forbiddenTables,
      disallowSelectStar: true,
      enforceLimit: true,
      requireExplain: true,
    },
  );

  const validation = engine.validateAndRewrite(plan.sql);
  const blockedByPolicy = !validation.allowed;

  if (testCase.expectedPolicy === 'allow' && blockedByPolicy) {
    reasons.push(`expected policy allow, got blocked (${validation.reason})`);
  }
  if (testCase.expectedPolicy === 'block' && !blockedByPolicy) {
    reasons.push('expected policy block, got allow');
  }

  const rewrittenSql = validation.rewrittenSql ?? plan.sql;

  if (validation.allowed && testCase.requiredConstraints?.mustIncludeLimit && !hasLimit(rewrittenSql)) {
    reasons.push('constraint failed: expected LIMIT in rewritten SQL');
  }

  if (validation.allowed && testCase.requiredConstraints?.mustNotSelectStar && hasSelectStar(rewrittenSql)) {
    reasons.push('constraint failed: expected query without SELECT *');
  }

  if (validation.allowed && forbiddenTables.length > 0 && hasForbiddenTable(rewrittenSql, forbiddenTables)) {
    reasons.push('constraint failed: forbidden table referenced');
  }

  if (validation.allowed && testCase.goldenSql && !sameSqlShape(rewrittenSql, testCase.goldenSql)) {
    reasons.push('golden SQL shape mismatch');
  }

  const explainEvaluation = engine.evaluateExplain(plan.explain);
  const expectedExplainAllowed = testCase.expectedExplainAllowed ?? true;
  if (validation.allowed && explainEvaluation.allowed !== expectedExplainAllowed) {
    reasons.push(
      expectedExplainAllowed
        ? 'expected EXPLAIN gate to allow execution'
        : 'expected EXPLAIN gate to block execution',
    );
  }

  let execAttempted = false;
  let execSuccess = false;

  if (EXECUTE_READ_TESTS && validation.allowed && explainEvaluation.allowed && classification.classification === 'read') {
    execAttempted = true;
    try {
      await executeQuery({
        dbType: 'postgres',
        host: DB_ENV.host,
        port: DB_ENV.port,
        database: DB_ENV.database,
        user: DB_ENV.user,
        password: DB_ENV.password,
        ssl: false,
        sql: rewrittenSql,
        params: plan.params.map((p) => p.value),
      });
      execSuccess = true;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      reasons.push(`execution failed: ${msg}`);
    }
  }

  return {
    id: testCase.id,
    pass: reasons.length === 0,
    parseFailed,
    blockedByPolicy,
    execAttempted,
    execSuccess,
    reasons,
  };
}

async function main(): Promise<void> {
  if (ONLINE && !process.env.OPENAI_API_KEY) {
    throw new Error('OPENQUERY_EVAL_ONLINE=1 requires OPENAI_API_KEY.');
  }

  const suite = readJsonFile<EvalCase[]>(resolve(FIXTURE_DIR, 'suite.json'));
  const offlinePlans = readJsonFile<Record<string, FixturePlan>>(resolve(FIXTURE_DIR, 'offline-plans.json'));
  const schema = readJsonFile<SchemaSnapshot>(resolve(FIXTURE_DIR, 'schema.snapshot.json'));

  if (EXECUTE_READ_TESTS) {
    await applySeed();
  }

  const provider = ONLINE ? new OpenAIProvider() : null;

  const results: CaseResult[] = [];
  for (const testCase of suite) {
    const result = await evaluateCase(testCase, schema, offlinePlans, provider);
    results.push(result);
  }

  for (const result of results) {
    if (result.pass) {
      console.log(`[PASS] ${result.id}`);
      continue;
    }
    console.log(`[FAIL] ${result.id}`);
    for (const reason of result.reasons) {
      console.log(`  - ${reason}`);
    }
  }

  const total = results.length;
  const passed = results.filter((r) => r.pass).length;
  const parseFails = results.filter((r) => r.parseFailed).length;
  const policyBlocked = results.filter((r) => r.blockedByPolicy).length;
  const execAttempted = results.filter((r) => r.execAttempted).length;
  const execSucceeded = results.filter((r) => r.execSuccess).length;

  const failureReasonCounts = new Map<string, number>();
  for (const result of results) {
    for (const reason of result.reasons) {
      failureReasonCounts.set(reason, (failureReasonCounts.get(reason) ?? 0) + 1);
    }
  }

  const topFailureReasons = Array.from(failureReasonCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  console.log('');
  console.log('Summary');
  console.log(`- Mode: ${ONLINE ? 'online (OPENQUERY_EVAL_ONLINE=1)' : 'offline (default)'}`);
  console.log(`- Cases: ${total}`);
  console.log(`- Pass rate: ${summarizePercent(passed, total)} (${passed}/${total})`);
  console.log(`- Parse fail rate: ${summarizePercent(parseFails, total)} (${parseFails}/${total})`);
  console.log(`- Blocked by policy rate: ${summarizePercent(policyBlocked, total)} (${policyBlocked}/${total})`);
  console.log(`- Exec success rate: ${summarizePercent(execSucceeded, execAttempted)} (${execSucceeded}/${execAttempted} attempted)`);

  if (topFailureReasons.length > 0) {
    console.log('- Top failure reasons:');
    for (const [reason, count] of topFailureReasons) {
      console.log(`  - (${count}) ${reason}`);
    }
  }

  if (passed !== total) {
    process.exitCode = 1;
  }
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`Eval runner failed: ${msg}`);
  process.exitCode = 1;
});
