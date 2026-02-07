import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const CLI_ENTRY = resolve('dist/main.js');

function runCli(args, env) {
  const result = spawnSync(process.execPath, [CLI_ENTRY, ...args], {
    cwd: resolve('.'),
    env,
    encoding: 'utf8',
  });
  return {
    code: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

test('CLI integration against postgres fixture (safe read + blocked query)', { timeout: 120000 }, (t) => {
  if (process.env.OPENQUERY_PG_INTEGRATION !== '1') {
    t.skip('Set OPENQUERY_PG_INTEGRATION=1 to run CLI integration tests.');
    return;
  }

  const home = mkdtempSync(join(tmpdir(), 'openquery-cli-it-'));
  t.after(() => {
    rmSync(home, { recursive: true, force: true });
  });

  const profile = `itest-${Date.now()}`;
  const env = {
    ...process.env,
    HOME: home,
    OPENQUERY_PASSWORD: process.env.OPENQUERY_PG_PASSWORD || 'openquery_dev',
  };

  const host = process.env.OPENQUERY_PG_HOST || '127.0.0.1';
  const port = process.env.OPENQUERY_PG_PORT || '55432';
  const database = process.env.OPENQUERY_PG_DATABASE || 'openquery_test';
  const user = process.env.OPENQUERY_PG_USER || 'openquery';

  const add = runCli(
    [
      'profiles',
      'add',
      '--name',
      profile,
      '--type',
      'postgres',
      '--host',
      host,
      '--port',
      port,
      '--database',
      database,
      '--user',
      user,
      '--json',
    ],
    env,
  );
  assert.equal(add.code, 0, add.stderr || add.stdout);

  const use = runCli(['profiles', 'use', profile, '--json'], env);
  assert.equal(use.code, 0, use.stderr || use.stdout);

  const refresh = runCli(['schema', 'refresh', '--name', profile, '--json'], env);
  assert.equal(refresh.code, 0, refresh.stderr || refresh.stdout);

  const read = runCli(['run', '--name', profile, '--sql', 'SELECT id, email FROM users ORDER BY id LIMIT 3', '--json'], env);
  assert.equal(read.code, 0, read.stderr || read.stdout);
  const readPayload = JSON.parse(read.stdout);
  assert.equal(readPayload.ok, true);
  assert.equal(readPayload.data.rowCount >= 1, true);

  const blocked = runCli(['run', '--name', profile, '--sql', 'SELECT * FROM users', '--json'], env);
  assert.equal(blocked.code, 3, blocked.stderr || blocked.stdout);
  const blockedPayload = JSON.parse(blocked.stdout);
  assert.equal(blockedPayload.ok, false);
  assert.equal(blockedPayload.code, 'POLICY_BLOCKED');

  // No explicit cleanup command needed: HOME points to a temp dir removed by test teardown.
});
