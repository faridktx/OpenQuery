# Troubleshooting

## Postgres connection fails

Symptoms:

- `Connection failed`
- `password authentication failed`
- `database does not exist`

Checks:

```bash
cd infra/docker
docker compose ps
```

Expected defaults from `infra/docker/docker-compose.yml`:

- host `127.0.0.1`
- port `5432`
- database `openquery_test`
- user `openquery`
- password `openquery_dev`

## Schema refresh says no active profile

Set an active profile first:

```bash
pnpm --filter @openquery/cli exec openquery profiles use demo
```

## Ask command timeouts

- Verify DB connectivity first with `profiles test`.
- Reduce query complexity or use `--dry-run`.
- Check safe timeout defaults in `SAFE_DEFAULTS` (15s statement timeout).

## OPENAI key errors

Symptoms:

- `OPENAI_API_KEY environment variable is not set`

Fix:

```bash
export OPENAI_API_KEY=sk-...
```

## macOS keychain issues (Desktop)

Symptoms:

- password not saved/retrieved from keychain

Checks:

- Ensure app has keychain access permission in macOS prompts.
- Try deleting and re-saving the profile password.
- Restart the desktop app after granting keychain permission.

## Desktop Tauri build errors

Install/update prerequisites:

```bash
xcode-select --install
rustup update
```

Then rebuild:

```bash
pnpm --filter @openquery/desktop build:bridge
pnpm --filter @openquery/desktop build:bundle
```

## Eval execution mode fails

If `OPENQUERY_EVAL_EXECUTE=1 pnpm eval` fails:

- Ensure Postgres is running (`docker compose up -d` under `infra/docker`)
- Ensure port/user/password match env defaults
- Rerun without execution mode to validate deterministic offline checks:

```bash
pnpm eval
```
