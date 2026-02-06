# 2-Minute Demo Script

This script is optimized for recruiter demos on macOS.

## 0:00-0:20 Setup

```bash
pnpm install
pnpm -r build
cd infra/docker && docker compose up -d && cd ../..
```

What to show:

- Repo builds cleanly
- Local fixture database starts with one command

## 0:20-0:45 Profile + schema

```bash
pnpm --filter @openquery/cli exec openquery profiles add \
  --name demo \
  --type postgres \
  --host 127.0.0.1 \
  --port 5432 \
  --database openquery_test \
  --user openquery

pnpm --filter @openquery/cli exec openquery schema refresh --name demo
```

What to show:

- Local profile creation
- Schema snapshot loading

## 0:45-1:20 Safe query flow

```bash
OPENAI_API_KEY=sk-... pnpm --filter @openquery/cli exec openquery ask "show active users" --mode safe --dry-run --name demo
```

What to show:

- Generated SQL
- Policy result
- EXPLAIN summary
- Dry-run execution gating

## 1:20-1:45 POWER mode confirmations

```bash
pnpm --filter @openquery/cli exec openquery power enable --profile demo
pnpm --filter @openquery/cli exec openquery run --name demo --sql "UPDATE users SET is_active = false WHERE id = 2"
```

What to show:

- Write preview
- Required typed phrase
- Audit-backed execution path

## 1:45-2:00 Reliability proof

```bash
pnpm eval
pnpm bench
```

What to show:

- Deterministic eval summary (pass/blocked/parse metrics)
- Latency p50/p95 numbers
