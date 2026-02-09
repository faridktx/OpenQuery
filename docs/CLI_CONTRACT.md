# OpenQuery CLI Contract

Version: 2026-02-09
Applies to: `apps/cli/src/main.ts`

## 1. Command Surface

Implemented commands:
- `openquery doctor`
- `openquery profiles add|edit|list|use|remove|test`
- `openquery schema refresh|status`
- `openquery ask <question>`
- `openquery run [--sql <sql>]` (or SQL from stdin)
- `openquery history list|show <id>`
- `openquery export --id <id> --md <file>`
- `openquery export --last --csv <file>`
- `openquery power enable|disable|status`

Binary aliases:
- `openquery`
- `oq`

Planned alignment:
- `openquery history export <id> --format md|json` as history subcommand.

## 2. Global Flags

Supported on command leaves:
- `--json`
- `--quiet`
- `--verbose`
- `--debug`

## 3. Exit Codes

- `0`: success
- `1`: usage/validation error
- `2`: runtime failure (db/network/env)
- `3`: policy/safety blocked

## 4. Output Contract

### 4.1 Human output

Rules:
- concise text/tables by default,
- no stack traces unless `--debug`.

### 4.2 JSON output (current)

Success shape:
```json
{
  "ok": true,
  "data": {}
}
```

Error shape:
```json
{
  "ok": false,
  "code": "POLICY_BLOCKED",
  "message": "...",
  "details": {}
}
```

Notes:
- `details` appears mainly when `--debug` or specific policy/runtime errors include it.
- shape is stable enough for scripting but not yet normalized with explicit `command` metadata.

Planned v1 normalization:
```json
{
  "ok": true,
  "command": { "name": "run", "version": "..." },
  "result": {}
}
```
or
```json
{
  "ok": false,
  "command": { "name": "run", "version": "..." },
  "error": { "code": "...", "message": "...", "details": {} }
}
```

## 5. Query Formats

`run` supports:
- table (default human)
- JSON (`--json` or `--format json`)
- CSV (`--format csv`)

`export` supports:
- markdown report (`--id ... --md file.md`)
- csv from in-process last result (`--last --csv file.csv`)

## 6. Error Handling Contract

Guaranteed behaviors:
- unhandled failures map to exit code `2`,
- policy blocks map to exit code `3`,
- usage validation maps to exit code `1`,
- no secret values are printed by default.

Debug behavior:
- `--debug` includes stack/details for troubleshooting.
