# Eval Harness

OpenQuery includes a deterministic evaluation harness under `packages/eval`.

## Goals

- Validate SQL safety policy behavior on fixed fixtures
- Validate statement classification and table targeting
- Validate EXPLAIN gating outcomes
- Optionally execute allowed read queries against the fixture database
- Support opt-in online generation scoring using OpenAI

## Fixture Inputs

- Suite cases: `packages/eval/fixtures/suite.json`
- Offline generated plans: `packages/eval/fixtures/offline-plans.json`
- Fixture schema snapshot: `packages/eval/fixtures/schema.snapshot.json`
- Shared seed SQL: `infra/docker/seed.sql`

Each suite case defines:

- `question`
- `dialect`
- `expectedTables` (set)
- `expectedStatementType` (`read`, `write`, `dangerous`)
- `requiredConstraints` (`mustIncludeLimit`, `mustNotSelectStar`, `forbiddenTables`)
- optional `goldenSql` for shape matching

## Run Modes

### Offline (default)

Uses canned plans from `offline-plans.json` and deterministic EXPLAIN fixtures.

```bash
pnpm eval
```

### Online (opt-in)

Calls OpenAI to generate plans and scores those plans against the same suite.

```bash
OPENQUERY_EVAL_ONLINE=1 OPENAI_API_KEY=sk-... pnpm eval
```

### Optional execution checks

To also run allowed read queries against the local fixture Postgres:

```bash
OPENQUERY_EVAL_EXECUTE=1 pnpm eval
```

Default DB env values used for execution mode:

- `OPENQUERY_PG_HOST=127.0.0.1`
- `OPENQUERY_PG_PORT=5432`
- `OPENQUERY_PG_DATABASE=openquery_test`
- `OPENQUERY_PG_USER=openquery`
- `OPENQUERY_PG_PASSWORD=openquery_dev`

## Output Summary

The runner prints:

- pass rate
- parse fail rate
- blocked by policy rate
- exec success rate
- top failure reasons

A non-zero exit code is returned if any suite case fails expectations.
