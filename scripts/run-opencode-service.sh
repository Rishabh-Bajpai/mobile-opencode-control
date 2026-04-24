#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNTIME_DIR="$ROOT_DIR/.runtime"

ORIGINAL_OPENCODE_BIN="${OPENCODE_BIN-}"
ORIGINAL_OPENCODE_APP_PORT="${OPENCODE_APP_PORT-}"
ORIGINAL_FRONTEND_APP_PORT="${FRONTEND_APP_PORT-}"

if [[ -f "$ROOT_DIR/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT_DIR/.env"
  set +a
fi

if [[ -n "$ORIGINAL_OPENCODE_BIN" ]]; then
  OPENCODE_BIN="$ORIGINAL_OPENCODE_BIN"
fi

if [[ -n "$ORIGINAL_OPENCODE_APP_PORT" ]]; then
  OPENCODE_APP_PORT="$ORIGINAL_OPENCODE_APP_PORT"
fi

if [[ -n "$ORIGINAL_FRONTEND_APP_PORT" ]]; then
  FRONTEND_APP_PORT="$ORIGINAL_FRONTEND_APP_PORT"
fi

mkdir -p "$RUNTIME_DIR"

OPENCODE_PORT="${OPENCODE_APP_PORT:-40961}"
FRONTEND_PORT="${FRONTEND_APP_PORT:-5173}"
FRONTEND_ORIGINS="${FRONTEND_ORIGINS:-http://localhost:${FRONTEND_PORT}}"
OPENCODE_CORS_ORIGINS="${OPENCODE_CORS_ORIGINS:-$FRONTEND_ORIGINS}"

echo "$OPENCODE_PORT" >"$RUNTIME_DIR/opencode.port"
echo "http://127.0.0.1:${OPENCODE_PORT}" >"$RUNTIME_DIR/opencode.url"

OPENCODE_BIN_FILE="$RUNTIME_DIR/opencode.bin"
OPENCODE_BIN="${OPENCODE_BIN:-}"
if [[ -z "$OPENCODE_BIN" && -f "$OPENCODE_BIN_FILE" ]]; then
  OPENCODE_BIN="$(cat "$OPENCODE_BIN_FILE")"
fi
if [[ -z "$OPENCODE_BIN" ]]; then
  OPENCODE_BIN="$(command -v opencode || true)"
fi
if [[ -z "$OPENCODE_BIN" || ! -x "$OPENCODE_BIN" ]]; then
  echo "opencode CLI executable could not be resolved"
  echo "Set OPENCODE_BIN or create $OPENCODE_BIN_FILE with an absolute executable path"
  exit 1
fi

exec "$OPENCODE_BIN" serve \
  --hostname 127.0.0.1 \
  --port "$OPENCODE_PORT" \
  --cors "$OPENCODE_CORS_ORIGINS"
