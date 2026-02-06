/**
 * Write execution with audit logging for POWER mode.
 * Orchestrates preview → confirm → execute → audit.
 */

import { createHash } from 'node:crypto';
import { executeWriteQuery, type ExecuteRequest } from '../db/execute.js';
import { SAFE_DEFAULTS } from '../db/defaults.js';
import type { WritePreview, WriteExecutionResult } from '../policy/types.js';
import type { LocalStore } from '../storage/sqlite.js';

export interface WriteExecuteInput {
  dbType: string;
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  ssl: boolean;
  sql: string;
  params?: unknown[];
  profileId: string;
}

/**
 * Hash SQL for audit logging (privacy-preserving).
 */
export function hashSql(sql: string): string {
  return createHash('sha256').update(sql).digest('hex').slice(0, 16);
}

/**
 * Execute a write operation with full audit trail.
 */
export async function executeWriteWithAudit(
  input: WriteExecuteInput,
  preview: WritePreview,
  store: LocalStore,
): Promise<WriteExecutionResult> {
  const sqlHash = hashSql(input.sql);

  // Log confirmation
  store.logAudit('write_confirmed', {
    profile_id: input.profileId,
    classification: preview.classification,
    impacted_tables: preview.impactedTables,
    sql_hash: sqlHash,
  });

  try {
    const req: ExecuteRequest = {
      dbType: input.dbType,
      host: input.host,
      port: input.port,
      database: input.database,
      user: input.user,
      password: input.password,
      ssl: input.ssl,
      sql: input.sql,
      params: input.params,
      limits: {
        statementTimeoutMs: SAFE_DEFAULTS.statementTimeoutMs,
      },
    };

    const result = await executeWriteQuery(req);

    // Log success
    store.logAudit('write_executed', {
      profile_id: input.profileId,
      classification: preview.classification,
      impacted_tables: preview.impactedTables,
      rows_affected: result.rowsAffected,
      exec_ms: result.execMs,
      sql_hash: sqlHash,
    });

    return {
      success: true,
      rowsAffected: result.rowsAffected,
      execMs: result.execMs,
    };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);

    // Log failure
    store.logAudit('write_failed', {
      profile_id: input.profileId,
      classification: preview.classification,
      error: errorMsg,
      sql_hash: sqlHash,
    });

    return {
      success: false,
      rowsAffected: 0,
      execMs: 0,
      error: errorMsg,
    };
  }
}
