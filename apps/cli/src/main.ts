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
import { normalizeArgv } from './argv.js';
import {
  EXIT_CODE_SUCCESS,
  toExitCode,
  usageError,
  runtimeError,
  policyError,
} from './errors.js';
import {
  outputOptionsFromCommand,
  printCommandSuccess,
  printError,
  printHuman,
  printHumanTable,
  printWarning,
  withOutputFlags,
} from './output.js';

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
    throw usageError('No profile specified and no active profile set.');
  }
  const profile = store.getProfileByName(profileName);
  if (!profile) {
    throw usageError(`Profile "${profileName}" not found.`, 'PROFILE_NOT_FOUND');
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

async function resolveCommandPassword(options?: { passwordStdin?: boolean }): Promise<string> {
  if (options?.passwordStdin) {
    const fromStdin = await readStdin();
    if (!fromStdin) {
      throw usageError('Expected password on stdin, but received empty input.');
    }
    return fromStdin;
  }
  return getPassword();
}

async function resolvePasswordForProfile(
  profile: { dbType: string },
  options?: { passwordStdin?: boolean },
): Promise<string> {
  if (profile.dbType === 'sqlite') {
    return '';
  }
  return resolveCommandPassword(options);
}

async function runCommand(
  command: Command,
  fn: (output: ReturnType<typeof outputOptionsFromCommand>) => Promise<void> | void,
): Promise<void> {
  const output = outputOptionsFromCommand(command);
  try {
    await fn(output);
  } catch (error: unknown) {
    printError(error, output);
    process.exitCode = toExitCode(error);
  }
}

function withExamples(cmd: Command, lines: string[]): Command {
  const rendered = lines.map((line) => `  ${line}`).join('\n');
  cmd.addHelpText('after', `\nExamples:\n${rendered}\n`);
  return cmd;
}

// ── Program ──────────────────────────────────────────────────────────

const program = new Command();

program
  .name('openquery')
  .description('OpenQuery — local-first SQL Copilot')
  .option('--json', 'Machine-readable JSON output', false)
  .option('--quiet', 'Suppress non-essential logs', false)
  .option('--verbose', 'Show additional context', false)
  .option('--debug', 'Show internal error details and stacks', false)
  .showHelpAfterError('(run with --help for usage)')
  .helpOption('-h, --help', 'display help')
  .version(VERSION, '-v, --version', 'Show version number');

program.exitOverride();
program.addHelpText(
  'after',
  `
Command groups:
  Setup:    doctor, profiles, schema
  Query:    ask, run
  History:  history, export
  Safety:   power
`,
);

// ── doctor ───────────────────────────────────────────────────────────

withExamples(
  withOutputFlags(
    program
      .command('doctor')
      .description('Check environment and dependencies')
      .action(async function (this: Command) {
        await runCommand(this as Command, async (output) => {
          const nodeVersion = process.version;
          const nodeMajor = parseInt(nodeVersion.slice(1), 10);
          const nodeOk = nodeMajor >= 20;

          let pnpmVersion = 'not found';
          try {
            pnpmVersion = execSync('pnpm --version', { encoding: 'utf-8' }).trim();
          } catch {
            // not installed
          }

          const openaiKeySet = Boolean(process.env.OPENAI_API_KEY);
          const model = process.env.OPENQUERY_MODEL || 'gpt-4o-mini (default)';
          const configDir = join(homedir(), '.openquery');
          const dbPath = defaultDbPath();

          const payload = {
            node: { version: nodeVersion, ok: nodeOk, requiredMajor: 20 },
            pnpm: { version: pnpmVersion !== 'not found' ? pnpmVersion : null, ok: pnpmVersion !== 'not found' },
            openAiKeySet: openaiKeySet,
            model,
            paths: {
              configDir,
              configDirExists: existsSync(configDir),
              dbPath,
              dbPathExists: existsSync(dbPath),
            },
            safeDefaults: {
              defaultLimit: SAFE_DEFAULTS.defaultLimit,
              maxRows: SAFE_DEFAULTS.maxRows,
              statementTimeoutMs: SAFE_DEFAULTS.statementTimeoutMs,
            },
          };

          if (output.json) {
            printCommandSuccess(payload, output);
            return;
          }

          printHuman('OpenQuery Doctor', output);
          printHuman('================', output);
          printHuman('', output);
          printHuman(`Node.js:    ${nodeVersion} ${nodeOk ? '✓' : '✗ (requires >=20)'}`, output);
          printHuman(
            `pnpm:       ${pnpmVersion !== 'not found' ? `v${pnpmVersion} ✓` : '✗ not found'}`,
            output,
          );
          printHuman(`OpenAI key: ${openaiKeySet ? 'set ✓' : 'not set'}`, output);
          printHuman(`LLM model:  ${model}`, output);
          printHuman(
            `Config dir: ${configDir} ${existsSync(configDir) ? '(exists)' : '(will be created)'}`,
            output,
          );
          printHuman(`DB path:    ${dbPath} ${existsSync(dbPath) ? '(exists)' : '(will be created)'}`, output);
          printHuman('', output);
          printHuman('Safe defaults:', output);
          printHuman(`  Default LIMIT:     ${SAFE_DEFAULTS.defaultLimit}`, output);
          printHuman(`  Max rows:          ${SAFE_DEFAULTS.maxRows}`, output);
          printHuman(`  Statement timeout: ${SAFE_DEFAULTS.statementTimeoutMs}ms`, output);
        });
      }),
  ),
  ['openquery doctor', 'openquery doctor --json'],
);

// ── profiles ─────────────────────────────────────────────────────────

const profiles = program.command('profiles').description('Manage database connection profiles');

withExamples(
  withOutputFlags(
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
      .action(async function (this: Command, opts) {
        await runCommand(this as Command, async (output) => {
          if (opts.type !== 'postgres') {
            throw usageError('Only "postgres" is supported right now.');
          }
          const port = parseInt(opts.port, 10);
          if (!Number.isFinite(port) || port <= 0 || port > 65535) {
            throw usageError('Invalid --port. Expected 1-65535.');
          }
          if (!opts.host?.trim() || !opts.database?.trim() || !opts.user?.trim()) {
            throw usageError('Host, database, and user are required.');
          }

          const store = openStore();
          try {
            if (store.getProfileByName(opts.name)) {
              throw usageError(`Profile "${opts.name}" already exists.`, 'PROFILE_EXISTS');
            }

            store.createProfile({
              name: opts.name,
              db_type: opts.type,
              host: opts.host,
              port,
              database: opts.database,
              user: opts.user,
              ssl: opts.ssl,
            });

            const becameActive = !store.getActiveProfile();
            if (becameActive) {
              store.setActiveProfile(opts.name);
            }
            store.logAudit('profile_created', { name: opts.name, type: opts.type });

            if (output.json) {
              printCommandSuccess({ name: opts.name, dbType: opts.type, active: becameActive }, output);
            } else {
              printHuman(
                becameActive
                  ? `Profile "${opts.name}" created and set as active.`
                  : `Profile "${opts.name}" created.`,
                output,
              );
            }
          } finally {
            store.close();
          }
        });
      }),
  ),
  ['openquery profiles add --name demo --type postgres --host 127.0.0.1 --port 55432 --database openquery_test --user openquery'],
);

withExamples(
  withOutputFlags(
    profiles
      .command('edit')
      .description('Edit an existing connection profile')
      .requiredOption('--name <name>', 'Profile name')
      .option('--host <host>', 'Database host')
      .option('--port <port>', 'Database port')
      .option('--database <database>', 'Database name')
      .option('--user <user>', 'Database user')
      .option('--ssl', 'Enable SSL')
      .option('--no-ssl', 'Disable SSL')
      .action(async function (this: Command, opts) {
        await runCommand(this as Command, async (output) => {
          const store = openStore();
          try {
            const current = store.getProfileByName(opts.name);
            if (!current) throw usageError(`Profile "${opts.name}" not found.`, 'PROFILE_NOT_FOUND');

            const nextPort = opts.port ? parseInt(opts.port, 10) : (current.port ?? 5432);
            if (!Number.isFinite(nextPort) || nextPort <= 0 || nextPort > 65535) {
              throw usageError('Invalid --port. Expected 1-65535.');
            }

            store.updateProfileConnection(opts.name, {
              host: opts.host ?? current.host,
              port: nextPort,
              database: opts.database ?? current.database,
              user: opts.user ?? current.user,
              ssl: typeof opts.ssl === 'boolean' ? opts.ssl : Boolean(current.ssl),
            });

            printCommandSuccess({ name: opts.name, updated: true }, output, `Profile "${opts.name}" updated.`);
          } finally {
            store.close();
          }
        });
      }),
  ),
  ['openquery profiles edit --name demo --host 127.0.0.1 --port 55432'],
);

withExamples(
  withOutputFlags(
    profiles
      .command('list')
      .description('List all connection profiles')
      .action(async function (this: Command) {
        await runCommand(this as Command, async (output) => {
          const store = openStore();
          try {
            const all = store.listProfiles();
            const active = store.getActiveProfile();

            if (output.json) {
              printCommandSuccess(
                all.map((p) => ({
                  name: p.name,
                  dbType: p.db_type,
                  host: p.host,
                  port: p.port,
                  database: p.database,
                  user: p.user,
                  ssl: Boolean(p.ssl),
                  active: p.name === active,
                })),
                output,
              );
              return;
            }

            if (all.length === 0) {
              printHuman('No profiles configured. Use "openquery profiles add" to create one.', output);
              return;
            }

            printHumanTable(
              ['active', 'name', 'type', 'host', 'port', 'database', 'user', 'ssl'],
              all.map((p) => ({
                active: p.name === active ? '*' : '',
                name: p.name,
                type: p.db_type,
                host: p.host,
                port: p.port,
                database: p.database,
                user: p.user,
                ssl: p.ssl ? 'yes' : 'no',
              })),
              output,
            );
          } finally {
            store.close();
          }
        });
      }),
  ),
  ['openquery profiles list', 'openquery profiles list --json'],
);

withExamples(
  withOutputFlags(
    profiles
      .command('use <name>')
      .description('Set the active profile')
      .action(async function (this: Command, name: string) {
        await runCommand(this as Command, async (output) => {
          const store = openStore();
          try {
            if (!store.getProfileByName(name)) {
              throw usageError(`Profile "${name}" not found.`, 'PROFILE_NOT_FOUND');
            }
            store.setActiveProfile(name);
            store.logAudit('profile_activated', { name });
            printCommandSuccess({ activeProfile: name }, output, `Active profile set to "${name}".`);
          } finally {
            store.close();
          }
        });
      }),
  ),
  ['openquery profiles use demo'],
);

withExamples(
  withOutputFlags(
    profiles
      .command('remove <name>')
      .description('Remove a connection profile')
      .action(async function (this: Command, name: string) {
        await runCommand(this as Command, async (output) => {
          const store = openStore();
          try {
            if (!store.deleteProfile(name)) {
              throw usageError(`Profile "${name}" not found.`, 'PROFILE_NOT_FOUND');
            }
            store.logAudit('profile_removed', { name });
            printCommandSuccess({ removed: name }, output, `Profile "${name}" removed.`);
          } finally {
            store.close();
          }
        });
      }),
  ),
  ['openquery profiles remove demo'],
);

withExamples(
  withOutputFlags(
    profiles
      .command('test')
      .description('Test connection for a profile')
      .option('--name <name>', 'Profile name (defaults to active)')
      .option('--password-stdin', 'Read password from stdin for non-interactive usage', false)
      .action(async function (this: Command, opts) {
        await runCommand(this as Command, async (output) => {
          const store = openStore();
          try {
            const p = getProfileForCommand(store, opts.name);
            const password = await resolvePasswordForProfile(p, { passwordStdin: opts.passwordStdin });
            const start = Date.now();
            const result = await testDbConnection({
              dbType: p.dbType,
              host: p.host,
              port: p.port,
              database: p.database,
              user: p.user,
              password,
              ssl: p.ssl,
            });
            const latencyMs = Date.now() - start;

            if (!result.ok) {
              throw runtimeError(`Connection failed: ${result.error}`, 'DB_CONN_FAILED', {
                profile: p.name,
                host: p.host,
                port: p.port,
                database: p.database,
              });
            }

            const payload = {
              profile: p.name,
              ok: true,
              latencyMs,
              serverVersion: result.serverVersion ?? null,
            };
            if (output.json) {
              printCommandSuccess(payload, output);
            } else {
              printHuman(`Connection successful for "${p.name}" (${latencyMs}ms).`, output);
              if (result.serverVersion) {
                printHuman(`Server: ${result.serverVersion}`, output);
              }
            }
          } finally {
            store.close();
          }
        });
      }),
  ),
  ['openquery profiles test --name demo', 'printf "%s" "$OPENQUERY_PASSWORD" | openquery profiles test --name demo --password-stdin --json'],
);

// ── schema ──────────────────────────────────────────────────────────

const schema = program.command('schema').description('Schema introspection commands');

withExamples(
  withOutputFlags(
    schema
      .command('refresh')
      .description('Introspect and store database schema for the active profile')
      .option('--name <name>', 'Profile name (defaults to active)')
      .option('--password-stdin', 'Read password from stdin for non-interactive usage', false)
      .action(async function (this: Command, opts) {
        await runCommand(this as Command, async (output) => {
          const store = openStore();
          try {
            const p = getProfileForCommand(store, opts.name);
            const password = await resolvePasswordForProfile(p, { passwordStdin: opts.passwordStdin });

            if (output.verbose) {
              printHuman(`Introspecting schema for "${p.name}"...`, output);
            }
            const snapshot = await introspectSchema(
              { host: p.host, port: p.port, database: p.database, user: p.user, ssl: p.ssl },
              password,
            );

            const snapshotJson = JSON.stringify(snapshot);
            store.storeSchemaSnapshot(p.id, snapshotJson);

            const totalCols = snapshot.tables.reduce((sum, t) => sum + t.columns.length, 0);
            store.logAudit('schema_refreshed', {
              profile: p.name,
              tableCount: snapshot.tables.length,
              columnCount: totalCols,
            });

            printCommandSuccess(
              {
                profile: p.name,
                tables: snapshot.tables.length,
                columns: totalCols,
                capturedAt: snapshot.capturedAt,
              },
              output,
              `Schema refreshed for "${p.name}" (${snapshot.tables.length} tables, ${totalCols} columns).`,
            );
          } finally {
            store.close();
          }
        });
      }),
  ),
  ['openquery schema refresh --name demo', 'printf "%s" "$OPENQUERY_PASSWORD" | openquery schema refresh --password-stdin --json'],
);

withExamples(
  withOutputFlags(
    schema
      .command('status')
      .description('Show schema snapshot status for a profile')
      .option('--name <name>', 'Profile name (defaults to active)')
      .action(async function (this: Command, opts) {
        await runCommand(this as Command, async (output) => {
          const store = openStore();
          try {
            const p = getProfileForCommand(store, opts.name);
            const latest = store.getLatestSchemaSnapshot(p.id);
            if (!latest) {
              printCommandSuccess(
                { profile: p.name, hasSnapshot: false, tables: 0, columns: 0, capturedAt: null },
                output,
                `No schema snapshot found for "${p.name}". Run "openquery schema refresh".`,
              );
              return;
            }
            const parsed = JSON.parse(latest.snapshotJson) as { tables: Array<{ columns: unknown[] }> };
            const totalCols = parsed.tables.reduce((sum, t) => sum + t.columns.length, 0);
            printCommandSuccess(
              {
                profile: p.name,
                hasSnapshot: true,
                tables: parsed.tables.length,
                columns: totalCols,
                capturedAt: latest.capturedAt,
              },
              output,
              `Schema snapshot for "${p.name}": ${parsed.tables.length} tables, ${totalCols} columns, captured ${latest.capturedAt}.`,
            );
          } finally {
            store.close();
          }
        });
      }),
  ),
  ['openquery schema status', 'openquery schema status --json'],
);

// ── run ──────────────────────────────────────────────────────────────

withExamples(
  withOutputFlags(
    program
      .command('run')
      .description('Execute a SQL query through the policy engine')
      .option('--sql <sql>', 'SQL statement to execute')
      .option('--mode <mode>', 'Execution mode (safe|standard)', 'safe')
      .option('--name <name>', 'Profile name (defaults to active)')
      .option('--limit <limit>', 'Override default LIMIT')
      .option('--max-rows <n>', 'Max rows for execution', String(SAFE_DEFAULTS.maxRows))
      .option('--timeout-ms <n>', 'Statement timeout in milliseconds', String(SAFE_DEFAULTS.statementTimeoutMs))
      .option('--format <format>', 'Output format (table|json|csv)', 'table')
      .option('--confirm-phrase <phrase>', 'Provide confirmation phrase for write operations')
      .option('--password-stdin', 'Read password from stdin for non-interactive usage', false)
      .option('--i-understand', 'Skip final y/N prompt (phrase still required)', false)
      .action(async function (this: Command, opts) {
        await runCommand(this as Command, async (output) => {
          let sql: string = opts.sql ?? '';
          if (!sql) {
            if (process.stdin.isTTY) {
              throw usageError('Provide SQL via --sql or pipe SQL via stdin.');
            }
            sql = await readStdin();
          }
          if (!sql.trim()) {
            throw usageError('Empty SQL statement.');
          }
          const mode: GuardrailMode = opts.mode === 'standard' ? 'standard' : 'safe';
          const maxRows = parseInt(opts.maxRows, 10);
          const timeoutMs = parseInt(opts.timeoutMs, 10);
          if (!Number.isFinite(maxRows) || maxRows <= 0) throw usageError('Invalid --max-rows.');
          if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw usageError('Invalid --timeout-ms.');

          const store = openStore();
          try {
            const p = getProfileForCommand(store, opts.name);
            const password = await resolvePasswordForProfile(p, { passwordStdin: opts.passwordStdin });
            const classification = classifyStatement(sql);
            const isWrite = classification.classification !== 'read';
            const powerSettings = store.getProfilePowerSettings(p.name);
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
              const limit = parseInt(opts.limit, 10);
              if (!Number.isFinite(limit) || limit <= 0) {
                throw usageError('Invalid --limit.');
              }
              engine.setSafeModeConfig({ defaultLimit: limit });
            }

            const validation = engine.validateAndRewrite(sql);
            if (!validation.allowed) {
              if (isWrite) {
                store.logAudit('write_blocked', {
                  profile_id: p.id,
                  classification: classification.classification,
                  reason: validation.reason,
                  sql_hash: hashSql(sql),
                });
              }
              throw policyError(validation.reason, {
                details: validation.details,
                suggestion: validation.suggestedFix,
                warnings: validation.warnings,
              });
            }
            for (const warning of validation.warnings) {
              printWarning(warning, output);
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

            if (isWrite) {
              let preview;
              try {
                preview = await previewWrite({
                  ...connOpts,
                  sql,
                  params: [],
                  customConfirmPhrase: powerSettings?.confirmPhrase,
                });
              } catch (error: unknown) {
                throw runtimeError(
                  error instanceof Error ? error.message : String(error),
                  'DB_CONN_FAILED',
                );
              }

              store.logAudit('write_previewed', {
                profile_id: p.id,
                classification: classification.classification,
                impacted_tables: classification.impactedTables,
                sql_hash: hashSql(sql),
              });

              const confirmation = requestConfirmation(
                classification.classification,
                classification.hasWhereClause,
                powerSettings?.confirmPhrase,
              );
              let phraseInput = opts.confirmPhrase ?? '';
              if (!phraseInput && process.stdin.isTTY) {
                phraseInput = await promptUser('\nType confirmation phrase:\n> ');
              }
              if (!verifyConfirmation(phraseInput, confirmation.phrase)) {
                throw policyError('Confirmation phrase mismatch for write operation.');
              }

              if (preview.requiresDangerousConfirmation) {
                const dangerousInput = process.stdin.isTTY ? await promptUser('\nType dangerous confirmation phrase:\n> ') : '';
                if (!verifyConfirmation(dangerousInput, preview.dangerousConfirmationPhrase)) {
                  throw policyError('Dangerous confirmation phrase mismatch.');
                }
              }

              if (!opts.iUnderstand && process.stdin.isTTY) {
                const finalConfirm = await promptUser('Confirm execution? [y/N]: ');
                if (finalConfirm.toLowerCase() !== 'y') {
                  printCommandSuccess({ cancelled: true }, output, 'Operation cancelled.');
                  return;
                }
              }

              let writeResult;
              try {
                writeResult = await executeWriteWithAudit(
                  { ...connOpts, sql, params: [], profileId: p.id },
                  preview,
                  store,
                );
              } catch (error: unknown) {
                throw runtimeError(
                  error instanceof Error ? error.message : String(error),
                  'DB_QUERY_FAILED',
                );
              }
              if (!writeResult.success) {
                throw runtimeError(writeResult.error ?? 'Write execution failed.', 'DB_QUERY_FAILED');
              }

              printCommandSuccess(
                {
                  classification: classification.classification,
                  rowsAffected: writeResult.rowsAffected,
                  execMs: writeResult.execMs,
                },
                output,
                `${writeResult.rowsAffected} row${writeResult.rowsAffected !== 1 ? 's' : ''} affected in ${writeResult.execMs}ms`,
              );
              return;
            }

            const rewrittenSql = validation.rewrittenSql!;
            const smConfig = engine.getSafeModeConfig();
            let explainSummary: { estimatedRows: number; estimatedCost: number; hasSeqScan: boolean } | null = null;
            if (smConfig.requireExplain) {
              let explainResult;
              try {
                explainResult = await explainQuery({
                  ...connOpts,
                  sql: rewrittenSql,
                  limits: { statementTimeoutMs: timeoutMs },
                });
              } catch (error: unknown) {
                throw runtimeError(
                  error instanceof Error ? error.message : String(error),
                  'DB_QUERY_FAILED',
                );
              }
              const evalResult = engine.evaluateExplain(explainResult);
              explainSummary = evalResult.summary;
              for (const warning of evalResult.warnings) {
                printWarning(`EXPLAIN: ${warning}`, output);
              }
              if (!evalResult.allowed) {
                throw policyError('Query blocked by EXPLAIN gating.', {
                  blockers: evalResult.blockers,
                  warnings: evalResult.warnings,
                  summary: evalResult.summary,
                });
              }
            }

            let result;
            try {
              result = await executeQuery({
                ...connOpts,
                sql: rewrittenSql,
                limits: { maxRows, statementTimeoutMs: timeoutMs },
              });
            } catch (error: unknown) {
              throw runtimeError(
                error instanceof Error ? error.message : String(error),
                'DB_QUERY_FAILED',
              );
            }

            lastRunResult = { columns: result.columns, rows: result.rows, queryId: `${Date.now()}` };

            if (output.json || opts.format === 'json') {
              printCommandSuccess(
                {
                  mode,
                  sql: rewrittenSql,
                  explainSummary,
                  rowCount: result.rowCount,
                  truncated: result.truncated,
                  execMs: result.execMs,
                  columns: result.columns,
                  rows: result.rows,
                },
                output,
              );
            } else if (opts.format === 'csv') {
              const csvLines = [result.columns.map(escapeCsvField).join(',')];
              for (const row of result.rows) {
                csvLines.push(result.columns.map((col) => escapeCsvField(String(row[col] ?? ''))).join(','));
              }
              printHuman(csvLines.join('\n'), output);
            } else {
              printHumanTable(result.columns, result.rows, output);
              printHuman('', output);
              printHuman(
                `${result.rowCount} row${result.rowCount !== 1 ? 's' : ''} returned` +
                  (result.truncated ? ` (truncated to ${maxRows})` : '') +
                  ` in ${result.execMs}ms`,
                output,
              );
            }

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
      }),
  ),
  [
    'openquery run --sql "SELECT id, email FROM users LIMIT 20"',
    'openquery run --sql "SELECT * FROM users" --json',
    'openquery run --sql "SELECT id FROM users LIMIT 10" --format csv',
  ],
);

// ── ask ──────────────────────────────────────────────────────────────

withExamples(
  withOutputFlags(
    program
      .command('ask')
      .description('Ask a natural language question — generate SQL, apply policy, and optionally execute')
      .argument('<question>', 'Natural language question')
      .option('--mode <mode>', 'Execution mode (safe|standard)', 'safe')
      .option('--dry-run', 'Generate + validate + EXPLAIN only, do not execute', false)
      .option('--no-execute', 'Alias for --dry-run')
      .option('--name <name>', 'Profile name (defaults to active)')
      .option('--password-stdin', 'Read password from stdin for non-interactive usage', false)
      .action(async function (this: Command, question: string, opts) {
        await runCommand(this as Command, async (output) => {
          const store = openStore();
          try {
            const p = getProfileForCommand(store, opts.name);
            const password = await resolvePasswordForProfile(p, { passwordStdin: opts.passwordStdin });
            const mode: GuardrailMode = opts.mode === 'standard' ? 'standard' : 'safe';
            const dryRun = opts.dryRun || !opts.execute;

            if (output.verbose) {
              printHuman(`Question: "${question}"`, output);
              printHuman(`Mode: ${mode}`, output);
            }

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

            if (result.status === 'blocked') {
              throw policyError(result.validation.reason || 'Query blocked by policy.', {
                validation: result.validation,
                explainBlockers: result.explainBlockers,
              });
            }
            if (result.error) {
              throw runtimeError(result.error, 'OPENAI_FAILED');
            }

            if (output.json) {
              printCommandSuccess(result, output);
              return;
            }

            printHuman(`Generated SQL (model: ${result.model}${result.retried ? ', retried' : ''}):`, output);
            printHuman(`  ${result.plan.sql}`, output);
            if (result.plan.params.length > 0) {
              printHuman(`  Params: ${JSON.stringify(result.plan.params.map((p) => ({ [p.name]: p.value })))}`, output);
            }
            if (result.plan.assumptions.length > 0) {
              printHuman(`  Assumptions: ${result.plan.assumptions.join('; ')}`, output);
            }
            printHuman(`  Confidence: ${(result.plan.confidence * 100).toFixed(0)}%`, output);
            printHuman('', output);
            printHuman(`Policy: ${result.validation.allowed ? 'ALLOWED' : 'DENIED'}`, output);
            for (const warning of result.validation.warnings) {
              printWarning(warning, output);
            }

            if (result.explainSummary) {
              printHuman('', output);
              printHuman('EXPLAIN:', output);
              printHuman(`  Estimated rows: ${result.explainSummary.estimatedRows}`, output);
              printHuman(`  Estimated cost: ${result.explainSummary.estimatedCost}`, output);
              printHuman(`  Seq scan:       ${result.explainSummary.hasSeqScan ? 'yes' : 'no'}`, output);
              for (const warning of result.explainWarnings) {
                printWarning(`EXPLAIN: ${warning}`, output);
              }
            }

            if (result.executionResult) {
              printHuman('', output);
              printHumanTable(result.executionResult.columns, result.executionResult.rows, output);
              printHuman('', output);
              printHuman(
                `${result.executionResult.rowCount} row${result.executionResult.rowCount !== 1 ? 's' : ''} returned` +
                  (result.executionResult.truncated ? ` (truncated to ${SAFE_DEFAULTS.maxRows})` : '') +
                  ` in ${result.executionResult.execMs}ms`,
                output,
              );
              lastRunResult = {
                columns: result.executionResult.columns,
                rows: result.executionResult.rows,
                queryId: result.queryId,
              };
            } else if (result.status === 'dry-run') {
              printHuman('--dry-run: skipping execution.', output);
            }
            printHuman(`Query ID: ${result.queryId}`, output);
          } finally {
            store.close();
          }
        });
      }),
  ),
  [
    'openquery ask "show active users" --dry-run',
    'openquery ask "top spenders" --mode safe',
    'openquery ask "recent paid orders" --json',
  ],
);

// ── history ─────────────────────────────────────────────────────────

const history = program.command('history').description('Query history');

withExamples(
  withOutputFlags(
    history
      .command('list')
      .description('List recent queries')
      .option('--limit <n>', 'Number of items', '20')
      .action(async function (this: Command, opts) {
        await runCommand(this as Command, async (output) => {
          const store = openStore();
          try {
            const db = store.getDb();
            const limit = parseInt(opts.limit, 10) || 20;
            const items = listHistory(db, limit);

            if (output.json) {
              printCommandSuccess(items, output);
              return;
            }
            if (items.length === 0) {
              printHuman('No queries in history. Use "openquery ask" to generate and run queries.', output);
              return;
            }
            printHumanTable(
              ['id', 'question', 'asked_at', 'status', 'exec_ms', 'row_count'],
              items.map((item) => ({
                id: item.id.slice(0, 8) + '...',
                question: item.question.length > 50 ? item.question.slice(0, 47) + '...' : item.question,
                asked_at: item.askedAt,
                status: item.status ?? '-',
                exec_ms: item.execMs ?? '-',
                row_count: item.rowCount ?? '-',
              })),
              output,
            );
          } finally {
            store.close();
          }
        });
      }),
  ),
  ['openquery history list --limit 20', 'openquery history list --json'],
);

withExamples(
  withOutputFlags(
    history
      .command('show <id>')
      .description('Show details for a specific query')
      .action(async function (this: Command, id: string) {
        await runCommand(this as Command, async (output) => {
          const store = openStore();
          try {
            const db = store.getDb();
            let fullId = id;
            if (id.length < 36) {
              const match = db
                .prepare('SELECT id FROM queries WHERE id LIKE ? LIMIT 1')
                .get(`${id}%`) as { id: string } | undefined;
              if (match) fullId = match.id;
            }
            const detail = getHistoryItem(db, fullId);
            if (!detail) throw usageError(`Query "${id}" not found.`);

            if (output.json) {
              printCommandSuccess(detail, output);
              return;
            }
            printHuman(`Query ID:  ${detail.query.id}`, output);
            printHuman(`Question:  ${detail.query.question}`, output);
            printHuman(`Mode:      ${detail.query.mode}`, output);
            printHuman(`Asked at:  ${detail.query.askedAt}`, output);
            if (detail.generation) {
              printHuman('\nGeneration:', output);
              printHuman(`  Model:      ${detail.generation.model}`, output);
              printHuman(`  SQL:        ${detail.generation.generatedSql}`, output);
              printHuman(`  Confidence: ${(detail.generation.confidence * 100).toFixed(0)}%`, output);
            }
            if (detail.run) {
              printHuman('\nExecution:', output);
              printHuman(`  Status:      ${detail.run.status}`, output);
              printHuman(`  Rewritten:   ${detail.run.rewrittenSql}`, output);
              printHuman(`  Exec time:   ${detail.run.execMs}ms`, output);
              printHuman(`  Row count:   ${detail.run.rowCount}`, output);
            }
            printHuman('\nNote: Result rows are not stored in history.', output);
          } finally {
            store.close();
          }
        });
      }),
  ),
  ['openquery history show <query-id>', 'openquery history show <query-id-prefix> --json'],
);

// ── export ──────────────────────────────────────────────────────────

withExamples(
  withOutputFlags(
    program
      .command('export')
      .description('Export query results or reports')
      .option('--id <id>', 'Query ID to export')
      .option('--last', 'Use last in-memory result from current process')
      .option('--md <file>', 'Export as Markdown report')
      .option('--csv <file>', 'Export as CSV (only for --last, in-memory results)')
      .action(async function (this: Command, opts) {
        await runCommand(this as Command, async (output) => {
          if (opts.md && opts.id) {
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
              if (!detail) throw usageError(`Query "${opts.id}" not found.`);

              const lines: string[] = [
                '# OpenQuery Report',
                '',
                `**Query ID:** ${detail.query.id}`,
                `**Question:** ${detail.query.question}`,
                `**Mode:** ${detail.query.mode}`,
                `**Asked at:** ${detail.query.askedAt}`,
                '',
              ];
              if (detail.generation) {
                lines.push(
                  '## Generated SQL',
                  '',
                  '```sql',
                  detail.generation.generatedSql,
                  '```',
                  '',
                  `**Model:** ${detail.generation.model}`,
                  `**Confidence:** ${(detail.generation.confidence * 100).toFixed(0)}%`,
                  '',
                );
              }
              if (detail.run) {
                lines.push('## Execution', '', `**Status:** ${detail.run.status}`);
                if (detail.run.rewrittenSql) {
                  lines.push('', '**Rewritten SQL:**', '', '```sql', detail.run.rewrittenSql, '```', '');
                }
              }
              lines.push('---', '*Note: Result rows are not included in history exports.*');
              writeFileSync(opts.md, lines.join('\n'), 'utf-8');
              printCommandSuccess({ file: opts.md, format: 'md' }, output, `Markdown report exported to ${opts.md}`);
            } finally {
              store.close();
            }
            return;
          }

          if (opts.csv && opts.last) {
            if (!lastRunResult) throw usageError('No recent results to export; rerun query first.');
            const csvLines: string[] = [lastRunResult.columns.map(escapeCsvField).join(',')];
            for (const row of lastRunResult.rows) {
              csvLines.push(lastRunResult.columns.map((col) => escapeCsvField(String(row[col] ?? ''))).join(','));
            }
            writeFileSync(opts.csv, csvLines.join('\n') + '\n', 'utf-8');
            printCommandSuccess({ file: opts.csv, format: 'csv', rows: lastRunResult.rows.length }, output, `CSV exported to ${opts.csv} (${lastRunResult.rows.length} rows)`);
            return;
          }

          if (opts.csv && !opts.last) {
            throw usageError('CSV export requires --last. Use --md for history-based export.');
          }
          throw usageError('Usage: openquery export --id <id> --md out.md OR openquery export --last --csv out.csv');
        });
      }),
  ),
  ['openquery export --id <query-id> --md out.md', 'openquery export --last --csv out.csv'],
);

// ── power ──────────────────────────────────────────────────────────

const power = program.command('power').description('POWER mode — enable/disable write operations');

withExamples(
  withOutputFlags(
    power
      .command('enable')
      .description('Enable POWER mode (write operations) for a profile')
      .option('--profile <name>', 'Profile name (defaults to active)')
      .option('--dangerous', 'Also enable dangerous operations (DROP, TRUNCATE)', false)
      .option('--yes', 'Skip typed enable confirmation', false)
      .action(async function (this: Command, opts) {
        await runCommand(this as Command, async (output) => {
          const store = openStore();
          try {
            const profileName = opts.profile ?? store.getActiveProfile();
            if (!profileName) throw usageError('No profile specified and no active profile set.');
            const profile = store.getProfileByName(profileName);
            if (!profile) throw usageError(`Profile "${profileName}" not found.`, 'PROFILE_NOT_FOUND');

            if (!opts.yes && process.stdin.isTTY) {
              const phrase = await promptUser('Type "ENABLE POWER" to continue: ');
              if (phrase.trim() !== 'ENABLE POWER') {
                throw usageError('POWER mode enable cancelled: confirmation phrase mismatch.');
              }
            }

            store.updateProfilePower(profileName, {
              allowWrite: true,
              allowDangerous: opts.dangerous,
            });
            store.logAudit('power_enabled', {
              profile_id: profile.id,
              allow_dangerous: opts.dangerous,
            });

            printCommandSuccess(
              { profile: profileName, allowWrite: true, allowDangerous: Boolean(opts.dangerous) },
              output,
              `POWER mode enabled for "${profileName}".`,
            );
            if (opts.dangerous && !output.json) {
              printWarning('Dangerous operations are enabled for this profile.', output);
            }
          } finally {
            store.close();
          }
        });
      }),
  ),
  ['openquery power enable --profile demo', 'openquery power enable --profile demo --dangerous --yes'],
);

withExamples(
  withOutputFlags(
    power
      .command('disable')
      .description('Disable POWER mode (return to read-only) for a profile')
      .option('--profile <name>', 'Profile name (defaults to active)')
      .action(async function (this: Command, opts) {
        await runCommand(this as Command, async (output) => {
          const store = openStore();
          try {
            const profileName = opts.profile ?? store.getActiveProfile();
            if (!profileName) throw usageError('No profile specified and no active profile set.');
            const profile = store.getProfileByName(profileName);
            if (!profile) throw usageError(`Profile "${profileName}" not found.`, 'PROFILE_NOT_FOUND');

            store.updateProfilePower(profileName, {
              allowWrite: false,
              allowDangerous: false,
            });
            store.logAudit('power_disabled', { profile_id: profile.id });
            printCommandSuccess({ profile: profileName, allowWrite: false, allowDangerous: false }, output, `POWER mode disabled for "${profileName}".`);
          } finally {
            store.close();
          }
        });
      }),
  ),
  ['openquery power disable --profile demo'],
);

withExamples(
  withOutputFlags(
    power
      .command('status')
      .description('Show POWER mode status for a profile')
      .option('--profile <name>', 'Profile name (defaults to active)')
      .action(async function (this: Command, opts) {
        await runCommand(this as Command, async (output) => {
          const store = openStore();
          try {
            const profileName = opts.profile ?? store.getActiveProfile();
            if (!profileName) throw usageError('No profile specified and no active profile set.');
            const settings = store.getProfilePowerSettings(profileName);
            if (!settings) throw usageError(`Profile "${profileName}" not found.`, 'PROFILE_NOT_FOUND');

            if (output.json) {
              printCommandSuccess({ profile: profileName, ...settings }, output);
              return;
            }
            printHuman(`Profile "${profileName}":`, output);
            printHuman(`  Write operations: ${settings.allowWrite ? 'ENABLED (POWER mode)' : 'disabled (SAFE mode)'}`, output);
            printHuman(`  Dangerous ops:    ${settings.allowDangerous ? 'ENABLED' : 'disabled'}`, output);
            if (settings.confirmPhrase) {
              printHuman('  Custom phrase:    [configured]', output);
            }
          } finally {
            store.close();
          }
        });
      }),
  ),
  ['openquery power status --profile demo', 'openquery power status --json'],
);

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

async function main(): Promise<void> {
  const normalizedArgv = normalizeArgv(process.argv);
  try {
    await program.parseAsync(normalizedArgv);
    if (process.exitCode === undefined) {
      process.exitCode = EXIT_CODE_SUCCESS;
    }
  } catch (error: unknown) {
    const output = outputOptionsFromCommand(program);
    // Commander wraps usage/validation failures as CommanderError
    if ((error as { code?: string })?.code === 'commander.helpDisplayed') {
      process.exitCode = EXIT_CODE_SUCCESS;
      return;
    }
    if ((error as { code?: string })?.code?.startsWith?.('commander.')) {
      printError(usageError((error as Error).message), output);
      process.exitCode = 1;
      return;
    }
    printError(error, output);
    process.exitCode = toExitCode(error);
  }
}

void main();
