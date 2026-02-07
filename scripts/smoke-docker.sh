#!/usr/bin/env bash
set -euo pipefail

COMPOSE_FILE="infra/docker/docker-compose.yml"
SERVICE="postgres"
READY_TIMEOUT_SECONDS=60
HOST_PORT="${OPENQUERY_PG_PORT:-5432}"

fail() {
  echo "FAIL: $1" >&2
  exit 1
}

if ! docker info >/dev/null 2>&1; then
  fail "Docker daemon is not running. Start Docker Desktop and retry."
fi

echo "Starting Postgres fixture on host port ${HOST_PORT}..."
if ! up_output="$(docker compose -f "$COMPOSE_FILE" up -d 2>&1)"; then
  echo "$up_output" >&2
  if printf '%s' "$up_output" | grep -qi "address already in use"; then
    fail "Host port ${HOST_PORT} is already in use. Choose a free port, e.g. OPENQUERY_PG_PORT=55432 pnpm smoke:docker"
  fi
  fail "Failed to start Postgres fixture via docker compose."
fi
echo "$up_output"

CID="$(docker compose -f "$COMPOSE_FILE" ps -q "$SERVICE")"
if [[ -z "$CID" ]]; then
  fail "Could not resolve container ID for service '$SERVICE'."
fi

echo "Waiting for Postgres readiness (up to ${READY_TIMEOUT_SECONDS}s)..."
ready=0
start_ts=$(date +%s)
while true; do
  if docker exec "$CID" pg_isready -U openquery -d openquery_test >/dev/null 2>&1; then
    ready=1
    break
  fi
  now_ts=$(date +%s)
  elapsed=$((now_ts - start_ts))
  if (( elapsed >= READY_TIMEOUT_SECONDS )); then
    break
  fi
  sleep 2
done

if [[ "$ready" -ne 1 ]]; then
  docker logs --tail 50 "$CID" || true
  fail "Postgres did not become ready within ${READY_TIMEOUT_SECONDS}s."
fi

users_count="$(docker exec -i "$CID" psql -U openquery -d openquery_test -t -A -c "SELECT COUNT(*) FROM users;" 2>/dev/null || true)"
users_count="${users_count//$'\r'/}"
users_count="${users_count//$'\n'/}"

users_table_exists="$(docker exec -i "$CID" psql -U openquery -d openquery_test -t -A -c "SELECT to_regclass('public.users') IS NOT NULL;" 2>/dev/null || true)"
users_table_exists="${users_table_exists//$'\r'/}"
users_table_exists="${users_table_exists//$'\n'/}"

if [[ "$users_table_exists" != "t" ]]; then
  fail "Seed verification failed. 'public.users' table not found. Reset with: docker compose -f $COMPOSE_FILE down -v"
fi

if [[ -z "$users_count" ]]; then
  fail "Seed verification failed. Could not read users count from public.users."
fi

if ! [[ "$users_count" =~ ^[0-9]+$ ]]; then
  fail "Seed verification failed. Unexpected users count value: '$users_count'"
fi

if (( users_count <= 0 )); then
  fail "Seed verification failed. public.users has 0 rows; expected seeded data."
fi

echo "PASS: Docker fixture is healthy on host port ${HOST_PORT} (users count=${users_count})."
echo ""
echo "Use these environment variables for integration commands:"
echo "OPENQUERY_PG_HOST=127.0.0.1"
echo "OPENQUERY_PG_PORT=${HOST_PORT}"
echo "OPENQUERY_PG_DATABASE=openquery_test"
echo "OPENQUERY_PG_USER=openquery"
echo "OPENQUERY_PG_PASSWORD=openquery_dev"
