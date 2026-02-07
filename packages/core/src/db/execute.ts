/**
 * Query execution dispatcher.
 * Selects the correct adapter based on db_type and delegates execution.
 */

import * as postgres from './adapters/postgres.js';
import * as mysql from './adapters/mysql.js';
import * as sqlite from './adapters/sqlite.js';
import type { ExecuteLimits, ExecuteResult, PgConnectionConfig, ExplainOutput } from './adapters/postgres.js';
import type { SchemaSnapshot } from './types.js';

export type { ExecuteResult, ExecuteLimits, ExplainOutput } from './adapters/postgres.js';

export interface ExecuteRequest {
  dbType: string;
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  ssl: boolean;
  sql: string;
  params?: unknown[];
  limits?: ExecuteLimits;
}

export interface TestRequest {
  dbType: string;
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  ssl: boolean;
}

export interface ExplainRequest {
  dbType: string;
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  ssl: boolean;
  sql: string;
  params?: unknown[];
  limits?: ExecuteLimits;
}

export interface IntrospectRequest {
  dbType: string;
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  ssl: boolean;
}

function toPgConfig(req: { host: string; port: number; database: string; user: string; ssl: boolean }): PgConnectionConfig {
  return { host: req.host, port: req.port, database: req.database, user: req.user, ssl: req.ssl };
}

function toSqliteConfig(req: { database: string }): sqlite.SqliteConnectionConfig {
  return { database: req.database };
}

export async function executeQuery(req: ExecuteRequest): Promise<ExecuteResult> {
  switch (req.dbType) {
    case 'postgres':
      return postgres.execute(toPgConfig(req), req.password, req.sql, req.params, req.limits);
    case 'mysql':
      return mysql.execute(toPgConfig(req), req.password, req.sql, req.params, req.limits);
    case 'sqlite':
      return sqlite.execute(toSqliteConfig(req), req.password, req.sql, req.params, req.limits);
    default:
      throw new Error(`Unsupported database type: ${req.dbType}. Supported: postgres, sqlite.`);
  }
}

export async function explainQuery(req: ExplainRequest): Promise<ExplainOutput> {
  switch (req.dbType) {
    case 'postgres':
      return postgres.explain(toPgConfig(req), req.password, req.sql, req.params, req.limits);
    case 'mysql':
      return mysql.explain(toPgConfig(req), req.password, req.sql, req.params, req.limits);
    case 'sqlite':
      return sqlite.explain(toSqliteConfig(req), req.password, req.sql, req.params, req.limits);
    default:
      throw new Error(`Unsupported database type: ${req.dbType}. Supported: postgres, sqlite.`);
  }
}

export interface WriteResult {
  rowsAffected: number;
  execMs: number;
}

export async function executeWriteQuery(req: ExecuteRequest): Promise<WriteResult> {
  switch (req.dbType) {
    case 'postgres':
      return postgres.executeWrite(toPgConfig(req), req.password, req.sql, req.params, req.limits);
    case 'mysql':
      return mysql.executeWrite(toPgConfig(req), req.password, req.sql, req.params, req.limits);
    case 'sqlite':
      return sqlite.executeWrite(toSqliteConfig(req), req.password, req.sql, req.params, req.limits);
    default:
      throw new Error(`Unsupported database type: ${req.dbType}. Supported: postgres, sqlite.`);
  }
}

export async function explainWriteQuery(req: ExplainRequest): Promise<ExplainOutput> {
  switch (req.dbType) {
    case 'postgres':
      return postgres.explainWrite(toPgConfig(req), req.password, req.sql, req.params, req.limits);
    case 'mysql':
      return mysql.explainWrite(toPgConfig(req), req.password, req.sql, req.params, req.limits);
    case 'sqlite':
      return sqlite.explainWrite(toSqliteConfig(req), req.password, req.sql, req.params, req.limits);
    default:
      throw new Error(`Unsupported database type: ${req.dbType}. Supported: postgres, sqlite.`);
  }
}

export async function testDbConnection(
  req: TestRequest,
): Promise<{ ok: boolean; error?: string; serverVersion?: string }> {
  switch (req.dbType) {
    case 'postgres':
      return postgres.testConnection(toPgConfig(req), req.password);
    case 'mysql':
      return mysql.testConnection();
    case 'sqlite':
      return sqlite.testConnection(toSqliteConfig(req));
    default:
      throw new Error(`Unsupported database type: ${req.dbType}. Supported: postgres, sqlite.`);
  }
}

export async function introspectSchemaForConnection(req: IntrospectRequest): Promise<SchemaSnapshot> {
  switch (req.dbType) {
    case 'postgres':
      return postgres.introspectSchema(toPgConfig(req), req.password);
    case 'mysql':
      return mysql.introspectSchema(toPgConfig(req), req.password);
    case 'sqlite':
      return sqlite.introspectSchema(toSqliteConfig(req));
    default:
      throw new Error(`Unsupported database type: ${req.dbType}. Supported: postgres, sqlite.`);
  }
}
