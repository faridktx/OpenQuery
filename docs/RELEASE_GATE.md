# OpenQuery Release Gate

Version: 2026-02-09

Purpose:
- define explicit pass/fail commands for packaging readiness,
- avoid subjective "looks good" release decisions.

Rule:
- If any required gate fails, packaging verdict is `NO`.
- Optional Docker gates may be skipped only when Docker is unavailable.

## 1. Environment

Required:
- Node.js >= 20
- pnpm >= 9
- Rust toolchain + Tauri prerequisites for desktop build

Optional:
- Docker Desktop/Engine for fixture + integration gates

## 2. Command Gates

Run from repository root unless noted.

1. Install
```bash
pnpm install
```
Pass criteria:
- exits `0`
- lockfile/dependency resolution completes without fatal errors

2. Lint
```bash
pnpm lint
```
Pass criteria:
- exits `0`
- no lint errors

3. Typecheck
```bash
pnpm typecheck
```
Pass criteria:
- exits `0`
- no TypeScript errors

4. Build all packages
```bash
pnpm -r build
```
Pass criteria:
- exits `0`
- all workspace packages build

5. Test all packages
```bash
pnpm -r test
```
Pass criteria:
- exits `0`
- all tests pass

6. Eval harness
```bash
pnpm eval
```
Pass criteria:
- exits `0`
- eval command completes

7. Desktop compile (tauri, no bundle)
```bash
pnpm --filter @openquery/desktop tauri build --no-bundle
```
Pass criteria:
- exits `0`
- Tauri desktop compile succeeds

Current macOS bundle output:
- `.app` bundle is generated at `apps/desktop/src-tauri/target/release/bundle/macos/`.
- `.dmg` is not produced by default in the current configuration.

8. CLI build
```bash
pnpm -C apps/cli build
```
Pass criteria:
- exits `0`
- `apps/cli/dist/main.js` exists

9. CLI doctor smoke
```bash
node apps/cli/dist/main.js doctor
```
Pass criteria:
- exits `0`
- prints doctor summary without unhandled exception

10. CLI help smoke
```bash
node apps/cli/dist/main.js --help
```
Pass criteria:
- exits `0`
- help text renders

## 3. Conditional Docker Gates

Run only if Docker is available (`docker info` works).

11. Docker fixture smoke
```bash
pnpm smoke:docker
```
Pass criteria:
- exits `0`
- fixture startup + seed verification pass
- `.openquery/fixture.env` is created with chosen host/port/db/user/password

12. Core Postgres integration tests
```bash
pnpm --filter @openquery/core test:integration
```
Pass criteria:
- exits `0`
- integration suite passes

If Docker is unavailable:
- mark Docker gates as `SKIPPED (Docker unavailable)`.
- do not mark as pass.

Recommended local convenience:
```bash
pnpm smoke:integration
```
This runs:
1. `pnpm smoke:docker`
2. `OPENQUERY_PG_INTEGRATION=1 pnpm --filter @openquery/core test:integration`

## 4. Manual Desktop Smoke

Required checks:
1. Launch desktop app (Tauri runtime, not Vite-only).
2. Complete setup using No-Docker demo path.
3. Set OpenAI key in Settings UI.
4. Run one safe query successfully.
5. Trigger one blocked query and confirm fix guidance is shown.
6. Verify history entry appears and markdown export works.

Pass criteria:
- all six checks complete without terminal-only workaround.

## 5. Recording Template

Use this exact table in release notes or PR comment:

| Gate | Command/Check | Result |
|---|---|---|
| G1 | `pnpm install` | PASS/FAIL |
| G2 | `pnpm lint` | PASS/FAIL |
| G3 | `pnpm typecheck` | PASS/FAIL |
| G4 | `pnpm -r build` | PASS/FAIL |
| G5 | `pnpm -r test` | PASS/FAIL |
| G6 | `pnpm eval` | PASS/FAIL |
| G7 | `pnpm --filter @openquery/desktop tauri build --no-bundle` | PASS/FAIL |
| G8 | `pnpm -C apps/cli build` | PASS/FAIL |
| G9 | `node apps/cli/dist/main.js doctor` | PASS/FAIL |
| G10 | `node apps/cli/dist/main.js --help` | PASS/FAIL |
| G11 | `pnpm smoke:docker` | PASS/FAIL/SKIP |
| G12 | `pnpm --filter @openquery/core test:integration` | PASS/FAIL/SKIP |
| M1 | Desktop manual smoke (6 checks) | PASS/FAIL |

Final verdict:
- `Ready to package: YES` only when all required gates pass.
- otherwise `Ready to package: NO`.
