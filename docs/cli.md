# OpenQuery CLI

Enterprise-grade local SQL copilot CLI with safe defaults and machine-readable output.

## Install and Run

### Local workspace (recommended for contributors)
```bash
pnpm -C apps/cli build
node apps/cli/dist/main.js --help
```

### pnpm script invocation
```bash
pnpm -C apps/cli run cli -- --help
pnpm -C apps/cli run cli -- doctor
```

### Package smoke
```bash
cd apps/cli
npm pack
```

The package exports both bins:
- `openquery`
- `oq`

## Global flags
All leaf commands support:
- `--json` machine-readable output
- `--quiet` suppress non-essential logs
- `--verbose` include additional context
- `--debug` include technical details/stacks

## Exit codes
- `0` success
- `1` usage/validation failure
- `2` runtime failure (db/network/environment)
- `3` policy/safety blocked

## Quickstart

```bash
openquery doctor
openquery profiles add --name demo --type postgres --host 127.0.0.1 --port 55432 --database openquery_test --user openquery
openquery profiles use demo
openquery schema refresh --name demo
openquery run --sql "SELECT id, email FROM users ORDER BY id LIMIT 20"
```

## Human vs JSON output

Human:
```bash
openquery profiles list
```

JSON:
```bash
openquery profiles list --json
```

## Common troubleshooting

- `Profile not found`:
  - run `openquery profiles list`
  - set active profile with `openquery profiles use <name>`

- `Policy blocked`:
  - read message and suggestion
  - avoid `SELECT *`
  - reduce row scope with `LIMIT` and filters

- `Connection failed`:
  - verify host/port/user/database
  - verify password (`OPENQUERY_PASSWORD` or interactive prompt)

## Smoke test script

```bash
scripts/smoke-cli.sh
```

If `OPENQUERY_PG_INTEGRATION=1` is set, the script also verifies postgres profile + read query + blocked query behavior.
