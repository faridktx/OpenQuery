# OpenQuery Architecture

## Overview

OpenQuery is a local-first SQL Copilot. It translates natural language into SQL, enforces safety policies via AST analysis, and runs queries against user databases — all with a local-first, privacy-respecting design.

**Surfaces:** CLI (`openquery`) and Desktop (Tauri app).
**Core logic:** Shared TypeScript package (`@openquery/core`).
**Local state:** SQLite via better-sqlite3 (profiles, audit log, query history).

## Monorepo Layout

```
openquery/
├── packages/core/      # Shared core: DB adapters, policy engine, LLM, storage
├── apps/cli/           # CLI app (commander-based)
├── apps/desktop/       # Tauri desktop app
├── infra/docker/       # Test database containers
└── docs/               # Architecture, threat model, ADRs
```

## Key Design Decisions

1. **AST-based SQL policy** — Every SQL statement is parsed into an AST before evaluation. Regex-only classification is forbidden.
2. **Default read-only** — The default mode (`safe`) only allows SELECT and read-only operations.
3. **Local-first** — All state (profiles, history, audit logs) stored in local SQLite. No cloud dependency.
4. **Explicit write gating** — Write mode (`power`) requires explicit opt-in, confirmations, and audit logging.
5. **LLM data boundary: never send rows** — Only schema metadata and the user's question are sent to the LLM. Result rows, actual data values, and credentials are never included in LLM prompts.

---

## Phase Plan

### Phase 0 — Scaffolding
Set up the monorepo structure, pnpm workspaces, TypeScript tooling, and package skeletons. Implement the CLI spine (`--help`, `version`, `doctor`), core type definitions, policy framework interfaces, and local SQLite storage wrapper.

### Phase 1 — Read-Only Core
Implement the Postgres adapter (`DbAdapter`), AST-based SQL parser and policy engine (using `node-sql-parser`), and the `ask`/`run` flow for read-only queries. Policy engine enforces safe mode by default.

### Phase 2 — CLI Polish & Profiles
AST-based policy engine with proper LIMIT rewrite, Postgres EXPLAIN checks, CLI ask/run routing through policy. Connection profile management. Audit logging.

### Phase 3 — LLM Integration
OpenAI LLM integration for SQL generation with structured JSON outputs validated via AJV. Schema retrieval heuristic selects relevant tables/columns for the LLM prompt (no embeddings). Full `ask` flow: user provides a question, LLM generates SQL, policy engine validates and rewrites, EXPLAIN gating in safe mode, optional execution.

**Key components:**
- `packages/core/src/llm/` — LLM module (OpenAI provider, prompt construction, schema context builder, JSON schema validation)
- `packages/core/src/ask.ts` — High-level orchestration combining LLM + policy + execution
- `packages/core/src/storage/repo.ts` — Query history repository (questions, generations, runs)
- Schema snapshots stored in SQLite, refreshed via `openquery schema refresh`

**Data boundary:** The LLM receives only: database dialect, schema subset (table/column names, types, PKs), the user's question, and policy constraints. It never receives: actual data rows, connection credentials, or query results.

**History:** Stores question, generated SQL, rewritten SQL, EXPLAIN summary, execution metrics, and status. Does NOT store result rows.

**Exports:** Markdown reports from history (no rows). CSV export from in-memory session results only.

### Phase 4 — Desktop App (Tauri) (current)
Tauri v2 desktop MVP that reuses the core engine. No business logic duplication.

**Architecture:**
- **Frontend:** React + Vite (runs in Tauri webview)
- **Bridge:** Node.js process (`apps/desktop/bridge/`) communicating via stdin/stdout JSON-RPC. Calls `@openquery/core` functions directly.
- **Tauri Rust backend:** Manages bridge lifecycle, exposes Tauri commands, handles OS keychain via `keyring` crate.
- **Secret storage:** `SecretStore` interface in core. Desktop uses OS keychain (macOS Keychain / Windows Credential Manager / Linux Secret Service). CLI uses `NoopSecretStore` (env/prompt).

**Pages:** Profiles, Schema Browser, Ask Workspace, History.

**Key files:**
- `apps/desktop/bridge/main.ts` — Bridge process entry point
- `apps/desktop/bridge/handlers.ts` — Core function dispatch
- `apps/desktop/src-tauri/src/main.rs` — Tauri commands
- `apps/desktop/src-tauri/src/bridge.rs` — Bridge process management
- `apps/desktop/src-tauri/src/keychain.rs` — OS keychain operations
- `apps/desktop/src/` — React frontend
- `packages/core/src/secrets/` — SecretStore interface

### Phase 5 — Write Mode (Power Mode)
Gated write mode with confirmations, dry-run preview, row-count estimation, and full audit logging.

### Phase 6 — MySQL & Extensions
MySQL adapter, plugin system, collaboration features.
