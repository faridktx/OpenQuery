# Threat Model

Canonical threat-model doc for packaging. Source-aligned with `docs/threat-model.md`.

## Trust boundaries

1. User input (NL/SQL) to OpenQuery
2. OpenQuery to target database
3. OpenQuery to LLM provider (Ask only)

## Primary risks

- accidental writes/destructive statements
- privilege misuse
- over-broad result retrieval
- credential leakage

## Implemented mitigations

- safe-mode default with read constraints
- AST-based statement classification and policy blocks
- EXPLAIN gating thresholds
- POWER enablement + typed confirmations
- keychain-backed secret storage
- local audit events for critical actions

## Planned hardening

- richer UI-level audit inspection/export
- expanded per-table policy administration in desktop
