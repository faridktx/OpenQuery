# OpenQuery

OpenQuery is a local-first SQL copilot for Postgres with strict guardrails.
It turns natural language into SQL, validates and rewrites queries via AST-based policy checks, gates execution with EXPLAIN, and supports controlled write operations through POWER mode confirmations.

## Why OpenQuery Is Different

- AST guardrails, not regex-only checks
- EXPLAIN gating before execution in safe mode
- POWER mode write flow with typed confirmations and audit events
- Local-first architecture with local profile/history storage
- Deterministic eval harness for safety + correctness regression checks

## Feature List

- Natural-language `ask` flow with SQL generation
- Safe-mode policy engine with LIMIT injection/clamping
- Statement classification (`read` / `write` / `dangerous`)
- Write preview + confirmation phrases + execution audit trail
- Schema introspection and local schema snapshots
- Query history with Markdown export
- Desktop app (Tauri + React + bridge)
- CLI workflow for scripting and demos

## Quickstart (CLI)

Prerequisites:

- Node.js 18+
- pnpm 8+
- Docker (for local Postgres fixture)
- `OPENAI_API_KEY` for LLM generation commands

```bash
pnpm install
pnpm -r build

# Start fixture Postgres
cd infra/docker
docker compose up -d
cd ../..

# Build CLI
pnpm --filter @openquery/cli build

# Create profile
pnpm --filter @openquery/cli exec openquery profiles add \
  --name local \
  --type postgres \
  --host 127.0.0.1 \
  --port 5432 \
  --database openquery_test \
  --user openquery

# Refresh schema snapshot
pnpm --filter @openquery/cli exec openquery schema refresh --name local

# Dry-run ask
OPENAI_API_KEY=sk-... pnpm --filter @openquery/cli exec openquery ask "show active users" --dry-run
```

## Quickstart (Desktop)

```bash
pnpm install
pnpm --filter @openquery/core build
pnpm --filter @openquery/desktop build:bridge
cd apps/desktop
pnpm tauri dev
```

For release bundle instructions see `docs/release.md`.

## Security Model Overview

- Policy engine parses SQL into AST and enforces statement-level rules.
- Safe mode blocks writes and dangerous statements by default.
- EXPLAIN gating can block high-cost/high-row-risk reads before execution.
- POWER mode requires explicit profile opt-in and typed confirmation phrases.
- Audit events are written locally for profile changes, previews, blocked writes, and executions.

Data boundary:

- OpenAI calls receive question + selected schema context.
- Database credentials and query result rows stay local.
- Full details: `docs/security.md`.

## Threat Model Summary

Threat scenarios, trust boundaries, and mitigations are documented in `docs/threat-model.md`.

## Evaluation and Benchmarks

- Eval harness: `pnpm eval` (offline deterministic by default)
- Benchmarks: `pnpm bench`

See `docs/eval.md` and `docs/benchmarks.md`.

## Planned

- MySQL adapter support is intentionally deferred to Phase 7.
- Phase 6 ships with a friendly MySQL adapter stub and explicit "planned" messaging.
