/**
 * NoopSecretStore — used by CLI where passwords come from env/prompt.
 * Never stores anything.
 */

import type { SecretStore } from './types.js';

export class NoopSecretStore implements SecretStore {
  async set(_profileId: string, _password: string): Promise<void> {
    // no-op
  }

  async get(_profileId: string): Promise<string | null> {
    return null;
  }

  async delete(_profileId: string): Promise<void> {
    // no-op
  }
}
