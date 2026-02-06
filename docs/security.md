# Security and Data Boundary

## Core principle

OpenQuery is local-first. Query execution and credentials remain local to the machine running OpenQuery.

## What is sent to OpenAI

When using `ask`:

- user question text
- selected schema context (table and column metadata)
- mode/policy context (safe vs standard)

This is used only to generate a SQL plan.

## What is not sent to OpenAI

- database passwords
- query result rows
- local SQLite state (`~/.openquery/openquery.db`)
- keychain secrets

## Guardrails before execution

1. SQL parse and policy validation (AST-based)
2. LIMIT enforcement and clamping
3. statement classification (`read`, `write`, `dangerous`)
4. EXPLAIN gating in safe mode
5. POWER mode confirmation workflow for writes

## Local secret handling

- CLI passwords are prompted at runtime and not stored in query history.
- Desktop can store passwords in OS keychain.
- Profile metadata is stored locally in SQLite.

## Auditability

Local audit events include:

- profile and power mode changes
- write previews and write execution outcomes
- blocked write attempts

## Threat model

See `docs/threat-model.md` for detailed trust boundaries, attack paths, and mitigation mapping.
