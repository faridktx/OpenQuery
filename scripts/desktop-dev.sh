#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
DESKTOP_DIR="$ROOT_DIR/apps/desktop"

if [[ ! -d "$DESKTOP_DIR/src-tauri" ]]; then
  echo "Desktop package not found at $DESKTOP_DIR"
  exit 1
fi

if [[ "$ROOT_DIR" == *"/Documents/"* ]]; then
  cat <<'EOF'
Warning: repo is under ~/Documents.
macOS privacy controls can block node/tauri with EPERM/uv_cwd issues in Documents.
Recommended: move repo to ~/dev/OpenQuery and run again.
EOF
fi

if ! xcode-select -p >/dev/null 2>&1; then
  cat <<'EOF'
Xcode command line tools are not configured.
Run: xcode-select --install
EOF
  exit 1
fi

for tool in node pnpm rustc cargo; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "Missing required tool: $tool"
    exit 1
  fi
done

stale_rustc="$(ps -ax -o pid=,ppid=,command= | awk '$2 == 1 && $0 ~ /rustc --crate-name openquery_desktop/ { print $1 }')"
if [[ -n "${stale_rustc:-}" ]]; then
  cat <<EOF
Detected orphan rustc process(es): $stale_rustc
This can block or stall tauri dev.
Run: kill $stale_rustc
Then retry: pnpm --filter @openquery/desktop dev:tauri
EOF
  exit 1
fi

port_owner="$(lsof -nP -iTCP:1420 -sTCP:LISTEN 2>/dev/null | tail -n +2 || true)"
if [[ -n "${port_owner:-}" ]]; then
  cat <<EOF
Port 1420 is already in use.
$port_owner
Stop the process using port 1420 and retry.
EOF
  exit 1
fi

echo "Starting OpenQuery desktop via Tauri..."
echo "Note: first Rust debug compile can take 1-3 minutes before the window appears."

cd "$DESKTOP_DIR"
exec pnpm tauri dev
