# Release Checklist

## Build and test

- [ ] `pnpm -r build`
- [ ] `pnpm -r test`
- [ ] `pnpm eval`

## Desktop bundle

- [ ] `pnpm --filter @openquery/desktop build:bundle`
- [ ] Verify app artifact exists under `apps/desktop/src-tauri/target/release/bundle/macos/`

## CLI smoke tests

- [ ] `pnpm --filter @openquery/cli build`
- [ ] `pnpm --filter @openquery/cli exec openquery doctor`
- [ ] `pnpm --filter @openquery/cli exec openquery profiles list`

## Desktop smoke tests

- [ ] Launch `pnpm --filter @openquery/desktop tauri dev`
- [ ] Add/test profile in UI
- [ ] Refresh schema
- [ ] Run ask dry-run and full run
- [ ] Export history markdown

## Power mode verification

- [ ] Enable POWER mode on a profile
- [ ] Verify write preview is shown
- [ ] Verify typed confirmation is required
- [ ] Verify write execution audit event is logged
- [ ] Verify dangerous operation requires stronger confirmation phrase

## Documentation

- [ ] `README.md` quickstarts are up to date
- [ ] `docs/release.md` matches current build commands
- [ ] `docs/eval.md` and `docs/benchmarks.md` reflect current harness
