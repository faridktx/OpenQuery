/**
 * Postgres adapter for OpenQuery.
 * Uses the `pg` driver with strict safety defaults.
 */

import pg from 'pg';
import { SAFE_DEFAULTS } from '../defaults.js';

const { Client } = pg;

export interface PgConnectionConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  ssl: boolean;
}

export interface ExecuteResult {
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
  truncated: boolean;
  execMs: number;
}

export interface ExecuteLimits {
  defaultLimit?: number;
  maxRows?: number;
  statementTimeoutMs?: number;
}

export interface ExplainOutput {
  raw: unknown;
  estimatedRows: number;
  estimatedCost: number;
  hasSeqScan: boolean;
  warnings: string[];
}

/**
 * Test a Postgres connection: connect, run SELECT 1, disconnect.
 */
export async function testConnection(
  cfg: PgConnectionConfig,
  password: string,
): Promise<{ ok: boolean; error?: string; serverVersion?: string }> {
  const client = new Client({
    host: cfg.host,
    port: cfg.port,
    database: cfg.database,
    user: cfg.user,
    password,
    ssl: cfg.ssl ? { rejectUnauthorized: false } : false,
    connectionTimeoutMillis: 10_000,
  });

  try {
    await client.connect();
    const res = await client.query('SELECT version()');
    const serverVersion = res.rows[0]?.version as string | undefined;
    return { ok: true, serverVersion };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  } finally {
    try {
      await client.end();
    } catch {
      // ignore disconnect errors
    }
  }
}

/**
 * Execute a SQL statement against Postgres with safety guardrails.
 *
 * The SQL should already be validated and rewritten by the policy engine
 * (LIMIT injection/clamping is handled upstream).
 *
 * Safety measures:
 * - Sets statement_timeout on the session
 * - Wraps in BEGIN READ ONLY transaction
 * - Hard caps returned rows to limits.maxRows
 */
export async function execute(
  cfg: PgConnectionConfig,
  password: string,
  sql: string,
  params: unknown[] = [],
  limits: ExecuteLimits = {},
): Promise<ExecuteResult> {
  const effectiveLimits = {
    maxRows: limits.maxRows ?? SAFE_DEFAULTS.maxRows,
    statementTimeoutMs: limits.statementTimeoutMs ?? SAFE_DEFAULTS.statementTimeoutMs,
  };

  const client = new Client({
    host: cfg.host,
    port: cfg.port,
    database: cfg.database,
    user: cfg.user,
    password,
    ssl: cfg.ssl ? { rejectUnauthorized: false } : false,
    connectionTimeoutMillis: 10_000,
  });

  try {
    await client.connect();

    // Set statement timeout
    await client.query(`SET statement_timeout = ${effectiveLimits.statementTimeoutMs}`);

    // Begin read-only transaction for safety
    await client.query('BEGIN READ ONLY');

    const start = performance.now();
    const result = await client.query(sql, params);
    const execMs = Math.round(performance.now() - start);

    await client.query('COMMIT');

    const columns = result.fields?.map((f) => f.name) ?? [];
    const allRows = (result.rows ?? []) as Record<string, unknown>[];

    // Hard cap rows
    const truncated = allRows.length > effectiveLimits.maxRows;
    const rows = truncated ? allRows.slice(0, effectiveLimits.maxRows) : allRows;

    return {
      columns,
      rows,
      rowCount: allRows.length,
      truncated,
      execMs,
    };
  } catch (err: unknown) {
    // Attempt rollback on error
    try {
      await client.query('ROLLBACK');
    } catch {
      // ignore
    }
    throw err;
  } finally {
    try {
      await client.end();
    } catch {
      // ignore
    }
  }
}

/**
 * Run EXPLAIN (FORMAT JSON) on a SQL statement and parse the plan.
 * Runs under the same statement timeout and read-only transaction.
 */
export async function explain(
  cfg: PgConnectionConfig,
  password: string,
  sql: string,
  params: unknown[] = [],
  limits: ExecuteLimits = {},
): Promise<ExplainOutput> {
  const timeoutMs = limits.statementTimeoutMs ?? SAFE_DEFAULTS.statementTimeoutMs;

  const client = new Client({
    host: cfg.host,
    port: cfg.port,
    database: cfg.database,
    user: cfg.user,
    password,
    ssl: cfg.ssl ? { rejectUnauthorized: false } : false,
    connectionTimeoutMillis: 10_000,
  });

  try {
    await client.connect();
    await client.query(`SET statement_timeout = ${timeoutMs}`);
    await client.query('BEGIN READ ONLY');

    const result = await client.query(`EXPLAIN (FORMAT JSON) ${sql}`, params);
    await client.query('COMMIT');

    const raw = result.rows[0]?.['QUERY PLAN'];
    return parseExplainJson(raw);
  } catch (err: unknown) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // ignore
    }
    throw err;
  } finally {
    try {
      await client.end();
    } catch {
      // ignore
    }
  }
}

/**
 * Parse the JSON output of EXPLAIN (FORMAT JSON).
 * Exported for testing with fixture data.
 */
export function parseExplainJson(raw: unknown): ExplainOutput {
  const warnings: string[] = [];

  // Postgres returns EXPLAIN JSON as an array with one element containing { Plan: ... }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let plan: any = null;
  if (Array.isArray(raw) && raw.length > 0) {
    plan = raw[0]?.Plan ?? raw[0]?.['Plan'];
  }

  if (!plan) {
    return {
      raw,
      estimatedRows: 0,
      estimatedCost: 0,
      hasSeqScan: false,
      warnings: ['Could not parse EXPLAIN output.'],
    };
  }

  const estimatedRows = plan['Plan Rows'] ?? 0;
  const estimatedCost = plan['Total Cost'] ?? 0;
  const hasSeqScan = detectSeqScan(plan);

  if (hasSeqScan) {
    const seqTables = collectSeqScanTables(plan);
    if (seqTables.length > 0) {
      warnings.push(`Sequential scan on: ${seqTables.join(', ')}`);
    } else {
      warnings.push('Sequential scan detected in query plan.');
    }
  }

  return { raw, estimatedRows, estimatedCost, hasSeqScan, warnings };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function detectSeqScan(node: any): boolean {
  if (!node || typeof node !== 'object') return false;
  if (node['Node Type'] === 'Seq Scan') return true;
  const plans = node['Plans'];
  if (Array.isArray(plans)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return plans.some((p: any) => detectSeqScan(p));
  }
  return false;
}

/**
 * Introspect the Postgres schema: tables, columns, PKs, FKs, indexes.
 * Returns a SchemaSnapshot suitable for LLM context.
 */
export async function introspectSchema(
  cfg: PgConnectionConfig,
  password: string,
): Promise<import('../types.js').SchemaSnapshot> {
  const client = new Client({
    host: cfg.host,
    port: cfg.port,
    database: cfg.database,
    user: cfg.user,
    password,
    ssl: cfg.ssl ? { rejectUnauthorized: false } : false,
    connectionTimeoutMillis: 15_000,
  });

  try {
    await client.connect();

    // Get tables
    const tablesRes = await client.query(`
      SELECT t.table_schema, t.table_name,
             c.reltuples::bigint AS row_estimate
      FROM information_schema.tables t
      LEFT JOIN pg_class c ON c.relname = t.table_name
      LEFT JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = t.table_schema
      WHERE t.table_schema NOT IN ('pg_catalog', 'information_schema')
        AND t.table_type = 'BASE TABLE'
      ORDER BY t.table_schema, t.table_name
    `);

    // Get columns
    const colsRes = await client.query(`
      SELECT c.table_schema, c.table_name, c.column_name, c.data_type,
             c.is_nullable, c.column_default,
             CASE WHEN pk.column_name IS NOT NULL THEN true ELSE false END AS is_pk
      FROM information_schema.columns c
      LEFT JOIN (
        SELECT ku.table_schema, ku.table_name, ku.column_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage ku
          ON tc.constraint_name = ku.constraint_name
          AND tc.table_schema = ku.table_schema
        WHERE tc.constraint_type = 'PRIMARY KEY'
      ) pk ON pk.table_schema = c.table_schema
          AND pk.table_name = c.table_name
          AND pk.column_name = c.column_name
      WHERE c.table_schema NOT IN ('pg_catalog', 'information_schema')
      ORDER BY c.table_schema, c.table_name, c.ordinal_position
    `);

    // Build table map
    const tableMap = new Map<string, import('../types.js').TableInfo>();
    for (const row of tablesRes.rows) {
      const key = `${row.table_schema}.${row.table_name}`;
      tableMap.set(key, {
        name: row.table_name,
        schema: row.table_schema,
        columns: [],
        rowCountEstimate: Math.max(0, Number(row.row_estimate) || 0),
      });
    }

    for (const row of colsRes.rows) {
      const key = `${row.table_schema}.${row.table_name}`;
      const table = tableMap.get(key);
      if (table) {
        table.columns.push({
          name: row.column_name,
          dataType: row.data_type,
          nullable: row.is_nullable === 'YES',
          isPrimaryKey: row.is_pk === true,
          defaultValue: row.column_default ?? undefined,
        });
      }
    }

    return {
      tables: Array.from(tableMap.values()),
      capturedAt: new Date(),
    };
  } finally {
    try {
      await client.end();
    } catch {
      // ignore
    }
  }
}

/**
 * Execute a write statement (INSERT/UPDATE/DELETE/DDL) within a transaction.
 * Uses BEGIN (not READ ONLY), COMMIT on success, ROLLBACK on error.
 */
export async function executeWrite(
  cfg: PgConnectionConfig,
  password: string,
  sql: string,
  params: unknown[] = [],
  limits: ExecuteLimits = {},
): Promise<{ rowsAffected: number; execMs: number }> {
  const timeoutMs = limits.statementTimeoutMs ?? SAFE_DEFAULTS.statementTimeoutMs;

  const client = new Client({
    host: cfg.host,
    port: cfg.port,
    database: cfg.database,
    user: cfg.user,
    password,
    ssl: cfg.ssl ? { rejectUnauthorized: false } : false,
    connectionTimeoutMillis: 10_000,
  });

  try {
    await client.connect();
    await client.query(`SET statement_timeout = ${timeoutMs}`);
    await client.query('BEGIN');

    const start = performance.now();
    const result = await client.query(sql, params);
    const execMs = Math.round(performance.now() - start);

    await client.query('COMMIT');

    return {
      rowsAffected: result.rowCount ?? 0,
      execMs,
    };
  } catch (err: unknown) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // ignore
    }
    throw err;
  } finally {
    try {
      await client.end();
    } catch {
      // ignore
    }
  }
}

/**
 * Run EXPLAIN on a write statement without committing.
 * Uses BEGIN → EXPLAIN → ROLLBACK to avoid side effects.
 */
export async function explainWrite(
  cfg: PgConnectionConfig,
  password: string,
  sql: string,
  params: unknown[] = [],
  limits: ExecuteLimits = {},
): Promise<ExplainOutput> {
  const timeoutMs = limits.statementTimeoutMs ?? SAFE_DEFAULTS.statementTimeoutMs;

  const client = new Client({
    host: cfg.host,
    port: cfg.port,
    database: cfg.database,
    user: cfg.user,
    password,
    ssl: cfg.ssl ? { rejectUnauthorized: false } : false,
    connectionTimeoutMillis: 10_000,
  });

  try {
    await client.connect();
    await client.query(`SET statement_timeout = ${timeoutMs}`);
    await client.query('BEGIN');

    const result = await client.query(`EXPLAIN (FORMAT JSON) ${sql}`, params);

    // Always rollback — this is a dry-run
    await client.query('ROLLBACK');

    const raw = result.rows[0]?.['QUERY PLAN'];
    return parseExplainJson(raw);
  } catch (err: unknown) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // ignore
    }
    throw err;
  } finally {
    try {
      await client.end();
    } catch {
      // ignore
    }
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function collectSeqScanTables(node: any): string[] {
  const tables: string[] = [];
  if (!node || typeof node !== 'object') return tables;
  if (node['Node Type'] === 'Seq Scan' && node['Relation Name']) {
    tables.push(node['Relation Name']);
  }
  const plans = node['Plans'];
  if (Array.isArray(plans)) {
    for (const p of plans) {
      tables.push(...collectSeqScanTables(p));
    }
  }
  return tables;
}
