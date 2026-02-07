/**
 * Bridge handlers — maps RPC method names to core function calls.
 * Each handler receives params + password (from Tauri keychain) and returns a result.
 */

import {
  LocalStore,
  defaultDbPath,
  testDbConnection,
  introspectSchemaForConnection,
  askAndMaybeRun,
  listHistory,
  getHistoryItem,
  previewWrite,
  executeWriteWithAudit,
  executeQuery,
  explainQuery,
  SAFE_DEFAULTS,
  DefaultPolicyEngine,
  classifyStatement,
  defaultSafeModeConfig,
  type StoredProfile,
  type SchemaSnapshot,
  type GuardrailMode,
} from '@openquery/core';
import Database from 'better-sqlite3';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';

let store: LocalStore | null = null;
const launchEnvOpenAiKey = process.env.OPENAI_API_KEY;
let desktopInjectedOpenAiKey: string | null = null;
const DEMO_SQLITE_PROFILE_NAME = 'demo-sqlite';
const DEMO_POSTGRES_PROFILE_NAME = 'demo-postgres';
const DEMO_POSTGRES_PORT_KEY = 'demo_postgres_port';
const DEMO_SQLITE_DB_PATH = join(homedir(), '.openquery', 'demo', 'openquery-demo.sqlite');
const DOCKER_SERVICE = 'postgres';
const SQLITE_DEMO_SEED_SQL = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  is_active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  status TEXT NOT NULL,
  total_cents INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS internal_audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action TEXT NOT NULL,
  actor TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

DELETE FROM orders;
DELETE FROM users;
DELETE FROM internal_audit_log;
DELETE FROM sqlite_sequence WHERE name IN ('users', 'orders', 'internal_audit_log');

INSERT INTO users (email, full_name, is_active) VALUES
  ('alice@example.com', 'Alice Nguyen', 1),
  ('bob@example.com', 'Bob Martinez', 1),
  ('carol@example.com', 'Carol Singh', 0),
  ('dana@example.com', 'Dana Brown', 1);

INSERT INTO orders (user_id, status, total_cents) VALUES
  (1, 'paid', 1250),
  (1, 'paid', 2450),
  (2, 'pending', 990),
  (2, 'failed', 3150),
  (3, 'paid', 500),
  (4, 'paid', 10750);

INSERT INTO internal_audit_log (action, actor) VALUES
  ('seed_loaded', 'system');
`;

function getStore(): LocalStore {
  if (!store) {
    store = new LocalStore(defaultDbPath());
    store.migrate();
  }
  return store;
}

function getProfile(nameOrId?: string): StoredProfile {
  const s = getStore();
  if (nameOrId) {
    const byName = s.getProfileByName(nameOrId);
    if (byName) return byName;
  }
  const activeName = s.getActiveProfile();
  if (!activeName) throw new Error('No active profile set.');
  const profile = s.getProfileByName(activeName);
  if (!profile) throw new Error(`Active profile "${activeName}" not found.`);
  return profile;
}

function applyDesktopOpenAiKey(apiKey?: string): void {
  const trimmed = typeof apiKey === 'string' ? apiKey.trim() : '';
  if (trimmed) {
    process.env.OPENAI_API_KEY = trimmed;
    desktopInjectedOpenAiKey = trimmed;
    return;
  }
  if (desktopInjectedOpenAiKey !== null) {
    if (launchEnvOpenAiKey) {
      process.env.OPENAI_API_KEY = launchEnvOpenAiKey;
    } else {
      delete process.env.OPENAI_API_KEY;
    }
    desktopInjectedOpenAiKey = null;
  }
}

function ensureDir(path: string): void {
  if (!existsSync(path)) {
    mkdirSync(path, { recursive: true });
  }
}

function seedSqliteDemoDatabase(dbPath: string): void {
  ensureDir(dirname(dbPath));
  const db = new Database(dbPath);
  try {
    db.exec(SQLITE_DEMO_SEED_SQL);
  } finally {
    db.close();
  }
}

function ensureDemoSqliteProfile(storeRef: LocalStore, dbPath: string): StoredProfile {
  const existing = storeRef.getProfileByName(DEMO_SQLITE_PROFILE_NAME);
  if (!existing) {
    const created = storeRef.createProfile({
      name: DEMO_SQLITE_PROFILE_NAME,
      db_type: 'sqlite',
      host: 'local',
      port: 0,
      database: dbPath,
      user: 'demo',
      ssl: false,
    });
    storeRef.setActiveProfile(DEMO_SQLITE_PROFILE_NAME);
    return created;
  }

  storeRef.updateProfileConnection(DEMO_SQLITE_PROFILE_NAME, {
    db_type: 'sqlite',
    host: 'local',
    port: 0,
    database: dbPath,
    user: 'demo',
    ssl: false,
  });
  storeRef.setActiveProfile(DEMO_SQLITE_PROFILE_NAME);
  return storeRef.getProfileByName(DEMO_SQLITE_PROFILE_NAME) as StoredProfile;
}

function ensureDemoPostgresProfile(storeRef: LocalStore, port: number): StoredProfile {
  const existing = storeRef.getProfileByName(DEMO_POSTGRES_PROFILE_NAME);
  if (!existing) {
    const created = storeRef.createProfile({
      name: DEMO_POSTGRES_PROFILE_NAME,
      db_type: 'postgres',
      host: '127.0.0.1',
      port,
      database: 'openquery_test',
      user: 'openquery',
      ssl: false,
    });
    storeRef.setActiveProfile(DEMO_POSTGRES_PROFILE_NAME);
    return created;
  }

  storeRef.updateProfileConnection(DEMO_POSTGRES_PROFILE_NAME, {
    db_type: 'postgres',
    host: '127.0.0.1',
    port,
    database: 'openquery_test',
    user: 'openquery',
    ssl: false,
  });
  storeRef.setActiveProfile(DEMO_POSTGRES_PROFILE_NAME);
  return storeRef.getProfileByName(DEMO_POSTGRES_PROFILE_NAME) as StoredProfile;
}

function getRepoRoot(): string | null {
  let cursor = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 10; i += 1) {
    if (existsSync(join(cursor, 'infra', 'docker', 'docker-compose.yml'))) {
      return cursor;
    }
    const next = dirname(cursor);
    if (next === cursor) break;
    cursor = next;
  }
  return null;
}

function getComposeFilePath(): string {
  const root = getRepoRoot();
  if (!root) {
    throw new Error('Docker compose file not found. Use Demo (No Docker) mode.');
  }
  return join(root, 'infra', 'docker', 'docker-compose.yml');
}

function runProcess(
  command: string,
  args: string[],
  opts: { env?: NodeJS.ProcessEnv; timeoutMs?: number } = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const proc = spawn(command, args, {
      env: opts.env ?? process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    proc.on('error', (err) => {
      resolve({ code: 127, stdout, stderr: `${stderr}\n${String(err.message)}`.trim() });
    });
    let timeout: NodeJS.Timeout | null = null;
    if (opts.timeoutMs && opts.timeoutMs > 0) {
      timeout = setTimeout(() => {
        proc.kill('SIGTERM');
      }, opts.timeoutMs);
    }
    proc.on('close', (code) => {
      if (timeout) clearTimeout(timeout);
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

async function checkPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', () => {
      resolve(false);
    });
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    server.listen(port, '127.0.0.1');
  });
}

async function selectFreePort(preferred: number[]): Promise<number> {
  const deduped = [...new Set(preferred.filter((p) => Number.isInteger(p) && p > 0 && p < 65535))];
  for (const port of deduped) {
    if (await checkPortFree(port)) return port;
  }
  for (let i = 0; i < 20; i += 1) {
    const random = 55000 + Math.floor(Math.random() * 1000);
    if (await checkPortFree(random)) return random;
  }
  throw new Error('No free localhost port found in the demo range (55000-56000).');
}

async function getComposeContainerId(composeFile: string): Promise<string> {
  const ps = await runProcess('docker', ['compose', '-f', composeFile, 'ps', '-q', DOCKER_SERVICE]);
  if (ps.code !== 0) return '';
  return ps.stdout.trim();
}

// ── Profile handlers ──────────────────────────────────────────────

export function profilesList(): StoredProfile[] {
  const s = getStore();
  const all = s.listProfiles();
  const active = s.getActiveProfile();
  return all.map((p) => ({ ...p, _active: p.name === active } as StoredProfile & { _active: boolean }));
}

export function profilesAdd(params: {
  name: string;
  db_type: string;
  host: string;
  port: number;
  database: string;
  user: string;
  ssl: boolean;
}): StoredProfile {
  const s = getStore();
  if (s.getProfileByName(params.name)) {
    throw new Error(`Profile "${params.name}" already exists.`);
  }
  const profile = s.createProfile(params);
  if (!s.getActiveProfile()) {
    s.setActiveProfile(params.name);
  }
  s.logAudit('profile_created', { name: params.name });
  return profile;
}

export function profilesRemove(params: { name: string }): { ok: boolean } {
  const s = getStore();
  const profile = s.getProfileByName(params.name);
  if (!profile) throw new Error(`Profile "${params.name}" not found.`);
  s.deleteProfile(params.name);
  s.logAudit('profile_removed', { name: params.name });
  return { ok: true, profileId: profile.id } as { ok: boolean };
}

export function profilesUse(params: { name: string }): { ok: boolean } {
  const s = getStore();
  if (!s.getProfileByName(params.name)) {
    throw new Error(`Profile "${params.name}" not found.`);
  }
  s.setActiveProfile(params.name);
  return { ok: true };
}

export async function profilesTest(params: { name?: string; password: string }): Promise<{ ok: boolean; error?: string; serverVersion?: string }> {
  const profile = getProfile(params.name);
  return testDbConnection({
    dbType: profile.db_type,
    host: profile.host ?? 'localhost',
    port: profile.port ?? 5432,
    database: profile.database ?? '',
    user: profile.user ?? '',
    password: params.password,
    ssl: profile.ssl === 1,
  });
}

export function profilesGetActive(): { name: string | null } {
  return { name: getStore().getActiveProfile() };
}

// ── Schema handlers ───────────────────────────────────────────────

export async function schemaRefresh(params: { name?: string; password: string }): Promise<{ tables: number; columns: number }> {
  const s = getStore();
  const profile = getProfile(params.name);
  const snapshot = await introspectSchemaForConnection({
    dbType: profile.db_type,
    host: profile.host ?? 'localhost',
    port: profile.port ?? 5432,
    database: profile.database ?? '',
    user: profile.user ?? '',
    password: params.password,
    ssl: profile.ssl === 1,
  });
  const snapshotJson = JSON.stringify(snapshot);
  s.storeSchemaSnapshot(profile.id, snapshotJson);
  s.logAudit('schema_refreshed', { profile: profile.name });
  const totalCols = snapshot.tables.reduce((sum, t) => sum + t.columns.length, 0);
  return { tables: snapshot.tables.length, columns: totalCols };
}

export function schemaSearch(params: { name?: string; query: string }): Array<{ schema?: string; table: string; column?: string; dataType?: string }> {
  const s = getStore();
  const profile = getProfile(params.name);
  const snap = s.getLatestSchemaSnapshot(profile.id);
  if (!snap) throw new Error('No schema snapshot. Run schema refresh first.');
  const schema: SchemaSnapshot = JSON.parse(snap.snapshotJson);
  const q = params.query.toLowerCase();
  const results: Array<{ schema?: string; table: string; column?: string; dataType?: string }> = [];

  for (const table of schema.tables) {
    const tableName = table.schema ? `${table.schema}.${table.name}` : table.name;
    if (tableName.toLowerCase().includes(q)) {
      results.push({ schema: table.schema, table: table.name });
    }
    for (const col of table.columns) {
      if (col.name.toLowerCase().includes(q)) {
        results.push({ schema: table.schema, table: table.name, column: col.name, dataType: col.dataType });
      }
    }
  }
  return results.slice(0, 50);
}

export function schemaTableDetail(params: { name?: string; table: string; schema?: string }): unknown {
  const s = getStore();
  const profile = getProfile(params.name);
  const snap = s.getLatestSchemaSnapshot(profile.id);
  if (!snap) throw new Error('No schema snapshot. Run schema refresh first.');
  const schemaData: SchemaSnapshot = JSON.parse(snap.snapshotJson);

  const found = schemaData.tables.find((t) =>
    t.name === params.table && (!params.schema || t.schema === params.schema),
  );
  if (!found) throw new Error(`Table "${params.table}" not found in schema snapshot.`);
  return found;
}

export function schemaGetSnapshot(params: { name?: string }): SchemaSnapshot | null {
  const s = getStore();
  const profile = getProfile(params.name);
  const snap = s.getLatestSchemaSnapshot(profile.id);
  if (!snap) return null;
  return JSON.parse(snap.snapshotJson);
}

// ── Ask handlers ──────────────────────────────────────────────────

export async function askDryRun(params: {
  question: string;
  mode?: string;
  password: string;
  name?: string;
  openAiApiKey?: string;
}): Promise<unknown> {
  const s = getStore();
  const profile = getProfile(params.name);
  const mode: GuardrailMode = params.mode === 'standard' ? 'standard' : 'safe';
  applyDesktopOpenAiKey(params.openAiApiKey);
  return askAndMaybeRun(
    {
      profile: {
        id: profile.id,
        name: profile.name,
        dbType: profile.db_type,
        host: profile.host ?? 'localhost',
        port: profile.port ?? 5432,
        database: profile.database ?? '',
        user: profile.user ?? '',
        ssl: profile.ssl === 1,
      },
      password: params.password,
      question: params.question,
      mode,
      execute: false,
      dryRun: true,
    },
    s,
  );
}

export async function askRun(params: {
  question: string;
  mode?: string;
  password: string;
  name?: string;
  openAiApiKey?: string;
}): Promise<unknown> {
  const s = getStore();
  const profile = getProfile(params.name);
  const mode: GuardrailMode = params.mode === 'standard' ? 'standard' : 'safe';
  applyDesktopOpenAiKey(params.openAiApiKey);
  return askAndMaybeRun(
    {
      profile: {
        id: profile.id,
        name: profile.name,
        dbType: profile.db_type,
        host: profile.host ?? 'localhost',
        port: profile.port ?? 5432,
        database: profile.database ?? '',
        user: profile.user ?? '',
        ssl: profile.ssl === 1,
      },
      password: params.password,
      question: params.question,
      mode,
      execute: true,
      dryRun: false,
    },
    s,
  );
}

// ── Workspace SQL handlers ─────────────────────────────────────────

export async function workspaceSql(params: {
  sql: string;
  mode?: string;
  action?: string;
  password: string;
  name?: string;
  policy?: {
    maxRowsThreshold?: number;
    maxCostThreshold?: number;
    enforceLimit?: boolean;
  };
}): Promise<unknown> {
  const sql = (params.sql ?? '').trim();
  if (!sql) throw new Error('SQL cannot be empty.');

  const s = getStore();
  const profile = getProfile(params.name);
  const mode: GuardrailMode = params.mode === 'standard' ? 'standard' : 'safe';
  const action = params.action ?? 'run';
  const powerSettings = s.getProfilePowerSettings(profile.name);

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

  if (params.policy) {
    engine.setSafeModeConfig({
      maxEstimatedRows: params.policy.maxRowsThreshold,
      maxEstimatedCost: params.policy.maxCostThreshold,
      enforceLimit: params.policy.enforceLimit,
    });
  }

  const classification = classifyStatement(sql);
  const validation = engine.validateAndRewrite(sql);
  const rewrittenSql = validation.rewrittenSql ?? sql;

  const base = {
    classification,
    validation,
    rewrittenSql,
    explainSummary: null as unknown,
    explainWarnings: [] as string[],
    explainBlockers: [] as string[],
  };

  if (!validation.allowed) {
    return {
      ...base,
      status: 'blocked',
      error: validation.reason,
      executionResult: null,
    };
  }

  const conn = {
    dbType: profile.db_type,
    host: profile.host ?? 'localhost',
    port: profile.port ?? 5432,
    database: profile.database ?? '',
    user: profile.user ?? '',
    password: params.password,
    ssl: profile.ssl === 1,
  };

  const shouldExplain =
    action === 'explain' || action === 'dry-run' || engine.getSafeModeConfig().requireExplain;

  let explainSummary: unknown = null;
  let explainWarnings: string[] = [];
  let explainBlockers: string[] = [];

  if (shouldExplain) {
    try {
      const explain = await explainQuery({
        ...conn,
        sql: rewrittenSql,
        limits: { statementTimeoutMs: SAFE_DEFAULTS.statementTimeoutMs },
      });
      const explainEval = engine.evaluateExplain(explain);
      explainSummary = explainEval.summary;
      explainWarnings = explainEval.warnings;
      explainBlockers = explainEval.blockers;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        ...base,
        status: 'error',
        error: `EXPLAIN failed: ${msg}`,
        executionResult: null,
      };
    }
  }

  if (action === 'explain') {
    return {
      ...base,
      status: 'explained',
      explainSummary,
      explainWarnings,
      explainBlockers,
      executionResult: null,
    };
  }

  if (explainBlockers.length > 0) {
    return {
      ...base,
      status: 'blocked',
      explainSummary,
      explainWarnings,
      explainBlockers,
      error: explainBlockers.join('; '),
      executionResult: null,
    };
  }

  if (action === 'dry-run') {
    return {
      ...base,
      status: 'dry-run',
      explainSummary,
      explainWarnings,
      explainBlockers,
      executionResult: null,
    };
  }

  if (classification.classification !== 'read') {
    return {
      ...base,
      status: 'requires-power',
      explainSummary,
      explainWarnings,
      explainBlockers,
      error:
        'Write SQL requires POWER mode preview + confirmation. Use "Preview Write" before execution.',
      executionResult: null,
    };
  }

  try {
    const executionResult = await executeQuery({
      ...conn,
      sql: rewrittenSql,
      limits: {
        maxRows: SAFE_DEFAULTS.maxRows,
        statementTimeoutMs: SAFE_DEFAULTS.statementTimeoutMs,
      },
    });
    return {
      ...base,
      status: 'ok',
      explainSummary,
      explainWarnings,
      explainBlockers,
      executionResult,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ...base,
      status: 'error',
      explainSummary,
      explainWarnings,
      explainBlockers,
      error: msg,
      executionResult: null,
    };
  }
}

// ── History handlers ──────────────────────────────────────────────

export function historyList(params: { limit?: number }): unknown {
  const s = getStore();
  return listHistory(s.getDb(), params.limit ?? 50);
}

export function historyShow(params: { id: string }): unknown {
  const s = getStore();
  const db = s.getDb();
  let fullId = params.id;
  if (params.id.length < 36) {
    const match = db.prepare('SELECT id FROM queries WHERE id LIKE ? LIMIT 1').get(`${params.id}%`) as { id: string } | undefined;
    if (match) fullId = match.id;
  }
  const detail = getHistoryItem(db, fullId);
  if (!detail) throw new Error(`Query "${params.id}" not found.`);
  return detail;
}

export function historyExportMd(params: { id: string }): string {
  const s = getStore();
  const db = s.getDb();
  let fullId = params.id;
  if (params.id.length < 36) {
    const match = db.prepare('SELECT id FROM queries WHERE id LIKE ? LIMIT 1').get(`${params.id}%`) as { id: string } | undefined;
    if (match) fullId = match.id;
  }
  const detail = getHistoryItem(db, fullId);
  if (!detail) throw new Error(`Query "${params.id}" not found.`);

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
    lines.push(`## Generated SQL`, '', '```sql', detail.generation.generatedSql, '```', '',
      `**Model:** ${detail.generation.model}`,
      `**Confidence:** ${(detail.generation.confidence * 100).toFixed(0)}%`, '');
  }

  if (detail.run) {
    lines.push(`## Execution`, '', `**Status:** ${detail.run.status}`);
    if (detail.run.rewrittenSql) {
      lines.push('', '**Rewritten SQL:**', '', '```sql', detail.run.rewrittenSql, '```', '');
    }
    lines.push(`**Exec time:** ${detail.run.execMs}ms`, `**Row count:** ${detail.run.rowCount}`, '');
  }

  lines.push('---', '*Result rows are not included in history exports.*');
  return lines.join('\n');
}

// ── Settings handlers ───────────────────────────────────────────────

export function settingsStatus(): {
  openAiKeySet: boolean;
  model: string;
  appVersion: string;
  defaults: {
    maxRowsThreshold: number;
    maxCostThreshold: number;
    enforceLimit: boolean;
  };
} {
  const safeDefaults = defaultSafeModeConfig();
  return {
    openAiKeySet: Boolean(process.env.OPENAI_API_KEY),
    model: process.env.OPENQUERY_MODEL || 'gpt-4o-mini',
    appVersion: process.env.npm_package_version || '0.0.1',
    defaults: {
      maxRowsThreshold: safeDefaults.maxEstimatedRows,
      maxCostThreshold: safeDefaults.maxEstimatedCost,
      enforceLimit: safeDefaults.enforceLimit,
    },
  };
}

export async function settingsTestOpenAiKey(params: { apiKey?: string }): Promise<{ ok: boolean; message: string }> {
  const candidate = typeof params.apiKey === 'string' && params.apiKey.trim().length > 0
    ? params.apiKey.trim()
    : process.env.OPENAI_API_KEY?.trim();

  if (!candidate) {
    return {
      ok: false,
      message: 'OpenAI API key is not set. Save one in Settings or use OPENAI_API_KEY as fallback.',
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch('https://api.openai.com/v1/models?limit=1', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${candidate}`,
      },
      signal: controller.signal,
    });

    if (response.ok) {
      return { ok: true, message: 'API key validated successfully.' };
    }
    if (response.status === 401) {
      return { ok: false, message: 'OpenAI rejected this key (401). Check the value and try again.' };
    }
    if (response.status === 429) {
      return { ok: true, message: 'Key accepted, but the account is currently rate or quota limited (429).' };
    }

    const body = (await response.text()).slice(0, 200);
    return {
      ok: false,
      message: `OpenAI validation failed (${response.status}). ${body || 'No error body returned.'}`,
    };
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'AbortError') {
      return { ok: false, message: 'Validation timed out. Check network access and try again.' };
    }
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, message: `Validation request failed: ${msg}` };
  } finally {
    clearTimeout(timeout);
  }
}

// ── Setup + fixture handlers ───────────────────────────────────────

export function demoNoDockerStatus(): {
  ready: boolean;
  dbPath: string;
  active: boolean;
  profileName: string;
} {
  const s = getStore();
  const profile = s.getProfileByName(DEMO_SQLITE_PROFILE_NAME);
  return {
    ready: existsSync(DEMO_SQLITE_DB_PATH),
    dbPath: DEMO_SQLITE_DB_PATH,
    active: s.getActiveProfile() === DEMO_SQLITE_PROFILE_NAME,
    profileName: DEMO_SQLITE_PROFILE_NAME,
  };
}

export function demoNoDockerPrepare(params: { reset?: boolean } = {}): {
  ready: boolean;
  dbPath: string;
  profileName: string;
} {
  if (params.reset && existsSync(DEMO_SQLITE_DB_PATH)) {
    rmSync(DEMO_SQLITE_DB_PATH, { force: true });
  }
  if (!existsSync(DEMO_SQLITE_DB_PATH)) {
    seedSqliteDemoDatabase(DEMO_SQLITE_DB_PATH);
  }
  const s = getStore();
  ensureDemoSqliteProfile(s, DEMO_SQLITE_DB_PATH);
  s.logAudit(params.reset ? 'demo_sqlite_reset' : 'demo_sqlite_ready', {
    db_path: DEMO_SQLITE_DB_PATH,
  });
  return {
    ready: true,
    dbPath: DEMO_SQLITE_DB_PATH,
    profileName: DEMO_SQLITE_PROFILE_NAME,
  };
}

export function demoNoDockerReset(): {
  ready: boolean;
  dbPath: string;
  profileName: string;
} {
  return demoNoDockerPrepare({ reset: true });
}

export async function fixtureCheckDocker(): Promise<{
  installed: boolean;
  daemonRunning: boolean;
  message?: string;
}> {
  const version = await runProcess('docker', ['--version'], { timeoutMs: 5_000 });
  if (version.code !== 0) {
    return {
      installed: false,
      daemonRunning: false,
      message: 'Docker is not installed. Install Docker Desktop or use Demo (No Docker).',
    };
  }
  const info = await runProcess('docker', ['info'], { timeoutMs: 8_000 });
  if (info.code !== 0) {
    return {
      installed: true,
      daemonRunning: false,
      message: 'Docker daemon is not running. Start Docker Desktop or use Demo (No Docker).',
    };
  }
  return { installed: true, daemonRunning: true };
}

export async function fixturePickPort(params: { preferredPorts?: number[] } = {}): Promise<{ port: number }> {
  const s = getStore();
  const remembered = Number(s.getSetting(DEMO_POSTGRES_PORT_KEY) ?? '');
  const preferred = [
    ...(params.preferredPorts ?? [5432, 55432, 55433, 55434]),
    ...(Number.isFinite(remembered) ? [remembered] : []),
  ];
  const port = await selectFreePort(preferred);
  s.setSetting(DEMO_POSTGRES_PORT_KEY, String(port));
  return { port };
}

export async function fixtureStatus(): Promise<{ running: boolean; port?: number; message?: string }> {
  const docker = await fixtureCheckDocker();
  if (!docker.installed || !docker.daemonRunning) {
    return { running: false, message: docker.message };
  }

  const composeFile = getComposeFilePath();
  const cid = await getComposeContainerId(composeFile);
  if (!cid) {
    const rememberedPort = Number(getStore().getSetting(DEMO_POSTGRES_PORT_KEY) ?? '');
    return {
      running: false,
      port: Number.isFinite(rememberedPort) ? rememberedPort : undefined,
    };
  }

  const portRes = await runProcess('docker', ['port', cid, '5432/tcp'], { timeoutMs: 5_000 });
  let hostPort: number | undefined;
  if (portRes.code === 0) {
    const match = portRes.stdout.match(/:(\d+)\s*$/m);
    if (match) {
      hostPort = Number(match[1]);
    }
  }
  if (hostPort) {
    getStore().setSetting(DEMO_POSTGRES_PORT_KEY, String(hostPort));
  }
  return { running: true, port: hostPort };
}

export async function fixtureLogs(params: { tail?: number } = {}): Promise<{ lines: string[] }> {
  const composeFile = getComposeFilePath();
  const tail = Math.max(1, Math.min(500, params.tail ?? 50));
  const result = await runProcess(
    'docker',
    ['compose', '-f', composeFile, 'logs', '--tail', String(tail), DOCKER_SERVICE],
    { timeoutMs: 10_000 },
  );
  const text = `${result.stdout}\n${result.stderr}`.trim();
  return {
    lines: text ? text.split('\n').slice(-tail) : [],
  };
}

export async function fixtureUp(params: { port: number }): Promise<{
  running: boolean;
  port: number;
  profileName: string;
}> {
  const docker = await fixtureCheckDocker();
  if (!docker.installed || !docker.daemonRunning) {
    throw new Error(docker.message || 'Docker is unavailable. Use Demo (No Docker) mode.');
  }
  if (!Number.isInteger(params.port) || params.port <= 0 || params.port > 65535) {
    throw new Error('Invalid port supplied for Docker fixture.');
  }
  const composeFile = getComposeFilePath();
  const env = { ...process.env, OPENQUERY_PG_PORT: String(params.port) };
  const up = await runProcess('docker', ['compose', '-f', composeFile, 'up', '-d'], { env, timeoutMs: 20_000 });
  if (up.code !== 0) {
    const output = `${up.stdout}\n${up.stderr}`;
    if (/address already in use/i.test(output)) {
      throw new Error('Selected port is already in use. Choose another free port and retry.');
    }
    throw new Error(`Failed to start Docker fixture: ${output.trim()}`);
  }

  const startAt = Date.now();
  let cid = '';
  let isReady = false;
  while (Date.now() - startAt < 60_000) {
    cid = await getComposeContainerId(composeFile);
    if (cid) {
      const readyResult = await runProcess(
        'docker',
        ['exec', cid, 'pg_isready', '-U', 'openquery', '-d', 'openquery_test'],
        { timeoutMs: 5_000 },
      );
      if (readyResult.code === 0) {
        isReady = true;
        break;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }

  if (!cid || !isReady) {
    const logs = await fixtureLogs({ tail: 50 });
    throw new Error(`Fixture container did not start.\n${logs.lines.join('\n')}`);
  }

  const usersTable = await runProcess(
    'docker',
    ['exec', '-i', cid, 'psql', '-U', 'openquery', '-d', 'openquery_test', '-t', '-A', '-c', "SELECT to_regclass('public.users') IS NOT NULL;"],
    { timeoutMs: 5_000 },
  );
  if (usersTable.code !== 0 || usersTable.stdout.trim() !== 't') {
    const logs = await fixtureLogs({ tail: 50 });
    throw new Error(`Seed verification failed (users table missing).\n${logs.lines.join('\n')}`);
  }

  const usersCount = await runProcess(
    'docker',
    ['exec', '-i', cid, 'psql', '-U', 'openquery', '-d', 'openquery_test', '-t', '-A', '-c', 'SELECT COUNT(*) FROM users;'],
    { timeoutMs: 5_000 },
  );
  const count = Number(usersCount.stdout.trim());
  if (usersCount.code !== 0 || !Number.isFinite(count) || count <= 0) {
    const logs = await fixtureLogs({ tail: 50 });
    throw new Error(`Seed verification failed (users row count invalid).\n${logs.lines.join('\n')}`);
  }

  const s = getStore();
  ensureDemoPostgresProfile(s, params.port);
  s.setSetting(DEMO_POSTGRES_PORT_KEY, String(params.port));
  s.logAudit('demo_postgres_up', { port: params.port });

  return {
    running: true,
    port: params.port,
    profileName: DEMO_POSTGRES_PROFILE_NAME,
  };
}

export async function fixtureDown(): Promise<{ ok: boolean }> {
  const docker = await fixtureCheckDocker();
  if (!docker.installed || !docker.daemonRunning) {
    throw new Error(docker.message || 'Docker is unavailable.');
  }
  const composeFile = getComposeFilePath();
  const result = await runProcess('docker', ['compose', '-f', composeFile, 'down', '-v'], { timeoutMs: 20_000 });
  if (result.code !== 0) {
    throw new Error(`Failed to stop Docker fixture: ${`${result.stdout}\n${result.stderr}`.trim()}`);
  }
  getStore().logAudit('demo_postgres_down');
  return { ok: true };
}

// ── Power mode handlers ──────────────────────────────────────────

export function profileUpdatePower(params: {
  name: string;
  settings: { allowWrite?: boolean; allowDangerous?: boolean; confirmPhrase?: string | null };
}): { ok: boolean } {
  const s = getStore();
  const ok = s.updateProfilePower(params.name, params.settings);
  if (!ok) throw new Error(`Profile "${params.name}" not found.`);
  const profile = s.getProfileByName(params.name);
  if (profile && params.settings.allowWrite !== undefined) {
    s.logAudit(params.settings.allowWrite ? 'power_enabled' : 'power_disabled', {
      profile_id: profile.id,
      allow_dangerous: params.settings.allowDangerous,
    });
  }
  return { ok: true };
}

export function profileGetPower(params: { name: string }): {
  allowWrite: boolean;
  allowDangerous: boolean;
  confirmPhrase: string | null;
} {
  const s = getStore();
  const settings = s.getProfilePowerSettings(params.name);
  if (!settings) throw new Error(`Profile "${params.name}" not found.`);
  return settings;
}

export async function writePreviewHandler(params: {
  sql: string;
  params: unknown[];
  password: string;
  name?: string;
}): Promise<unknown> {
  const profile = getProfile(params.name);
  const s = getStore();
  const powerSettings = s.getProfilePowerSettings(profile.name);
  return previewWrite({
    dbType: profile.db_type,
    host: profile.host ?? 'localhost',
    port: profile.port ?? 5432,
    database: profile.database ?? '',
    user: profile.user ?? '',
    password: params.password,
    ssl: profile.ssl === 1,
    sql: params.sql,
    params: params.params,
    customConfirmPhrase: powerSettings?.confirmPhrase,
  });
}

export async function writeExecuteHandler(params: {
  sql: string;
  params: unknown[];
  password: string;
  name?: string;
}): Promise<unknown> {
  const s = getStore();
  const profile = getProfile(params.name);
  const powerSettings = s.getProfilePowerSettings(profile.name);

  // Generate preview for audit
  const preview = await previewWrite({
    dbType: profile.db_type,
    host: profile.host ?? 'localhost',
    port: profile.port ?? 5432,
    database: profile.database ?? '',
    user: profile.user ?? '',
    password: params.password,
    ssl: profile.ssl === 1,
    sql: params.sql,
    params: params.params,
    customConfirmPhrase: powerSettings?.confirmPhrase,
  });

  return executeWriteWithAudit(
    {
      dbType: profile.db_type,
      host: profile.host ?? 'localhost',
      port: profile.port ?? 5432,
      database: profile.database ?? '',
      user: profile.user ?? '',
      password: params.password,
      ssl: profile.ssl === 1,
      sql: params.sql,
      params: params.params,
      profileId: profile.id,
    },
    preview,
    s,
  );
}

// ── Method dispatch ──────────────────────────────────────────────

type MethodHandler = (params: any) => unknown | Promise<unknown>;

const METHODS: Record<string, MethodHandler> = {
  'profiles.list': profilesList,
  'profiles.add': profilesAdd,
  'profiles.remove': profilesRemove,
  'profiles.use': profilesUse,
  'profiles.test': profilesTest,
  'profiles.getActive': profilesGetActive,
  'schema.refresh': schemaRefresh,
  'schema.search': schemaSearch,
  'schema.tableDetail': schemaTableDetail,
  'schema.getSnapshot': schemaGetSnapshot,
  'ask.dryRun': askDryRun,
  'ask.run': askRun,
  'workspace.sql': workspaceSql,
  'history.list': historyList,
  'history.show': historyShow,
  'history.exportMd': historyExportMd,
  'settings.status': settingsStatus,
  'settings.testOpenAiKey': settingsTestOpenAiKey,
  'demo.noDockerStatus': demoNoDockerStatus,
  'demo.noDockerPrepare': demoNoDockerPrepare,
  'demo.noDockerReset': demoNoDockerReset,
  'fixture.checkDocker': fixtureCheckDocker,
  'fixture.pickPort': fixturePickPort,
  'fixture.status': fixtureStatus,
  'fixture.up': fixtureUp,
  'fixture.down': fixtureDown,
  'fixture.logs': fixtureLogs,
  'profile.updatePower': profileUpdatePower,
  'profile.getPower': profileGetPower,
  'write.preview': writePreviewHandler,
  'write.execute': writeExecuteHandler,
};

export async function dispatch(method: string, params: unknown): Promise<unknown> {
  const handler = METHODS[method];
  if (!handler) throw new Error(`Unknown method: ${method}`);
  return handler(params as any);
}

export function shutdown(): void {
  if (store) {
    store.close();
    store = null;
  }
}
