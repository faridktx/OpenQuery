# Docker Fixture Setup

OpenQuery uses a Compose-managed PostgreSQL fixture. You do not manually create containers in Docker Desktop.

## 1) Start Docker Desktop

- Launch Docker Desktop.
- Wait for it to finish startup.

Verify daemon availability:

```bash
docker info
```

If this fails, fix Docker Desktop first before running repo scripts.

## 2) Run the fixture smoke command

Default port (`5432`):

```bash
pnpm smoke:docker
```

Port override (recommended when local Postgres already uses 5432):

```bash
OPENQUERY_PG_PORT=55432 pnpm smoke:docker
```

The smoke script performs:

- `docker info` daemon check
- `docker compose up -d`
- readiness wait via `pg_isready` (60s timeout)
- seed validation (`public.users` exists and has rows)
- prints exact env vars for integration test commands

## 3) Run core integration tests against the fixture

```bash
OPENQUERY_PG_PORT=55432 OPENQUERY_PG_HOST=127.0.0.1 pnpm --filter @openquery/core test:integration
```

Use the same port override you used for `pnpm smoke:docker`.

## 4) Reset the fixture volume (safe reset)

Use this when seed data changes or data is dirty:

```bash
docker compose -f infra/docker/docker-compose.yml down -v
OPENQUERY_PG_PORT=55432 pnpm smoke:docker
```

## 5) Port conflict troubleshooting

Check who owns a port:

```bash
lsof -nP -iTCP:5432 -sTCP:LISTEN
lsof -nP -iTCP:5433 -sTCP:LISTEN
```

Then rerun with a free port:

```bash
OPENQUERY_PG_PORT=55432 pnpm smoke:docker
```

## Fixture defaults

- DB: `openquery_test`
- User: `openquery`
- Password: `openquery_dev`
- Host: `127.0.0.1`
- Port: `${OPENQUERY_PG_PORT:-5432}`
