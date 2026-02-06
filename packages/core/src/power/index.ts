/**
 * POWER mode — controlled write operations with strict oversight.
 */

export { previewWrite, type PreviewInput } from './preview.js';
export {
  requestConfirmation,
  verifyConfirmation,
  DEFAULT_WRITE_PHRASE,
  DEFAULT_DANGEROUS_PHRASE,
  DEFAULT_NO_WHERE_PHRASE,
  type ConfirmationRequest,
} from './confirm.js';
export { executeWriteWithAudit, hashSql, type WriteExecuteInput } from './execute.js';
