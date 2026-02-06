/**
 * Query history repository.
 * Stores questions, LLM generations, and execution runs.
 * NEVER stores result row data.
 */

import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';

// ── Types ────────────────────────────────────────────────────────────

export interface StoredGeneration {
  model: string;
  generatedSql: string;
  generatedParamsJson: string;
  confidence: number;
  assumptionsJson: string;
  safetyNotesJson: string;
}

export interface StoredRun {
  rewrittenSql: string;
  rewrittenParamsJson: string;
  explainSummaryJson: string;
  execMs: number;
  rowCount: number;
  truncated: boolean;
  status: 'ok' | 'blocked' | 'error';
  errorText?: string;
}

export interface HistoryItem {
  id: string;
  profileId: string;
  question: string;
  mode: string;
  dialect: string;
  askedAt: string;
}

export interface HistoryListItem {
  id: string;
  question: string;
  askedAt: string;
  status: string | null;
  execMs: number | null;
  rowCount: number | null;
}

export interface HistoryDetail {
  query: HistoryItem;
  generation: {
    id: string;
    model: string;
    generatedSql: string;
    params: unknown[];
    confidence: number;
    assumptions: string[];
    safetyNotes: string[];
    generatedAt: string;
  } | null;
  run: {
    id: string;
    rewrittenSql: string;
    params: unknown[];
    explainSummary: unknown;
    execMs: number;
    rowCount: number;
    truncated: boolean;
    status: string;
    errorText: string | null;
    ranAt: string;
  } | null;
}

// ── Repository functions ─────────────────────────────────────────────

export function createQuery(
  db: Database.Database,
  profileId: string,
  question: string,
  mode: string,
  dialect: string,
): string {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO queries (id, profile_id, asked_at, question, mode, dialect)
     VALUES (?, ?, datetime('now'), ?, ?, ?)`,
  ).run(id, profileId, question, mode, dialect);
  return id;
}

export function storeGeneration(
  db: Database.Database,
  queryId: string,
  gen: StoredGeneration,
): string {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO generations (id, query_id, generated_at, model, generated_sql, generated_params_json, confidence, assumptions_json, safety_notes_json)
     VALUES (?, ?, datetime('now'), ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    queryId,
    gen.model,
    gen.generatedSql,
    gen.generatedParamsJson,
    gen.confidence,
    gen.assumptionsJson,
    gen.safetyNotesJson,
  );
  return id;
}

export function storeRun(
  db: Database.Database,
  queryId: string,
  run: StoredRun,
): string {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO runs (id, query_id, ran_at, rewritten_sql, rewritten_params_json, explain_summary_json, exec_ms, row_count, truncated, status, error_text)
     VALUES (?, ?, datetime('now'), ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    queryId,
    run.rewrittenSql,
    run.rewrittenParamsJson,
    run.explainSummaryJson,
    run.execMs,
    run.rowCount,
    run.truncated ? 1 : 0,
    run.status,
    run.errorText ?? null,
  );
  return id;
}

export function listHistory(
  db: Database.Database,
  limit: number = 20,
): HistoryListItem[] {
  return db
    .prepare(
      `SELECT q.id, q.question, q.asked_at AS askedAt,
              r.status, r.exec_ms AS execMs, r.row_count AS rowCount
       FROM queries q
       LEFT JOIN runs r ON r.query_id = q.id
       ORDER BY q.asked_at DESC
       LIMIT ?`,
    )
    .all(limit) as HistoryListItem[];
}

export function getHistoryItem(
  db: Database.Database,
  id: string,
): HistoryDetail | null {
  const query = db
    .prepare('SELECT id, profile_id AS profileId, question, mode, dialect, asked_at AS askedAt FROM queries WHERE id = ?')
    .get(id) as HistoryItem | undefined;

  if (!query) return null;

  const genRow = db
    .prepare(
      `SELECT id, model, generated_sql, generated_params_json, confidence, assumptions_json, safety_notes_json, generated_at
       FROM generations WHERE query_id = ? ORDER BY generated_at DESC LIMIT 1`,
    )
    .get(id) as Record<string, unknown> | undefined;

  const runRow = db
    .prepare(
      `SELECT id, rewritten_sql, rewritten_params_json, explain_summary_json, exec_ms, row_count, truncated, status, error_text, ran_at
       FROM runs WHERE query_id = ? ORDER BY ran_at DESC LIMIT 1`,
    )
    .get(id) as Record<string, unknown> | undefined;

  return {
    query,
    generation: genRow
      ? {
          id: genRow.id as string,
          model: genRow.model as string,
          generatedSql: genRow.generated_sql as string,
          params: safeJsonParse(genRow.generated_params_json as string, []) as unknown[],
          confidence: genRow.confidence as number,
          assumptions: safeJsonParse(genRow.assumptions_json as string, []) as string[],
          safetyNotes: safeJsonParse(genRow.safety_notes_json as string, []) as string[],
          generatedAt: genRow.generated_at as string,
        }
      : null,
    run: runRow
      ? {
          id: runRow.id as string,
          rewrittenSql: runRow.rewritten_sql as string,
          params: safeJsonParse(runRow.rewritten_params_json as string, []) as unknown[],
          explainSummary: safeJsonParse(runRow.explain_summary_json as string, null),
          execMs: runRow.exec_ms as number,
          rowCount: runRow.row_count as number,
          truncated: (runRow.truncated as number) === 1,
          status: runRow.status as string,
          errorText: (runRow.error_text as string | null) ?? null,
          ranAt: runRow.ran_at as string,
        }
      : null,
  };
}

function safeJsonParse(json: string | null, fallback: unknown): unknown {
  if (!json) return fallback;
  try {
    return JSON.parse(json);
  } catch {
    return fallback;
  }
}
