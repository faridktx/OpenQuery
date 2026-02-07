/**
 * SQLite adapter used by desktop No-Docker demo mode.
 * Uses better-sqlite3 for local file execution.
 */

import Database from 'better-sqlite3';
import { SAFE_DEFAULTS } from '../defaults.js';
import type { SchemaSnapshot, TableInfo } from '../types.js';
import type { ExecuteLimits, ExecuteResult, ExplainOutput } from './postgres.js';

export interface SqliteConnectionConfig {
  database: string;
}

function openDatabase(cfg: SqliteConnectionConfig, readonly = true): Database.Database {
  if (!cfg.database?.trim()) {
    throw new Error('SQLite database path is required.');
  }
  return new Database(cfg.database, { readonly, fileMustExist: readonly });
}

export async function testConnection(
  cfg: SqliteConnectionConfig,
): Promise<{ ok: boolean; error?: string; serverVersion?: string }> {
  try {
    const db = openDatabase(cfg, true);
    db.prepare('SELECT 1').get();
    const versionRow = db.prepare('SELECT sqlite_version() as version').get() as { version?: string } | undefined;
    db.close();
    return { ok: true, serverVersion: versionRow?.version ?? 'sqlite' };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}

function queryAll(stmt: Database.Statement, params: unknown[]): Record<string, unknown>[] {
  if (!params.length) return stmt.all() as Record<string, unknown>[];
  return stmt.all(...(params as unknown[])) as Record<string, unknown>[];
}

function queryRun(stmt: Database.Statement, params: unknown[]): Database.RunResult {
  if (!params.length) return stmt.run();
  return stmt.run(...(params as unknown[]));
}

export async function execute(
  cfg: SqliteConnectionConfig,
  _password: string,
  sql: string,
  params: unknown[] = [],
  limits: ExecuteLimits = {},
): Promise<ExecuteResult> {
  const maxRows = limits.maxRows ?? SAFE_DEFAULTS.maxRows;
  const db = openDatabase(cfg, true);
  try {
    const start = performance.now();
    const stmt = db.prepare(sql);
    if (!stmt.reader) {
      const run = queryRun(stmt, params);
      const execMs = Math.round(performance.now() - start);
      return {
        columns: [],
        rows: [],
        rowCount: Number(run.changes ?? 0),
        truncated: false,
        execMs,
      };
    }

    const allRows = queryAll(stmt, params);
    const execMs = Math.round(performance.now() - start);
    const columns = stmt.columns().map((column) => column.name);
    const truncated = allRows.length > maxRows;
    const rows = truncated ? allRows.slice(0, maxRows) : allRows;
    return {
      columns,
      rows,
      rowCount: allRows.length,
      truncated,
      execMs,
    };
  } finally {
    db.close();
  }
}

export async function explain(
  cfg: SqliteConnectionConfig,
  _password: string,
  sql: string,
  params: unknown[] = [],
  _limits: ExecuteLimits = {},
): Promise<ExplainOutput> {
  const db = openDatabase(cfg, true);
  try {
    const explainStmt = db.prepare(`EXPLAIN QUERY PLAN ${sql}`);
    const rows = queryAll(explainStmt, params);
    const details = rows
      .map((row) => String((row as Record<string, unknown>).detail ?? ''))
      .filter((text) => text.length > 0);
    const hasSeqScan = details.some((detail) => detail.toUpperCase().includes('SCAN '));
    const warnings: string[] = ['SQLite demo mode uses simplified EXPLAIN plan output.'];
    if (hasSeqScan) {
      warnings.push('Potential full table scan detected.');
    }
    return {
      raw: rows,
      estimatedRows: 0,
      estimatedCost: 0,
      hasSeqScan,
      warnings,
    };
  } finally {
    db.close();
  }
}

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

export async function introspectSchema(
  cfg: SqliteConnectionConfig,
): Promise<SchemaSnapshot> {
  const db = openDatabase(cfg, true);
  try {
    const tables = db
      .prepare(`
        SELECT name
        FROM sqlite_master
        WHERE type = 'table'
          AND name NOT LIKE 'sqlite_%'
        ORDER BY name
      `)
      .all() as Array<{ name: string }>;

    const tableInfos: TableInfo[] = [];
    for (const tableRow of tables) {
      const tableName = tableRow.name;
      const columns = db
        .prepare(`PRAGMA table_info(${quoteIdent(tableName)})`)
        .all() as Array<{
        name: string;
        type: string;
        notnull: 0 | 1;
        pk: 0 | 1;
        dflt_value: string | null;
      }>;

      const countRow = db
        .prepare(`SELECT COUNT(*) as c FROM ${quoteIdent(tableName)}`)
        .get() as { c: number };

      tableInfos.push({
        name: tableName,
        schema: 'main',
        rowCountEstimate: Number(countRow?.c ?? 0),
        columns: columns.map((column) => ({
          name: column.name,
          dataType: column.type || 'TEXT',
          nullable: column.notnull === 0,
          isPrimaryKey: column.pk === 1,
          defaultValue: column.dflt_value ?? undefined,
        })),
      });
    }

    return {
      tables: tableInfos,
      capturedAt: new Date(),
    };
  } finally {
    db.close();
  }
}

export async function executeWrite(
  cfg: SqliteConnectionConfig,
  _password: string,
  sql: string,
  params: unknown[] = [],
  _limits: ExecuteLimits = {},
): Promise<{ rowsAffected: number; execMs: number }> {
  const db = openDatabase(cfg, false);
  try {
    const start = performance.now();
    const stmt = db.prepare(sql);
    const run = queryRun(stmt, params);
    const execMs = Math.round(performance.now() - start);
    return {
      rowsAffected: Number(run.changes ?? 0),
      execMs,
    };
  } finally {
    db.close();
  }
}

export async function explainWrite(
  cfg: SqliteConnectionConfig,
  _password: string,
  sql: string,
  params: unknown[] = [],
  _limits: ExecuteLimits = {},
): Promise<ExplainOutput> {
  return explain(cfg, '', sql, params);
}
