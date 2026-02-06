/**
 * Statement classifier for OpenQuery POWER mode.
 * Classifies SQL as read/write/dangerous and extracts impacted tables.
 */

import { parseSql, type SqlKind } from './parse.js';

export type StatementClassification = 'read' | 'write' | 'dangerous';

export interface ClassificationResult {
  classification: StatementClassification;
  kind: SqlKind;
  impactedTables: string[];
  hasWhereClause: boolean;
  summary: string;
}

const WRITE_KINDS: SqlKind[] = ['insert', 'update', 'delete', 'create', 'alter'];
const DANGEROUS_KINDS: SqlKind[] = ['drop', 'truncate'];

// GRANT/REVOKE may not parse via node-sql-parser — detect via text
const DANGEROUS_KEYWORDS_RE = /^\s*(GRANT|REVOKE)\b/i;

/**
 * Classify a SQL statement as read, write, or dangerous.
 * Returns impacted tables, WHERE clause presence, and a human-readable summary.
 */
export function classifyStatement(sql: string): ClassificationResult {
  // Check for GRANT/REVOKE before parsing (parser may not handle these)
  const trimmed = sql.trim();
  if (DANGEROUS_KEYWORDS_RE.test(trimmed)) {
    const keyword = trimmed.split(/\s/)[0].toUpperCase();
    return {
      classification: 'dangerous',
      kind: 'unknown',
      impactedTables: [],
      hasWhereClause: false,
      summary: `${keyword} statement (dangerous privilege operation)`,
    };
  }

  const parseResult = parseSql(sql);
  if (!parseResult.ok) {
    return {
      classification: 'read',
      kind: 'unknown',
      impactedTables: [],
      hasWhereClause: false,
      summary: 'Unparseable statement',
    };
  }

  const { kind, ast } = parseResult;

  let classification: StatementClassification = 'read';
  if (DANGEROUS_KINDS.includes(kind)) {
    classification = 'dangerous';
  } else if (WRITE_KINDS.includes(kind)) {
    classification = 'write';
  }

  const impactedTables = extractImpactedTables(ast, kind);
  const hasWhereClause = detectWhereClause(ast, kind);
  const summary = buildSummary(kind, classification, impactedTables, hasWhereClause);

  return { classification, kind, impactedTables, hasWhereClause, summary };
}

/**
 * Extract table names affected by the statement.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractImpactedTables(ast: any, kind: SqlKind): string[] {
  if (!ast || typeof ast !== 'object') return [];
  const tables: string[] = [];

  switch (kind) {
    case 'select': {
      // Read-only: extract FROM tables
      if (Array.isArray(ast.from)) {
        for (const f of ast.from) {
          if (f.table) tables.push(f.db ? `${f.db}.${f.table}` : f.table);
        }
      }
      break;
    }
    case 'insert': {
      // INSERT INTO <table>
      if (Array.isArray(ast.table)) {
        for (const t of ast.table) {
          if (t.table) tables.push(t.db ? `${t.db}.${t.table}` : t.table);
        }
      } else if (ast.table?.table) {
        tables.push(ast.table.db ? `${ast.table.db}.${ast.table.table}` : ast.table.table);
      }
      break;
    }
    case 'update': {
      // UPDATE <table>
      if (Array.isArray(ast.table)) {
        for (const t of ast.table) {
          if (t.table) tables.push(t.db ? `${t.db}.${t.table}` : t.table);
        }
      } else if (ast.table?.table) {
        tables.push(ast.table.db ? `${ast.table.db}.${ast.table.table}` : ast.table.table);
      }
      break;
    }
    case 'delete': {
      // DELETE FROM <table>
      if (Array.isArray(ast.from)) {
        for (const f of ast.from) {
          if (f.table) tables.push(f.db ? `${f.db}.${f.table}` : f.table);
        }
      } else if (ast.table?.table) {
        tables.push(ast.table.db ? `${ast.table.db}.${ast.table.table}` : ast.table.table);
      }
      break;
    }
    case 'create':
    case 'alter':
    case 'drop':
    case 'truncate': {
      // DDL: table name may be in ast.table or ast.name depending on statement shape
      if (ast.table) {
        if (Array.isArray(ast.table)) {
          for (const t of ast.table) {
            if (typeof t === 'string') {
              tables.push(t);
            } else if (t.table) {
              tables.push(t.db ? `${t.db}.${t.table}` : t.table);
            }
          }
        } else if (typeof ast.table === 'string') {
          tables.push(ast.table);
        } else if (ast.table.table) {
          tables.push(ast.table.db ? `${ast.table.db}.${ast.table.table}` : ast.table.table);
        }
      }
      if (ast.name) {
        if (Array.isArray(ast.name)) {
          for (const n of ast.name) {
            if (typeof n === 'string') {
              tables.push(n);
            } else if (n?.table) {
              tables.push(n.db ? `${n.db}.${n.table}` : n.table);
            }
          }
        } else if (typeof ast.name === 'string') {
          tables.push(ast.name);
        } else if (ast.name?.table) {
          tables.push(ast.name.db ? `${ast.name.db}.${ast.name.table}` : ast.name.table);
        }
      }
      break;
    }
  }

  return [...new Set(tables)];
}

/**
 * Detect if an UPDATE or DELETE has a WHERE clause.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function detectWhereClause(ast: any, kind: SqlKind): boolean {
  if (kind !== 'update' && kind !== 'delete') return true;
  if (!ast) return false;
  return ast.where != null;
}

function buildSummary(
  kind: SqlKind,
  classification: StatementClassification,
  tables: string[],
  hasWhere: boolean,
): string {
  const tableStr = tables.length > 0 ? ` on ${tables.join(', ')}` : '';
  const kindUpper = kind.toUpperCase();

  if (classification === 'dangerous') {
    return `${kindUpper}${tableStr} (DANGEROUS — may cause irreversible data loss)`;
  }

  if ((kind === 'update' || kind === 'delete') && !hasWhere) {
    return `${kindUpper}${tableStr} (WARNING: no WHERE clause — affects ALL rows)`;
  }

  return `${kindUpper}${tableStr}`;
}
