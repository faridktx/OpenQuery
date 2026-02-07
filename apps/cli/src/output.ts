import type { Command } from 'commander';
import { formatTable } from './util/table.js';
import { CliError } from './errors.js';

export interface OutputOptions {
  json: boolean;
  quiet: boolean;
  verbose: boolean;
  debug: boolean;
}

export function outputOptionsFromCommand(command: Command): OutputOptions {
  const opts = command.optsWithGlobals?.() ?? command.opts();
  return {
    json: Boolean(opts.json),
    quiet: Boolean(opts.quiet),
    verbose: Boolean(opts.verbose),
    debug: Boolean(opts.debug),
  };
}

export function printHuman(message: string, output: OutputOptions): void {
  if (!output.quiet) {
    console.log(message);
  }
}

export function printWarning(message: string, output: OutputOptions): void {
  if (!output.quiet) {
    console.warn(`Warning: ${message}`);
  }
}

export function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

export function printHumanTable(columns: string[], rows: Record<string, unknown>[], output: OutputOptions): void {
  if (output.quiet) return;
  console.log(formatTable(columns, rows));
}

export function printError(error: unknown, output: OutputOptions): void {
  const isCliError = error instanceof CliError;
  const message = isCliError ? error.message : error instanceof Error ? error.message : String(error);

  if (output.json) {
    const payload: Record<string, unknown> = {
      ok: false,
      code: isCliError ? error.code : 'INTERNAL_ERROR',
      message,
    };
    if (output.debug) {
      payload.details = isCliError
        ? error.details ?? null
        : error instanceof Error
          ? { stack: error.stack }
          : { raw: String(error) };
    }
    printJson(payload);
    return;
  }

  console.error(`Error: ${message}`);
  if (output.debug) {
    if (isCliError && error.details !== undefined) {
      console.error('Details:', JSON.stringify(error.details, null, 2));
    } else if (error instanceof Error && error.stack) {
      console.error(error.stack);
    }
  }
}

export function printCommandSuccess(value: unknown, output: OutputOptions, humanMessage?: string): void {
  if (output.json) {
    printJson({ ok: true, data: value });
    return;
  }
  if (humanMessage && !output.quiet) {
    console.log(humanMessage);
  }
}

export function withOutputFlags<T extends Command>(command: T): T {
  return command
    .option('--json', 'Machine-readable JSON output', false)
    .option('--quiet', 'Suppress non-essential logs', false)
    .option('--verbose', 'Show additional context', false)
    .option('--debug', 'Show internal error details and stacks', false) as T;
}
