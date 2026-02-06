#!/bin/bash
# Quick launch for OpenQuery Desktop
# Usage: ./launch.sh [--rebuild]
set -e

DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

source "$HOME/.cargo/env" 2>/dev/null || true

if [ "$1" = "--rebuild" ] || [ ! -f src-tauri/target/debug/openquery-desktop ]; then
    echo "Building Tauri app..."
    cd src-tauri
    cargo build 2>&1
    cd "$DIR"
    echo "Build complete."
fi

echo "Starting Vite dev server..."
npx vite --port 1420 &
VITE_PID=$!

# Wait for Vite to be ready
for i in $(seq 1 30); do
    if curl -s http://localhost:1420 > /dev/null 2>&1; then
        break
    fi
    sleep 0.5
done

echo "Launching OpenQuery Desktop..."
src-tauri/target/debug/openquery-desktop

# Cleanup Vite on exit
kill $VITE_PID 2>/dev/null
