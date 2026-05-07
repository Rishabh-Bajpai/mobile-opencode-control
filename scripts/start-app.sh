#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNTIME_DIR="$ROOT_DIR/.runtime"
LOG_DIR="$RUNTIME_DIR/logs"

OPENCODE_PID_FILE="$RUNTIME_DIR/opencode.pid"
OPENCODE_PORT_FILE="$RUNTIME_DIR/opencode.port"
OPENCODE_URL_FILE="$RUNTIME_DIR/opencode.url"
BACKEND_PID_FILE="$RUNTIME_DIR/backend.pid"
BACKEND_PORT_FILE="$RUNTIME_DIR/backend.port"
BACKEND_URL_FILE="$RUNTIME_DIR/backend.url"
FRONTEND_PID_FILE="$RUNTIME_DIR/frontend.pid"
FRONTEND_PORT_FILE="$RUNTIME_DIR/frontend.port"
FRONTEND_URL_FILE="$RUNTIME_DIR/frontend.url"

mkdir -p "$LOG_DIR"

is_running() {
  local pid_file="$1"
  if [[ ! -f "$pid_file" ]]; then
    return 1
  fi

  local pid
  pid="$(cat "$pid_file")"
  if [[ -z "$pid" ]]; then
    return 1
  fi

  kill -0 "$pid" >/dev/null 2>&1
}

require_dep() {
  local dep="$1"
  local hint="$2"
  if ! command -v "$dep" >/dev/null 2>&1; then
    echo "Missing dependency: $dep"
    echo "$hint"
    exit 1
  fi
}

require_dep "opencode" "Install OpenCode CLI first, then re-run this script."
require_dep "npm" "Install Node.js + npm first, then re-run this script."
require_dep "curl" "Install curl first, then re-run this script."

if [[ ! -x "$ROOT_DIR/.venv/bin/python" ]]; then
  echo "Python virtual environment not found at: $ROOT_DIR/.venv"
  echo "Run: python3 -m venv .venv && source .venv/bin/activate && pip install -r backend/requirements.txt"
  exit 1
fi

if [[ ! -d "$ROOT_DIR/frontend/node_modules" ]]; then
  echo "Installing frontend dependencies..."
  npm --prefix "$ROOT_DIR/frontend" install
fi

if is_running "$OPENCODE_PID_FILE" || is_running "$BACKEND_PID_FILE" || is_running "$FRONTEND_PID_FILE"; then
  echo "One or more services are already running. Use scripts/stop-app.sh first."
  exit 1
fi

pick_port() {
  local base_port="$1"
  local attempts="${2:-60}"
  local sleep_seconds="${4:-0.5}"
  "$ROOT_DIR/.venv/bin/python" - "$base_port" "$attempts" "$sleep_seconds" <<'PY'
import socket
import time
import sys

base_port = int(sys.argv[1])
attempts = int(sys.argv[2])
sleep_seconds = float(sys.argv[3])

for attempt in range(attempts):
    for offset in range(3):
        candidate = base_port + offset
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            sock.bind(("127.0.0.1", candidate))
        except OSError as exc:
            pass
        else:
            print(candidate)
            sock.close()
            sys.exit(0)
        finally:
            try:
                sock.close()
            except Exception:
                pass

    if attempt < attempts - 1:
        time.sleep(sleep_seconds)

print(f"No free port available in range {base_port}-{base_port + 2}", file=sys.stderr)
sys.exit(1)
PY
}

wait_for_opencode() {
  local port="$1"
  local url="http://127.0.0.1:${port}/global/health"
  local max_tries=40
  local attempt=1
  while (( attempt <= max_tries )); do
    if curl -fsS "$url" >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.25
    (( attempt += 1 ))
  done
  return 1
}

OPENCODE_BASE_PORT="${OPENCODE_APP_PORT:-40961}"
OPENCODE_PORT="$(pick_port "$OPENCODE_BASE_PORT")"
OPENCODE_BASE_URL="http://127.0.0.1:${OPENCODE_PORT}"

BACKEND_BASE_PORT="${BACKEND_APP_PORT:-38473}"
BACKEND_PORT="$(pick_port "$BACKEND_BASE_PORT")"
BACKEND_BASE_URL="http://127.0.0.1:${BACKEND_PORT}"

FRONTEND_BASE_PORT="${FRONTEND_APP_PORT:-5173}"
FRONTEND_PORT="$(pick_port "$FRONTEND_BASE_PORT")"
FRONTEND_BASE_URL="http://127.0.0.1:${FRONTEND_PORT}"
FRONTEND_ALLOWED_HOSTS="${FRONTEND_ALLOWED_HOSTS:-localhost,127.0.0.1}"
FRONTEND_ORIGINS="${FRONTEND_ORIGINS:-http://localhost:${FRONTEND_PORT}}"
OPENCODE_CORS_ORIGINS="${OPENCODE_CORS_ORIGINS:-$FRONTEND_ORIGINS}"

echo "Starting OpenCode server..."
opencode serve --hostname 127.0.0.1 --port "$OPENCODE_PORT" --cors "$OPENCODE_CORS_ORIGINS" >"$LOG_DIR/opencode.log" 2>&1 &
echo $! >"$OPENCODE_PID_FILE"
echo "$OPENCODE_PORT" >"$OPENCODE_PORT_FILE"
echo "$OPENCODE_BASE_URL" >"$OPENCODE_URL_FILE"

if ! wait_for_opencode "$OPENCODE_PORT"; then
  echo "OpenCode failed to start on ${OPENCODE_BASE_URL}. Check: $LOG_DIR/opencode.log"
  exit 1
fi

echo "Starting backend with project venv..."
OPENCODE_BASE_URL="$OPENCODE_BASE_URL" FRONTEND_ORIGINS="$FRONTEND_ORIGINS" FRONTEND_ORIGIN="${FRONTEND_ORIGIN:-$(printf '%s' "$FRONTEND_ORIGINS" | cut -d',' -f1)}" BACKEND_PORT="$BACKEND_PORT" "$ROOT_DIR/.venv/bin/python" "$ROOT_DIR/backend/run.py" >"$LOG_DIR/backend.log" 2>&1 &
echo $! >"$BACKEND_PID_FILE"
echo "$BACKEND_PORT" >"$BACKEND_PORT_FILE"
echo "$BACKEND_BASE_URL" >"$BACKEND_URL_FILE"

echo "Starting frontend dev server..."
BACKEND_PORT="$BACKEND_PORT" FRONTEND_ALLOWED_HOSTS="$FRONTEND_ALLOWED_HOSTS" npm --prefix "$ROOT_DIR/frontend" run dev -- --host 0.0.0.0 --port "$FRONTEND_PORT" >"$LOG_DIR/frontend.log" 2>&1 &
echo $! >"$FRONTEND_PID_FILE"
echo "$FRONTEND_PORT" >"$FRONTEND_PORT_FILE"
echo "$FRONTEND_BASE_URL" >"$FRONTEND_URL_FILE"

sleep 2

echo ""
echo "App started."
echo "- Frontend: ${FRONTEND_BASE_URL}"
echo "- Backend:  ${BACKEND_BASE_URL}/api/health"
echo "- OpenCode: ${OPENCODE_BASE_URL}/global/health"
echo ""
echo "Logs:"
echo "- $LOG_DIR/frontend.log"
echo "- $LOG_DIR/backend.log"
echo "- $LOG_DIR/opencode.log"
