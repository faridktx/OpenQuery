/**
 * High-level "ask" orchestration.
 * Ties together LLM generation, policy validation, EXPLAIN gating, and execution.
 */

import { OpenAIProvider, type GeneratePlanResult } from './llm/index.js';
import type { LlmSqlPlan } from './llm/types.js';
import { DefaultPolicyEngine, type ExplainData } from './policy/engine.js';
import type { GuardrailMode, ValidationResult, ExplainEvaluation } from './policy/types.js';
import type { SchemaSnapshot } from './db/types.js';
import { executeQuery, explainQuery, type ExecuteResult, type ExplainOutput } from './db/execute.js';
import { SAFE_DEFAULTS } from './db/defaults.js';
import { LocalStore } from './storage/sqlite.js';
import { createQuery, storeGeneration, storeRun, type StoredRun } from './storage/repo.js';

export interface AskInput {
  /** Profile info */
  profile: {
    id: string;
    name: string;
    dbType: string;
    host: string;
    port: number;
    database: string;
    user: string;
    ssl: boolean;
  };
  password: string;
  question: string;
  mode: GuardrailMode;
  execute: boolean;
  dryRun: boolean;
}

export interface AskResult {
  queryId: string;
  plan: LlmSqlPlan;
  model: string;
  retried: boolean;
  validation: ValidationResult;
  explainSummary: ExplainEvaluation['summary'] | null;
  explainAllowed: boolean;
  explainWarnings: string[];
  explainBlockers: string[];
  executionResult: ExecuteResult | null;
  status: 'ok' | 'blocked' | 'error' | 'dry-run';
  error?: string;
}

export async function askAndMaybeRun(
  input: AskInput,
  store: LocalStore,
): Promise<AskResult> {
  const db = store.getDb();

  // 1. Load latest schema snapshot
  const snapshot = store.getLatestSchemaSnapshot(input.profile.id);
  if (!snapshot) {
    throw new Error(
      `No schema snapshot found for profile "${input.profile.name}". ` +
        `Run "openquery schema refresh" first to introspect the database schema.`,
    );
  }

  const schema: SchemaSnapshot = JSON.parse(snapshot.snapshotJson);

  // 2. Create query record
  const queryId = createQuery(db, input.profile.id, input.question, input.mode, input.profile.dbType);

  // 3. Call LLM
  let genResult: GeneratePlanResult;
  try {
    const provider = new OpenAIProvider();
    const engine = new DefaultPolicyEngine({ mode: input.mode });
    const smConfig = engine.getSafeModeConfig();

    genResult = await provider.generatePlan({
      question: input.question,
      schema,
      dialect: input.profile.dbType,
      mode: input.mode,
      blockedTables: smConfig.blockedTables,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    storeRun(db, queryId, {
      rewrittenSql: '',
      rewrittenParamsJson: '[]',
      explainSummaryJson: '{}',
      execMs: 0,
      rowCount: 0,
      truncated: false,
      status: 'error',
      errorText: `LLM error: ${msg}`,
    });
    throw err;
  }

  // Store generation
  storeGeneration(db, queryId, {
    model: genResult.model,
    generatedSql: genResult.plan.sql,
    generatedParamsJson: JSON.stringify(genResult.plan.params),
    confidence: genResult.plan.confidence,
    assumptionsJson: JSON.stringify(genResult.plan.assumptions),
    safetyNotesJson: JSON.stringify(genResult.plan.safetyNotes),
  });

  // 4. Policy validation + rewrite
  const engine = new DefaultPolicyEngine(
    { mode: input.mode },
    input.mode === 'standard'
      ? { requireExplain: false, disallowSelectStar: false, maxJoins: 20, maxLimit: 50_000 }
      : undefined,
  );

  const validation = engine.validateAndRewrite(genResult.plan.sql);

  if (!validation.allowed) {
    const runData: StoredRun = {
      rewrittenSql: genResult.plan.sql,
      rewrittenParamsJson: JSON.stringify(genResult.plan.params),
      explainSummaryJson: '{}',
      execMs: 0,
      rowCount: 0,
      truncated: false,
      status: 'blocked',
      errorText: validation.reason,
    };
    storeRun(db, queryId, runData);

    return {
      queryId,
      plan: genResult.plan,
      model: genResult.model,
      retried: genResult.retried,
      validation,
      explainSummary: null,
      explainAllowed: false,
      explainWarnings: [],
      explainBlockers: [validation.reason],
      executionResult: null,
      status: 'blocked',
      error: validation.reason,
    };
  }

  const rewrittenSql = validation.rewrittenSql!;
  const paramValues = genResult.plan.params.map((p) => p.value);

  // 5. EXPLAIN preflight
  const connOpts = {
    dbType: input.profile.dbType,
    host: input.profile.host,
    port: input.profile.port,
    database: input.profile.database,
    user: input.profile.user,
    password: input.password,
    ssl: input.profile.ssl,
  };

  const smConfig = engine.getSafeModeConfig();
  let explainSummary: ExplainEvaluation['summary'] | null = null;
  let explainAllowed = true;
  let explainWarnings: string[] = [];
  let explainBlockers: string[] = [];

  if (smConfig.requireExplain || input.dryRun) {
    try {
      const explainResult: ExplainOutput = await explainQuery({
        ...connOpts,
        sql: rewrittenSql,
        params: paramValues,
        limits: { statementTimeoutMs: SAFE_DEFAULTS.statementTimeoutMs },
      });

      const evalResult = engine.evaluateExplain(explainResult as ExplainData);
      explainSummary = evalResult.summary;
      explainAllowed = evalResult.allowed;
      explainWarnings = evalResult.warnings;
      explainBlockers = evalResult.blockers;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      explainAllowed = false;
      explainBlockers = [`EXPLAIN failed: ${msg}`];
    }
  }

  if (!explainAllowed) {
    storeRun(db, queryId, {
      rewrittenSql,
      rewrittenParamsJson: JSON.stringify(paramValues),
      explainSummaryJson: JSON.stringify(explainSummary ?? {}),
      execMs: 0,
      rowCount: 0,
      truncated: false,
      status: 'blocked',
      errorText: explainBlockers.join('; '),
    });

    return {
      queryId,
      plan: genResult.plan,
      model: genResult.model,
      retried: genResult.retried,
      validation,
      explainSummary,
      explainAllowed: false,
      explainWarnings,
      explainBlockers,
      executionResult: null,
      status: 'blocked',
      error: explainBlockers.join('; '),
    };
  }

  // 6. Execute (unless dry-run)
  if (input.dryRun || !input.execute) {
    storeRun(db, queryId, {
      rewrittenSql,
      rewrittenParamsJson: JSON.stringify(paramValues),
      explainSummaryJson: JSON.stringify(explainSummary ?? {}),
      execMs: 0,
      rowCount: 0,
      truncated: false,
      status: 'ok',
    });

    return {
      queryId,
      plan: genResult.plan,
      model: genResult.model,
      retried: genResult.retried,
      validation,
      explainSummary,
      explainAllowed: true,
      explainWarnings,
      explainBlockers: [],
      executionResult: null,
      status: 'dry-run',
    };
  }

  let execResult: ExecuteResult;
  try {
    execResult = await executeQuery({
      ...connOpts,
      sql: rewrittenSql,
      params: paramValues,
      limits: {
        maxRows: SAFE_DEFAULTS.maxRows,
        statementTimeoutMs: SAFE_DEFAULTS.statementTimeoutMs,
      },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    storeRun(db, queryId, {
      rewrittenSql,
      rewrittenParamsJson: JSON.stringify(paramValues),
      explainSummaryJson: JSON.stringify(explainSummary ?? {}),
      execMs: 0,
      rowCount: 0,
      truncated: false,
      status: 'error',
      errorText: msg,
    });

    return {
      queryId,
      plan: genResult.plan,
      model: genResult.model,
      retried: genResult.retried,
      validation,
      explainSummary,
      explainAllowed: true,
      explainWarnings,
      explainBlockers: [],
      executionResult: null,
      status: 'error',
      error: msg,
    };
  }

  storeRun(db, queryId, {
    rewrittenSql,
    rewrittenParamsJson: JSON.stringify(paramValues),
    explainSummaryJson: JSON.stringify(explainSummary ?? {}),
    execMs: execResult.execMs,
    rowCount: execResult.rowCount,
    truncated: execResult.truncated,
    status: 'ok',
  });

  return {
    queryId,
    plan: genResult.plan,
    model: genResult.model,
    retried: genResult.retried,
    validation,
    explainSummary,
    explainAllowed: true,
    explainWarnings,
    explainBlockers: [],
    executionResult: execResult,
    status: 'ok',
  };
}
