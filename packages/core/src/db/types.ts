/**
 * Database abstraction types for OpenQuery.
 * Adapters for Postgres, MySQL, SQLite etc. will implement DbAdapter.
 */

export type DbType = 'postgres' | 'mysql' | 'sqlite';

export interface ConnectionConfig {
  type: DbType;
  host?: string;
  port?: number;
  database: string;
  user?: string;
  password?: string;
  /** Path for file-based DBs like SQLite */
  filepath?: string;
  /** Connection timeout in milliseconds */
  timeoutMs?: number;
}

export interface SessionLimits {
  /** Maximum rows returned per query */
  maxRows: number;
  /** Query timeout in milliseconds */
  timeoutMs: number;
  /** Whether to force read-only transactions */
  readOnly: boolean;
}

export interface ExplainResult {
  plan: string;
  estimatedRows?: number;
  estimatedCost?: number;
  warnings: string[];
}

export interface QueryResult {
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
  durationMs: number;
}

export interface SchemaSnapshot {
  tables: TableInfo[];
  capturedAt: Date;
}

export interface TableInfo {
  name: string;
  schema?: string;
  columns: ColumnInfo[];
  rowCountEstimate?: number;
}

export interface ColumnInfo {
  name: string;
  dataType: string;
  nullable: boolean;
  isPrimaryKey: boolean;
  defaultValue?: string;
}

/**
 * Database adapter interface. Each supported DB engine implements this.
 * All query methods must respect SessionLimits.
 */
export interface DbAdapter {
  readonly type: DbType;

  connect(config: ConnectionConfig): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;

  /** Execute a read-only query */
  query(sql: string, params?: unknown[]): Promise<QueryResult>;

  /** Get EXPLAIN output for a query without executing it */
  explain(sql: string, params?: unknown[]): Promise<ExplainResult>;

  /** Snapshot the current schema */
  getSchema(): Promise<SchemaSnapshot>;

  /** Set session-level limits */
  setLimits(limits: SessionLimits): Promise<void>;
}
