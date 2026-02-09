# Troubleshooting

Canonical troubleshooting doc for packaging. Source-aligned with `docs/troubleshooting.md`.

## Common fixes

1. Docker unavailable
- use No-Docker setup path in desktop.
- or start Docker Desktop and rerun `pnpm smoke:docker`.

2. Port conflict on Postgres fixture
- run `pnpm smoke:docker`.
- the script auto-selects a free port and writes `.openquery/fixture.env`.

3. Missing OpenAI key
- set key in desktop Settings.
- SQL mode remains usable without AI key.

4. Desktop build issues
- ensure Xcode CLI tools + Rust toolchain are installed.
- run `pnpm --filter @openquery/desktop tauri build --no-bundle`.

5. Schema missing/stale
- refresh schema from Setup or top bar before Ask.

6. Integration tests connect to wrong Postgres
- run `pnpm smoke:docker` first, then `pnpm --filter @openquery/core test:integration`.
- or run the combined command: `pnpm smoke:integration`.
- integration tests auto-load `.openquery/fixture.env` and only fill missing env vars (CI-provided vars still win).
