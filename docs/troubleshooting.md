# Troubleshooting

## Docker daemon is not running

Symptom:

- `Cannot connect to the Docker daemon ... docker.sock`

Fix:

1. Start Docker Desktop.
2. Re-run:

```bash
docker info
OPENQUERY_PG_PORT=55432 pnpm smoke:docker
```

## Postgres fixture port conflict

Symptom:

- `address already in use` on `5432`

Check who owns the port:

```bash
lsof -nP -iTCP:5432 -sTCP:LISTEN
lsof -nP -iTCP:5433 -sTCP:LISTEN
```

Use a free host port:

```bash
OPENQUERY_PG_PORT=55432 pnpm smoke:docker
OPENQUERY_PG_PORT=55432 OPENQUERY_PG_HOST=127.0.0.1 pnpm --filter @openquery/core test:integration
```

## Seed data not updating

Symptom:

- fixture starts but expected seed changes are missing

Cause:

- `seed.sql` in `/docker-entrypoint-initdb.d` runs only when volume is initialized

Fix:

```bash
docker compose -f infra/docker/docker-compose.yml down -v
OPENQUERY_PG_PORT=55432 pnpm smoke:docker
```

## macOS `EPERM` / `uv_cwd` when repo is in `~/Documents`

Fix options:

1. Move repo to `~/dev/OpenQuery` (recommended), or
2. Grant Full Disk Access to your terminal app and relaunch terminal

## macOS `rsync --info=progress2` flag error

Cause:

- Apple `rsync` does not support GNU-only `--info=progress2`

Use:

```bash
rsync -aP /path/from/OpenQuery/ ~/dev/OpenQuery/
```

Fallback:

```bash
cp -R /path/from/OpenQuery ~/dev/OpenQuery
```

## CLI helper argument forwarding confusion

Use deterministic direct CLI commands:

```bash
pnpm -C apps/cli build
node apps/cli/dist/main.js --help
node apps/cli/dist/main.js doctor
```

Root helper remains available:

```bash
pnpm openquery:build -- doctor
```

## `OPENAI_API_KEY` missing

Symptom:

- Ask flow fails with key-not-set error

Fix:

```bash
export OPENAI_API_KEY=sk-...
```

Desktop behavior:

- Workspace shows an explicit callout and does not crash.

## Desktop build failures

Prerequisites:

```bash
xcode-select --install
rustup update
```

Compile checks:

```bash
pnpm --filter @openquery/desktop build
pnpm --filter @openquery/desktop tauri build --no-bundle
```
