/**
 * Bridge handlers — maps RPC method names to core function calls.
 * Each handler receives params + password (from Tauri keychain) and returns a result.
 */

import {
  LocalStore,
  defaultDbPath,
  testDbConnection,
  introspectSchema,
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

let store: LocalStore | null = null;
const launchEnvOpenAiKey = process.env.OPENAI_API_KEY;
let desktopInjectedOpenAiKey: string | null = null;

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
  const snapshot = await introspectSchema(
    {
      host: profile.host ?? 'localhost',
      port: profile.port ?? 5432,
      database: profile.database ?? '',
      user: profile.user ?? '',
      ssl: profile.ssl === 1,
    },
    params.password,
  );
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
