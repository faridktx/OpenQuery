/**
 * Secret storage interface.
 * Implementations: NoopSecretStore (CLI), KeychainSecretStore (desktop).
 */

export interface SecretStore {
  /** Store a password for a profile */
  set(profileId: string, password: string): Promise<void>;
  /** Retrieve a stored password, or null if not found */
  get(profileId: string): Promise<string | null>;
  /** Delete a stored password */
  delete(profileId: string): Promise<void>;
}
