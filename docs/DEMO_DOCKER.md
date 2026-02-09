# OpenQuery Demo (Docker)

Goal:
- run Postgres fixture demo with one-command backend prep,
- complete desktop flow entirely in UI.

## 1. One-command fixture prep

```bash
pnpm smoke:docker
```

Expected:
- Docker fixture starts,
- readiness + seed verification pass,
- a free host port is auto-selected when `5432` is busy,
- `.openquery/fixture.env` is written for integration tests.

## 2. Launch desktop

```bash
pnpm --filter @openquery/desktop dev:tauri
```

## 3. Complete setup in UI

1. Open `Setup`.
2. Step 1: select `Demo (Docker Postgres)`.
3. Step 2: click `Start Docker demo`.
4. Confirm status shows running + selected port.
5. Step 3: click `Refresh schema`.
6. Step 4: run first query.

Expected:
- profile `demo-postgres` is active,
- connection test passes,
- schema + query success.

## 4. Validate guardrails and history

1. In Workspace run one safe query.
2. Run one blocked query (`SELECT *` or risky SQL).
3. Confirm blocked reason/fix guidance appears.
4. Open History and export Markdown.

## 5. Stop/reset fixture from UI

In Setup Step 2:
- `Stop` stops fixture.
- `Reset` recreates fixture and reseeds data.

Expected:
- no terminal required after initial smoke command.

## 6. Postgres integration test (one true command)

```bash
pnpm smoke:integration
```

Expected:
- runs fixture smoke + core integration tests using `.openquery/fixture.env`,
- passes without manual port management.
