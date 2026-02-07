# OpenQuery Smoke Checklist

Run from repo root unless noted.

## Workspace reliability

| Step | Command | Expected signal |
|---|---|---|
| Install | `pnpm install` | exits 0 |
| Build | `pnpm -r build` | exits 0 |
| Test | `pnpm -r test` | exits 0 |
| Lint | `pnpm lint` | exits 0 |
| Typecheck | `pnpm typecheck` | exits 0 |

## Docker fixture reliability

| Step | Command | Expected signal |
|---|---|---|
| Docker daemon | `docker info` | exits 0 |
| Fixture smoke (port override) | `OPENQUERY_PG_PORT=55432 pnpm smoke:docker` | fixture starts, readiness passes, seeded `users` count printed |
| Core integration | `OPENQUERY_PG_PORT=55432 OPENQUERY_PG_HOST=127.0.0.1 pnpm --filter @openquery/core test:integration` | exits 0 |

## CLI deterministic execution

| Step | Command | Expected signal |
|---|---|---|
| Build CLI | `pnpm -C apps/cli build` | exits 0 |
| Help | `node apps/cli/dist/main.js --help` | usage text |
| Doctor | `node apps/cli/dist/main.js doctor` | dependency and env summary |

Optional helper path:

| Step | Command | Expected signal |
|---|---|---|
| Root helper doctor | `pnpm openquery:build -- doctor` | same doctor output |

## Desktop compile check

| Step | Command | Expected signal |
|---|---|---|
| Frontend build | `pnpm --filter @openquery/desktop build` | exits 0 |
| Tauri compile no bundle | `pnpm --filter @openquery/desktop tauri build --no-bundle` | exits 0 |

## Eval harness

| Step | Command | Expected signal |
|---|---|---|
| Eval | `pnpm eval` | summary report printed, exits 0 |
