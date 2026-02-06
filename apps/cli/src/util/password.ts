/**
 * Interactive password prompt utility.
 * Reads password from OPENQUERY_PASSWORD env var or prompts interactively (no echo).
 */

import { createInterface } from 'node:readline';

export function getPassword(): Promise<string> {
  // Check env var first
  const envPw = process.env.OPENQUERY_PASSWORD;
  if (envPw) {
    return Promise.resolve(envPw);
  }

  return new Promise((resolve, reject) => {
    const rl = createInterface({
      input: process.stdin,
      output: process.stderr, // write prompt to stderr so stdout stays clean
      terminal: true,
    });

    // Disable echo
    if (process.stdin.isTTY) {
      process.stdin.setRawMode?.(false);
    }

    process.stderr.write('Password: ');

    // Mute output for password entry
    const origWrite = process.stdout.write.bind(process.stdout);
    const stderrOrigWrite = process.stderr.write.bind(process.stderr);
    let muted = true;

    // Override stderr write to hide typed characters
    (process.stderr as NodeJS.WritableStream).write = ((
      chunk: string | Uint8Array,
      ...args: unknown[]
    ): boolean => {
      if (muted && typeof chunk === 'string' && chunk !== 'Password: ' && chunk !== '\n') {
        return true;
      }
      return (stderrOrigWrite as (...a: unknown[]) => boolean)(chunk, ...args);
    }) as typeof process.stderr.write;

    rl.question('', (answer) => {
      muted = false;
      (process.stderr as NodeJS.WritableStream).write = stderrOrigWrite;
      process.stderr.write('\n');
      rl.close();
      resolve(answer);
    });

    rl.on('error', reject);
  });
}
