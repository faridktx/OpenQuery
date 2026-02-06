#!/usr/bin/env node

/**
 * OpenQuery CLI entrypoint.
 * Phase 5: POWER mode for controlled write operations.
 */

import { Command } from 'commander';
import { execSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createInterface } from 'node:readline';
import {
  LocalStore,
  defaultDbPath,
  testDbConnection,
  executeQuery,
  explainQuery,
  SAFE_DEFAULTS,
  DefaultPolicyEngine,
  type GuardrailMode,
  introspectSchema,
  askAndMaybeRun,
  listHistory,
  getHistoryItem,
  classifyStatement,
  previewWrite,
  requestConfirmation,
  verifyConfirmation,
  executeWriteWithAudit,
  hashSql,
} from '@openquery/core';
import { getPassword } from './util/password.js';
import { formatTable } from './util/table.js';

const VERSION = '0.5.0';

// In-memory last result for CSV export within same process
let lastRunResult: { columns: string[]; rows: Record<string, unknown>[]; queryId: string } | null = null;

// ── Helpers ──────────────────────────────────────────────────────────

function openStore(): LocalStore {
  const store = new LocalStore(defaultDbPath());
  store.migrate();
  return store;
}

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', (chunk) => (data += chunk));
    process.stdin.on('end', () => resolve(data.trim()));
    process.stdin.on('error', reject);
  });
}

function getProfileForCommand(
  store: LocalStore,
  nameOpt?: string,
): { id: string; name: string; host: string; port: number; database: string; user: string; dbType: string; ssl: boolean } {
  const profileName = nameOpt ?? store.getActiveProfile();
  if (!profileName) {
    console.error('Error: No profile specified and no active profile set.');
    process.exit(1);
  }
  const profile = store.getProfileByName(profileName);
  if (!profile) {
    console.error(`Error: Profile "${profileName}" not found.`);
    process.exit(1);
  }
  return {
    id: profile.id,
    name: profileName,
    host: profile.host ?? 'localhost',
    port: profile.port ?? 5432,
    database: profile.database ?? '',
    user: profile.user ?? '',
    dbType: profile.db_type,
    ssl: profile.ssl === 1,
  };
}

// ── Program ──────────────────────────────────────────────────────────

const program = new Command();

program
  .name('openquery')
  .description('OpenQuery — local-first SQL Copilot')
  .version(VERSION, '-v, --version', 'Show version number');

// ── doctor ───────────────────────────────────────────────────────────

program
  .command('doctor')
  .description('Check environment and dependencies')
  .action(async () => {
    console.log('OpenQuery Doctor');
    console.log('================\n');

    const nodeVersion = process.version;
    const nodeMajor = parseInt(nodeVersion.slice(1), 10);
    const nodeOk = nodeMajor >= 18;
    console.log(`Node.js:    ${nodeVersion} ${nodeOk ? '✓' : '✗ (requires >=18)'}`);

    let pnpmVersion = 'not found';
    try {
      pnpmVersion = execSync('pnpm --version', { encoding: 'utf-8' }).trim();
    } catch {
      // not installed
    }
    console.log(
      `pnpm:       ${pnpmVersion !== 'not found' ? `v${pnpmVersion} ✓` : '✗ not found'}`,
    );

    const tryImport = async (mod: string) => {
      try { await import(mod); return true; } catch { return false; }
    };
    const sqliteOk = await tryImport('better-sqlite3');
    console.log(
      `SQLite:     ${sqliteOk ? 'better-sqlite3 found ✓' : 'better-sqlite3 not found'}`,
    );

    const pgOk = await tryImport('pg');
    console.log(`Postgres:   ${pgOk ? 'pg driver found ✓' : 'pg driver not found'}`);

    const parserOk = await tryImport('node-sql-parser');
    console.log(`SQL parser: ${parserOk ? 'node-sql-parser found ✓' : 'not found'}`);

    const openaiKey = process.env.OPENAI_API_KEY ? 'set ✓' : 'not set';
    const model = process.env.OPENQUERY_MODEL || 'gpt-4o-mini (default)';
    console.log(`OpenAI key: ${openaiKey}`);
    console.log(`LLM model:  ${model}`);

    const configDir = join(homedir(), '.openquery');
    const dbPath = defaultDbPath();
    console.log(
      `Config dir: ${configDir} ${existsSync(configDir) ? '(exists)' : '(will be created)'}`,
    );
    console.log(`DB path:    ${dbPath} ${existsSync(dbPath) ? '(exists)' : '(will be created)'}`);

    console.log(`\nSafe defaults:`);
    console.log(`  Default LIMIT:     ${SAFE_DEFAULTS.defaultLimit}`);
    console.log(`  Max rows:          ${SAFE_DEFAULTS.maxRows}`);
    console.log(`  Statement timeout: ${SAFE_DEFAULTS.statementTimeoutMs}ms`);

    console.log('\nPhase 3 — LLM integration + schema retrieval + history.');
  });

// ── profiles ─────────────────────────────────────────────────────────

const profiles = program.command('profiles').description('Manage database connection profiles');

profiles
  .command('add')
  .description('Add a new connection profile')
  .requiredOption('--name <name>', 'Profile name')
  .requiredOption('--type <type>', 'Database type (postgres)')
  .requiredOption('--host <host>', 'Database host')
  .option('--port <port>', 'Database port', '5432')
  .requiredOption('--database <database>', 'Database name')
  .requiredOption('--user <user>', 'Database user')
  .option('--ssl', 'Enable SSL', false)
  .action(async (opts) => {
    if (opts.type !== 'postgres') {
      console.error(
        'Error: Only "postgres" is implemented in Phase 6. "mysql" is planned for Phase 7.',
      );
      process.exit(1);
    }

    const store = openStore();
    try {
      if (store.getProfileByName(opts.name)) {
        console.error(`Error: Profile "${opts.name}" already exists.`);
        process.exit(1);
      }

      store.createProfile({
        name: opts.name,
        db_type: opts.type,
        host: opts.host,
        port: parseInt(opts.port, 10),
        database: opts.database,
        user: opts.user,
        ssl: opts.ssl,
      });

      if (!store.getActiveProfile()) {
        store.setActiveProfile(opts.name);
        console.log(`Profile "${opts.name}" created and set as active.`);
      } else {
        console.log(`Profile "${opts.name}" created.`);
      }

      store.logAudit('profile_created', { name: opts.name, type: opts.type });
    } finally {
      store.close();
    }
  });

profiles
  .command('list')
  .description('List all connection profiles')
  .action(() => {
    const store = openStore();
    try {
      const all = store.listProfiles();
      const active = store.getActiveProfile();

      if (all.length === 0) {
        console.log('No profiles configured. Use "openquery profiles add" to create one.');
        return;
      }

      console.log('Profiles:\n');
      for (const p of all) {
        const marker = p.name === active ? ' (active)' : '';
        const ssl = p.ssl ? ', ssl' : '';
        console.log(
          `  ${p.name}${marker} — ${p.db_type}://${p.user}@${p.host}:${p.port}/${p.database}${ssl}`,
        );
      }
    } finally {
      store.close();
    }
  });

profiles
  .command('use <name>')
  .description('Set the active profile')
  .action((name: string) => {
    const store = openStore();
    try {
      if (!store.getProfileByName(name)) {
        console.error(`Error: Profile "${name}" not found.`);
        process.exit(1);
      }
      store.setActiveProfile(name);
      store.logAudit('profile_activated', { name });
      console.log(`Active profile set to "${name}".`);
    } finally {
      store.close();
    }
  });

profiles
  .command('remove <name>')
  .description('Remove a connection profile')
  .action((name: string) => {
    const store = openStore();
    try {
      if (!store.deleteProfile(name)) {
        console.error(`Error: Profile "${name}" not found.`);
        process.exit(1);
      }
      store.logAudit('profile_removed', { name });
      console.log(`Profile "${name}" removed.`);
    } finally {
      store.close();
    }
  });

profiles
  .command('test')
  .description('Test connection for a profile')
  .option('--name <name>', 'Profile name (defaults to active)')
  .action(async (opts) => {
    const store = openStore();
    try {
      const p = getProfileForCommand(store, opts.name);
      const password = await getPassword();

      console.log(`Testing connection to "${p.name}"...`);
      const result = await testDbConnection({
        dbType: p.dbType,
        host: p.host,
        port: p.port,
        database: p.database,
        user: p.user,
        password,
        ssl: p.ssl,
      });

      if (result.ok) {
        console.log(`✓ Connection successful.`);
        if (result.serverVersion) {
          console.log(`  Server: ${result.serverVersion}`);
        }
      } else {
        console.error(`✗ Connection failed: ${result.error}`);
        process.exit(1);
      }
    } finally {
      store.close();
    }
  });

// ── schema ──────────────────────────────────────────────────────────

const schema = program.command('schema').description('Schema introspection commands');

schema
  .command('refresh')
  .description('Introspect and store database schema for the active profile')
  .option('--name <name>', 'Profile name (defaults to active)')
  .action(async (opts) => {
    const store = openStore();
    try {
      const p = getProfileForCommand(store, opts.name);
      const password = await getPassword();

      console.log(`Introspecting schema for "${p.name}"...`);
      const snapshot = await introspectSchema(
        { host: p.host, port: p.port, database: p.database, user: p.user, ssl: p.ssl },
        password,
      );

      const snapshotJson = JSON.stringify(snapshot);
      store.storeSchemaSnapshot(p.id, snapshotJson);

      console.log(`Schema snapshot stored.`);
      console.log(`  Tables: ${snapshot.tables.length}`);
      const totalCols = snapshot.tables.reduce((sum, t) => sum + t.columns.length, 0);
      console.log(`  Columns: ${totalCols}`);

      store.logAudit('schema_refreshed', {
        profile: p.name,
        tableCount: snapshot.tables.length,
        columnCount: totalCols,
      });
    } finally {
      store.close();
    }
  });

// ── run ──────────────────────────────────────────────────────────────

program
  .command('run')
  .description('Execute a SQL query through the policy engine')
  .option('--sql <sql>', 'SQL statement to execute')
  .option('--mode <mode>', 'Execution mode (safe|standard)', 'safe')
  .option('--name <name>', 'Profile name (defaults to active)')
  .option('--limit <limit>', 'Override default LIMIT')
  .option('--confirm-phrase <phrase>', 'Provide confirmation phrase for write operations')
  .option('--i-understand', 'Skip final y/N prompt (phrase still required)', false)
  .action(async (opts) => {
    let sql: string = opts.sql ?? '';
    if (!sql) {
      if (process.stdin.isTTY) {
        console.error('Error: Provide SQL via --sql flag or pipe via stdin.');
        process.exit(1);
      }
      sql = await readStdin();
    }
    if (!sql.trim()) {
      console.error('Error: Empty SQL statement.');
      process.exit(1);
    }

    const store = openStore();
    try {
      const p = getProfileForCommand(store, opts.name);
      const password = await getPassword();

      // Classify statement to determine if it's a write
      const classification = classifyStatement(sql);
      const isWrite = classification.classification !== 'read';

      // Load profile power settings for write policy
      const powerSettings = store.getProfilePowerSettings(p.name);
      const mode: GuardrailMode = opts.mode === 'standard' ? 'standard' : 'safe';

      const engine = new DefaultPolicyEngine(
        {
          mode,
          allowWrite: powerSettings?.allowWrite ?? false,
          allowDestructive: powerSettings?.allowDangerous ?? false,
        },
        mode === 'standard'
          ? { requireExplain: false, disallowSelectStar: false, maxJoins: 20, maxLimit: 50_000 }
          : undefined,
      );

      if (opts.limit) {
        engine.setSafeModeConfig({ defaultLimit: parseInt(opts.limit, 10) || SAFE_DEFAULTS.defaultLimit });
      }

      const validation = engine.validateAndRewrite(sql);
      if (!validation.allowed) {
        console.error(`Policy: DENIED — ${validation.reason}`);
        if (validation.details) console.error(`Details:\n${validation.details}`);
        if (validation.suggestedFix) console.error(`Suggestion: ${validation.suggestedFix}`);

        // Log blocked write attempt
        if (isWrite) {
          store.logAudit('write_blocked', {
            profile_id: p.id,
            classification: classification.classification,
            reason: validation.reason,
            sql_hash: hashSql(sql),
          });
        }
        process.exit(1);
      }

      for (const w of validation.warnings) {
        console.log(`Warning: ${w}`);
      }

      const connOpts = {
        dbType: p.dbType,
        host: p.host,
        port: p.port,
        database: p.database,
        user: p.user,
        password,
        ssl: p.ssl,
      };

      // ── Write path: preview + confirm + execute ────────────────
      if (isWrite) {
        console.log('\n\x1b[31m⚠ WRITE OPERATION DETECTED\x1b[0m');
        console.log(`Classification: ${classification.classification} (${classification.kind.toUpperCase()})`);
        console.log(`Impacted tables: ${classification.impactedTables.join(', ') || 'unknown'}`);
        console.log(`WHERE clause: ${classification.hasWhereClause ? 'present' : 'MISSING'}`);

        // Generate preview
        const preview = await previewWrite({
          ...connOpts,
          sql,
          params: [],
          customConfirmPhrase: powerSettings?.confirmPhrase,
        });

        if (preview.estimatedRowsAffected !== null) {
          console.log(`Estimated rows affected: ${preview.estimatedRowsAffected}`);
        }

        for (const w of preview.warnings) {
          console.log(`\x1b[33mWarning: ${w}\x1b[0m`);
        }

        store.logAudit('write_previewed', {
          profile_id: p.id,
          classification: classification.classification,
          impacted_tables: classification.impactedTables,
          sql_hash: hashSql(sql),
        });

        // Confirmation flow
        const confirmation = requestConfirmation(
          classification.classification,
          classification.hasWhereClause,
          powerSettings?.confirmPhrase,
        );

        console.log(`\n${confirmation.message}`);

        // Get confirmation phrase
        let phraseInput = opts.confirmPhrase ?? '';
        if (!phraseInput && process.stdin.isTTY) {
          phraseInput = await promptUser('\n> ');
        }

        if (!verifyConfirmation(phraseInput, confirmation.phrase)) {
          console.error('\nConfirmation phrase does not match. Operation cancelled.');
          process.exit(1);
        }

        // For dangerous ops, require the dangerous phrase too
        if (preview.requiresDangerousConfirmation) {
          console.log(`\nAdditional confirmation required for dangerous operation.`);
          console.log(`Type: ${preview.dangerousConfirmationPhrase}`);
          const dangerousInput = process.stdin.isTTY
            ? await promptUser('\n> ')
            : '';
          if (!verifyConfirmation(dangerousInput, preview.dangerousConfirmationPhrase)) {
            console.error('\nDangerous confirmation phrase does not match. Operation cancelled.');
            process.exit(1);
          }
        }

        // Final y/N prompt
        if (!opts.iUnderstand && process.stdin.isTTY) {
          const finalConfirm = await promptUser('Confirm execution? [y/N]: ');
          if (finalConfirm.toLowerCase() !== 'y') {
            console.log('Operation cancelled.');
            process.exit(0);
          }
        }

        // Execute write
        const writeResult = await executeWriteWithAudit(
          { ...connOpts, sql, params: [], profileId: p.id },
          preview,
          store,
        );

        if (writeResult.success) {
          console.log(`\n${writeResult.rowsAffected} row${writeResult.rowsAffected !== 1 ? 's' : ''} affected in ${writeResult.execMs}ms`);
          console.log('Audit event logged: write_executed');
        } else {
          console.error(`\nWrite failed: ${writeResult.error}`);
          process.exit(1);
        }

        return;
      }

      // ── Read path (existing behavior) ──────────────────────────
      const rewrittenSql = validation.rewrittenSql!;

      const smConfig = engine.getSafeModeConfig();
      if (smConfig.requireExplain) {
        try {
          const explainResult = await explainQuery({
            ...connOpts,
            sql: rewrittenSql,
            limits: { statementTimeoutMs: SAFE_DEFAULTS.statementTimeoutMs },
          });

          const evalResult = engine.evaluateExplain(explainResult);
          for (const w of evalResult.warnings) {
            console.log(`EXPLAIN warning: ${w}`);
          }

          if (!evalResult.allowed) {
            console.error(`EXPLAIN: BLOCKED`);
            for (const b of evalResult.blockers) {
              console.error(`  ${b}`);
            }
            process.exit(1);
          }

          console.log(
            `EXPLAIN: OK (est. ${evalResult.summary.estimatedRows} rows, cost ${evalResult.summary.estimatedCost})`,
          );
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`EXPLAIN failed: ${msg}`);
          process.exit(1);
        }
      }

      let result;
      try {
        result = await executeQuery({
          ...connOpts,
          sql: rewrittenSql,
          limits: {
            maxRows: SAFE_DEFAULTS.maxRows,
            statementTimeoutMs: SAFE_DEFAULTS.statementTimeoutMs,
          },
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`Error: Query failed — ${msg}`);
        process.exit(1);
      }

      console.log(formatTable(result.columns, result.rows));
      console.log('');
      console.log(
        `${result.rowCount} row${result.rowCount !== 1 ? 's' : ''} returned` +
          (result.truncated ? ` (truncated to ${SAFE_DEFAULTS.maxRows})` : '') +
          ` in ${result.execMs}ms`,
      );

      store.logAudit('query_ran', {
        profile: p.name,
        mode,
        sqlPreview: sql.slice(0, 200),
        rewritten: rewrittenSql !== sql.trim(),
        rowCount: result.rowCount,
        truncated: result.truncated,
        execMs: result.execMs,
      });
    } finally {
      store.close();
    }
  });

// ── ask ──────────────────────────────────────────────────────────────

program
  .command('ask')
  .description('Ask a natural language question — generates SQL via LLM, validates, and optionally executes')
  .argument('<question>', 'Natural language question')
  .option('--mode <mode>', 'Execution mode (safe|standard)', 'safe')
  .option('--dry-run', 'Generate + validate + EXPLAIN only, do not execute', false)
  .option('--no-execute', 'Alias for --dry-run')
  .option('--name <name>', 'Profile name (defaults to active)')
  .action(async (question: string, opts) => {
    const store = openStore();
    try {
      const p = getProfileForCommand(store, opts.name);
      const password = await getPassword();

      const mode: GuardrailMode = opts.mode === 'standard' ? 'standard' : 'safe';
      const dryRun = opts.dryRun || !opts.execute;

      console.log(`Question: "${question}"`);
      console.log(`Mode:     ${mode}`);
      console.log(`Execute:  ${dryRun ? 'no (dry-run)' : 'yes'}`);
      console.log('');

      console.log('Generating SQL...');
      const result = await askAndMaybeRun(
        {
          profile: {
            id: p.id,
            name: p.name,
            dbType: p.dbType,
            host: p.host,
            port: p.port,
            database: p.database,
            user: p.user,
            ssl: p.ssl,
          },
          password,
          question,
          mode,
          execute: !dryRun,
          dryRun,
        },
        store,
      );

      // Print generated SQL
      console.log(`\nGenerated SQL (model: ${result.model}${result.retried ? ', retried' : ''}):`);
      console.log(`  ${result.plan.sql}`);
      if (result.plan.params.length > 0) {
        console.log(`  Params: ${JSON.stringify(result.plan.params.map((p) => ({ [p.name]: p.value })))}`);
      }
      if (result.plan.assumptions.length > 0) {
        console.log(`  Assumptions: ${result.plan.assumptions.join('; ')}`);
      }
      console.log(`  Confidence: ${(result.plan.confidence * 100).toFixed(0)}%`);

      // Print policy result
      console.log(`\nPolicy: ${result.validation.allowed ? 'ALLOWED' : 'DENIED'}`);
      for (const w of result.validation.warnings) {
        console.log(`  Warning: ${w}`);
      }
      if (!result.validation.allowed) {
        console.error(`  Reason: ${result.validation.reason}`);
      }

      // Print EXPLAIN summary
      if (result.explainSummary) {
        console.log(`\nEXPLAIN:`);
        console.log(`  Estimated rows: ${result.explainSummary.estimatedRows}`);
        console.log(`  Estimated cost: ${result.explainSummary.estimatedCost}`);
        console.log(`  Seq scan:       ${result.explainSummary.hasSeqScan ? 'yes' : 'no'}`);
        for (const w of result.explainWarnings) {
          console.log(`  Warning: ${w}`);
        }
        if (result.explainBlockers.length > 0) {
          for (const b of result.explainBlockers) {
            console.error(`  BLOCKED: ${b}`);
          }
        }
      }

      // Print execution result
      if (result.executionResult) {
        console.log('');
        console.log(formatTable(result.executionResult.columns, result.executionResult.rows));
        console.log('');
        console.log(
          `${result.executionResult.rowCount} row${result.executionResult.rowCount !== 1 ? 's' : ''} returned` +
            (result.executionResult.truncated ? ` (truncated to ${SAFE_DEFAULTS.maxRows})` : '') +
            ` in ${result.executionResult.execMs}ms`,
        );

        // Store in memory for CSV export
        lastRunResult = {
          columns: result.executionResult.columns,
          rows: result.executionResult.rows,
          queryId: result.queryId,
        };
      } else if (result.status === 'dry-run') {
        console.log('\n--dry-run: skipping execution.');
      } else if (result.error) {
        console.error(`\nError: ${result.error}`);
      }

      console.log(`\nQuery ID: ${result.queryId}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`Error: ${msg}`);
      process.exit(1);
    } finally {
      store.close();
    }
  });

// ── history ─────────────────────────────────────────────────────────

const history = program.command('history').description('Query history');

history
  .command('list')
  .description('List recent queries')
  .option('--limit <n>', 'Number of items', '20')
  .action((opts) => {
    const store = openStore();
    try {
      const db = store.getDb();
      const items = listHistory(db, parseInt(opts.limit, 10) || 20);

      if (items.length === 0) {
        console.log('No queries in history. Use "openquery ask" to generate and run queries.');
        return;
      }

      console.log(
        formatTable(
          ['id', 'question', 'asked_at', 'status', 'exec_ms', 'row_count'],
          items.map((item) => ({
            id: item.id.slice(0, 8) + '...',
            question: item.question.length > 50 ? item.question.slice(0, 47) + '...' : item.question,
            asked_at: item.askedAt,
            status: item.status ?? '-',
            exec_ms: item.execMs ?? '-',
            row_count: item.rowCount ?? '-',
          })),
        ),
      );
    } finally {
      store.close();
    }
  });

history
  .command('show <id>')
  .description('Show details for a specific query')
  .action((id: string) => {
    const store = openStore();
    try {
      const db = store.getDb();

      // Support partial ID matching
      let fullId = id;
      if (id.length < 36) {
        const match = db
          .prepare('SELECT id FROM queries WHERE id LIKE ? LIMIT 1')
          .get(`${id}%`) as { id: string } | undefined;
        if (match) fullId = match.id;
      }

      const detail = getHistoryItem(db, fullId);
      if (!detail) {
        console.error(`Error: Query "${id}" not found.`);
        process.exit(1);
      }

      console.log(`Query ID:  ${detail.query.id}`);
      console.log(`Question:  ${detail.query.question}`);
      console.log(`Mode:      ${detail.query.mode}`);
      console.log(`Asked at:  ${detail.query.askedAt}`);

      if (detail.generation) {
        console.log(`\nGeneration:`);
        console.log(`  Model:      ${detail.generation.model}`);
        console.log(`  SQL:        ${detail.generation.generatedSql}`);
        console.log(`  Confidence: ${(detail.generation.confidence * 100).toFixed(0)}%`);
        if (detail.generation.assumptions.length > 0) {
          console.log(`  Assumptions: ${(detail.generation.assumptions as string[]).join('; ')}`);
        }
      }

      if (detail.run) {
        console.log(`\nExecution:`);
        console.log(`  Status:      ${detail.run.status}`);
        console.log(`  Rewritten:   ${detail.run.rewrittenSql}`);
        console.log(`  Exec time:   ${detail.run.execMs}ms`);
        console.log(`  Row count:   ${detail.run.rowCount}`);
        if (detail.run.errorText) {
          console.log(`  Error:       ${detail.run.errorText}`);
        }
        if (detail.run.explainSummary && typeof detail.run.explainSummary === 'object') {
          const es = detail.run.explainSummary as Record<string, unknown>;
          if (es.estimatedRows !== undefined) {
            console.log(`  EXPLAIN est. rows: ${es.estimatedRows}`);
            console.log(`  EXPLAIN est. cost: ${es.estimatedCost}`);
          }
        }
      }

      console.log('\nNote: Result rows are not stored in history.');
    } finally {
      store.close();
    }
  });

// ── export ──────────────────────────────────────────────────────────

program
  .command('export')
  .description('Export query results or reports')
  .option('--id <id>', 'Query ID to export')
  .option('--last', 'Use last in-memory result from current process')
  .option('--md <file>', 'Export as Markdown report')
  .option('--csv <file>', 'Export as CSV (only for --last, in-memory results)')
  .action((opts) => {
    if (opts.md && opts.id) {
      // Markdown report from history
      const store = openStore();
      try {
        const db = store.getDb();

        let fullId = opts.id;
        if (opts.id.length < 36) {
          const match = db
            .prepare('SELECT id FROM queries WHERE id LIKE ? LIMIT 1')
            .get(`${opts.id}%`) as { id: string } | undefined;
          if (match) fullId = match.id;
        }

        const detail = getHistoryItem(db, fullId);
        if (!detail) {
          console.error(`Error: Query "${opts.id}" not found.`);
          process.exit(1);
        }

        const lines: string[] = [
          `# OpenQuery Report`,
          '',
          `**Query ID:** ${detail.query.id}`,
          `**Question:** ${detail.query.question}`,
          `**Mode:** ${detail.query.mode}`,
          `**Asked at:** ${detail.query.askedAt}`,
          '',
        ];

        if (detail.generation) {
          lines.push(
            `## Generated SQL`,
            '',
            '```sql',
            detail.generation.generatedSql,
            '```',
            '',
            `**Model:** ${detail.generation.model}`,
            `**Confidence:** ${(detail.generation.confidence * 100).toFixed(0)}%`,
            '',
          );
          if (detail.generation.assumptions.length > 0) {
            lines.push(`**Assumptions:**`);
            for (const a of detail.generation.assumptions as string[]) {
              lines.push(`- ${a}`);
            }
            lines.push('');
          }
        }

        if (detail.run) {
          lines.push(
            `## Execution`,
            '',
            `**Status:** ${detail.run.status}`,
          );
          if (detail.run.rewrittenSql) {
            lines.push('', '**Rewritten SQL:**', '', '```sql', detail.run.rewrittenSql, '```', '');
          }
          if (detail.run.explainSummary && typeof detail.run.explainSummary === 'object') {
            const es = detail.run.explainSummary as Record<string, unknown>;
            lines.push(
              `### EXPLAIN Summary`,
              '',
              `- Estimated rows: ${es.estimatedRows ?? 'N/A'}`,
              `- Estimated cost: ${es.estimatedCost ?? 'N/A'}`,
              `- Seq scan: ${es.hasSeqScan ?? 'N/A'}`,
              '',
            );
          }
          lines.push(
            `**Exec time:** ${detail.run.execMs}ms`,
            `**Row count:** ${detail.run.rowCount}`,
          );
          if (detail.run.errorText) {
            lines.push(`**Error:** ${detail.run.errorText}`);
          }
          lines.push('');
        }

        lines.push('---', '*Note: Result rows are not included in history exports.*');

        writeFileSync(opts.md, lines.join('\n'), 'utf-8');
        console.log(`Markdown report exported to ${opts.md}`);
      } finally {
        store.close();
      }
      return;
    }

    if (opts.csv && opts.last) {
      // CSV from in-memory last result
      if (!lastRunResult) {
        console.error('No recent results to export; rerun query.');
        process.exit(1);
      }

      const csvLines: string[] = [];
      // Header
      csvLines.push(lastRunResult.columns.map(escapeCsvField).join(','));
      // Rows
      for (const row of lastRunResult.rows) {
        csvLines.push(
          lastRunResult.columns
            .map((col) => escapeCsvField(String(row[col] ?? '')))
            .join(','),
        );
      }

      writeFileSync(opts.csv, csvLines.join('\n') + '\n', 'utf-8');
      console.log(`CSV exported to ${opts.csv} (${lastRunResult.rows.length} rows)`);
      return;
    }

    if (opts.csv && !opts.last) {
      console.error(
        'CSV export requires --last flag (in-memory results from current session only). ' +
          'Use --md for history-based export.',
      );
      process.exit(1);
    }

    console.error('Usage: openquery export --id <id> --md out.md  OR  openquery export --last --csv out.csv');
    process.exit(1);
  });

// ── power ──────────────────────────────────────────────────────────

const power = program.command('power').description('POWER mode — enable/disable write operations');

power
  .command('enable')
  .description('Enable POWER mode (write operations) for a profile')
  .option('--profile <name>', 'Profile name (defaults to active)')
  .option('--dangerous', 'Also enable dangerous operations (DROP, TRUNCATE)', false)
  .action((opts) => {
    const store = openStore();
    try {
      const profileName = opts.profile ?? store.getActiveProfile();
      if (!profileName) {
        console.error('Error: No profile specified and no active profile set.');
        process.exit(1);
      }
      const profile = store.getProfileByName(profileName);
      if (!profile) {
        console.error(`Error: Profile "${profileName}" not found.`);
        process.exit(1);
      }

      store.updateProfilePower(profileName, {
        allowWrite: true,
        allowDangerous: opts.dangerous,
      });

      store.logAudit('power_enabled', {
        profile_id: profile.id,
        allow_dangerous: opts.dangerous,
      });

      console.log(`POWER mode enabled for "${profileName}".`);
      console.log('Write operations now allowed with confirmation.');
      if (opts.dangerous) {
        console.log('WARNING: Dangerous operations (DROP, TRUNCATE) are also enabled.');
      }
    } finally {
      store.close();
    }
  });

power
  .command('disable')
  .description('Disable POWER mode (return to read-only) for a profile')
  .option('--profile <name>', 'Profile name (defaults to active)')
  .action((opts) => {
    const store = openStore();
    try {
      const profileName = opts.profile ?? store.getActiveProfile();
      if (!profileName) {
        console.error('Error: No profile specified and no active profile set.');
        process.exit(1);
      }
      const profile = store.getProfileByName(profileName);
      if (!profile) {
        console.error(`Error: Profile "${profileName}" not found.`);
        process.exit(1);
      }

      store.updateProfilePower(profileName, {
        allowWrite: false,
        allowDangerous: false,
      });

      store.logAudit('power_disabled', { profile_id: profile.id });

      console.log(`POWER mode disabled for "${profileName}". Back to read-only.`);
    } finally {
      store.close();
    }
  });

power
  .command('status')
  .description('Show POWER mode status for a profile')
  .option('--profile <name>', 'Profile name (defaults to active)')
  .action((opts) => {
    const store = openStore();
    try {
      const profileName = opts.profile ?? store.getActiveProfile();
      if (!profileName) {
        console.error('Error: No profile specified and no active profile set.');
        process.exit(1);
      }
      const settings = store.getProfilePowerSettings(profileName);
      if (!settings) {
        console.error(`Error: Profile "${profileName}" not found.`);
        process.exit(1);
      }

      console.log(`Profile "${profileName}":`);
      console.log(`  Write operations: ${settings.allowWrite ? 'ENABLED (POWER mode)' : 'disabled (SAFE mode)'}`);
      console.log(`  Dangerous ops:    ${settings.allowDangerous ? 'ENABLED' : 'disabled'}`);
      if (settings.confirmPhrase) {
        console.log(`  Custom phrase:    "${settings.confirmPhrase}"`);
      }
    } finally {
      store.close();
    }
  });

// ── readline helper ────────────────────────────────────────────────

function promptUser(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

function escapeCsvField(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

// ── parse ────────────────────────────────────────────────────────────

program.parse();
