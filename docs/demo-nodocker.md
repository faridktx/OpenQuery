# Demo (No Docker)

Use this flow when you want a zero-terminal product demo.

## In-app path
1. Launch desktop:
   ```bash
   pnpm --filter @openquery/desktop dev:tauri
   ```
2. Open `Setup`.
3. Select `Demo (No Docker)`.
4. Click `Create demo profile`.
5. Click `Refresh schema`.
6. Run first query.

## What this mode uses
- Local SQLite fixture in app data dir
- Local profile named `demo-sqlite`
- Simplified EXPLAIN output suitable for quick demos

## Reset
In Setup Step 2, click `Reset Demo DB`.
