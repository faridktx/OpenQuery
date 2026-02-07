# Release Checklist

## Build and test

- [ ] `pnpm install`
- [ ] `pnpm -r build`
- [ ] `pnpm -r test`
- [ ] `pnpm lint`
- [ ] `pnpm typecheck`
- [ ] `pnpm eval`

## Docker + integration

- [ ] `docker info`
- [ ] `OPENQUERY_PG_PORT=55432 pnpm smoke:docker`
- [ ] `OPENQUERY_PG_PORT=55432 OPENQUERY_PG_HOST=127.0.0.1 pnpm --filter @openquery/core test:integration`

## CLI smoke tests

- [ ] `pnpm -C apps/cli build`
- [ ] `node apps/cli/dist/main.js --help`
- [ ] `node apps/cli/dist/main.js doctor`
- [ ] Optional helper check: `pnpm openquery:build -- doctor`

## Desktop compile checks

- [ ] `pnpm --filter @openquery/desktop build`
- [ ] `pnpm --filter @openquery/desktop tauri build --no-bundle`

## Desktop demo smoke

- [ ] Launch `pnpm --filter @openquery/desktop tauri dev`
- [ ] Profiles: create, test connection, set active, refresh schema
- [ ] Workspace: ask dry-run, SQL explain, query run, CSV export
- [ ] History: filter/search and reopen SQL in workspace
- [ ] Settings: OpenAI key guidance visible when key missing

## Power mode verification

- [ ] Enable POWER mode on a profile
- [ ] Verify write preview is shown
- [ ] Verify typed confirmation is required
- [ ] Verify write execution audit event is logged
- [ ] Verify dangerous operation requires stronger confirmation phrase

## Documentation

- [ ] `README.md` quickstarts are up to date
- [ ] `docs/dev-setup.md` and `docs/docker-setup.md` are up to date
- [ ] `docs/smoke.md` matches CI and scripts
- [ ] `docs/recruiter-demo.md` matches current UX flow
- [ ] `docs/release.md` matches current build commands
- [ ] `docs/eval.md` and `docs/benchmarks.md` reflect current harness
