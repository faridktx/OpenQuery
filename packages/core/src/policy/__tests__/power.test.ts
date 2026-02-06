/**
 * POWER mode tests — Phase 5.
 * Covers statement classification, policy gating, confirmation, and migration.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { classifyStatement } from '../classify.js';
import { DefaultPolicyEngine } from '../engine.js';
import {
  requestConfirmation,
  verifyConfirmation,
  DEFAULT_WRITE_PHRASE,
  DEFAULT_DANGEROUS_PHRASE,
  DEFAULT_NO_WHERE_PHRASE,
} from '../../power/confirm.js';
import { LocalStore } from '../../storage/sqlite.js';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

// ── Statement classification tests ──────────────────────────────────

describe('classifyStatement', () => {
  it('classifies SELECT as read', () => {
    const result = classifyStatement('SELECT * FROM users');
    assert.equal(result.classification, 'read');
    assert.equal(result.kind, 'select');
    assert.ok(result.impactedTables.includes('users'));
  });

  it('classifies INSERT as write', () => {
    const result = classifyStatement("INSERT INTO users (name) VALUES ('test')");
    assert.equal(result.classification, 'write');
    assert.equal(result.kind, 'insert');
    assert.ok(result.impactedTables.includes('users'));
  });

  it('classifies UPDATE as write', () => {
    const result = classifyStatement("UPDATE users SET name = 'x' WHERE id = 1");
    assert.equal(result.classification, 'write');
    assert.equal(result.kind, 'update');
    assert.ok(result.impactedTables.includes('users'));
    assert.equal(result.hasWhereClause, true);
  });

  it('classifies DELETE as write', () => {
    const result = classifyStatement('DELETE FROM users WHERE id = 1');
    assert.equal(result.classification, 'write');
    assert.equal(result.kind, 'delete');
    assert.equal(result.hasWhereClause, true);
  });

  it('classifies UPDATE without WHERE', () => {
    const result = classifyStatement("UPDATE users SET active = false");
    assert.equal(result.classification, 'write');
    assert.equal(result.hasWhereClause, false);
    assert.ok(result.summary.includes('no WHERE'));
  });

  it('classifies DELETE without WHERE', () => {
    const result = classifyStatement('DELETE FROM users');
    assert.equal(result.classification, 'write');
    assert.equal(result.hasWhereClause, false);
    assert.ok(result.summary.includes('no WHERE'));
  });

  it('classifies CREATE TABLE as write', () => {
    const result = classifyStatement('CREATE TABLE test_table (id INTEGER PRIMARY KEY)');
    assert.equal(result.classification, 'write');
    assert.equal(result.kind, 'create');
  });

  it('classifies ALTER TABLE as write', () => {
    const result = classifyStatement('ALTER TABLE users ADD COLUMN email TEXT');
    assert.equal(result.classification, 'write');
    assert.equal(result.kind, 'alter');
  });

  it('classifies DROP TABLE as dangerous', () => {
    const result = classifyStatement('DROP TABLE users');
    assert.equal(result.classification, 'dangerous');
    assert.equal(result.kind, 'drop');
    assert.ok(result.impactedTables.includes('users'));
    assert.ok(result.summary.includes('DANGEROUS'));
  });

  it('classifies TRUNCATE as dangerous', () => {
    const result = classifyStatement('TRUNCATE users');
    assert.equal(result.classification, 'dangerous');
    assert.equal(result.kind, 'truncate');
  });

  it('classifies GRANT as dangerous via text detection', () => {
    const result = classifyStatement('GRANT ALL ON users TO admin');
    assert.equal(result.classification, 'dangerous');
  });

  it('classifies REVOKE as dangerous via text detection', () => {
    const result = classifyStatement('REVOKE ALL ON users FROM admin');
    assert.equal(result.classification, 'dangerous');
  });

  it('classifies CREATE INDEX as write', () => {
    const result = classifyStatement('CREATE INDEX idx_users_name ON users (name)');
    assert.equal(result.classification, 'write');
    assert.equal(result.kind, 'create');
  });
});

// ── Policy engine with write mode ───────────────────────────────────

describe('DefaultPolicyEngine with allowWrite', () => {
  it('blocks UPDATE when allowWrite=false', () => {
    const engine = new DefaultPolicyEngine(
      { allowWrite: false },
      { disallowSelectStar: false },
    );
    const result = engine.validateAndRewrite("UPDATE users SET name = 'x' WHERE id = 1");
    assert.equal(result.allowed, false);
    assert.ok(result.reason.includes('POWER mode'));
  });

  it('allows UPDATE when allowWrite=true', () => {
    const engine = new DefaultPolicyEngine(
      { allowWrite: true },
      { disallowSelectStar: false },
    );
    const result = engine.validateAndRewrite("UPDATE users SET name = 'x' WHERE id = 1");
    assert.equal(result.allowed, true);
  });

  it('allows INSERT when allowWrite=true', () => {
    const engine = new DefaultPolicyEngine(
      { allowWrite: true },
      { disallowSelectStar: false },
    );
    const result = engine.validateAndRewrite("INSERT INTO users (name) VALUES ('test')");
    assert.equal(result.allowed, true);
  });

  it('allows DELETE when allowWrite=true', () => {
    const engine = new DefaultPolicyEngine(
      { allowWrite: true },
      { disallowSelectStar: false },
    );
    const result = engine.validateAndRewrite('DELETE FROM users WHERE id = 1');
    assert.equal(result.allowed, true);
  });

  it('allows CREATE TABLE when allowWrite=true', () => {
    const engine = new DefaultPolicyEngine(
      { allowWrite: true },
      { disallowSelectStar: false },
    );
    const result = engine.validateAndRewrite('CREATE TABLE test_t (id INT)');
    assert.equal(result.allowed, true);
  });

  it('blocks DROP TABLE even when allowWrite=true but allowDestructive=false', () => {
    const engine = new DefaultPolicyEngine(
      { allowWrite: true, allowDestructive: false },
      { disallowSelectStar: false },
    );
    const result = engine.validateAndRewrite('DROP TABLE users');
    assert.equal(result.allowed, false);
    assert.ok(result.reason.includes('Dangerous') || result.reason.includes('blocked'));
  });

  it('allows DROP TABLE when allowWrite=true AND allowDestructive=true', () => {
    const engine = new DefaultPolicyEngine(
      { allowWrite: true, allowDestructive: true },
      { disallowSelectStar: false },
    );
    const result = engine.validateAndRewrite('DROP TABLE users');
    assert.equal(result.allowed, true);
  });

  it('blocks TRUNCATE unless allowDestructive=true', () => {
    const engine = new DefaultPolicyEngine(
      { allowWrite: true, allowDestructive: false },
      { disallowSelectStar: false },
    );
    const result = engine.validateAndRewrite('TRUNCATE users');
    assert.equal(result.allowed, false);
  });

  it('still blocks multi-statement even in write mode', () => {
    const engine = new DefaultPolicyEngine(
      { allowWrite: true },
      { disallowSelectStar: false },
    );
    const result = engine.validateAndRewrite('INSERT INTO t VALUES (1); INSERT INTO t VALUES (2)');
    assert.equal(result.allowed, false);
    assert.ok(result.reason.includes('Multiple'));
  });

  it('classifyAndValidate returns both classification and validation', () => {
    const engine = new DefaultPolicyEngine(
      { allowWrite: true },
      { disallowSelectStar: false },
    );
    const { validation, classification } = engine.classifyAndValidate("UPDATE users SET name = 'x' WHERE id = 1");
    assert.equal(validation.allowed, true);
    assert.equal(classification.classification, 'write');
    assert.equal(classification.kind, 'update');
    assert.ok(classification.impactedTables.includes('users'));
  });
});

// ── Confirmation system tests ───────────────────────────────────────

describe('Confirmation system', () => {
  it('verifyConfirmation requires exact match', () => {
    assert.equal(verifyConfirmation(DEFAULT_WRITE_PHRASE, DEFAULT_WRITE_PHRASE), true);
    assert.equal(verifyConfirmation('wrong phrase', DEFAULT_WRITE_PHRASE), false);
    assert.equal(verifyConfirmation('', DEFAULT_WRITE_PHRASE), false);
  });

  it('verifyConfirmation trims whitespace', () => {
    assert.equal(verifyConfirmation(`  ${DEFAULT_WRITE_PHRASE}  `, DEFAULT_WRITE_PHRASE), true);
  });

  it('verifyConfirmation is case-sensitive', () => {
    assert.equal(verifyConfirmation(DEFAULT_WRITE_PHRASE.toLowerCase(), DEFAULT_WRITE_PHRASE), false);
  });

  it('requestConfirmation returns dangerous for dangerous ops', () => {
    const req = requestConfirmation('dangerous', true);
    assert.equal(req.isDangerous, true);
    assert.equal(req.phrase, DEFAULT_DANGEROUS_PHRASE);
  });

  it('requestConfirmation returns no-where phrase when hasWhere=false', () => {
    const req = requestConfirmation('write', false);
    assert.equal(req.phrase, DEFAULT_NO_WHERE_PHRASE);
    assert.ok(req.message.includes('no WHERE'));
  });

  it('requestConfirmation uses custom phrase when provided', () => {
    const custom = 'MY CUSTOM PHRASE';
    const req = requestConfirmation('write', true, custom);
    assert.equal(req.phrase, custom);
  });

  it('requestConfirmation uses default phrase when custom is null', () => {
    const req = requestConfirmation('write', true, null);
    assert.equal(req.phrase, DEFAULT_WRITE_PHRASE);
  });
});

// ── SQLite migration tests ──────────────────────────────────────────

describe('Migration 8: Power mode columns', () => {
  let store: LocalStore;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'oq-test-'));
    store = new LocalStore(join(tmpDir, 'test.db'));
    store.migrate();
  });

  afterEach(() => {
    store.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('profiles have power columns after migration', () => {
    const profile = store.createProfile({
      name: 'test-pg',
      db_type: 'postgres',
      host: 'localhost',
      port: 5432,
      database: 'testdb',
      user: 'testuser',
    });
    assert.equal(profile.allow_write, 0);
    assert.equal(profile.allow_dangerous, 0);
    assert.equal(profile.power_confirm_phrase, null);
  });

  it('updateProfilePower sets allow_write', () => {
    store.createProfile({
      name: 'test-pg',
      db_type: 'postgres',
      host: 'localhost',
    });

    const updated = store.updateProfilePower('test-pg', { allowWrite: true });
    assert.equal(updated, true);

    const settings = store.getProfilePowerSettings('test-pg');
    assert.ok(settings);
    assert.equal(settings.allowWrite, true);
    assert.equal(settings.allowDangerous, false);
  });

  it('updateProfilePower sets allow_dangerous', () => {
    store.createProfile({
      name: 'test-pg',
      db_type: 'postgres',
      host: 'localhost',
    });

    store.updateProfilePower('test-pg', { allowWrite: true, allowDangerous: true });
    const settings = store.getProfilePowerSettings('test-pg');
    assert.ok(settings);
    assert.equal(settings.allowWrite, true);
    assert.equal(settings.allowDangerous, true);
  });

  it('updateProfilePower sets custom confirmation phrase', () => {
    store.createProfile({
      name: 'test-pg',
      db_type: 'postgres',
      host: 'localhost',
    });

    store.updateProfilePower('test-pg', { confirmPhrase: 'CUSTOM PHRASE' });
    const settings = store.getProfilePowerSettings('test-pg');
    assert.ok(settings);
    assert.equal(settings.confirmPhrase, 'CUSTOM PHRASE');
  });

  it('updateProfilePower returns false for nonexistent profile', () => {
    const result = store.updateProfilePower('nonexistent', { allowWrite: true });
    assert.equal(result, false);
  });

  it('getProfilePowerSettings returns undefined for nonexistent profile', () => {
    const settings = store.getProfilePowerSettings('nonexistent');
    assert.equal(settings, undefined);
  });
});

// ── Audit events tests ──────────────────────────────────────────────

describe('Audit events for power mode', () => {
  let store: LocalStore;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'oq-test-'));
    store = new LocalStore(join(tmpDir, 'test.db'));
    store.migrate();
  });

  afterEach(() => {
    store.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('logs power_enabled audit event', () => {
    store.logAudit('power_enabled', { profile_id: 'test-id', allow_dangerous: false });
    const events = store.listAuditEvents({ type: 'power_enabled' });
    assert.equal(events.length, 1);
    assert.equal(events[0].type, 'power_enabled');
    assert.equal((events[0].payload as any).profile_id, 'test-id');
  });

  it('logs write_blocked audit event', () => {
    store.logAudit('write_blocked', {
      profile_id: 'test-id',
      classification: 'write',
      reason: 'Power mode not enabled',
      sql_hash: 'abc123',
    });
    const events = store.listAuditEvents({ type: 'write_blocked' });
    assert.equal(events.length, 1);
    assert.equal((events[0].payload as any).classification, 'write');
  });

  it('logs write_executed audit event', () => {
    store.logAudit('write_executed', {
      profile_id: 'test-id',
      classification: 'write',
      impacted_tables: ['users'],
      rows_affected: 5,
      exec_ms: 12,
      sql_hash: 'abc123',
    });
    const events = store.listAuditEvents({ type: 'write_executed' });
    assert.equal(events.length, 1);
    assert.equal((events[0].payload as any).rows_affected, 5);
  });

  it('listAuditEvents with limit', () => {
    for (let i = 0; i < 10; i++) {
      store.logAudit('test_event', { i });
    }
    const events = store.listAuditEvents({ type: 'test_event', limit: 3 });
    assert.equal(events.length, 3);
  });

  it('listAuditEvents without type filter', () => {
    store.logAudit('power_enabled', {});
    store.logAudit('write_executed', {});
    const events = store.listAuditEvents({ limit: 10 });
    assert.equal(events.length, 2);
  });
});
