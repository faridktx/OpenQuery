/**
 * AST-based validation rules for the OpenQuery policy engine.
 *
 * Every rule operates on the parsed AST, not on raw SQL text.
 * Rules return structured decisions with reasons and suggested fixes.
 */

import type { SafeModeConfig, PolicyConfig } from './types.js';
import type { SqlKind } from './parse.js';

export interface RuleViolation {
  rule: string;
  reason: string;
  suggestedFix?: string;
}

export interface ValidationResult {
  allowed: boolean;
  violations: RuleViolation[];
  warnings: string[];
}

/**
 * Validate an AST against the configured policy rules.
 */
export function validateAst(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ast: any,
  kind: SqlKind,
  statementCount: number,
  config: SafeModeConfig,
  policyConfig?: PolicyConfig,
): ValidationResult {
  const violations: RuleViolation[] = [];
  const warnings: string[] = [];

  // Rule 1: single statement only
  if (statementCount > 1) {
    violations.push({
      rule: 'single_statement',
      reason: `Multiple statements detected (${statementCount}). Only single statements are allowed.`,
      suggestedFix: 'Split into separate queries.',
    });
  }

  // Rule 2: allowed statement types
  if (kind !== 'select') {
    const writeKinds = ['insert', 'update', 'delete'];
    const ddlWriteKinds = ['create', 'alter'];
    const dangerousKinds = ['drop', 'truncate'];

    if (writeKinds.includes(kind)) {
      if (!policyConfig?.allowWrite) {
        violations.push({
          rule: 'read_only',
          reason: `Write statement "${kind.toUpperCase()}" is not allowed without POWER mode.`,
          suggestedFix:
            'Enable POWER mode for this profile: openquery power enable --profile <name>',
        });
      }
    } else if (ddlWriteKinds.includes(kind)) {
      if (!policyConfig?.allowWrite) {
        violations.push({
          rule: 'no_ddl',
          reason: `DDL statement "${kind.toUpperCase()}" is not allowed without POWER mode.`,
          suggestedFix:
            'Enable POWER mode for this profile: openquery power enable --profile <name>',
        });
      }
    } else if (dangerousKinds.includes(kind)) {
      if (!policyConfig?.allowDestructive) {
        violations.push({
          rule: 'dangerous_op',
          reason: `Dangerous statement "${kind.toUpperCase()}" is blocked.`,
          suggestedFix:
            !policyConfig?.allowWrite
              ? 'Enable POWER mode with dangerous operations: openquery power enable --profile <name> --dangerous'
              : 'Enable dangerous operations: openquery power enable --profile <name> --dangerous',
        });
      }
    } else {
      violations.push({
        rule: 'unknown_type',
        reason: `Statement type "${kind}" is not recognized or allowed.`,
      });
    }
  }

  if (kind !== 'select' || !ast) {
    return { allowed: violations.length === 0, violations, warnings };
  }

  // Rule 3: disallow SELECT *
  if (config.disallowSelectStar && hasSelectStar(ast)) {
    violations.push({
      rule: 'no_select_star',
      reason: 'SELECT * is not allowed in safe mode. Specify columns explicitly.',
      suggestedFix: 'Replace * with specific column names.',
    });
  }

  // Rule 4: max joins
  const joinCount = countJoins(ast);
  if (joinCount > config.maxJoins) {
    violations.push({
      rule: 'max_joins',
      reason: `Query has ${joinCount} joins, exceeding the limit of ${config.maxJoins}.`,
      suggestedFix: `Simplify the query to use at most ${config.maxJoins} joins, or use standard mode.`,
    });
  }

  // Rule 5: check for blocked tables/schemas (if configured)
  if (config.blockedTables.length > 0) {
    const tables = extractTableNames(ast);
    for (const table of tables) {
      const lower = table.toLowerCase();
      if (config.blockedTables.some((b) => lower === b.toLowerCase())) {
        violations.push({
          rule: 'blocked_table',
          reason: `Table "${table}" is blocked by policy.`,
        });
      }
    }
  }

  // Defense-in-depth: check for dangerous functions via AST
  const dangerousFns = findDangerousFunctions(ast);
  for (const fn of dangerousFns) {
    violations.push({
      rule: 'dangerous_function',
      reason: `Function "${fn}" is potentially dangerous and not allowed.`,
    });
  }

  return { allowed: violations.length === 0, violations, warnings };
}

// ── AST inspection helpers ───────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function hasSelectStar(ast: any): boolean {
  // node-sql-parser: columns is '*' for SELECT * or an array of column refs
  if (ast.columns === '*') return true;
  if (Array.isArray(ast.columns)) {
    return ast.columns.some(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (col: any) =>
        col?.expr?.type === 'star' ||
        col?.expr?.value === '*' ||
        col?.expr?.column === '*',
    );
  }
  return false;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function countJoins(ast: any): number {
  const from = ast.from;
  if (!Array.isArray(from)) return 0;
  // First entry is the base table, subsequent entries with 'join' are joins
  return from.filter(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (f: any) => f.join && f.join !== '',
  ).length;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractTableNames(ast: any): string[] {
  const tables: string[] = [];
  const from = ast.from;
  if (!Array.isArray(from)) return tables;
  for (const f of from) {
    if (f.table) {
      const name = f.db ? `${f.db}.${f.table}` : f.table;
      tables.push(name);
    }
  }
  return tables;
}

const DANGEROUS_FUNCTIONS = new Set([
  'pg_sleep',
  'pg_terminate_backend',
  'pg_cancel_backend',
  'lo_import',
  'lo_export',
  'lo_unlink',
  'dblink',
  'dblink_exec',
  'pg_read_file',
  'pg_read_binary_file',
  'pg_write_file',
  'pg_ls_dir',
  'pg_stat_file',
]);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function findDangerousFunctions(ast: any): string[] {
  const found: string[] = [];
  walkAst(ast, (node) => {
    if (
      node &&
      typeof node === 'object' &&
      node.type === 'function' &&
      typeof node.name === 'string'
    ) {
      if (DANGEROUS_FUNCTIONS.has(node.name.toLowerCase())) {
        found.push(node.name);
      }
    }
    // Also check aggr_func and other function-like nodes
    if (
      node &&
      typeof node === 'object' &&
      node.type === 'aggr_func' &&
      typeof node.name === 'string'
    ) {
      if (DANGEROUS_FUNCTIONS.has(node.name.toLowerCase())) {
        found.push(node.name);
      }
    }
  });
  return found;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function walkAst(node: any, visitor: (n: any) => void): void {
  if (node === null || node === undefined) return;
  if (typeof node !== 'object') return;

  visitor(node);

  if (Array.isArray(node)) {
    for (const item of node) {
      walkAst(item, visitor);
    }
  } else {
    for (const key of Object.keys(node)) {
      walkAst(node[key], visitor);
    }
  }
}
