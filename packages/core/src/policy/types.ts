/**
 * Policy and guardrail types for OpenQuery.
 *
 * The policy engine evaluates every SQL statement against the current
 * GuardrailMode before execution. It uses AST-based analysis.
 */

/** Operating modes for the policy engine */
export type GuardrailMode = 'safe' | 'standard';

/** Per-profile policy configuration */
export interface PolicyConfig {
  /** Current guardrail mode. Default: 'safe' */
  mode: GuardrailMode;

  /** Whether write operations are allowed. Default: false */
  allowWrite: boolean;

  /** Whether destructive operations (DROP, TRUNCATE) are allowed. Default: false */
  allowDestructive: boolean;

  /** Maximum rows a write can affect before requiring confirmation. Default: 100 */
  writeRowThreshold: number;

  /** Require typed confirmation phrase for destructive ops. Default: true */
  requireTypedConfirmation: boolean;

  /** Require dry-run preview before writes. Default: true */
  requireDryRun: boolean;

  /** Allowed schemas/tables for writes (empty = all, if writes enabled) */
  writeAllowList: string[];

  /** Blocked schemas/tables for writes (takes precedence over allow list) */
  writeBlockList: string[];
}

/** Safe mode configuration — thresholds and feature flags */
export interface SafeModeConfig {
  /** Require EXPLAIN preflight before execution */
  requireExplain: boolean;
  /** Enforce LIMIT injection/clamping */
  enforceLimit: boolean;
  /** Max estimated rows from EXPLAIN before blocking */
  maxEstimatedRows: number;
  /** Max estimated cost from EXPLAIN before blocking */
  maxEstimatedCost: number;
  /** Max number of JOINs allowed */
  maxJoins: number;
  /** Disallow SELECT * */
  disallowSelectStar: boolean;
  /** Default LIMIT to inject when missing */
  defaultLimit: number;
  /** Max allowed LIMIT value */
  maxLimit: number;
  /** Tables blocked from querying */
  blockedTables: string[];
}

/** Result of policy validation + rewrite */
export interface ValidationResult {
  /** Whether the statement is allowed */
  allowed: boolean;
  /** Rewritten SQL (with LIMIT adjustments) — only present if allowed */
  rewrittenSql?: string;
  /** Non-blocking warnings */
  warnings: string[];
  /** Reason for denial */
  reason: string;
  /** Detailed explanation of the issue */
  details?: string;
  /** Suggested fix for the user */
  suggestedFix?: string;
}

/** Result of EXPLAIN evaluation */
export interface ExplainEvaluation {
  /** Whether execution should proceed */
  allowed: boolean;
  /** Non-blocking warnings */
  warnings: string[];
  /** Blocking reasons */
  blockers: string[];
  /** Raw explain data summary */
  summary: {
    estimatedRows: number;
    estimatedCost: number;
    hasSeqScan: boolean;
  };
}

/** Result of a policy evaluation (legacy interface, kept for compatibility) */
export interface PolicyDecision {
  /** Whether the statement is allowed to execute */
  allowed: boolean;

  /** Reason for denial, or info about what was allowed */
  reason: string;

  /** Rewritten SQL if allowed */
  rewrittenSql?: string;

  /** Non-blocking warnings */
  warnings?: string[];

  /** Suggested fix if denied */
  suggestedFix?: string;

  /** If allowed but requires confirmation, what to show the user */
  confirmationRequired?: ConfirmationPrompt;

  /** If a dry-run is required, signal to the caller */
  dryRunRequired?: boolean;

  /** Risk level assessment */
  risk: RiskLevel;

  /** Audit event to log regardless of outcome */
  auditEvent: AuditEvent;
}

export type RiskLevel = 'none' | 'low' | 'medium' | 'high' | 'critical';

export interface ConfirmationPrompt {
  message: string;
  /** If set, user must type this exact phrase to confirm */
  typedPhrase?: string;
}

export interface AuditEvent {
  timestamp: Date;
  mode: GuardrailMode;
  sql: string;
  decision: 'allowed' | 'denied' | 'pending_confirmation';
  reason: string;
  risk: RiskLevel;
}

/** Per-profile confirmation phrase for write operations */
export interface WritePreview {
  classification: import('./classify.js').StatementClassification;
  kind: import('./parse.js').SqlKind;
  impactedTables: string[];
  hasWhereClause: boolean;
  summary: string;
  estimatedRowsAffected: number | null;
  explainPlan: unknown | null;
  warnings: string[];
  requiresConfirmation: boolean;
  confirmationPhrase: string;
  requiresDangerousConfirmation: boolean;
  dangerousConfirmationPhrase: string;
}

export interface WriteExecutionResult {
  success: boolean;
  rowsAffected: number;
  execMs: number;
  error?: string;
}

/** Default policy config — safe, read-only */
export function defaultPolicyConfig(): PolicyConfig {
  return {
    mode: 'safe',
    allowWrite: false,
    allowDestructive: false,
    writeRowThreshold: 100,
    requireTypedConfirmation: true,
    requireDryRun: true,
    writeAllowList: [],
    writeBlockList: [],
  };
}

/** Default safe mode config */
export function defaultSafeModeConfig(): SafeModeConfig {
  return {
    requireExplain: true,
    enforceLimit: true,
    maxEstimatedRows: 1_000_000,
    maxEstimatedCost: 1_000_000,
    maxJoins: 6,
    disallowSelectStar: true,
    defaultLimit: 200,
    maxLimit: 5_000,
    blockedTables: [],
  };
}

/** Standard mode config — relaxed */
export function defaultStandardModeConfig(): SafeModeConfig {
  return {
    requireExplain: false,
    enforceLimit: true,
    maxEstimatedRows: 10_000_000,
    maxEstimatedCost: 10_000_000,
    maxJoins: 20,
    disallowSelectStar: false,
    defaultLimit: 200,
    maxLimit: 50_000,
    blockedTables: [],
  };
}
