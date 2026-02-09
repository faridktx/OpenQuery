# OpenQuery Demo (No Docker)

Goal:
- run OpenQuery desktop end-to-end when Docker is unavailable,
- prove setup, guardrails, results, and export behavior.

## 1. Start desktop

```bash
pnpm install
pnpm --filter @openquery/desktop dev:tauri
```

Expected:
- Tauri app window opens.
- Setup page is available.

## 2. Complete setup in UI

1. Open `Setup`.
2. Step 1: select `Demo (No Docker)`.
3. Step 2: click `Create demo profile`.
4. Step 3: click `Refresh schema`.
5. Step 4:
- if OpenAI key is set, run `Generate + Run (safe)`, or
- run `Run SQL sample` fallback.

Expected:
- profile `demo-sqlite` is active,
- schema refresh succeeds,
- first query returns rows.

## 3. Validate safe behavior

In `Workspace` SQL tab run:
```sql
SELECT id, email, full_name FROM users ORDER BY id LIMIT 20;
```
Expected:
- query allowed,
- rows render,
- CSV export action enabled.

Run blocked query:
```sql
SELECT * FROM users;
```
Expected:
- query blocked in safe mode,
- policy reason and fix guidance shown.

## 4. Validate history + export

1. Open `History`.
2. Confirm new entries are listed.
3. Open one entry.
4. Click `Export Markdown`.

Expected:
- markdown report downloads,
- no secrets shown.

## 5. Optional reset

In Setup Step 2 use:
- `Reset demo DB`

Expected:
- local SQLite fixture reseeded,
- setup remains runnable without Docker.
