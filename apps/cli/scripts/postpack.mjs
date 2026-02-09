import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const thisFile = fileURLToPath(import.meta.url);
const cliRoot = path.resolve(path.dirname(thisFile), '..');
const tmpDir = path.join(cliRoot, '.pack-tmp');
const statePath = path.join(cliRoot, '.pack-state.json');
const corePath = path.join(cliRoot, 'node_modules', '@openquery', 'core');

try {
  if (!existsSync(statePath)) {
    rmSync(tmpDir, { recursive: true, force: true });
    process.exit(0);
  }

  const state = JSON.parse(readFileSync(statePath, 'utf8'));
  rmSync(corePath, { recursive: true, force: true });

  if (state?.hadSymlink && typeof state.symlinkTarget === 'string') {
    mkdirSync(path.dirname(corePath), { recursive: true });
    symlinkSync(state.symlinkTarget, corePath);
  }
} finally {
  rmSync(statePath, { force: true });
  rmSync(tmpDir, { recursive: true, force: true });
}
