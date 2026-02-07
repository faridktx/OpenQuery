export const EXIT_CODE_SUCCESS = 0;
export const EXIT_CODE_USAGE = 1;
export const EXIT_CODE_RUNTIME = 2;
export const EXIT_CODE_POLICY = 3;

export type CliErrorCode =
  | 'INVALID_ARGS'
  | 'PROFILE_NOT_FOUND'
  | 'PROFILE_EXISTS'
  | 'DB_CONN_FAILED'
  | 'DB_QUERY_FAILED'
  | 'POLICY_BLOCKED'
  | 'EXPLAIN_BLOCKED'
  | 'OPENAI_FAILED'
  | 'INTERNAL_ERROR';

export type CliErrorKind = 'usage' | 'runtime' | 'policy';

export class CliError extends Error {
  readonly kind: CliErrorKind;
  readonly code: CliErrorCode;
  readonly details?: unknown;

  constructor(kind: CliErrorKind, code: CliErrorCode, message: string, details?: unknown) {
    super(message);
    this.kind = kind;
    this.code = code;
    this.details = details;
  }
}

export function usageError(message: string, code: CliErrorCode = 'INVALID_ARGS', details?: unknown): CliError {
  return new CliError('usage', code, message, details);
}

export function runtimeError(message: string, code: CliErrorCode = 'DB_QUERY_FAILED', details?: unknown): CliError {
  return new CliError('runtime', code, message, details);
}

export function policyError(message: string, details?: unknown): CliError {
  return new CliError('policy', 'POLICY_BLOCKED', message, details);
}

export function toExitCode(error: unknown): number {
  if (error instanceof CliError) {
    if (error.kind === 'usage') return EXIT_CODE_USAGE;
    if (error.kind === 'policy') return EXIT_CODE_POLICY;
    return EXIT_CODE_RUNTIME;
  }
  return EXIT_CODE_RUNTIME;
}
