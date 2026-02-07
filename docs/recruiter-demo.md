# Recruiter Quick Demo (2 Minutes)

This is the single copy-paste flow for a polished desktop demo.

## 1) Launch
```bash
pnpm install
pnpm --filter @openquery/desktop dev:tauri
```

## 2) In-app click path
1. Open `Setup`.
2. Select `Demo (No Docker)`.
3. Click `Create demo profile`.
4. Click `Refresh schema`.
5. In `Run first query`, click `Run SQL sample`.
6. Open `Workspace` and run:
   ```sql
   SELECT id, email, full_name, is_active FROM users WHERE is_active = 1 ORDER BY id LIMIT 20;
   ```
7. Open `History` and reopen the latest query.

## 3) Guardrails moment (safe mode)
In `Workspace` -> `Run SQL`, run:
```sql
SELECT * FROM users;
```
Expected: policy block guidance with fix suggestions.

## 4) Optional Docker parity demo
If you need Postgres parity:
```bash
docker info
OPENQUERY_PG_PORT=55432 pnpm smoke:docker
```
Then in Setup choose `Demo (Docker Postgres)` and click `Start`.

## 5) OpenAI key note
Primary path is in-app:
- `Settings` -> `AI Provider` -> save key.

Without key:
- Ask remains disabled.
- SQL mode still works.
