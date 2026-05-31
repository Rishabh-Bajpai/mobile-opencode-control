#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNTIME_DIR="$ROOT_DIR/.runtime"

OPENCODE_PID_FILE="$RUNTIME_DIR/opencode.pid"
OPENCODE_PORT_FILE="$RUNTIME_DIR/opencode.port"
OPENCODE_URL_FILE="$RUNTIME_DIR/opencode.url"
BACKEND_PID_FILE="$RUNTIME_DIR/backend.pid"
BACKEND_PORT_FILE="$RUNTIME_DIR/backend.port"
BACKEND_URL_FILE="$RUNTIME_DIR/backend.url"
FRONTEND_PID_FILE="$RUNTIME_DIR/frontend.pid"
FRONTEND_PORT_FILE="$RUNTIME_DIR/frontend.port"
FRONTEND_URL_FILE="$RUNTIME_DIR/frontend.url"

BACKEND_SYSTEMD_UNIT="mobile-opencode-control-backend.service"
FRONTEND_SYSTEMD_UNIT="mobile-opencode-control-frontend.service"
OPENCODE_SYSTEMD_UNIT="mobile-opencode-control-opencode.service"

systemd_active() {
  local unit="$1"
  systemctl is-active --quiet "$unit" 2>/dev/null
}

stop_by_pattern() {
  local name="$1" pattern="$2"
  local pids
  pids="$(pgrep -f "$pattern" 2>/dev/null || true)"
  if [[ -z "$pids" ]]; then
    return 1
  fi
  echo "$pids" | while read -r pid; do
    [[ -z "$pid" ]] && continue
    kill "$pid" 2>/dev/null || true
  done
  sleep 1
  echo "$pids" | while read -r pid; do
    [[ -z "$pid" ]] && continue
    kill -0 "$pid" 2>/dev/null && kill -9 "$pid" 2>/dev/null || true
  done
  return 0
}

stop_by_port() {
  local name="$1" port_file="$2" default_port="$3"
  local port
  if [[ -f "$port_file" ]]; then
    port="$(cat "$port_file")"
  else
    port="$default_port"
  fi
  # kill only the process listening on the specific port
  local pid
  pid="$(ss -tlnp "sport = :${port}" 2>/dev/null | grep -oP 'pid=\K[0-9]+' | head -1)"
  if [[ -n "$pid" ]]; then
    kill "$pid" 2>/dev/null || true
    sleep 0.5
    kill -0 "$pid" 2>/dev/null && kill -9 "$pid" 2>/dev/null || true
  fi
}

stop_service() {
  local name="$1" pid_file="$2" pattern="$3" port_file="$4" default_port="$5" systemd_unit="$6"
  local stopped=false

  # If systemd manages this service, skip — user should use systemctl
  if systemd_active "$systemd_unit"; then
    echo "$name: managed by systemd ($systemd_unit) — use 'sudo systemctl stop $systemd_unit'"
    return 0
  fi

  # Try PID file first
  if [[ -f "$pid_file" ]]; then
    local pid
    pid="$(cat "$pid_file" 2>/dev/null || echo "")"
    if [[ -n "$pid" ]]; then
      if kill -0 "$pid" 2>/dev/null; then
        kill "$pid" 2>/dev/null || true
        sleep 1
        kill -0 "$pid" 2>/dev/null && kill -9 "$pid" 2>/dev/null || true
        stopped=true
      fi
    fi
    rm -f "$pid_file"
  fi

  # Fallback: kill by pattern
  if stop_by_pattern "$name" "$pattern"; then
    stopped=true
  fi

  # Fallback: kill by port
  if ! $stopped; then
    stop_by_port "$name" "$port_file" "$default_port"
    stopped=true
  fi

  if $stopped; then
    echo "$name: stopped"
  else
    echo "$name: not running"
  fi
}

stop_service "frontend" "$FRONTEND_PID_FILE" "$ROOT_DIR/frontend/node_modules/.bin/vite" "$FRONTEND_PORT_FILE" 5173 "$FRONTEND_SYSTEMD_UNIT"
stop_service "backend"  "$BACKEND_PID_FILE"  "$ROOT_DIR/backend/run.py"                       "$BACKEND_PORT_FILE"  38473 "$BACKEND_SYSTEMD_UNIT"
stop_service "opencode"  "$OPENCODE_PID_FILE"  "opencode serve"                                 "$OPENCODE_PORT_FILE"  40961 "$OPENCODE_SYSTEMD_UNIT"

rm -f "$OPENCODE_PORT_FILE" "$OPENCODE_URL_FILE" "$BACKEND_PORT_FILE" "$BACKEND_URL_FILE" "$FRONTEND_PORT_FILE" "$FRONTEND_URL_FILE"
