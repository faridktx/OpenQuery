/**
 * Tauri invoke wrappers for the desktop app.
 * Each function maps to a Tauri command defined in main.rs.
 */

import { invoke } from '@tauri-apps/api/core';

function hasTauriBridge(): boolean {
  if (typeof window === 'undefined') return true;
  const maybeWindow = window as Window & {
    __TAURI_INTERNALS__?: {
      invoke?: unknown;
    };
  };
  return typeof maybeWindow.__TAURI_INTERNALS__?.invoke === 'function';
}

async function invokeCommand<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!hasTauriBridge()) {
    throw new Error(
      'Desktop bridge unavailable. Launch OpenQuery with `pnpm --filter @openquery/desktop dev:tauri`.',
    );
  }
  return invoke<T>(command, args);
}

// ── Profiles ────────────────────────────────────────────────────

export async function profilesList(): Promise<any[]> {
  return invokeCommand('profiles_list');
}

export async function profilesAdd(params: {
  name: string;
  db_type: string;
  host: string;
  port: number;
  database: string;
  user: string;
  ssl: boolean;
}): Promise<any> {
  return invokeCommand('profiles_add', { params });
}

export async function profilesRemove(name: string): Promise<any> {
  return invokeCommand('profiles_remove', { name });
}

export async function profilesUse(name: string): Promise<any> {
  return invokeCommand('profiles_use', { name });
}

export async function profilesTest(name: string, password: string): Promise<{ ok: boolean; error?: string; serverVersion?: string }> {
  return invokeCommand('profiles_test', { name, password });
}

export async function profilesGetActive(): Promise<{ name: string | null }> {
  return invokeCommand('profiles_get_active');
}

// ── Keychain ────────────────────────────────────────────────────

export async function keychainSet(profileId: string, password: string): Promise<void> {
  return invokeCommand('keychain_set', { profileId, password });
}

export async function keychainGet(profileId: string): Promise<string | null> {
  return invokeCommand('keychain_get', { profileId });
}

export async function keychainDelete(profileId: string): Promise<void> {
  return invokeCommand('keychain_delete', { profileId });
}

// ── Schema ──────────────────────────────────────────────────────

export async function schemaRefresh(password: string, name?: string): Promise<{ tables: number; columns: number }> {
  return invokeCommand('schema_refresh', { password, name: name ?? null });
}

export async function schemaSearch(query: string): Promise<any[]> {
  return invokeCommand('schema_search', { query });
}

export async function schemaTableDetail(table: string, schema?: string): Promise<any> {
  return invokeCommand('schema_table_detail', { table, schema: schema ?? null });
}

export async function schemaGetSnapshot(): Promise<any> {
  return invokeCommand('schema_get_snapshot');
}

// ── Ask ─────────────────────────────────────────────────────────

export async function askDryRun(
  question: string,
  mode: string,
  password: string,
  openAiApiKey?: string | null,
): Promise<any> {
  return invokeCommand('ask_dry_run', { question, mode, password, openAiApiKey: openAiApiKey ?? null });
}

export async function askRun(
  question: string,
  mode: string,
  password: string,
  openAiApiKey?: string | null,
): Promise<any> {
  return invokeCommand('ask_run', { question, mode, password, openAiApiKey: openAiApiKey ?? null });
}

// ── Workspace SQL ───────────────────────────────────────────────

export async function workspaceSql(params: {
  sql: string;
  mode: 'safe' | 'standard';
  action: 'run' | 'dry-run' | 'explain';
  password: string;
  name?: string;
  policy?: {
    maxRowsThreshold: number;
    maxCostThreshold: number;
    enforceLimit: boolean;
  };
}): Promise<any> {
  return invokeCommand('workspace_sql', {
    sql: params.sql,
    mode: params.mode,
    action: params.action,
    password: params.password,
    name: params.name ?? null,
    policy: params.policy ?? null,
  });
}

// ── Power Mode ──────────────────────────────────────────────────

export async function profileUpdatePower(
  name: string,
  settings: { allowWrite?: boolean; allowDangerous?: boolean; confirmPhrase?: string | null },
): Promise<any> {
  return invokeCommand('profile_update_power', { name, settings });
}

export async function profileGetPower(name: string): Promise<{
  allowWrite: boolean;
  allowDangerous: boolean;
  confirmPhrase: string | null;
}> {
  return invokeCommand('profile_get_power', { name });
}

export async function writePreview(
  sql: string,
  params: unknown[],
  password: string,
  name?: string,
): Promise<any> {
  return invokeCommand('write_preview', { sql, params, password, name: name ?? null });
}

export async function writeExecute(
  sql: string,
  params: unknown[],
  password: string,
  name?: string,
): Promise<any> {
  return invokeCommand('write_execute', { sql, params, password, name: name ?? null });
}

// ── History ─────────────────────────────────────────────────────

export async function historyList(limit?: number): Promise<any[]> {
  return invokeCommand('history_list', { limit: limit ?? null });
}

export async function historyShow(id: string): Promise<any> {
  return invokeCommand('history_show', { id });
}

export async function historyExportMd(id: string): Promise<string> {
  return invokeCommand('history_export_md', { id });
}

// ── Settings ────────────────────────────────────────────────────

export async function settingsStatus(): Promise<{
  openAiKeySet: boolean;
  model: string;
  appVersion: string;
  defaults: {
    maxRowsThreshold: number;
    maxCostThreshold: number;
    enforceLimit: boolean;
  };
}> {
  return invokeCommand('settings_status');
}

export async function settingsTestOpenAiKey(apiKey?: string | null): Promise<{ ok: boolean; message: string }> {
  return invokeCommand('settings_test_openai_key', { apiKey: apiKey ?? null });
}

// ── Setup + fixture ─────────────────────────────────────────────

export async function demoNoDockerStatus(): Promise<{
  ready: boolean;
  dbPath: string;
  active: boolean;
  profileName: string;
}> {
  return invokeCommand('demo_no_docker_status');
}

export async function demoNoDockerPrepare(reset = false): Promise<{
  ready: boolean;
  dbPath: string;
  profileName: string;
}> {
  return invokeCommand('demo_no_docker_prepare', { reset });
}

export async function demoNoDockerReset(): Promise<{
  ready: boolean;
  dbPath: string;
  profileName: string;
}> {
  return invokeCommand('demo_no_docker_reset');
}

export async function fixtureCheckDocker(): Promise<{
  installed: boolean;
  daemonRunning: boolean;
  message?: string;
}> {
  return invokeCommand('fixture_check_docker');
}

export async function fixturePickPort(preferredPorts?: number[]): Promise<{ port: number }> {
  return invokeCommand('fixture_pick_port', { preferredPorts: preferredPorts ?? null });
}

export async function fixtureUp(port: number): Promise<{
  running: boolean;
  port: number;
  profileName: string;
}> {
  return invokeCommand('fixture_up', { port });
}

export async function fixtureDown(): Promise<{ ok: boolean }> {
  return invokeCommand('fixture_down');
}

export async function fixtureStatus(): Promise<{
  running: boolean;
  port?: number;
  message?: string;
}> {
  return invokeCommand('fixture_status');
}

export async function fixtureLogs(tail = 50): Promise<{ lines: string[] }> {
  return invokeCommand('fixture_logs', { tail });
}
