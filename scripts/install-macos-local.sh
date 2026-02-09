#!/usr/bin/env bash
set -euo pipefail

APP_NAME="OpenQuery.app"
APP_SRC="apps/desktop/src-tauri/target/release/bundle/macos/${APP_NAME}"
APP_DST="/Applications/${APP_NAME}"
LSREGISTER="/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"

run_with_optional_sudo() {
  if "$@"; then
    return 0
  fi
  sudo "$@"
}

echo "[1/7] Building desktop bundle..."
pnpm --filter @openquery/desktop build:bundle

if [[ ! -d "${APP_SRC}" ]]; then
  echo "Missing app bundle at ${APP_SRC}" >&2
  exit 1
fi

echo "[2/7] Installing ${APP_NAME} into /Applications..."
run_with_optional_sudo ditto "${APP_SRC}" "${APP_DST}"

echo "[3/7] Clearing quarantine and metadata xattrs..."
run_with_optional_sudo xattr -dr com.apple.quarantine "${APP_DST}" || true
run_with_optional_sudo xattr -cr "${APP_DST}"

echo "[4/7] Applying local ad-hoc signature..."
run_with_optional_sudo codesign --force --deep --sign - "${APP_DST}"

echo "[5/7] Re-registering with LaunchServices..."
"${LSREGISTER}" -f "${APP_DST}"

echo "[6/7] Refreshing Spotlight index..."
run_with_optional_sudo mdutil -i on /
run_with_optional_sudo mdutil -E /
mdimport "${APP_DST}" || true

echo "[7/7] Refreshing Dock/Launchpad cache..."
killall Dock || true

echo "Done. Try Spotlight: type OpenQuery and launch the Applications result."
