import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const thisFile = fileURLToPath(import.meta.url);
const cliRoot = path.resolve(path.dirname(thisFile), '..');
const tmpDir = path.join(cliRoot, '.pack-tmp');
const statePath = path.join(cliRoot, '.pack-state.json');
const corePath = path.join(cliRoot, 'node_modules', '@openquery', 'core');

function run(cmd, args, cwd = cliRoot, capture = false) {
  const output = execFileSync(cmd, args, {
    cwd,
    encoding: 'utf8',
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  });
  return output?.trim() ?? '';
}

function ensureCoreLinkRestoredFromPreviousRun() {
  if (!existsSync(statePath)) return;
  try {
    const state = JSON.parse(readFileSync(statePath, 'utf8'));
    if (existsSync(corePath)) rmSync(corePath, { recursive: true, force: true });
    if (state?.hadSymlink && typeof state.symlinkTarget === 'string') {
      mkdirSync(path.dirname(corePath), { recursive: true });
      symlinkSync(state.symlinkTarget, corePath);
    }
  } catch {
    // Best effort cleanup from interrupted previous pack runs.
  } finally {
    rmSync(statePath, { force: true });
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

ensureCoreLinkRestoredFromPreviousRun();
run('pnpm', ['-C', '../../packages/core', 'build']);

mkdirSync(tmpDir, { recursive: true });
const packedName = run('npm', ['pack', '../../packages/core', '--pack-destination', tmpDir], cliRoot, true)
  .split('\n')
  .map((line) => line.trim())
  .filter(Boolean)
  .at(-1);

if (!packedName) {
  throw new Error('Unable to pack @openquery/core for CLI prepack.');
}

let hadSymlink = false;
let symlinkTarget = null;
if (existsSync(corePath) && lstatSync(corePath).isSymbolicLink()) {
  hadSymlink = true;
  symlinkTarget = readlinkSync(corePath);
}

if (existsSync(corePath)) {
  rmSync(corePath, { recursive: true, force: true });
}
mkdirSync(corePath, { recursive: true });

const coreTgz = path.join(tmpDir, packedName);
run('tar', ['-xzf', coreTgz, '-C', corePath, '--strip-components=1']);

writeFileSync(
  statePath,
  JSON.stringify(
    {
      hadSymlink,
      symlinkTarget,
    },
    null,
    2,
  ),
);
