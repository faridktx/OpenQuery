# OpenQuery Threat Model

## Overview

OpenQuery executes SQL against user databases. The primary risk is unintended data modification or destruction. This document defines the security model, threat surfaces, and mitigation strategies.

## Trust Boundaries

1. **User ↔ OpenQuery** — User provides natural language or raw SQL. OpenQuery must validate before execution.
2. **OpenQuery ↔ Database** — All queries go through the policy engine. Connections use the minimum required privileges.
3. **OpenQuery ↔ LLM** — LLM-generated SQL is untrusted input. It passes through the same policy engine as user-written SQL.

## Threat Categories

### T1: Accidental Data Modification
**Risk:** User or LLM generates a write query in what should be a read-only session.
**Mitigation:** Default mode is `safe` (read-only). Policy engine uses AST parsing to classify every statement. SELECT-only in safe mode.

### T2: Destructive Operations
**Risk:** DROP TABLE, TRUNCATE, DELETE without WHERE, or mass UPDATE.
**Mitigation:** Destructive ops require `power` mode + explicit opt-in + typed confirmation phrase + dry-run preview.

### T3: SQL Injection via LLM
**Risk:** LLM generates SQL that bypasses safety by embedding multiple statements or exploiting parser gaps.
**Mitigation:** AST parsing (never regex). Single-statement enforcement. Parameterized queries where possible.

### T4: Credential Exposure
**Risk:** Database credentials stored insecurely or leaked in logs.
**Mitigation:**
- **CLI:** Passwords provided via `OPENQUERY_PASSWORD` environment variable or interactive prompt. Never stored.
- **Desktop:** Passwords stored in the OS-native keychain (macOS Keychain, Windows Credential Manager, Linux Secret Service) via the `keyring` Rust crate. Users opt in with "Remember password" checkbox per profile. Passwords not stored in SQLite or any plaintext file.
- Passwords are never logged or included in audit events.
- The `SecretStore` interface in core abstracts credential access: `NoopSecretStore` for CLI, keychain-backed implementation for desktop.
- Removing a profile also deletes its keychain entry.

### T5: Excessive Data Access
**Risk:** Queries returning massive result sets, causing resource exhaustion.
**Mitigation:** SessionLimits enforce max rows and query timeout. EXPLAIN analysis before execution for large queries.

---

## Write Mode (POWER Mode) — Implemented in Phase 5

Write mode (`power` mode) is the mechanism by which OpenQuery allows data modification. It is **never the default** and requires multiple layers of explicit user consent.

### Activation Requirements

1. **Per-profile opt-in:** Write permissions are stored as columns on the `profiles` table (`allow_write`, `allow_dangerous`). Each profile independently controls its write policy. There is no global toggle.

2. **Default `allow_write=0`:** The user must explicitly enable via `openquery power enable --profile <name>` (CLI) or the Power Settings toggle (desktop).

3. **Two-level gating for dangerous ops:** `allow_dangerous` is a separate toggle that also requires `allow_write`. DROP, TRUNCATE, GRANT, and REVOKE are blocked unless both flags are set.

### Execution Safeguards (Implemented)

4. **AST-based classification:** Every statement is classified via `classifyStatement()` into `read`, `write`, or `dangerous` using `node-sql-parser` AST analysis. GRANT/REVOKE detected via text fallback.

5. **EXPLAIN-based preview:** For DML writes (INSERT/UPDATE/DELETE), OpenQuery runs `EXPLAIN (FORMAT JSON)` inside a `BEGIN ... ROLLBACK` transaction to estimate rows affected without side effects.

6. **Typed phrase confirmation:** Three distinct phrases:
   - Standard writes: `I UNDERSTAND THIS MAY MODIFY DATA` (customizable per profile)
   - No WHERE clause: `I CONFIRM THIS AFFECTS ALL ROWS`
   - Dangerous ops: `I ACCEPT THE RISK OF DATA LOSS`
   - Exact match required (case-sensitive, trimmed)

7. **No-WHERE detection:** UPDATE and DELETE without a WHERE clause trigger an additional warning and require the no-WHERE confirmation phrase instead of the standard phrase.

8. **Transaction wrapping:** All writes execute within `BEGIN ... COMMIT` with `ROLLBACK` on error. Statement timeout enforced.

9. **Single statement enforcement:** Multi-statement writes are always blocked regardless of power mode settings.

### Audit and Logging (Implemented)

10. **Audit event types:** `power_enabled`, `power_disabled`, `write_previewed`, `write_blocked`, `write_confirmed`, `write_executed`, `write_failed`

11. **Privacy-preserving audit:** Audit events store a SHA-256 hash of the SQL (first 16 hex chars), not the full SQL text. Full SQL is stored separately in query history (generations table).

12. **Audit payload includes:** profile_id, statement classification, impacted tables, rows affected, execution time, error messages.

13. **Append-only:** The audit log cannot be modified or deleted through OpenQuery. Users can delete the SQLite file manually.

14. **Write allow/block lists:** `PolicyConfig` supports `writeAllowList` and `writeBlockList` for granular table-level control (available for future use).

### Non-Goals for Write Mode

- Write mode does not support autonomous/batch operations. Every write requires interactive user presence.
- Write mode does not support multi-statement transactions. Each statement is evaluated and executed independently.
- Write mode does not bypass the policy engine. Even with `allowWrite=true`, every statement is AST-analyzed.
- DDL statements cannot be meaningfully previewed via EXPLAIN. Only textual summary is provided.
