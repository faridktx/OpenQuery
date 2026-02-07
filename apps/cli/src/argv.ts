export function normalizeArgv(rawArgv: string[]): string[] {
  // pnpm run forwards args as: node dist/main.js -- <args>
  if (rawArgv[2] === '--') {
    return [rawArgv[0], rawArgv[1], ...rawArgv.slice(3)];
  }
  return rawArgv;
}
