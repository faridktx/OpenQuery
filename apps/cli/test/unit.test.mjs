import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeArgv } from '../dist/argv.js';
import {
  policyError,
  runtimeError,
  usageError,
  toExitCode,
  EXIT_CODE_POLICY,
  EXIT_CODE_RUNTIME,
  EXIT_CODE_USAGE,
} from '../dist/errors.js';
import { printError } from '../dist/output.js';

test('normalizeArgv removes pnpm standalone double-dash', () => {
  const raw = ['node', 'dist/main.js', '--', 'doctor'];
  assert.deepEqual(normalizeArgv(raw), ['node', 'dist/main.js', 'doctor']);
});

test('normalizeArgv keeps normal argv untouched', () => {
  const raw = ['node', 'dist/main.js', 'doctor'];
  assert.deepEqual(normalizeArgv(raw), raw);
});

test('exit code mapping follows contract', () => {
  assert.equal(toExitCode(usageError('bad args')), EXIT_CODE_USAGE);
  assert.equal(toExitCode(runtimeError('db down')), EXIT_CODE_RUNTIME);
  assert.equal(toExitCode(policyError('blocked')), EXIT_CODE_POLICY);
});

test('printError emits structured JSON for machine mode', () => {
  const logs = [];
  const original = console.log;
  console.log = (value) => logs.push(String(value));
  try {
    printError(policyError('blocked by policy'), {
      json: true,
      quiet: false,
      verbose: false,
      debug: false,
    });
  } finally {
    console.log = original;
  }

  assert.equal(logs.length, 1);
  const parsed = JSON.parse(logs[0]);
  assert.equal(parsed.ok, false);
  assert.equal(parsed.code, 'POLICY_BLOCKED');
  assert.equal(parsed.message, 'blocked by policy');
});
