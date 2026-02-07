# Recruiter Quick Demo (2 to 3 Minutes)

This is the canonical demo flow for a fresh clone on macOS.

## 0) Preflight

- Start Docker Desktop first.
- Open terminal in repo root.

If `docker info` fails, start Docker Desktop and retry.

## 1) Copy-paste setup commands

```bash
pnpm install
pnpm -r build
OPENQUERY_PG_PORT=55432 pnpm smoke:docker
pnpm -C apps/cli build
node apps/cli/dist/main.js doctor
pnpm --filter @openquery/desktop tauri dev
```

If port `55432` is busy, pick another free port and reuse it for all fixture commands.

## 2) Desktop click-path (main story)

1. `Profiles`:
   - Click `Add Profile`.
   - Use:
     - name: `demo`
     - host: `127.0.0.1`
     - port: `55432`
     - database: `openquery_test`
     - user: `openquery`
   - Save profile.
   - Click `Test`.
   - Click `Refresh Schema`.
2. `Workspace`:
   - Show `Schema Explorer` on the left.
   - Click table `public.users` and point out copied column names.
3. `Ask` tab:
   - Ask: `show active users`
   - Click `Generate` (or `Dry Run`).
   - Show generated SQL, Safety panel, Explain panel.
4. `SQL` tab:
   - Run:
     ```sql
     SELECT id, email, is_active FROM users WHERE is_active = true ORDER BY id LIMIT 20;
     ```
   - Click `Explain`, then `Run`.
   - Show result table, row count, exec time, CSV export button.
5. Guardrails moment:
   - Try:
     ```sql
     SELECT * FROM users;
     ```
   - In safe mode, show policy warning/rewriting behavior in Safety panel.
6. POWER mode preview:
   - Go to `Profiles`, enable `POWER mode`.
   - Return to `Workspace` SQL tab and enter:
     ```sql
     UPDATE users SET is_active = false WHERE id = 2;
     ```
   - Click `Preview Write`.
   - Show typed confirmation phrase requirement in modal.
   - Do not click final execute during recruiter demo.

## 3) No OpenAI key fallback

If no OpenAI key is configured in Desktop Settings:

- Keep the same flow but use SQL tab instead of Ask generation.
- The app shows a clear OpenAI key callout and continues working for SQL execution/explain.

Optional fallback for power users:

```bash
export OPENAI_API_KEY=sk-...
```

## 4) CLI fallback path (if UI demo is blocked)

```bash
pnpm -C apps/cli build
node apps/cli/dist/main.js doctor
node apps/cli/dist/main.js --help
```

Optional helper:

```bash
pnpm openquery:build -- doctor
```
