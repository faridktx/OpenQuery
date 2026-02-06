/**
 * Confirmation system for POWER mode write operations.
 * Requires exact typed phrase match before executing writes.
 */

import type { StatementClassification } from '../policy/classify.js';

export const DEFAULT_WRITE_PHRASE = 'I UNDERSTAND THIS MAY MODIFY DATA';
export const DEFAULT_DANGEROUS_PHRASE = 'I ACCEPT THE RISK OF DATA LOSS';
export const DEFAULT_NO_WHERE_PHRASE = 'I CONFIRM THIS AFFECTS ALL ROWS';

export interface ConfirmationRequest {
  phrase: string;
  message: string;
  isDangerous: boolean;
}

/**
 * Build a confirmation request for a write operation.
 */
export function requestConfirmation(
  classification: StatementClassification,
  hasWhereClause: boolean,
  customPhrase?: string | null,
): ConfirmationRequest {
  if (classification === 'dangerous') {
    return {
      phrase: DEFAULT_DANGEROUS_PHRASE,
      message:
        'This is a DANGEROUS operation that may cause irreversible data loss. ' +
        `Type the following phrase exactly to confirm:\n\n  ${DEFAULT_DANGEROUS_PHRASE}`,
      isDangerous: true,
    };
  }

  if (!hasWhereClause) {
    return {
      phrase: DEFAULT_NO_WHERE_PHRASE,
      message:
        'WARNING: This statement has no WHERE clause and will affect ALL rows in the table. ' +
        `Type the following phrase exactly to confirm:\n\n  ${DEFAULT_NO_WHERE_PHRASE}`,
      isDangerous: false,
    };
  }

  const phrase = customPhrase || DEFAULT_WRITE_PHRASE;
  return {
    phrase,
    message:
      'This operation will modify data. ' +
      `Type the following phrase exactly to confirm:\n\n  ${phrase}`,
    isDangerous: false,
  };
}

/**
 * Verify that the user's input matches the expected confirmation phrase.
 * Exact match required (trimmed, case-sensitive).
 */
export function verifyConfirmation(input: string, expectedPhrase: string): boolean {
  return input.trim() === expectedPhrase;
}
