# OpenQuery Product Specification

Version: 2026-02-09
Scope: Desktop (`apps/desktop`), CLI (`apps/cli`), Core (`packages/core`)
Status convention:
- `Implemented`: present in current repository and wired for use.
- `Planned`: not fully implemented, or implemented only partially.

## 1. Product Summary

OpenQuery is a local-first SQL copilot for teams and individuals. It must:
1. turn natural language into SQL,
2. enforce safety guardrails before execution,
3. execute queries against user databases,
4. keep auditable/exportable local artifacts,
5. be usable from desktop UI without terminal dependency.

Primary principle:
- Desktop is first-class and end-to-end usable without terminal.
- CLI is scriptable and deterministic for CI/automation.

Current packaging target:
- Tauri desktop app + Node CLI + shared core package.
- Postgres production path, SQLite no-docker demo path, Docker fixture demo path.

## 2. Product Surfaces

### 2.1 Desktop

Status: `Implemented` with some `Planned` gaps.

Implemented navigation:
- Setup (`QuickstartPage`)
- Workspace (`WorkspacePage`)
- Profiles (`ProfilesPage`)
- History (`HistoryPage`)
- Settings (`SettingsPage`)

Planned navigation:
- Dedicated `Audit` page (audit events currently recorded in local store but not exposed in a dedicated desktop page).

Implemented top bar:
- Active profile selector.
- Connection test action.
- Session password input.
- Status pills: connection, schema status, AI key status.
- Primary actions: refresh schema, new query, help panel toggle.

Implemented setup flow (4-step wizard):
1. Experience mode select: No-Docker demo / Docker demo / Custom Postgres.
2. Connection details + test path.
3. Schema refresh.
4. First query (Ask or SQL sample fallback).

Implemented workspace behavior:
- Ask tab (AI generation + dry run/run).
- SQL tab (run/explain/dry-run + write preview trigger).
- Safe/standard mode selector in advanced controls.
- Policy, SQL, Summary, Results inspector sections.
- Explain warnings/blockers surfaced.
- CSV export and copy actions.
- Power write modal with typed confirmations.

Implemented history behavior:
- List + search/filter by text/profile/type/date-window.
- Detail tabs: overview/sql/policy/results.
- Markdown export.

Planned history behavior:
- Durable result-row history replay (current storage intentionally does not persist result rows).
- Explain tab as separate first-class tab (currently explain details are embedded with policy/details).

Implemented profiles behavior:
- Add, remove, set active, test, refresh schema.
- Power toggles (`allowWrite`, `allowDangerous`).
- Keychain password lookup + delete on profile removal.

Planned profiles behavior:
- Full edit modal in desktop UI (CLI supports edit; desktop currently focuses add/remove/use/test/refresh).

Implemented settings behavior:
- OpenAI key set/test/clear via keychain-backed UI.
- Safe policy defaults controls (rows/cost/limit enforcement).
- About/version and docs pointers.

Planned settings behavior:
- Full local-data path visibility section in UI.
- Advanced timeout/max-rows clamp controls in UI (core supports defaults and CLI flags).

Implemented help/walkthrough:
- Global help panel with first-query guidance and status meanings.
- Workspace help modal with safe/power and explain concepts.

### 2.2 CLI

Status: `Implemented` with contract deltas marked `Planned`.

Implemented command groups:
- `doctor`
- `profiles add|edit|list|use|remove|test`
- `schema refresh|status`
- `ask <question>`
- `run --sql ...` (or stdin)
- `history list|show`
- `export` (top-level command)
- `power enable|disable|status`

Implemented aliases:
- npm bin aliases: `openquery` and `oq`.

Planned command-surface alignment:
- `history export <id> --format md|json` as a history subcommand (current export command is top-level).
- Uniform `--profile` flag alias across ask/run/schema/history (current primary flag name is `--name`).

Implemented exit codes:
- `0` success
- `1` usage/validation
- `2` runtime
- `3` policy blocked

Implemented output formats:
- Human text (default)
- JSON (`--json`)
- Table/CSV for `run` output modes

Planned JSON contract normalization:
- A single stable envelope with `ok`, `command`, `result`, `error` for all commands. Current JSON envelopes vary by path.

### 2.3 Core

Status: `Implemented` with explicit `Planned` DB adapter gaps.

Implemented:
- LLM SQL planning (`askAndMaybeRun`, OpenAI provider).
- AST-based policy parsing/validation/rewrite (`node-sql-parser`).
- LIMIT injection/clamp for reads.
- SELECT-star disallow in safe mode.
- EXPLAIN gating and threshold checks.
- Statement classification (`read|write|dangerous`).
- POWER preview + typed confirmation helpers.
- Postgres adapter for read, write, explain, introspection.
- SQLite adapter for no-docker demo read/write/explain/introspection.
- Local storage for profiles/settings/audit/schema/history.

Planned:
- MySQL execution/introspection support (currently explicit stub with friendly message).

## 3. UX Flows

### 3.1 First-run setup

Entry conditions:
- No profile OR no active profile OR missing/stale schema.

Flow:
1. User selects mode in Setup Step 1.
2. Step 2 provisions profile:
- No-Docker: creates local SQLite demo DB and `demo-sqlite` profile.
- Docker: checks daemon, picks free port, starts fixture, creates `demo-postgres` profile.
- Custom: saves Postgres profile with optional keychain password.
3. Step 3 refreshes schema snapshot.
4. Step 4 runs first query (Ask if AI key exists, SQL sample fallback otherwise).
5. Success state offers navigation to Workspace/History/Settings.

### 3.2 Safe query flow

1. User enters question or SQL.
2. Core validates with AST policy rules.
3. Safe mode runs EXPLAIN gating.
4. If allowed, query executes and results render.
5. History and audit records are saved locally.

Blocked behavior:
- User sees reason + fix guidance in inspector.
- No execution occurs for blocked statements.

### 3.3 POWER write flow

1. User enables power per profile.
2. User requests write preview.
3. System shows impacted tables, warnings, confirmation phrase requirements.
4. User must type exact phrase(s).
5. Write executes with audit events for confirm/execution/failure.

## 4. Safety Model

### 4.1 Policy defaults

Default mode: `safe`
- Read-only by default.
- SELECT-star disallowed.
- LIMIT enforced.
- EXPLAIN required.
- Statement timeout + max rows applied.

Standard mode behavior:
- Relaxed read constraints.
- Writes still require profile power settings and confirmation flow.

### 4.2 Statement controls

Blocked by default:
- Dangerous ops (`DROP`, `TRUNCATE`, privilege operations).
- Writes when power is disabled.
- Multi-statement SQL.
- Blocked-table access when configured.

Write guardrails:
- Preview required.
- Confirmation phrase required.
- Stronger phrase for dangerous operations.
- Additional warning/phrase for UPDATE/DELETE without WHERE.

### 4.3 Explain gating

Safe mode evaluates:
- estimated rows,
- estimated cost,
- sequential scan warning.

Behavior:
- Threshold breach blocks execution.
- Warnings shown to user.

### 4.4 Auditability

Stored locally in `audit_events`:
- profile create/remove/use,
- schema refresh,
- power enable/disable,
- write preview/block/confirm/execute/fail,
- query run metadata.

Planned:
- Dedicated desktop audit viewer + JSON/Markdown audit export UI.

## 5. CLI Command Surface (Current vs Planned)

Implemented:
- `openquery doctor`
- `openquery profiles list|add|edit|remove|use|test`
- `openquery schema refresh|status`
- `openquery ask <question>`
- `openquery run --sql <sql>`
- `openquery history list|show <id>`
- `openquery export --id <id> --md <file>`
- `openquery export --last --csv <file>`
- `openquery power enable|disable|status`

Planned alignment:
- `openquery history export <id> --format md|json`
- `openquery ask/run` unified with `--profile` naming and strict enterprise JSON envelope.

## 6. Configuration Model

### 6.1 Local persistent store

SQLite db path:
- `~/.openquery/openquery.db`

Tables include:
- `profiles`
- `settings`
- `audit_events`
- `schema_snapshots`
- `queries`
- `generations`
- `runs`

### 6.2 Secret storage

Desktop:
- OS keychain via Rust keyring integration.
- DB password + OpenAI key can be stored securely.

CLI:
- Password via prompt or `--password-stdin`.
- OpenAI key via environment.

### 6.3 Runtime policy config

Desktop currently exposes:
- max estimated rows threshold
- max estimated cost threshold
- limit enforcement toggle

CLI currently exposes:
- mode
- limit
- max-rows
- timeout-ms

## 7. Data Boundary and Security

Outbound to OpenAI (Ask path only):
- question
- schema metadata
- safety context

Not sent to OpenAI:
- DB credentials
- result rows
- local SQLite db files
- keychain secrets

Security constraints:
- no plaintext secret rendering in UI/CLI output,
- no secret storage in history/audit rows,
- safe defaults + explicit escalation for writes.

Reference docs:
- `docs/SECURITY.md`
- `docs/THREAT_MODEL.md`

## 8. Packaging Checklist

### 8.1 Required docs

Required for packaging:
- `docs/PRODUCT_SPEC.md`
- `docs/RELEASE_GATE.md`
- `docs/DEMO_NODOCKER.md`
- `docs/DEMO_DOCKER.md`
- `docs/CLI_CONTRACT.md`
- `docs/SECURITY.md`
- `docs/THREAT_MODEL.md`
- `docs/TROUBLESHOOTING.md`
- `docs/ARCHITECTURE.md`

### 8.2 Build/test gates

Automated:
- lint + typecheck
- workspace build + tests
- eval
- desktop tauri compile
- CLI build + smoke
- optional docker + integration tests

Manual desktop smoke:
- complete setup with no-docker mode,
- set OpenAI key in Settings,
- run one allowed query,
- run one blocked query with fix guidance,
- verify history entry + markdown export.

## 9. Implemented vs Planned Gap Summary

Implemented:
- Desktop setup/workspace/profiles/history/settings end-to-end.
- No-docker demo and Docker demo controls in UI.
- In-app OpenAI key entry and validation.
- Core policy + explain gating + power flow.
- CLI core command suite with safety exit codes.

Planned:
- Dedicated desktop Audit page/export UX.
- Desktop profile edit modal parity with CLI.
- MySQL adapter implementation.
- History-subcommand export shape + fully normalized CLI JSON envelope.
- Full durable result replay in history (currently intentionally not stored).
