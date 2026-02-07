# Contributing to OpenQuery

## Development Setup
1. Read `docs/dev-setup.md`.
2. Install dependencies:
   ```bash
   pnpm install
   ```

## Core Commands
Run from repo root:

```bash
pnpm -r build
pnpm -r test
pnpm lint
pnpm typecheck
pnpm eval
pnpm bench
```

## Desktop Development
```bash
pnpm --filter @openquery/desktop dev:tauri
```

## CLI Development
```bash
pnpm -C apps/cli build
node apps/cli/dist/main.js --help
```

## Pull Requests
- Keep changes focused and minimal.
- Include reproduction and verification commands in PR description.
- Update docs when behavior or setup changes.
- Ensure CI workflows pass before requesting review.
