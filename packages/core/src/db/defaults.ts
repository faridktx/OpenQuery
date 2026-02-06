/**
 * Safe session defaults for query execution.
 * These are conservative limits enforced by the execute layer.
 */

export const SAFE_DEFAULTS = {
  /** Default LIMIT appended to queries missing one */
  defaultLimit: 200,
  /** Hard cap on returned rows regardless of query LIMIT */
  maxRows: 5000,
  /** Statement timeout in milliseconds */
  statementTimeoutMs: 15_000,
} as const;
