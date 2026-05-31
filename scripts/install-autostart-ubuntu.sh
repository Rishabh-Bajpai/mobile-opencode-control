#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ "$(uname -s)" != "Linux" ]]; then
  echo "This installer is intended for Ubuntu/Linux with systemd."
  exit 1
fi

if ! command -v systemctl >/dev/null 2>&1; then
  echo "systemctl is required but not found."
  exit 1
fi

if [[ "$EUID" -ne 0 ]]; then
  echo "Run this script with sudo:"
  echo "  sudo ./scripts/install-autostart-ubuntu.sh"
  exit 1
fi

APP_USER="${SUDO_USER:-$USER}"
OPENCODE_BIN_OVERRIDE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --user)
      if [[ -z "${2:-}" ]]; then
        echo "Missing username. Example: sudo ./scripts/install-autostart-ubuntu.sh --user <username>"
        exit 1
      fi
      APP_USER="$2"
      shift 2
      ;;
    --opencode-bin)
      if [[ -z "${2:-}" ]]; then
        echo "Missing executable path. Example: sudo ./scripts/install-autostart-ubuntu.sh --opencode-bin /usr/local/bin/opencode"
        exit 1
      fi
      OPENCODE_BIN_OVERRIDE="$2"
      shift 2
      ;;
    *)
      echo "Unknown option: $1"
      echo "Supported options: --user <name> --opencode-bin <absolute-path>"
      exit 1
      ;;
  esac
done

if ! id "$APP_USER" >/dev/null 2>&1; then
  echo "User '$APP_USER' does not exist on this machine."
  exit 1
fi

APP_HOME="$(getent passwd "$APP_USER" | cut -d: -f6)"
if [[ -z "$APP_HOME" || ! -d "$APP_HOME" ]]; then
  echo "Unable to determine home directory for user '$APP_USER'."
  exit 1
fi

if [[ ! -x "$ROOT_DIR/.venv/bin/python" ]]; then
  echo "Python virtual environment not found at: $ROOT_DIR/.venv"
  echo "Run: python3 -m venv .venv && source .venv/bin/activate && pip install -r backend/requirements.txt"
  exit 1
fi

resolve_opencode_bin() {
  if [[ -n "$OPENCODE_BIN_OVERRIDE" ]]; then
    printf '%s\n' "$OPENCODE_BIN_OVERRIDE"
    return
  fi

  local candidate
  candidate="$(sudo -u "$APP_USER" -H bash -lc 'command -v opencode || true')"
  if [[ -n "$candidate" ]]; then
    printf '%s\n' "$candidate"
    return
  fi

  for candidate in \
    "$APP_HOME/.opencode/bin/opencode" \
    "$APP_HOME/.local/bin/opencode" \
    "/usr/local/bin/opencode" \
    "/usr/bin/opencode"; do
    if [[ -x "$candidate" ]]; then
      printf '%s\n' "$candidate"
      return
    fi
  done

  printf '\n'
}

OPENCODE_BIN="$(resolve_opencode_bin)"
if [[ -z "$OPENCODE_BIN" || ! -x "$OPENCODE_BIN" ]]; then
  echo "opencode CLI executable could not be resolved for user '$APP_USER'."
  echo "Re-run with an explicit binary path, for example:"
  echo "  sudo ./scripts/install-autostart-ubuntu.sh --opencode-bin /absolute/path/to/opencode"
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required but not found. Install Node.js + npm first."
  exit 1
fi

mkdir -p "$ROOT_DIR/.runtime"
echo "$OPENCODE_BIN" >"$ROOT_DIR/.runtime/opencode.bin"

OPENCODE_PORT="${OPENCODE_APP_PORT:-40961}"
BACKEND_PORT="${BACKEND_PORT:-38473}"
FRONTEND_PORT="${FRONTEND_APP_PORT:-5173}"
SERVICE_PREFIX="mobile-opencode-control"
SYSTEMD_DIR="/etc/systemd/system"

COMMON_ENV_PATH="PATH=$APP_HOME/.local/bin:/usr/local/bin:/usr/bin:/bin"

cat >"$SYSTEMD_DIR/${SERVICE_PREFIX}-opencode.service" <<EOF
[Unit]
Description=Mobile OpenCode Control - OpenCode Server
After=network-online.target
Wants=network-online.target
PartOf=${SERVICE_PREFIX}.target

[Service]
Type=simple
User=$APP_USER
WorkingDirectory=$ROOT_DIR
Environment=$COMMON_ENV_PATH
Environment=OPENCODE_BIN=$OPENCODE_BIN
Environment=OPENCODE_APP_PORT=$OPENCODE_PORT
Environment=FRONTEND_APP_PORT=$FRONTEND_PORT
ExecStart=$ROOT_DIR/scripts/run-opencode-service.sh
Restart=always
RestartSec=2

[Install]
WantedBy=${SERVICE_PREFIX}.target
EOF

cat >"$SYSTEMD_DIR/${SERVICE_PREFIX}-backend.service" <<EOF
[Unit]
Description=Mobile OpenCode Control - Backend
After=${SERVICE_PREFIX}-opencode.service
Requires=${SERVICE_PREFIX}-opencode.service
PartOf=${SERVICE_PREFIX}.target

[Service]
Type=simple
User=$APP_USER
WorkingDirectory=$ROOT_DIR
Environment=$COMMON_ENV_PATH
Environment=OPENCODE_APP_PORT=$OPENCODE_PORT
Environment=BACKEND_PORT=$BACKEND_PORT
Environment=OPENCODE_BASE_URL=http://127.0.0.1:$OPENCODE_PORT
ExecStart=$ROOT_DIR/scripts/run-backend-service.sh
Restart=always
RestartSec=2

[Install]
WantedBy=${SERVICE_PREFIX}.target
EOF

cat >"$SYSTEMD_DIR/${SERVICE_PREFIX}-frontend.service" <<EOF
[Unit]
Description=Mobile OpenCode Control - Frontend
After=${SERVICE_PREFIX}-backend.service
Requires=${SERVICE_PREFIX}-backend.service
PartOf=${SERVICE_PREFIX}.target

[Service]
Type=simple
User=$APP_USER
WorkingDirectory=$ROOT_DIR
Environment=$COMMON_ENV_PATH
Environment=BACKEND_PORT=$BACKEND_PORT
Environment=FRONTEND_APP_PORT=$FRONTEND_PORT
ExecStart=$ROOT_DIR/scripts/run-frontend-service.sh
Restart=always
RestartSec=2

[Install]
WantedBy=${SERVICE_PREFIX}.target
EOF

cat >"$SYSTEMD_DIR/${SERVICE_PREFIX}.target" <<EOF
[Unit]
Description=Mobile OpenCode Control stack
Wants=${SERVICE_PREFIX}-opencode.service ${SERVICE_PREFIX}-backend.service ${SERVICE_PREFIX}-frontend.service
After=network-online.target

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable "${SERVICE_PREFIX}.target"
systemctl restart "${SERVICE_PREFIX}.target"

echo "Installed and started systemd services."
echo "- Target: ${SERVICE_PREFIX}.target"
echo "- OpenCode: http://127.0.0.1:${OPENCODE_PORT}/global/health"
echo "- Backend:  http://127.0.0.1:${BACKEND_PORT}/api/health"
echo "- Frontend: http://127.0.0.1:${FRONTEND_PORT}"
echo ""
echo "Useful commands:"
echo "  sudo systemctl status ${SERVICE_PREFIX}.target"
echo "  sudo journalctl -u ${SERVICE_PREFIX}-opencode.service -f"
echo "  sudo journalctl -u ${SERVICE_PREFIX}-backend.service -f"
echo "  sudo journalctl -u ${SERVICE_PREFIX}-frontend.service -f"
