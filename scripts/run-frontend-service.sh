#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNTIME_DIR="$ROOT_DIR/.runtime"

ORIGINAL_FRONTEND_APP_PORT="${FRONTEND_APP_PORT-}"
ORIGINAL_BACKEND_PORT="${BACKEND_PORT-}"

if [[ -f "$ROOT_DIR/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT_DIR/.env"
  set +a
fi

if [[ -n "$ORIGINAL_FRONTEND_APP_PORT" ]]; then
  FRONTEND_APP_PORT="$ORIGINAL_FRONTEND_APP_PORT"
fi

if [[ -n "$ORIGINAL_BACKEND_PORT" ]]; then
  BACKEND_PORT="$ORIGINAL_BACKEND_PORT"
fi

mkdir -p "$RUNTIME_DIR"

FRONTEND_PORT="${FRONTEND_APP_PORT:-5173}"
BACKEND_PORT="${BACKEND_PORT:-38473}"

echo "$FRONTEND_PORT" >"$RUNTIME_DIR/frontend.port"
echo "http://127.0.0.1:${FRONTEND_PORT}" >"$RUNTIME_DIR/frontend.url"

if ! command -v npm >/dev/null 2>&1; then
  echo "npm is not available in PATH"
  exit 1
fi

install_frontend_deps() {
  if [[ -f "$ROOT_DIR/frontend/package-lock.json" ]]; then
    npm --prefix "$ROOT_DIR/frontend" ci
  else
    npm --prefix "$ROOT_DIR/frontend" install
  fi
}

vite_import_healthy() {
  npm --prefix "$ROOT_DIR/frontend" exec node -e "import('vite').then(() => process.exit(0)).catch(() => process.exit(1))" >/dev/null 2>&1
}

if [[ ! -d "$ROOT_DIR/frontend/node_modules" ]]; then
  install_frontend_deps
elif ! vite_import_healthy; then
  echo "Detected broken frontend dependencies. Reinstalling node_modules..."
  rm -rf "$ROOT_DIR/frontend/node_modules"
  install_frontend_deps
fi

exec env \
  BACKEND_PORT="$BACKEND_PORT" \
  npm --prefix "$ROOT_DIR/frontend" run dev -- --host 0.0.0.0 --port "$FRONTEND_PORT"
