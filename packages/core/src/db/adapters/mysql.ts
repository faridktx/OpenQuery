/**
 * MySQL adapter placeholder.
 *
 * Phase 6 intentionally defers MySQL execution support to Phase 7.
 */

import type { SchemaSnapshot } from '../types.js';
import type { ExecuteLimits, ExecuteResult, ExplainOutput } from './postgres.js';

export interface MySqlConnectionConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  ssl: boolean;
}

const PHASE7_MESSAGE =
  'MySQL support is planned for Phase 7 and is not implemented yet. Use a postgres profile for now.';

function notImplemented(operation: string): Error {
  return new Error(`${operation}: ${PHASE7_MESSAGE}`);
}

export async function testConnection(): Promise<{ ok: boolean; error: string }> {
  return { ok: false, error: PHASE7_MESSAGE };
}

export async function execute(
  _cfg: MySqlConnectionConfig,
  _password: string,
  _sql: string,
  _params: unknown[] = [],
  _limits: ExecuteLimits = {},
): Promise<ExecuteResult> {
  throw notImplemented('MySQL execute');
}

export async function explain(
  _cfg: MySqlConnectionConfig,
  _password: string,
  _sql: string,
  _params: unknown[] = [],
  _limits: ExecuteLimits = {},
): Promise<ExplainOutput> {
  throw notImplemented('MySQL explain');
}

export async function introspectSchema(
  _cfg: MySqlConnectionConfig,
  _password: string,
): Promise<SchemaSnapshot> {
  throw notImplemented('MySQL introspectSchema');
}

export async function executeWrite(
  _cfg: MySqlConnectionConfig,
  _password: string,
  _sql: string,
  _params: unknown[] = [],
  _limits: ExecuteLimits = {},
): Promise<{ rowsAffected: number; execMs: number }> {
  throw notImplemented('MySQL executeWrite');
}

export async function explainWrite(
  _cfg: MySqlConnectionConfig,
  _password: string,
  _sql: string,
  _params: unknown[] = [],
  _limits: ExecuteLimits = {},
): Promise<ExplainOutput> {
  throw notImplemented('MySQL explainWrite');
}
