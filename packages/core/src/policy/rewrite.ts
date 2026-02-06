/**
 * AST-based SQL rewriter for OpenQuery.
 *
 * Handles:
 * - Injecting LIMIT when missing
 * - Clamping LIMIT when above max
 *
 * Strategy: use AST for detection, minimize sqlify usage to preserve
 * original query structure. Only use sqlify when we must modify the LIMIT.
 */

import { parser, PG_OPT } from './parse.js';

/**
 * Ensure the query has a LIMIT clause, and clamp it if above max.
 *
 * - If no LIMIT: appends ` LIMIT <defaultLimit>` to original SQL string
 * - If LIMIT <= maxLimit: returns original SQL unchanged
 * - If LIMIT > maxLimit: rewrites via AST to clamp
 *
 * @param sql           Original SQL (should be a single SELECT/CTE)
 * @param defaultLimit  LIMIT to inject when missing
 * @param maxLimit      Maximum allowed LIMIT value
 * @returns             { rewrittenSql, limitApplied, originalLimit }
 */
export function ensureLimit(
  sql: string,
  defaultLimit: number,
  maxLimit: number,
): { rewrittenSql: string; limitApplied: boolean; originalLimit: number | null; clamped: boolean } {
  const trimmed = sql.trim().replace(/;+\s*$/, '');

  try {
    const astResult = parser.astify(trimmed, PG_OPT);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stmt = (Array.isArray(astResult) ? astResult[0] : astResult) as any;

    if (!stmt || stmt.type !== 'select') {
      // Not a SELECT — return as-is (validation layer handles rejection)
      return { rewrittenSql: trimmed, limitApplied: false, originalLimit: null, clamped: false };
    }

    const existingLimit = extractLimitValue(stmt);

    if (existingLimit === null) {
      // No LIMIT found — append to original SQL to preserve formatting
      return {
        rewrittenSql: `${trimmed} LIMIT ${defaultLimit}`,
        limitApplied: true,
        originalLimit: null,
        clamped: false,
      };
    }

    if (existingLimit <= maxLimit) {
      // LIMIT is within bounds — no change needed
      return {
        rewrittenSql: trimmed,
        limitApplied: false,
        originalLimit: existingLimit,
        clamped: false,
      };
    }

    // LIMIT exceeds max — clamp via AST rewrite
    setLimitValue(stmt, maxLimit);
    const rewritten = parser.sqlify(stmt, PG_OPT);

    return {
      rewrittenSql: rewritten,
      limitApplied: true,
      originalLimit: existingLimit,
      clamped: true,
    };
  } catch {
    // If parsing fails, fall back to string append (defense-in-depth)
    const hasLimit = /\bLIMIT\s+\d+/i.test(trimmed);
    if (!hasLimit) {
      return {
        rewrittenSql: `${trimmed} LIMIT ${defaultLimit}`,
        limitApplied: true,
        originalLimit: null,
        clamped: false,
      };
    }
    return { rewrittenSql: trimmed, limitApplied: false, originalLimit: null, clamped: false };
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractLimitValue(stmt: any): number | null {
  if (!stmt.limit) return null;

  // node-sql-parser: limit is { separator: '', value: [{ type: 'number', value: N }, ...] }
  // For LIMIT N OFFSET M, value has two elements
  const vals = stmt.limit?.value;
  if (Array.isArray(vals) && vals.length > 0) {
    const first = vals[vals.length === 2 ? 1 : 0]; // OFFSET, LIMIT order depends on dialect
    if (first && typeof first.value === 'number') {
      return first.value;
    }
  }

  return null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function setLimitValue(stmt: any, value: number): void {
  if (!stmt.limit?.value) return;

  const vals = stmt.limit.value;
  if (Array.isArray(vals) && vals.length > 0) {
    const idx = vals.length === 2 ? 1 : 0;
    if (vals[idx]) {
      vals[idx].value = value;
    }
  }
}
