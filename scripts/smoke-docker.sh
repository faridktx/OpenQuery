#!/usr/bin/env bash
set -euo pipefail

COMPOSE_FILE="infra/docker/docker-compose.yml"
SERVICE="postgres"
READY_TIMEOUT_SECONDS=60
FIXTURE_ENV_DIR=".openquery"
FIXTURE_ENV_FILE="${FIXTURE_ENV_DIR}/fixture.env"
DEFAULT_HOST="127.0.0.1"
DEFAULT_DB="openquery_test"
DEFAULT_USER="openquery"
DEFAULT_PASSWORD="openquery_dev"
PREFERRED_PORTS=(5432 55432 5433 55433 6432 65432)
HOST_PORT="${OPENQUERY_PG_PORT:-}"

fail() {
  echo "FAIL: $1" >&2
  exit 1
}

port_in_use() {
  local port="$1"
  if command -v lsof >/dev/null 2>&1; then
    if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
      return 0
    fi
    return 1
  fi

  if command -v nc >/dev/null 2>&1; then
    if nc -z localhost "$port" >/dev/null 2>&1; then
      return 0
    fi
    return 1
  fi

  if (echo >/dev/tcp/127.0.0.1/"$port") >/dev/null 2>&1; then
    return 0
  fi
  return 1
}

port_candidates() {
  local -a out=()
  if [[ -n "$HOST_PORT" ]]; then
    out+=("$HOST_PORT")
  fi
  out+=("${PREFERRED_PORTS[@]}")
  # shellcheck disable=SC2068
  printf '%s\n' ${out[@]} | awk '!seen[$0]++'
}

write_fixture_env() {
  mkdir -p "$FIXTURE_ENV_DIR"
  cat >"$FIXTURE_ENV_FILE" <<EOF_ENV
OPENQUERY_PG_HOST=${DEFAULT_HOST}
OPENQUERY_PG_PORT=${HOST_PORT}
OPENQUERY_PG_DATABASE=${DEFAULT_DB}
OPENQUERY_PG_USER=${DEFAULT_USER}
OPENQUERY_PG_PASSWORD=${DEFAULT_PASSWORD}
EOF_ENV
}

if ! docker info >/dev/null 2>&1; then
  fail "Docker daemon is not running. Start Docker Desktop and retry."
fi

if [[ -n "$HOST_PORT" ]] && port_in_use "$HOST_PORT"; then
  echo "Requested host port ${HOST_PORT} is in use. Falling back to auto-select."
fi

selected=0
while IFS= read -r candidate; do
  [[ -n "$candidate" ]] || continue
  if port_in_use "$candidate"; then
    continue
  fi

  echo "Starting Postgres fixture on host port ${candidate}..."
  if up_output="$(OPENQUERY_PG_PORT="$candidate" docker compose -f "$COMPOSE_FILE" up -d 2>&1)"; then
    echo "$up_output"
    HOST_PORT="$candidate"
    selected=1
    break
  fi

  if printf '%s' "$up_output" | grep -qi "address already in use"; then
    continue
  fi
  echo "$up_output" >&2
  fail "Failed to start Postgres fixture via docker compose."
done < <(port_candidates)

if [[ "$selected" -ne 1 ]]; then
  fail "Could not find a free host port for the Docker fixture."
fi

export OPENQUERY_PG_PORT="$HOST_PORT"

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

write_fixture_env

echo "PASS: Docker fixture is healthy on host port ${HOST_PORT} (users count=${users_count})."
echo "Fixture env written: ${FIXTURE_ENV_FILE}"
echo "Connection hint: postgres://${DEFAULT_USER}@${DEFAULT_HOST}:${HOST_PORT}/${DEFAULT_DB}"
