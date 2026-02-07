# Desktop Smoke Test

## Prerequisites

1. **Node.js** >= 18
2. **Rust** toolchain (for Tauri) — install via [rustup](https://rustup.rs/)
3. **Tauri CLI**: `cargo install tauri-cli` or use `pnpm tauri` from the desktop package
4. **Postgres** running (use `docker compose up -d` from `infra/docker/`)
5. OpenAI key configured in Desktop `Settings` -> `AI Provider` (optional; SQL demo works without it)

## Setup

```bash
cd ~/documents/openquery

# Install dependencies
pnpm install

# Build core (required by bridge and frontend)
pnpm --filter @openquery/core build

# Build the bridge
pnpm --filter @openquery/desktop build:bridge
```

## Development Mode

```bash
# Start the Vite dev server + Tauri app
cd apps/desktop
pnpm tauri dev
```

This starts the Vite dev server on port 1420 and launches the Tauri window.

## Manual Test Script

### 1. Setup (No Docker default)
- Open **Setup** in the sidebar (auto-opens when onboarding is needed)
- Select **Demo (No Docker)** and click **Create demo profile**
- Click **Refresh schema**
- Click **Run SQL sample** and confirm rows render

### 2. Setup (Docker optional)
- Switch to **Demo (Docker Postgres)**
- Click **Start Docker demo**
- Confirm status shows running and a resolved host port
- Click **Refresh schema** and run SQL sample again

### 3. Ask + SQL
- If OpenAI key is set: run `Generate (dry-run)` and `Generate + Run (safe)`
- Without OpenAI key: Ask stays disabled with Settings CTA; SQL tab still runs queries
- In SQL tab, run `SELECT id, email FROM users LIMIT 20;` then **Explain** and **Run**

### 4. History
- Open **History**
- Confirm setup/sample query entries are visible
- Open one entry back into Workspace

## Troubleshooting

- **"Bridge not started"**: Ensure the bridge is built (`pnpm --filter @openquery/desktop build:bridge`) and Node.js is in PATH
- **"No active profile"**: Open Setup and create demo profile
- **"No schema snapshot"**: Run Setup Step 3 refresh
- **Docker unavailable**: Use Demo (No Docker), then retry Docker mode later
- **Tauri build errors**: Ensure Rust toolchain is installed. Run `rustup update` if needed.

## Architecture Note

The desktop app uses a **Node.js bridge process** for core logic:
- Tauri (Rust) manages the bridge lifecycle
- Frontend (React) calls Tauri commands
- Tauri commands forward to the bridge via stdin/stdout JSON-RPC
- Keychain operations are handled directly in Rust via the `keyring` crate
- Database passwords never pass through SQLite or disk — only OS keychain or in-memory
