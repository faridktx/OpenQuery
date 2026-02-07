# OpenQuery

OpenQuery is a local-first SQL copilot for PostgreSQL with policy guardrails.

## What Is OpenQuery

- Natural-language to SQL flow with explicit safety checks before execution
- Local-first state: profiles, schema snapshots, history, and audit log stay on-device
- Dual surface: CLI plus Tauri desktop app backed by the same core engine

## How It Is Different

- Guardrails: AST-based SQL classification and rewrite, not regex-only checks
- Explain gating: safe mode can block high-cost/high-row plans before execution
- POWER mode: write operations require preview + typed confirmation
- Eval harness: deterministic offline regression checks for policy and generation outputs

## Start Here

- Setup guide: `docs/dev-setup.md`
- Docker fixture guide: `docs/docker-setup.md`
- Smoke checklist: `docs/smoke.md`
- Recruiter quick demo: `docs/recruiter-demo.md`

## Canonical Health Checks

Run from repo root:

```bash
pnpm install
pnpm -r build
pnpm -r test
pnpm lint
pnpm typecheck
```

## CLI (Deterministic Local Run)

```bash
pnpm -C apps/cli build
node apps/cli/dist/main.js --help
node apps/cli/dist/main.js doctor
```

## Desktop Build Check (No Bundle)

```bash
pnpm --filter @openquery/desktop build
pnpm --filter @openquery/desktop tauri build --no-bundle
```

## OpenAI Key in Desktop

- Primary flow: open Desktop `Settings` -> `AI Provider` and save your OpenAI API key.
- Fallback for power users: set `OPENAI_API_KEY` before launching the app.
- Without a key, `Ask` is disabled and SQL mode remains available.

## Desktop Setup Modes

- `Demo (No Docker)` (default): in-app SQLite demo, zero terminal steps.
- `Demo (Docker Postgres)`: start/stop/reset fixture from Setup UI with auto port selection.
- `Connect my Postgres`: custom host/port/user/password profile flow.

## Node and pnpm Policy

- Target runtime for parity with CI: Node 20 LTS
- Local Node 24 may work, but it is not the compatibility target
- Recommended package manager: pnpm 9.x

## Security Model

- OpenAI prompt boundary includes only question + schema metadata + policy context
- Query results and credentials are not sent to the LLM
- Full details: `docs/security.md` and `docs/threat-model.md`

## Evaluation

- Eval harness: `pnpm eval`
- Benchmarks: `pnpm bench`
