/**
 * @openquery/core — barrel export
 *
 * Core logic shared by CLI and desktop apps.
 */

// Database types
export type {
  DbType,
  ConnectionConfig,
  SessionLimits,
  ExplainResult,
  QueryResult,
  SchemaSnapshot,
  TableInfo,
  ColumnInfo,
  DbAdapter,
} from './db/types.js';

// Safe session defaults
export { SAFE_DEFAULTS } from './db/defaults.js';

// SQL safety check (Phase 1 — kept as defense-in-depth)
export { isSafeSelect } from './db/sql-check.js';

// Execution layer
export { executeQuery, explainQuery, testDbConnection, executeWriteQuery, explainWriteQuery } from './db/execute.js';
export type { ExecuteResult, ExecuteLimits, ExplainOutput, ExecuteRequest, ExplainRequest, TestRequest, WriteResult } from './db/execute.js';

// Postgres EXPLAIN parser (for testing with fixtures)
export { parseExplainJson } from './db/adapters/postgres.js';

// Policy types
export type {
  GuardrailMode,
  PolicyConfig,
  SafeModeConfig,
  ValidationResult,
  ExplainEvaluation,
  PolicyDecision,
  RiskLevel,
  ConfirmationPrompt,
  AuditEvent,
  WritePreview,
  WriteExecutionResult,
} from './policy/types.js';
export {
  defaultPolicyConfig,
  defaultSafeModeConfig,
  defaultStandardModeConfig,
} from './policy/types.js';

// Policy engine
export type { PolicyEngine, ExplainData } from './policy/engine.js';
export { DefaultPolicyEngine } from './policy/engine.js';
export { StubPolicyEngine } from './policy/stub-engine.js';

// SQL parser
export { parseSql } from './policy/parse.js';
export type { ParseResult, ParseOutcome, SqlKind } from './policy/parse.js';

// SQL rewriter
export { ensureLimit } from './policy/rewrite.js';

// Local storage
export { LocalStore, defaultDbPath } from './storage/sqlite.js';
export type { StoredProfile } from './storage/sqlite.js';

// Query history repository
export {
  createQuery,
  storeGeneration,
  storeRun,
  listHistory,
  getHistoryItem,
} from './storage/repo.js';
export type {
  StoredGeneration,
  StoredRun,
  HistoryItem,
  HistoryListItem,
  HistoryDetail,
} from './storage/repo.js';

// LLM module
export type { LlmSqlPlan, ParamType } from './llm/types.js';
export { OpenAIProvider } from './llm/openai.js';
export type { GeneratePlanInput, GeneratePlanResult } from './llm/openai.js';
export { buildSchemaContext } from './llm/schema.js';
export { buildMessages } from './llm/prompt.js';
export { llmSqlPlanSchema } from './llm/schema_json.js';

// Ask orchestration
export { askAndMaybeRun } from './ask.js';
export type { AskInput, AskResult } from './ask.js';

// Postgres adapter (schema introspection)
export { introspectSchema } from './db/adapters/postgres.js';
export type { PgConnectionConfig } from './db/adapters/postgres.js';

// Statement classifier
export { classifyStatement } from './policy/classify.js';
export type { StatementClassification, ClassificationResult } from './policy/classify.js';

// POWER mode — controlled write operations
export {
  previewWrite,
  requestConfirmation,
  verifyConfirmation,
  executeWriteWithAudit,
  hashSql,
  DEFAULT_WRITE_PHRASE,
  DEFAULT_DANGEROUS_PHRASE,
  DEFAULT_NO_WHERE_PHRASE,
} from './power/index.js';
export type { PreviewInput, ConfirmationRequest as PowerConfirmationRequest, WriteExecuteInput } from './power/index.js';

// Secret storage
export type { SecretStore } from './secrets/types.js';
export { NoopSecretStore } from './secrets/noop.js';
