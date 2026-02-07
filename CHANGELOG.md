# Changelog

## Unreleased

### Phase 0

- Audited workspace/package map, architecture paths, and CI workflows.
- Captured environment baseline (`node`, `pnpm`, Docker daemon state).
- Produced a risk register to drive stabilization work.

### Phase 1

- Added canonical macOS setup guide at `docs/dev-setup.md`.
- Added canonical smoke checklist at `docs/smoke.md`.
- Updated `README.md` to align with deterministic commands and docs links.

### Phase 2

- Hardened `scripts/smoke-docker.sh` with explicit seed checks:
  - verifies `public.users` table exists
  - verifies seeded row count is numeric and greater than zero
- Added fixture env output to smoke script for follow-up integration commands.
- Rewrote `docs/docker-setup.md` with daemon-first flow, port override, and safe volume reset.

### Phase 3

- Confirmed integration test gating and env-driven host/port/db/user/password behavior in `packages/core/src/db/__tests__/postgres.integration.test.ts`.
- Confirmed CI integration workflow uses the same env surface in `.github/workflows/integration-postgres.yml`.

### Phase 4

- Fixed root helper forwarding bug in `package.json` by removing hardcoded extra `--` from:
  - `openquery:build`
  - `oq:build`
- Verified helper usage:
  - `pnpm openquery:build -- --help`
  - `pnpm openquery:build -- doctor`

### Phase 5

- Added missing desktop backend commands in `apps/desktop/src-tauri/src/main.rs`:
  - `workspace_sql`
  - `settings_status`
  - `profile_update_power`
  - `profile_get_power`
  - `write_preview`
  - `write_execute`
- Extended desktop bridge `apps/desktop/bridge/handlers.ts`:
  - added workspace SQL execution/explain/dry-run handler
  - added settings status handler
  - preserved POWER preview/execute flow
- Updated desktop frontend:
  - new app shell/top bar/navigation in `apps/desktop/src/App.tsx`
  - new workspace surface in `apps/desktop/src/pages/WorkspacePage.tsx`
  - new settings screen in `apps/desktop/src/pages/SettingsPage.tsx`
  - upgraded profiles/history UX in:
    - `apps/desktop/src/pages/ProfilesPage.tsx`
    - `apps/desktop/src/pages/HistoryPage.tsx`
  - cohesive light-mode design system in `apps/desktop/src/styles.css`

### Phase 6

- Updated documentation consistency set:
  - `docs/troubleshooting.md`
  - `docs/release.md`
  - `docs/release-checklist.md`
  - `docs/demo-script.md`
- Added canonical recruiter script: `docs/recruiter-demo.md`.
- Completed full non-Docker verification chain:
  - `pnpm lint`
  - `pnpm typecheck`
  - `pnpm -r build`
  - `pnpm -r test`
  - `pnpm eval`

### Phase 7

- Finalized recruiter story and fallback flow in `docs/recruiter-demo.md` including:
  - port conflict override
  - Docker startup fallback
  - no-OpenAI-key offline demo path

### Final Verification Pass

- Verified full acceptance matrix with Docker daemon running:
  - workspace install/build/test/lint/typecheck
  - docker fixture smoke and core integration tests on `OPENQUERY_PG_PORT=55432`
  - deterministic CLI dist execution
  - desktop `tauri build --no-bundle`
- Removed obsolete compose `version` field from `infra/docker/docker-compose.yml` to eliminate warnings.
- Added Node 20 fallback verification path (`npx -y node@20`) in `docs/dev-setup.md`.
