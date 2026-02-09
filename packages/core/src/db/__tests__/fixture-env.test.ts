import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadFixtureEnvIfNeeded } from './fixture-env.js';

const keys = [
  'OPENQUERY_PG_INTEGRATION',
  'OPENQUERY_PG_HOST',
  'OPENQUERY_PG_PORT',
  'OPENQUERY_PG_DATABASE',
  'OPENQUERY_PG_USER',
  'OPENQUERY_PG_PASSWORD',
] as const;

function clearKeys(): void {
  for (const key of keys) {
    delete process.env[key];
  }
}

afterEach(() => {
  clearKeys();
});

describe('loadFixtureEnvIfNeeded', () => {
  it('loads fixture env values when integration is enabled', () => {
    process.env.OPENQUERY_PG_INTEGRATION = '1';
    const dir = mkdtempSync(join(tmpdir(), 'openquery-fixture-env-'));
    const envFile = join(dir, 'fixture.env');
    writeFileSync(
      envFile,
      [
        'OPENQUERY_PG_HOST=127.0.0.1',
        'OPENQUERY_PG_PORT=55432',
        'OPENQUERY_PG_DATABASE=openquery_test',
        'OPENQUERY_PG_USER=openquery',
        'OPENQUERY_PG_PASSWORD=openquery_dev',
      ].join('\n'),
      'utf-8',
    );

    try {
      const loaded = loadFixtureEnvIfNeeded([envFile]);
      assert.equal(loaded, envFile);
      assert.equal(process.env.OPENQUERY_PG_PORT, '55432');
      assert.equal(process.env.OPENQUERY_PG_HOST, '127.0.0.1');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('does not override values already set in process env', () => {
    process.env.OPENQUERY_PG_INTEGRATION = '1';
    process.env.OPENQUERY_PG_PORT = '5432';
    const dir = mkdtempSync(join(tmpdir(), 'openquery-fixture-env-'));
    const envFile = join(dir, 'fixture.env');
    writeFileSync(envFile, 'OPENQUERY_PG_PORT=55432\n', 'utf-8');

    try {
      loadFixtureEnvIfNeeded([envFile]);
      assert.equal(process.env.OPENQUERY_PG_PORT, '5432');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('does nothing when integration mode is not enabled', () => {
    const dir = mkdtempSync(join(tmpdir(), 'openquery-fixture-env-'));
    const envFile = join(dir, 'fixture.env');
    writeFileSync(envFile, 'OPENQUERY_PG_PORT=55432\n', 'utf-8');
    try {
      const loaded = loadFixtureEnvIfNeeded([envFile]);
      assert.equal(loaded, null);
      assert.equal(process.env.OPENQUERY_PG_PORT, undefined);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

