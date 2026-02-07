/**
 * Tauri invoke wrappers for the desktop app.
 * Each function maps to a Tauri command defined in main.rs.
 */

import { invoke } from '@tauri-apps/api/core';

// ── Profiles ────────────────────────────────────────────────────

export async function profilesList(): Promise<any[]> {
  return invoke('profiles_list');
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
  return invoke('profiles_add', { params });
}

export async function profilesRemove(name: string): Promise<any> {
  return invoke('profiles_remove', { name });
}

export async function profilesUse(name: string): Promise<any> {
  return invoke('profiles_use', { name });
}

export async function profilesTest(name: string, password: string): Promise<{ ok: boolean; error?: string; serverVersion?: string }> {
  return invoke('profiles_test', { name, password });
}

export async function profilesGetActive(): Promise<{ name: string | null }> {
  return invoke('profiles_get_active');
}

// ── Keychain ────────────────────────────────────────────────────

export async function keychainSet(profileId: string, password: string): Promise<void> {
  return invoke('keychain_set', { profileId, password });
}

export async function keychainGet(profileId: string): Promise<string | null> {
  return invoke('keychain_get', { profileId });
}

export async function keychainDelete(profileId: string): Promise<void> {
  return invoke('keychain_delete', { profileId });
}

// ── Schema ──────────────────────────────────────────────────────

export async function schemaRefresh(password: string, name?: string): Promise<{ tables: number; columns: number }> {
  return invoke('schema_refresh', { password, name: name ?? null });
}

export async function schemaSearch(query: string): Promise<any[]> {
  return invoke('schema_search', { query });
}

export async function schemaTableDetail(table: string, schema?: string): Promise<any> {
  return invoke('schema_table_detail', { table, schema: schema ?? null });
}

export async function schemaGetSnapshot(): Promise<any> {
  return invoke('schema_get_snapshot');
}

// ── Ask ─────────────────────────────────────────────────────────

export async function askDryRun(
  question: string,
  mode: string,
  password: string,
  openAiApiKey?: string | null,
): Promise<any> {
  return invoke('ask_dry_run', { question, mode, password, openAiApiKey: openAiApiKey ?? null });
}

export async function askRun(
  question: string,
  mode: string,
  password: string,
  openAiApiKey?: string | null,
): Promise<any> {
  return invoke('ask_run', { question, mode, password, openAiApiKey: openAiApiKey ?? null });
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
  return invoke('workspace_sql', {
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
  return invoke('profile_update_power', { name, settings });
}

export async function profileGetPower(name: string): Promise<{
  allowWrite: boolean;
  allowDangerous: boolean;
  confirmPhrase: string | null;
}> {
  return invoke('profile_get_power', { name });
}

export async function writePreview(
  sql: string,
  params: unknown[],
  password: string,
  name?: string,
): Promise<any> {
  return invoke('write_preview', { sql, params, password, name: name ?? null });
}

export async function writeExecute(
  sql: string,
  params: unknown[],
  password: string,
  name?: string,
): Promise<any> {
  return invoke('write_execute', { sql, params, password, name: name ?? null });
}

// ── History ─────────────────────────────────────────────────────

export async function historyList(limit?: number): Promise<any[]> {
  return invoke('history_list', { limit: limit ?? null });
}

export async function historyShow(id: string): Promise<any> {
  return invoke('history_show', { id });
}

export async function historyExportMd(id: string): Promise<string> {
  return invoke('history_export_md', { id });
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
  return invoke('settings_status');
}

export async function settingsTestOpenAiKey(apiKey?: string | null): Promise<{ ok: boolean; message: string }> {
  return invoke('settings_test_openai_key', { apiKey: apiKey ?? null });
}
