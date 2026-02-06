# Desktop Smoke Test

## Prerequisites

1. **Node.js** >= 18
2. **Rust** toolchain (for Tauri) — install via [rustup](https://rustup.rs/)
3. **Tauri CLI**: `cargo install tauri-cli` or use `pnpm tauri` from the desktop package
4. **Postgres** running (use `docker compose up -d` from `infra/docker/`)
5. **OPENAI_API_KEY** set in environment

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

### 1. Profiles
- Open the **Profiles** tab in the sidebar
- Click **Add Profile** and fill in your Postgres connection details
- Check "Remember password" if you want it stored in the OS keychain
- Click **Create**
- The profile should appear in the list with an "active" badge
- Click **Test** — should show "Connection OK"

### 2. Schema
- Open the **Schema** tab
- Enter your DB password in the sidebar (if not using keychain)
- Click **Refresh Schema** — should show table/column counts
- Type a table or column name in the search bar
- Click a search result to see table details (columns, types, PKs)

### 3. Ask
- Open the **Ask** tab
- Type a question like "show me all users"
- Click **Dry Run** — should show generated SQL, policy result, and EXPLAIN summary without executing
- Click **Run** — should execute and show results in a data grid
- Click **Export CSV** to download results
- Note the Query ID shown at the bottom

### 4. History
- Open the **History** tab
- Your recent queries should appear in the list
- Click a row to see full details (generation, execution, EXPLAIN)
- Click **MD** to export a Markdown report

## Troubleshooting

- **"Bridge not started"**: Ensure the bridge is built (`pnpm --filter @openquery/desktop build:bridge`) and Node.js is in PATH
- **"No active profile"**: Add a profile in the Profiles tab first
- **"No schema snapshot"**: Run Schema Refresh before using Ask
- **Password errors**: Enter the DB password in the sidebar password field
- **Tauri build errors**: Ensure Rust toolchain is installed. Run `rustup update` if needed.

## Architecture Note

The desktop app uses a **Node.js bridge process** for core logic:
- Tauri (Rust) manages the bridge lifecycle
- Frontend (React) calls Tauri commands
- Tauri commands forward to the bridge via stdin/stdout JSON-RPC
- Keychain operations are handled directly in Rust via the `keyring` crate
- Database passwords never pass through SQLite or disk — only OS keychain or in-memory
