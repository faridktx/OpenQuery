/**
 * Conservative SQL statement classifier for Phase 1.
 *
 * TODO(Phase 2): Replace this entire module with AST-based SQL parsing
 * (e.g. pgsql-ast-parser or node-sql-parser). This text-based check is
 * intentionally very strict and will reject valid read-only queries that
 * happen to contain suspicious keywords. Prefer false negatives (rejecting
 * safe queries) over false positives (allowing unsafe queries).
 */

/**
 * Returns true only if the SQL appears to be a safe SELECT or CTE-SELECT.
 * Rejects anything that doesn't clearly look like a read-only query.
 */
export function isSafeSelect(sql: string): { safe: boolean; reason?: string } {
  const trimmed = sql.trim().replace(/;+\s*$/, '');
  if (!trimmed) {
    return { safe: false, reason: 'Empty SQL statement' };
  }

  const upper = trimmed.toUpperCase();

  // Must start with SELECT or WITH (CTE)
  if (!upper.startsWith('SELECT') && !upper.startsWith('WITH')) {
    return { safe: false, reason: 'Statement must start with SELECT or WITH (CTE)' };
  }

  // If starts with WITH, must eventually have SELECT
  if (upper.startsWith('WITH') && !upper.includes('SELECT')) {
    return { safe: false, reason: 'CTE must contain a SELECT' };
  }

  // Reject any statement containing write/DDL keywords
  // This is over-broad but safe. TODO(Phase 2): use AST analysis instead.
  const forbidden = [
    'INSERT',
    'UPDATE',
    'DELETE',
    'DROP',
    'CREATE',
    'ALTER',
    'TRUNCATE',
    'GRANT',
    'REVOKE',
    'COPY',
    'EXECUTE',
    'CALL',
    'DO ',
    'SET ',
    'LOCK',
    'VACUUM',
    'REINDEX',
    'CLUSTER',
    'REFRESH',
    'COMMENT',
    'SECURITY',
    'REASSIGN',
  ];

  for (const kw of forbidden) {
    // Check as a whole word (preceded by whitespace, start, or semicolon)
    const pattern = new RegExp(`(?:^|\\s|;)${kw.replace(/\s/g, '\\s')}(?:\\s|$|;)`, 'i');
    if (pattern.test(trimmed)) {
      return { safe: false, reason: `Statement contains forbidden keyword: ${kw.trim()}` };
    }
  }

  // Reject function calls that could have side effects
  // TODO(Phase 2): whitelist safe functions via AST
  const dangerousFunctions = [
    'pg_sleep',
    'pg_terminate_backend',
    'pg_cancel_backend',
    'lo_import',
    'lo_export',
    'dblink',
    'pg_read_file',
    'pg_write_file',
  ];

  for (const fn of dangerousFunctions) {
    if (upper.includes(fn.toUpperCase())) {
      return { safe: false, reason: `Statement contains potentially dangerous function: ${fn}` };
    }
  }

  return { safe: true };
}
