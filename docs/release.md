# Release Guide

This document covers reproducible release builds for OpenQuery on macOS.

## Prerequisites

- Node.js 20 LTS
- pnpm 9
- Rust toolchain (`rustup`)
- Xcode Command Line Tools (`xcode-select --install`)

## Install dependencies

```bash
pnpm install
```

## Workspace verification baseline

```bash
pnpm -r build
pnpm -r test
pnpm lint
pnpm typecheck
```

## Docker fixture check (required for integration verification)

```bash
docker info
OPENQUERY_PG_PORT=55432 pnpm smoke:docker
OPENQUERY_PG_PORT=55432 OPENQUERY_PG_HOST=127.0.0.1 pnpm --filter @openquery/core test:integration
```

## CLI release sanity

```bash
pnpm -C apps/cli build
node apps/cli/dist/main.js --help
node apps/cli/dist/main.js doctor
```

Optional helper path:

```bash
pnpm openquery:build -- doctor
```

## Desktop compile checks

```bash
pnpm --filter @openquery/desktop build
pnpm --filter @openquery/desktop tauri build --no-bundle
```

## Desktop bundle (distribution build)

```bash
pnpm --filter @openquery/desktop build:bundle
```

Bundle artifact path:

- `apps/desktop/src-tauri/target/release/bundle/macos/`

### Optional codesign + notarization

OpenQuery currently builds unsigned by default, but the generated app bundle is signing-ready.
For distribution, sign and notarize in your release environment:

```bash
codesign --deep --force --options runtime --sign "Developer ID Application: <TEAM>" "apps/desktop/src-tauri/target/release/bundle/macos/OpenQuery.app"
```
