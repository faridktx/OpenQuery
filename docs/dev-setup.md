# OpenQuery Developer Setup (macOS)

This is the canonical local setup path for a fresh clone.

## 1) Choose a safe working directory

Recommended:

- `~/dev/OpenQuery`

Avoid by default:

- `~/Documents/OpenQuery` (macOS can block terminal access and cause `EPERM`/`uv_cwd` errors)

If you must use `~/Documents`:

- Enable Full Disk Access for your terminal app (Terminal, iTerm, Warp)
- Restart the terminal after granting permission

## 2) Clone or copy the repo

Use an Apple-rsync-safe command:

```bash
rsync -aP /path/to/source/OpenQuery/ ~/dev/OpenQuery/
```

Fallback:

```bash
cp -R /path/to/source/OpenQuery ~/dev/OpenQuery
```

## 3) Node and pnpm versions

Target runtime is Node 20 LTS (CI parity).

```bash
nvm install 20
nvm use 20
node -v
```

If `nvm` is unavailable, run at least one Node 20 command path with:

```bash
npx -y node@20 -v
npx -y node@20 apps/cli/dist/main.js --help
```

Recommended pnpm major:

```bash
corepack enable
corepack prepare pnpm@9 --activate
pnpm -v
```

Note:

- Node 24 may work, but Node 20 is the compatibility target.

## 4) Install dependencies

```bash
pnpm install
```

## 5) Canonical workspace verification

Run from repo root in this exact order:

```bash
pnpm -r build
pnpm -r test
pnpm lint
pnpm typecheck
```

## 6) Deterministic CLI sanity checks

Do not rely on workspace bin lookup for validation:

```bash
pnpm -C apps/cli build
node apps/cli/dist/main.js --help
node apps/cli/dist/main.js doctor
```

## 7) Next docs

- Docker fixture setup: `docs/docker-setup.md`
- Smoke checklist: `docs/smoke.md`
- Recruiter demo flow: `docs/recruiter-demo.md`
