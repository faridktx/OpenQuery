# OpenQuery Architecture

## System Overview
OpenQuery has three runtime surfaces on one shared core:

- `apps/desktop`: Tauri desktop app
- `apps/cli`: command-line interface
- `packages/core`: policy engine, adapters, ask/run orchestration, local storage

## High-Level Flow (Ask)
1. User selects active profile and refreshes schema snapshot.
2. User asks a question or pastes SQL.
3. Core classifies SQL and applies policy checks.
4. Safe mode runs EXPLAIN gating before execution.
5. Query executes if allowed; history and audit records are written locally.

## Data Boundaries
- OpenAI path receives: question, schema metadata, policy context.
- OpenAI path does not receive: credentials, result rows, local DB files.
- Profiles/history/schema snapshots are stored locally.

## Desktop Components
- React frontend in `apps/desktop/src`
- Tauri Rust commands in `apps/desktop/src-tauri/src/main.rs`
- Node bridge in `apps/desktop/bridge`
- Keychain integration in `apps/desktop/src-tauri/src/keychain.rs`

## Database Modes
- No-Docker demo: SQLite fixture
- Docker demo: seeded Postgres fixture (`infra/docker`)
- Custom profile: user Postgres connection

## Diagram
![Architecture](../assets/architecture/openquery-architecture.svg)
