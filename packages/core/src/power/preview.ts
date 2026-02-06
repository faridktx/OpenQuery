/**
 * Write preview system for POWER mode.
 * Generates a preview with classification, EXPLAIN, warnings, and confirmation requirements.
 */

import { classifyStatement } from '../policy/classify.js';
import { explainWriteQuery, type ExplainRequest } from '../db/execute.js';
import { SAFE_DEFAULTS } from '../db/defaults.js';
import type { WritePreview } from '../policy/types.js';
import {
  DEFAULT_WRITE_PHRASE,
  DEFAULT_DANGEROUS_PHRASE,
  DEFAULT_NO_WHERE_PHRASE,
} from './confirm.js';

export interface PreviewInput {
  dbType: string;
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  ssl: boolean;
  sql: string;
  params?: unknown[];
  customConfirmPhrase?: string | null;
}

/**
 * Generate a preview for a write operation.
 * For DML, attempts EXPLAIN to estimate rows affected.
 * For DDL, provides a textual summary.
 */
export async function previewWrite(input: PreviewInput): Promise<WritePreview> {
  const classification = classifyStatement(input.sql);
  const warnings: string[] = [];
  let estimatedRowsAffected: number | null = null;
  let explainPlan: unknown | null = null;

  const isDml = ['insert', 'update', 'delete'].includes(classification.kind);
  const isDdl = ['create', 'alter'].includes(classification.kind);
  const isDangerous = classification.classification === 'dangerous';

  // For DML statements, attempt EXPLAIN to estimate rows
  if (isDml) {
    try {
      const explainReq: ExplainRequest = {
        dbType: input.dbType,
        host: input.host,
        port: input.port,
        database: input.database,
        user: input.user,
        password: input.password,
        ssl: input.ssl,
        sql: input.sql,
        params: input.params,
        limits: { statementTimeoutMs: SAFE_DEFAULTS.statementTimeoutMs },
      };
      const explainResult = await explainWriteQuery(explainReq);
      estimatedRowsAffected = explainResult.estimatedRows;
      explainPlan = explainResult.raw;

      if (explainResult.hasSeqScan) {
        warnings.push('Query plan includes a sequential scan.');
      }
      for (const w of explainResult.warnings) {
        warnings.push(w);
      }
    } catch {
      warnings.push('Could not generate EXPLAIN preview for this statement.');
    }
  }

  // Warn about missing WHERE clause
  if ((classification.kind === 'update' || classification.kind === 'delete') && !classification.hasWhereClause) {
    warnings.push(
      `${classification.kind.toUpperCase()} without WHERE clause — this will affect ALL rows in the table.`,
    );
  }

  // DDL warning
  if (isDdl) {
    warnings.push('DDL statement — this will modify the database schema.');
  }

  // Dangerous warning
  if (isDangerous) {
    warnings.push('DANGEROUS operation — this may cause irreversible data loss.');
  }

  // Determine confirmation requirements
  const needsNoWhereConfirmation =
    (classification.kind === 'update' || classification.kind === 'delete') && !classification.hasWhereClause;

  const confirmationPhrase = needsNoWhereConfirmation
    ? DEFAULT_NO_WHERE_PHRASE
    : (input.customConfirmPhrase || DEFAULT_WRITE_PHRASE);

  return {
    classification: classification.classification,
    kind: classification.kind,
    impactedTables: classification.impactedTables,
    hasWhereClause: classification.hasWhereClause,
    summary: classification.summary,
    estimatedRowsAffected,
    explainPlan,
    warnings,
    requiresConfirmation: true,
    confirmationPhrase,
    requiresDangerousConfirmation: isDangerous,
    dangerousConfirmationPhrase: DEFAULT_DANGEROUS_PHRASE,
  };
}
