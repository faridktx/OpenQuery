/**
 * Local state store using better-sqlite3.
 * Stores connection profiles, settings, and audit events.
 */

import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';

// ── Schema migrations ────────────────────────────────────────────────

const MIGRATIONS: string[] = [
  // 0: migrations table (always runs first)
  `CREATE TABLE IF NOT EXISTS migrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    version INTEGER NOT NULL UNIQUE,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,

  // 1: profiles
  `CREATE TABLE IF NOT EXISTS profiles (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    db_type TEXT NOT NULL,
    host TEXT,
    port INTEGER,
    database TEXT,
    "user" TEXT,
    ssl INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,

  // 2: settings (key-value)
  `CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  )`,

  // 3: audit_events
  `CREATE TABLE IF NOT EXISTS audit_events (
    id TEXT PRIMARY KEY,
    at TEXT NOT NULL DEFAULT (datetime('now')),
    type TEXT NOT NULL,
    payload_json TEXT
  )`,

  // 4: schema_snapshots
  `CREATE TABLE IF NOT EXISTS schema_snapshots (
    id TEXT PRIMARY KEY,
    profile_id TEXT NOT NULL,
    captured_at TEXT NOT NULL DEFAULT (datetime('now')),
    snapshot_json TEXT NOT NULL,
    FOREIGN KEY (profile_id) REFERENCES profiles(id)
  )`,

  // 5: queries
  `CREATE TABLE IF NOT EXISTS queries (
    id TEXT PRIMARY KEY,
    profile_id TEXT NOT NULL,
    asked_at TEXT NOT NULL DEFAULT (datetime('now')),
    question TEXT NOT NULL,
    mode TEXT NOT NULL,
    dialect TEXT NOT NULL
  )`,

  // 6: generations
  `CREATE TABLE IF NOT EXISTS generations (
    id TEXT PRIMARY KEY,
    query_id TEXT NOT NULL,
    generated_at TEXT NOT NULL DEFAULT (datetime('now')),
    model TEXT NOT NULL,
    generated_sql TEXT NOT NULL,
    generated_params_json TEXT,
    confidence REAL,
    assumptions_json TEXT,
    safety_notes_json TEXT,
    FOREIGN KEY (query_id) REFERENCES queries(id)
  )`,

  // 7: runs
  `CREATE TABLE IF NOT EXISTS runs (
    id TEXT PRIMARY KEY,
    query_id TEXT NOT NULL,
    ran_at TEXT NOT NULL DEFAULT (datetime('now')),
    rewritten_sql TEXT,
    rewritten_params_json TEXT,
    explain_summary_json TEXT,
    exec_ms INTEGER,
    row_count INTEGER,
    truncated INTEGER DEFAULT 0,
    status TEXT NOT NULL,
    error_text TEXT,
    FOREIGN KEY (query_id) REFERENCES queries(id)
  )`,

  // 8: power mode columns on profiles
  `ALTER TABLE profiles ADD COLUMN allow_write INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE profiles ADD COLUMN allow_dangerous INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE profiles ADD COLUMN power_confirm_phrase TEXT`,
];

// ── Profile type ─────────────────────────────────────────────────────

export interface StoredProfile {
  id: string;
  name: string;
  db_type: string;
  host: string | null;
  port: number | null;
  database: string | null;
  user: string | null;
  ssl: number;
  created_at: string;
  allow_write: number;
  allow_dangerous: number;
  power_confirm_phrase: string | null;
}

// ── Default DB path ──────────────────────────────────────────────────

export function defaultDbPath(): string {
  return join(homedir(), '.openquery', 'openquery.db');
}

// ── LocalStore ───────────────────────────────────────────────────────

export class LocalStore {
  private db: Database.Database;

  constructor(dbPath: string) {
    const dir = dirname(dbPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
  }

  /** Run all pending migrations */
  migrate(): void {
    this.db.exec(MIGRATIONS[0]); // ensure migrations table exists

    const applied = this.db
      .prepare('SELECT version FROM migrations ORDER BY version')
      .all() as { version: number }[];
    const appliedSet = new Set(applied.map((r) => r.version));

    const insert = this.db.prepare('INSERT INTO migrations (version) VALUES (?)');

    for (let i = 1; i < MIGRATIONS.length; i++) {
      if (!appliedSet.has(i)) {
        this.db.exec(MIGRATIONS[i]);
        insert.run(i);
      }
    }
  }

  // ── Profile repository ───────────────────────────────────────────

  createProfile(profile: {
    name: string;
    db_type: string;
    host?: string;
    port?: number;
    database?: string;
    user?: string;
    ssl?: boolean;
  }): StoredProfile {
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO profiles (id, name, db_type, host, port, database, "user", ssl)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        profile.name,
        profile.db_type,
        profile.host ?? null,
        profile.port ?? null,
        profile.database ?? null,
        profile.user ?? null,
        profile.ssl ? 1 : 0,
      );

    return this.db.prepare('SELECT * FROM profiles WHERE id = ?').get(id) as StoredProfile;
  }

  listProfiles(): StoredProfile[] {
    return this.db.prepare('SELECT * FROM profiles ORDER BY name').all() as StoredProfile[];
  }

  getProfileByName(name: string): StoredProfile | undefined {
    return this.db.prepare('SELECT * FROM profiles WHERE name = ?').get(name) as
      | StoredProfile
      | undefined;
  }

  deleteProfile(name: string): boolean {
    const result = this.db.prepare('DELETE FROM profiles WHERE name = ?').run(name);
    // Clear active profile if it was this one
    const active = this.getActiveProfile();
    if (active === name) {
      this.db.prepare("DELETE FROM settings WHERE key = 'active_profile'").run();
    }
    return result.changes > 0;
  }

  // ── Profile power settings ──────────────────────────────────────

  updateProfilePower(
    name: string,
    settings: { allowWrite?: boolean; allowDangerous?: boolean; confirmPhrase?: string | null },
  ): boolean {
    const parts: string[] = [];
    const values: unknown[] = [];

    if (settings.allowWrite !== undefined) {
      parts.push('allow_write = ?');
      values.push(settings.allowWrite ? 1 : 0);
    }
    if (settings.allowDangerous !== undefined) {
      parts.push('allow_dangerous = ?');
      values.push(settings.allowDangerous ? 1 : 0);
    }
    if (settings.confirmPhrase !== undefined) {
      parts.push('power_confirm_phrase = ?');
      values.push(settings.confirmPhrase);
    }

    if (parts.length === 0) return false;

    values.push(name);
    const result = this.db
      .prepare(`UPDATE profiles SET ${parts.join(', ')} WHERE name = ?`)
      .run(...values);
    return result.changes > 0;
  }

  getProfilePowerSettings(name: string): {
    allowWrite: boolean;
    allowDangerous: boolean;
    confirmPhrase: string | null;
  } | undefined {
    const row = this.db
      .prepare('SELECT allow_write, allow_dangerous, power_confirm_phrase FROM profiles WHERE name = ?')
      .get(name) as { allow_write: number; allow_dangerous: number; power_confirm_phrase: string | null } | undefined;
    if (!row) return undefined;
    return {
      allowWrite: row.allow_write === 1,
      allowDangerous: row.allow_dangerous === 1,
      confirmPhrase: row.power_confirm_phrase,
    };
  }

  // ── Active profile (settings) ────────────────────────────────────

  setActiveProfile(name: string): void {
    this.db
      .prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
      .run('active_profile', name);
  }

  getActiveProfile(): string | null {
    const row = this.db.prepare("SELECT value FROM settings WHERE key = 'active_profile'").get() as
      | { value: string }
      | undefined;
    return row?.value ?? null;
  }

  // ── Audit events ─────────────────────────────────────────────────

  logAudit(type: string, payload?: Record<string, unknown>): void {
    this.db
      .prepare('INSERT INTO audit_events (id, type, payload_json) VALUES (?, ?, ?)')
      .run(randomUUID(), type, payload ? JSON.stringify(payload) : null);
  }

  listAuditEvents(opts?: { type?: string; limit?: number }): Array<{ id: string; at: string; type: string; payload: Record<string, unknown> | null }> {
    const limit = opts?.limit ?? 50;
    if (opts?.type) {
      return (
        this.db
          .prepare('SELECT id, at, type, payload_json FROM audit_events WHERE type = ? ORDER BY at DESC LIMIT ?')
          .all(opts.type, limit) as Array<{ id: string; at: string; type: string; payload_json: string | null }>
      ).map((r) => ({
        id: r.id,
        at: r.at,
        type: r.type,
        payload: r.payload_json ? JSON.parse(r.payload_json) : null,
      }));
    }
    return (
      this.db
        .prepare('SELECT id, at, type, payload_json FROM audit_events ORDER BY at DESC LIMIT ?')
        .all(limit) as Array<{ id: string; at: string; type: string; payload_json: string | null }>
    ).map((r) => ({
      id: r.id,
      at: r.at,
      type: r.type,
      payload: r.payload_json ? JSON.parse(r.payload_json) : null,
    }));
  }

  // ── Schema snapshots ────────────────────────────────────────────

  storeSchemaSnapshot(profileId: string, snapshotJson: string): string {
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO schema_snapshots (id, profile_id, snapshot_json) VALUES (?, ?, ?)`,
      )
      .run(id, profileId, snapshotJson);
    return id;
  }

  getLatestSchemaSnapshot(profileId: string): { id: string; capturedAt: string; snapshotJson: string } | undefined {
    return this.db
      .prepare(
        `SELECT id, captured_at AS capturedAt, snapshot_json AS snapshotJson
         FROM schema_snapshots WHERE profile_id = ? ORDER BY captured_at DESC LIMIT 1`,
      )
      .get(profileId) as { id: string; capturedAt: string; snapshotJson: string } | undefined;
  }

  // ── Lifecycle ────────────────────────────────────────────────────

  getDb(): Database.Database {
    return this.db;
  }

  close(): void {
    this.db.close();
  }
}
