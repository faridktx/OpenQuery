/**
 * AST-based SQL parser for OpenQuery policy engine.
 * Uses node-sql-parser with PostgreSQL dialect.
 *
 * This is the primary classification mechanism — regex is only used
 * as defense-in-depth, never as the sole decision-maker.
 */

import pkg from 'node-sql-parser';
const { Parser } = pkg;

const parser = new Parser();
const PG_OPT = { database: 'PostgresQL' } as const;

export type SqlKind =
  | 'select'
  | 'insert'
  | 'update'
  | 'delete'
  | 'create'
  | 'alter'
  | 'drop'
  | 'truncate'
  | 'unknown';

export interface ParseResult {
  /** The parsed AST (first statement) */
  ast: unknown;
  /** Number of statements found */
  statementCount: number;
  /** Classified statement type */
  kind: SqlKind;
  /** Original SQL with trailing semicolons stripped */
  normalizedSql: string;
}

export interface ParseError {
  ok: false;
  error: string;
}

export type ParseOutcome = ({ ok: true } & ParseResult) | ParseError;

/**
 * Parse a SQL string into an AST using the PostgreSQL dialect.
 * Returns a structured result or a parse error.
 */
export function parseSql(sql: string): ParseOutcome {
  const normalizedSql = sql.trim().replace(/;+\s*$/, '');

  if (!normalizedSql) {
    return { ok: false, error: 'Empty SQL statement' };
  }

  try {
    const astResult = parser.astify(normalizedSql, PG_OPT);
    const statements = Array.isArray(astResult) ? astResult : [astResult];

    if (statements.length === 0) {
      return { ok: false, error: 'No statements found' };
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const first = statements[0] as any;
    const rawKind = (first?.type ?? '').toLowerCase();
    const kind: SqlKind = isKnownKind(rawKind) ? rawKind : 'unknown';

    return {
      ok: true,
      ast: first,
      statementCount: statements.length,
      kind,
      normalizedSql,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `SQL parse error: ${msg}` };
  }
}

function isKnownKind(s: string): s is SqlKind {
  return ['select', 'insert', 'update', 'delete', 'create', 'alter', 'drop', 'truncate'].includes(
    s,
  );
}

/**
 * Re-export the parser for use in rewrite.ts.
 * Internal only — callers should use parseSql().
 */
export { parser, PG_OPT };
