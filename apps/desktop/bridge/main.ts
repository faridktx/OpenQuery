#!/usr/bin/env node

/**
 * Bridge process — JSON-RPC over stdin/stdout.
 * Tauri spawns this process and communicates via newline-delimited JSON.
 *
 * Request:  {"id":"uuid","method":"profiles.list","params":{}}\n
 * Response: {"id":"uuid","result":{...}}\n
 * Error:    {"id":"uuid","error":"message"}\n
 */

import { createInterface } from 'node:readline';
import { dispatch, shutdown } from './handlers.js';

const rl = createInterface({ input: process.stdin });

rl.on('line', async (line: string) => {
  let id: string | null = null;
  try {
    const msg = JSON.parse(line);
    id = msg.id ?? null;
    const result = await dispatch(msg.method, msg.params ?? {});
    write({ id, result: result ?? null });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    write({ id, error: message });
  }
});

rl.on('close', () => {
  shutdown();
  process.exit(0);
});

process.on('SIGTERM', () => {
  shutdown();
  process.exit(0);
});

function write(msg: unknown): void {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

// Signal ready
write({ id: null, result: 'bridge_ready' });
