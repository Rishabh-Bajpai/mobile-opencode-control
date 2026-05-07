#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNTIME_DIR="$ROOT_DIR/.runtime"
PYTHON_BIN="$ROOT_DIR/.venv/bin/python"

ORIGINAL_BACKEND_PORT="${BACKEND_PORT-}"
ORIGINAL_OPENCODE_APP_PORT="${OPENCODE_APP_PORT-}"
ORIGINAL_OPENCODE_BASE_URL="${OPENCODE_BASE_URL-}"

if [[ -f "$ROOT_DIR/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT_DIR/.env"
  set +a
fi

if [[ -n "$ORIGINAL_BACKEND_PORT" ]]; then
  BACKEND_PORT="$ORIGINAL_BACKEND_PORT"
fi

if [[ -n "$ORIGINAL_OPENCODE_APP_PORT" ]]; then
  OPENCODE_APP_PORT="$ORIGINAL_OPENCODE_APP_PORT"
fi

if [[ -n "$ORIGINAL_OPENCODE_BASE_URL" ]]; then
  OPENCODE_BASE_URL="$ORIGINAL_OPENCODE_BASE_URL"
fi

mkdir -p "$RUNTIME_DIR"

BACKEND_PORT="${BACKEND_PORT:-38473}"
OPENCODE_PORT="${OPENCODE_APP_PORT:-40961}"
OPENCODE_BASE_URL="${OPENCODE_BASE_URL:-http://127.0.0.1:${OPENCODE_PORT}}"

echo "$BACKEND_PORT" >"$RUNTIME_DIR/backend.port"
echo "http://127.0.0.1:${BACKEND_PORT}" >"$RUNTIME_DIR/backend.url"

if [[ ! -x "$PYTHON_BIN" ]]; then
  echo "Python virtual environment is missing at $ROOT_DIR/.venv"
  echo "Run: python3 -m venv .venv && source .venv/bin/activate && pip install -r backend/requirements.txt"
  exit 1
fi

exec env \
  OPENCODE_BASE_URL="$OPENCODE_BASE_URL" \
  BACKEND_PORT="$BACKEND_PORT" \
  "$PYTHON_BIN" "$ROOT_DIR/backend/run.py"
