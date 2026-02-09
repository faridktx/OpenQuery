import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const DEFAULT_FIXTURE_ENV_PATHS = [
  resolve(process.cwd(), '.openquery', 'fixture.env'),
  resolve(process.cwd(), '..', '.openquery', 'fixture.env'),
  resolve(process.cwd(), '..', '..', '.openquery', 'fixture.env'),
];

function parseEnvLine(line: string): { key: string; value: string } | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) return null;
  const idx = trimmed.indexOf('=');
  if (idx <= 0) return null;
  const key = trimmed.slice(0, idx).trim();
  if (!key) return null;
  let value = trimmed.slice(idx + 1).trim();
  if (
    value.length >= 2 &&
    ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'")))
  ) {
    value = value.slice(1, -1);
  }
  return { key, value };
}

export function loadFixtureEnvIfNeeded(paths: string[] = DEFAULT_FIXTURE_ENV_PATHS): string | null {
  if (process.env.OPENQUERY_PG_INTEGRATION !== '1') {
    return null;
  }

  const envPath = paths.find((path) => existsSync(path));
  if (!envPath) return null;

  const contents = readFileSync(envPath, 'utf-8');
  for (const line of contents.split(/\r?\n/)) {
    const parsed = parseEnvLine(line);
    if (!parsed) continue;
    if (process.env[parsed.key] !== undefined) continue;
    process.env[parsed.key] = parsed.value;
  }

  return envPath;
}

