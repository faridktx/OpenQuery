# POWER Mode — Controlled Write Operations

POWER mode enables write operations (INSERT, UPDATE, DELETE, DDL) on a per-profile basis with strict oversight. By default, OpenQuery operates in **read-only SAFE mode** where all write statements are blocked.

## Enabling POWER Mode

### CLI

```bash
# Enable write operations for the active profile
openquery power enable

# Enable for a specific profile
openquery power enable --profile mydb

# Also enable dangerous operations (DROP, TRUNCATE, GRANT/REVOKE)
openquery power enable --profile mydb --dangerous

# Check current status
openquery power status --profile mydb

# Disable (return to read-only)
openquery power disable --profile mydb
```

### Desktop

1. Go to **Profiles** page
2. Select the profile you want to modify
3. Toggle **Enable write operations (POWER mode)**
4. Optionally toggle **Allow dangerous operations** (only visible when writes are enabled)

## How Writes Work

When POWER mode is enabled and a write statement is detected:

1. **Classification** — The statement is classified as `write` (INSERT/UPDATE/DELETE/CREATE/ALTER) or `dangerous` (DROP/TRUNCATE/GRANT/REVOKE)
2. **Preview** — A preview is generated showing:
   - Statement classification and type
   - Impacted tables
   - Estimated rows affected (via EXPLAIN for DML)
   - Warnings (e.g., missing WHERE clause)
3. **Confirmation** — You must type an exact confirmation phrase:
   - Standard writes: `I UNDERSTAND THIS MAY MODIFY DATA`
   - No WHERE clause: `I CONFIRM THIS AFFECTS ALL ROWS`
   - Dangerous operations: `I ACCEPT THE RISK OF DATA LOSS`
4. **Execution** — The statement runs within a transaction (BEGIN, execute, COMMIT; ROLLBACK on error)
5. **Audit** — Every step is logged: preview, confirmation, execution result

## Supported Operations

### Allowed with `allowWrite=true`:
- INSERT INTO
- UPDATE (with confirmation; extra confirmation if no WHERE clause)
- DELETE (with confirmation; extra confirmation if no WHERE clause)
- CREATE TABLE
- ALTER TABLE (add column)
- CREATE INDEX

### Requires `allowDangerous=true` (plus `allowWrite=true`):
- DROP TABLE / DROP SCHEMA
- TRUNCATE
- GRANT / REVOKE

### Always blocked:
- Multiple statements in a single query
- Dangerous functions (pg_sleep, pg_terminate_backend, etc.)

## CLI Write Execution Example

```
$ openquery power enable --profile dev
POWER mode enabled for "dev". Write operations now allowed with confirmation.

$ openquery run --sql "UPDATE users SET active = false WHERE id = 99" --name dev

⚠ WRITE OPERATION DETECTED
Classification: write (UPDATE)
Impacted tables: users
WHERE clause: present
Estimated rows affected: 1

This operation will modify data. Type the following phrase exactly to confirm:

  I UNDERSTAND THIS MAY MODIFY DATA

> I UNDERSTAND THIS MAY MODIFY DATA
Confirm execution? [y/N]: y

1 row affected in 12ms
Audit event logged: write_executed
```

### Non-interactive (scripting)

```bash
openquery run \
  --sql "UPDATE users SET active = false WHERE id = 99" \
  --name dev \
  --confirm-phrase "I UNDERSTAND THIS MAY MODIFY DATA" \
  --i-understand
```

## Audit Trail

All write operations generate audit events queryable in the history UI:

| Event | When |
|-------|------|
| `power_enabled` | POWER mode turned on for a profile |
| `power_disabled` | POWER mode turned off |
| `write_previewed` | Write preview generated |
| `write_blocked` | Write blocked by policy |
| `write_confirmed` | User confirmed a write |
| `write_executed` | Write successfully executed |
| `write_failed` | Write execution failed |

Each audit event includes a SQL hash (not the full SQL) for privacy. Full SQL is stored in query history.

## Custom Confirmation Phrase

You can set a custom confirmation phrase per profile. This replaces the default `I UNDERSTAND THIS MAY MODIFY DATA` for standard write operations. Dangerous operations always require the fixed `I ACCEPT THE RISK OF DATA LOSS` phrase.
