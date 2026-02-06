/**
 * Schema retrieval heuristic: selects relevant tables/columns
 * for the LLM prompt based on the user's question.
 */

import type { SchemaSnapshot, TableInfo, ColumnInfo } from '../db/types.js';

export interface SchemaContextOpts {
  maxTables?: number;
  maxColumnsPerTable?: number;
}

interface ScoredTable {
  table: TableInfo;
  score: number;
  scoredColumns: Array<{ col: ColumnInfo; score: number }>;
}

/**
 * Tokenize a string: lowercase, split on non-alphanumeric (keeping underscores).
 */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9_]+/)
    .filter((t) => t.length > 1);
}

/**
 * Score how well a name matches the question tokens.
 * Supports matching against underscore-separated parts too.
 */
function scoreMatch(name: string, tokens: string[]): number {
  const lower = name.toLowerCase();
  const parts = lower.split('_').filter((p) => p.length > 0);
  let score = 0;
  for (const token of tokens) {
    if (lower === token) {
      score += 10;
    } else if (lower.includes(token)) {
      score += 5;
    } else if (parts.some((p) => p === token)) {
      score += 7;
    } else if (parts.some((p) => p.includes(token) || token.includes(p))) {
      score += 3;
    }
  }
  return score;
}

/**
 * Build a text schema context for the LLM prompt.
 * Uses a token overlap heuristic to pick the most relevant tables.
 */
export function buildSchemaContext(
  question: string,
  schema: SchemaSnapshot,
  opts: SchemaContextOpts = {},
): string {
  const maxTables = opts.maxTables ?? 6;
  const maxCols = opts.maxColumnsPerTable ?? 20;
  const tokens = tokenize(question);

  // Score each table
  const scored: ScoredTable[] = schema.tables.map((table) => {
    const tableName = table.schema ? `${table.schema}.${table.name}` : table.name;
    let tableScore = scoreMatch(tableName, tokens);
    // Also score on schema name separately
    if (table.schema) {
      tableScore += scoreMatch(table.schema, tokens);
    }

    // Score each column
    const scoredColumns = table.columns.map((col) => ({
      col,
      score: scoreMatch(col.name, tokens),
    }));

    // Boost table score by its best column matches
    const colBoost = scoredColumns
      .map((sc) => sc.score)
      .sort((a, b) => b - a)
      .slice(0, 3)
      .reduce((sum, s) => sum + s, 0);

    return {
      table,
      score: tableScore + colBoost,
      scoredColumns,
    };
  });

  // Sort by score descending, take top K
  scored.sort((a, b) => b.score - a.score);
  const selected = scored.slice(0, maxTables);

  // If all scores are 0, include the first few tables anyway (common case for vague questions)
  if (selected.every((s) => s.score === 0) && schema.tables.length > 0) {
    // Still use the first few tables
  }

  // Build text output
  const lines: string[] = ['-- Database Schema (relevant subset)', ''];

  for (const entry of selected) {
    const t = entry.table;
    const fullName = t.schema ? `${t.schema}.${t.name}` : t.name;
    lines.push(`TABLE ${fullName}`);

    // Sort columns: PK first, then by score, then alphabetical
    const cols = [...entry.scoredColumns]
      .sort((a, b) => {
        if (a.col.isPrimaryKey !== b.col.isPrimaryKey) return a.col.isPrimaryKey ? -1 : 1;
        if (b.score !== a.score) return b.score - a.score;
        return a.col.name.localeCompare(b.col.name);
      })
      .slice(0, maxCols);

    for (const { col } of cols) {
      const pk = col.isPrimaryKey ? ' PK' : '';
      const nullable = col.nullable ? ' NULL' : ' NOT NULL';
      lines.push(`  ${col.name} ${col.dataType}${nullable}${pk}`);
    }

    if (t.rowCountEstimate !== undefined) {
      lines.push(`  -- ~${t.rowCountEstimate.toLocaleString()} rows`);
    }

    lines.push('');
  }

  return lines.join('\n');
}
