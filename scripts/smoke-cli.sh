#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
CLI_DIR="$ROOT_DIR/apps/cli"
CLI_BIN="$ROOT_DIR/apps/cli/dist/main.js"

echo "[smoke-cli] build"
pnpm -C "$CLI_DIR" build

echo "[smoke-cli] help"
node "$CLI_BIN" --help >/dev/null

echo "[smoke-cli] doctor"
node "$CLI_BIN" doctor >/dev/null

if [[ "${OPENQUERY_PG_INTEGRATION:-0}" != "1" ]]; then
  echo "[smoke-cli] SKIP postgres flow (set OPENQUERY_PG_INTEGRATION=1 to enable)"
  exit 0
fi

HOST="${OPENQUERY_PG_HOST:-127.0.0.1}"
PORT="${OPENQUERY_PG_PORT:-55432}"
DB="${OPENQUERY_PG_DATABASE:-openquery_test}"
USER="${OPENQUERY_PG_USER:-openquery}"
PASS="${OPENQUERY_PG_PASSWORD:-openquery_dev}"
PROFILE="smoke-$(date +%s)"
TMP_HOME="$(mktemp -d)"
cleanup() {
  rm -rf "$TMP_HOME"
}
trap cleanup EXIT

echo "[smoke-cli] postgres profile add/use/refresh"
HOME="$TMP_HOME" OPENQUERY_PASSWORD="$PASS" node "$CLI_BIN" profiles add \
  --name "$PROFILE" --type postgres --host "$HOST" --port "$PORT" --database "$DB" --user "$USER" --json >/dev/null
HOME="$TMP_HOME" OPENQUERY_PASSWORD="$PASS" node "$CLI_BIN" profiles use "$PROFILE" --json >/dev/null
HOME="$TMP_HOME" OPENQUERY_PASSWORD="$PASS" node "$CLI_BIN" schema refresh --name "$PROFILE" --json >/dev/null

echo "[smoke-cli] safe read query"
HOME="$TMP_HOME" OPENQUERY_PASSWORD="$PASS" node "$CLI_BIN" run --name "$PROFILE" --sql "SELECT id, email FROM users ORDER BY id LIMIT 3" --json >/dev/null

echo "[smoke-cli] blocked query returns exit code 3"
set +e
HOME="$TMP_HOME" OPENQUERY_PASSWORD="$PASS" node "$CLI_BIN" run --name "$PROFILE" --sql "SELECT * FROM users" --json >/dev/null 2>&1
RC=$?
set -e
if [[ "$RC" -ne 3 ]]; then
  echo "[smoke-cli] FAIL expected exit code 3 for blocked query, got $RC"
  exit 1
fi

echo "[smoke-cli] PASS"
