# Security and Data Boundary

Canonical security doc for packaging. Source-aligned with `docs/security.md`.

## Core principle

OpenQuery is local-first. Credentials and query execution stay on the local machine.

## Data sent to OpenAI (Ask path)

- natural language question
- schema metadata context
- safety/mode context

## Data not sent to OpenAI

- database passwords
- result rows
- local SQLite store files
- keychain secrets

## Guardrails before execution

1. AST parse + policy validation
2. LIMIT injection/clamping
3. statement classification
4. EXPLAIN gating in safe mode
5. POWER write confirmation flow

## Secret handling

- Desktop secrets use OS keychain.
- CLI passwords are prompted or piped (`--password-stdin`).
- OpenAI key can come from desktop keychain or `OPENAI_API_KEY` env fallback.

## Audit trail

Local audit events include profile, schema, power, and write-operation lifecycle events.

See also:
- `docs/THREAT_MODEL.md`
- `docs/TROUBLESHOOTING.md`
