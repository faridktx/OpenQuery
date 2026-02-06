# Release Guide

This document covers reproducible release builds for OpenQuery on macOS.

## Prerequisites

- Node.js 18+
- pnpm 8+
- Rust toolchain (`rustup`)
- Xcode Command Line Tools (`xcode-select --install`)

## Install dependencies

```bash
pnpm install --frozen-lockfile
```

## Build all workspace packages

```bash
pnpm -r build
```

## Desktop app bundle (macOS)

Build a signed-ready `.app` bundle:

```bash
pnpm --filter @openquery/desktop build:bundle
```

Bundle artifacts are produced under:

- `apps/desktop/src-tauri/target/release/bundle/macos/`

### Optional codesign + notarization

OpenQuery currently builds unsigned by default, but the generated app bundle is signing-ready.
For distribution, sign and notarize in your release environment:

```bash
codesign --deep --force --options runtime --sign "Developer ID Application: <TEAM>" "apps/desktop/src-tauri/target/release/bundle/macos/OpenQuery.app"
```

## CLI package build

```bash
pnpm --filter @openquery/cli build
```

The compiled executable entrypoint is:

- `apps/cli/dist/main.js`

Global install path after publish:

```bash
npm i -g @openquery/cli
```

Local run without global install:

```bash
pnpm --filter @openquery/cli exec openquery --help
```
