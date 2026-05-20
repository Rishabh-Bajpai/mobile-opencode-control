# OpenCode Web Controller

**Build full-stack apps from your phone. Work from anywhere.**

A mobile-first, Telegram-like web controller for local OpenCode sessions. No desktop required, no expensive API subscriptions — just connect to OpenCode's free models or any OpenAI-compatible endpoint and start coding from your phone.

- **Mobile-first** — Control your dev environment from phone or desktop
- **Voice-ready** — Built-in STT/TTS for hands-free coding
- **File explorer** — Browse, search, preview, and download project files directly in-chat
- **Git integration** — Full Git UI: init, status, branches, commit, push, pull
- **Autonomous agents** — Scheduled tasks and PRD-driven Ralph loops on autopilot
- **Approval flow** — Review and approve dangerous changes before execution
- **Question/answer** — Respond to multi-choice agent prompts inline
- **Real-time streaming** — Watch code being written as it happens via SSE
- **Multi-project** — Manage unlimited projects with instant switching
- **Notifications** — Push notifications via ntfy, browser notifications
- **Runtime control** — Switch models and agents per-project

## Screenshots

### Mobile Views

| Project List | Chat View | Files View | Menu |
|-------------|-----------|------------|------|
| ![Mobile Project List](docs/resources/screenshots/mobile-project-list.png) | ![Mobile Chat](docs/resources/screenshots/mobile-view.png) | ![Mobile Files](docs/resources/screenshots/mobile-files-view.png) | ![Mobile Menu](docs/resources/screenshots/mobile-menu-view.png) |

### Desktop Views

| Main Chat | File Explorer |
|----------|--------------|
| ![Desktop Chat](docs/resources/screenshots/desktop-view.png) | ![Desktop Files](docs/resources/screenshots/desktop-files-view.png) |

## Table of Contents

- [Stack](#stack)
- [Prerequisites](#prerequisites)
- [Setup](#setup)
- [One-command start/stop](#one-command-startstop)
- [Auto-start on Ubuntu (systemd)](#auto-start-on-ubuntu-systemd)
- [Reverse proxy and PWA](#reverse-proxy-and-pwa)
- [API Endpoints](#api-endpoints)
- [Voice modes](#voice-modes)
- [Git integration](#git-integration)
- [Scheduled tasks & Ralph loop](#scheduled-tasks--ralph-loop)
- [Notifications](#notifications)
- [FAQ / Notes](#faq--notes)

## Stack

- Frontend: React 18 + TypeScript + Vite
- Backend: Flask + SQLAlchemy
- Default DB: SQLite (`backend/data/app.db`)
- Host OS target: Linux

## Prerequisites

- Python 3.11+
- Node.js 20+
- npm
- `opencode` CLI available in `PATH`

> This project is host-native (Python + Node + systemd).

## Setup

Choose one of the following two setup paths:

### Option A: Interactive setup (recommended)

```bash
./scripts/setup.sh
```

The guided script handles everything: installs Python & Node dependencies, configures voice mode, sets the default project root, and optionally installs systemd autostart services. It can also install the OpenCode CLI if missing.

### Option B: Manual setup

1. Create and activate virtualenv:

```bash
python3 -m venv .venv
source .venv/bin/activate
```

2. Install dependencies:

```bash
pip install --upgrade pip
pip install -r backend/requirements.txt
npm --prefix frontend install
```

3. Prepare environment file:

```bash
cp .env.example .env
```

For local-only development, the defaults are enough.

If you plan to access the app through a reverse proxy or HTTPS hostname, update `.env` to allow both local development and your public host:

```env
FRONTEND_ORIGIN=http://localhost:5173
FRONTEND_ORIGINS=http://localhost:5173,https://your-domain.example
FRONTEND_ALLOWED_HOSTS=localhost,127.0.0.1,your-domain.example
OPENCODE_CORS_ORIGINS=http://localhost:5173,https://your-domain.example
```

Notes:
- `FRONTEND_ORIGINS` controls backend CORS allowlists.
- `FRONTEND_ALLOWED_HOSTS` controls Vite dev-server host allowlists.
- `OPENCODE_CORS_ORIGINS` controls allowed browser origins for the OpenCode server.
- Keep `http://localhost:5173` in the list if you still use local dev directly.

4. Start services (required order):

```bash
# Terminal 1
opencode serve --hostname 127.0.0.1 --port 4096 --cors http://localhost:5173

# Terminal 2
source .venv/bin/activate
python backend/run.py

# Terminal 3
npm --prefix frontend run dev
```

5. Open app:

- Frontend: `http://localhost:5173`
- Backend health: `http://localhost:8080/api/health`

## One-command start/stop

Use helper scripts for local development:

```bash
./scripts/start-app.sh
./scripts/stop-app.sh
```

`start-app.sh` starts:
- OpenCode server on an app-owned free localhost port
- Flask backend via `.venv/bin/python`
- Frontend dev server on `localhost:5173`

Runtime logs/metadata are written under `.runtime/`.

The helper scripts load `.env` automatically.

## Auto-start on Ubuntu (systemd)

Install the systemd stack:

```bash
sudo ./scripts/install-autostart-ubuntu.sh
```

If `opencode` is in a custom location:

```bash
sudo ./scripts/install-autostart-ubuntu.sh --opencode-bin "$(which opencode)"
```

Created units:

- `mobile-opencode-control-opencode.service`
- `mobile-opencode-control-backend.service`
- `mobile-opencode-control-frontend.service`
- `mobile-opencode-control.target`

Useful commands:

```bash
sudo systemctl status mobile-opencode-control.target
sudo journalctl -u mobile-opencode-control-opencode.service -f
sudo journalctl -u mobile-opencode-control-backend.service -f
sudo journalctl -u mobile-opencode-control-frontend.service -f
```

The systemd service launcher scripts also load `.env`, while preserving service-managed runtime values like the chosen localhost ports.

### Restart after code changes

```bash
# Restart full stack
sudo systemctl restart mobile-opencode-control.target

# Check overall status
sudo systemctl status mobile-opencode-control.target
```

If only one service changed, restart just that service:

```bash
sudo systemctl restart mobile-opencode-control-frontend.service
sudo systemctl restart mobile-opencode-control-backend.service
sudo systemctl restart mobile-opencode-control-opencode.service
```

If you edited unit files or re-ran installer script, reload systemd first:

```bash
sudo systemctl daemon-reload
sudo systemctl restart mobile-opencode-control.target
```

If frontend fails after dependency changes, reinstall deps and restart frontend:

```bash
npm --prefix frontend ci
sudo systemctl restart mobile-opencode-control-frontend.service
```

### Reverse proxy and PWA

If you want PWA install prompts on mobile browsers, serve the app over HTTPS from a trusted hostname. A plain LAN URL such as `http://192.168.x.x:5173` is usually not enough for install prompts.

Typical setup:

1. Run the app stack locally with the provided scripts or systemd units.
2. Put Nginx, Caddy, or another reverse proxy in front of the frontend dev server.
3. Terminate TLS at the proxy for a hostname such as `https://your-domain.example`.
4. Add that hostname to these `.env` values:

```env
FRONTEND_ORIGINS=http://localhost:5173,https://your-domain.example
FRONTEND_ALLOWED_HOSTS=localhost,127.0.0.1,your-domain.example
OPENCODE_CORS_ORIGINS=http://localhost:5173,https://your-domain.example
```

5. Restart the stack after editing `.env`:

```bash
sudo systemctl restart mobile-opencode-control.target
```

Uninstall:

```bash
sudo ./scripts/uninstall-autostart-ubuntu.sh
```

## API Endpoints

### Auth

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/auth/login` | Authenticate with password, sets session cookie |
| POST | `/api/auth/logout` | Clear session, log out |
| GET | `/api/auth/me` | Check if current session is authenticated |

### Runtime & Health

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | Basic health check (no auth required) |
| GET | `/api/lan-url` | Get LAN URL with detected local IP (no auth required) |
| GET | `/api/opencode/health` | Check OpenCode server health upstream |
| GET | `/api/opencode/commands` | List available OpenCode slash commands |

### Projects

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/projects` | List projects (paginated, searchable by name/path) |
| POST | `/api/projects` | Create a new project (creates directory + initial session) |
| POST | `/api/projects/sync` | Sync projects from OpenCode upstream server |
| POST | `/api/projects/:id/select` | Set a project as the active/selected project |
| GET | `/api/state` | Get global app state (active project ID, default project root) |

### Sessions

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/projects/:id/sessions` | List all OpenCode sessions for a project |
| POST | `/api/projects/:id/sessions` | Create a new OpenCode session |
| PUT | `/api/projects/:id/session` | Switch the active session |
| DELETE | `/api/projects/:id/sessions/:session_id` | Delete a session (removes project if last session) |
| POST | `/api/projects/:id/session/ensure` | Ensure a session exists (creates one if missing) |
| POST | `/api/projects/:id/abort` | Abort/stop active agent execution |

### Messages & Commands

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/projects/:id/messages` | Get messages and timeline events for a session |
| POST | `/api/projects/:id/messages` | Send a message to OpenCode |
| POST | `/api/projects/:id/commands` | Run an OpenCode slash command |
| GET | `/api/projects/:id/diff` | Get file diff for the current session |

### Real-time Streaming (SSE)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/projects/:id/stream` | SSE stream of session events (approvals, questions, progress) |
| GET | `/api/projects/events` | SSE stream of global OpenCode events across all projects |

### Approvals

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/projects/:id/approvals` | Get pending permission approval requests |
| POST | `/api/projects/:id/permissions/:permission_id` | Respond to a permission (approve/deny + remember) |

### Questions

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/projects/:id/questions` | Get pending questions from the agent |
| POST | `/api/projects/:id/questions/:request_id/reply` | Reply to a pending multi-choice question |
| POST | `/api/projects/:id/questions/:request_id/reject` | Reject/dismiss a pending question |

### Runtime (Models & Agents)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/projects/:id/runtime` | Get available models and agents for a project |
| PUT | `/api/projects/:id/runtime` | Update selected model/agent for a project |

### Files

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/projects/:id/files/tree` | Get full file tree (flat list with depth) |
| GET | `/api/projects/:id/files/list` | List directory contents |
| GET | `/api/projects/:id/files/content` | Read/preview file content (up to 512KB) |
| GET | `/api/projects/:id/files/download` | Download a single file |
| GET | `/api/projects/:id/files/archive` | Download entire project as ZIP archive |

### Git

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/projects/:id/git/init` | Initialize a new git repo |
| GET | `/api/projects/:id/git/status` | Get git status (branch, changes, staged, untracked, ahead/behind) |
| GET | `/api/projects/:id/git/branches` | List local and remote branches |
| POST | `/api/projects/:id/git/branches/checkout` | Checkout a branch |
| POST | `/api/projects/:id/git/branches/create` | Create a new branch |
| POST | `/api/projects/:id/git/branches/track` | Track a remote branch locally |
| GET | `/api/projects/:id/git/history` | Get commit history (paginated) |
| POST | `/api/projects/:id/git/stage` | Stage all changes |
| POST | `/api/projects/:id/git/commit` | Commit staged changes |
| POST | `/api/projects/:id/git/push` | Push to remote |
| POST | `/api/projects/:id/git/pull` | Pull from remote |
| POST | `/api/projects/:id/git/remote` | Add or update a git remote |

### Scheduled Tasks

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/scheduler/status` | Get task scheduler status (running, active runs, poll interval) |
| GET | `/api/projects/:id/task` | Get the primary scheduled task with runs and metrics |
| PUT | `/api/projects/:id/task` | Create or update a scheduled task |
| DELETE | `/api/projects/:id/task` | Delete a scheduled task |
| POST | `/api/projects/:id/task/run` | Trigger a task to run immediately |
| GET | `/api/projects/:id/task/runs` | List task run history |
| GET | `/api/projects/:id/tasks` | List all scheduled tasks |
| POST | `/api/projects/:id/tasks/:task_id/pause` | Pause a scheduled task |
| POST | `/api/projects/:id/tasks/:task_id/resume` | Resume a paused task |
| POST | `/api/projects/:id/tasks/preview` | Preview next N scheduled run times |

### PRD (Product Requirements Document)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/projects/:id/prd` | Read the project's `prd.json` file |
| PUT | `/api/projects/:id/prd` | Create or update the project's `prd.json` file |

### Voice (STT/TTS)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/voice/health` | Check voice provider configuration |
| POST | `/api/stt/transcribe` | Transcribe uploaded audio to text |
| POST | `/api/tts/speak` | Synthesize text to speech audio |

### Notifications

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/notifications/settings` | Get notification channel settings |
| PUT | `/api/notifications/settings` | Update notification channel and ntfy topic URL |
| POST | `/api/notifications/ntfy/test` | Send a test ntfy notification |
| POST | `/api/notifications/ntfy/send` | Send an arbitrary ntfy notification |

## Voice modes

Voice is controlled by `.env`:

- `VOICE_PROVIDER_MODE=builtin`: uses built-in CPU voice (`faster-whisper` + Coqui TTS)
- `VOICE_PROVIDER_MODE=external`: uses OpenAI-compatible `STT_BASE_URL` / `TTS_BASE_URL`
- `VOICE_PROVIDER_MODE=auto`: uses external endpoints if configured, otherwise built-in

Built-in defaults are CPU-first:

- `BUILTIN_STT_DEVICE=cpu`
- `BUILTIN_STT_COMPUTE_TYPE=int8`

The frontend includes a microphone button for voice input (records audio via `MediaRecorder`, sends to `/api/stt/transcribe`) and a speaker button to play agent responses via TTS.

## Git integration

The app includes a full Git UI accessible from the project header. Features:

- **Initialize** a new git repository in any project directory
- **Status** view showing modified, staged, and untracked files with branch info and ahead/behind counts
- **Branch management** — list, create, checkout, and track remote branches
- **Stage & commit** — stage all changes and commit with a message
- **Remote management** — add or update remote URL via the UI
- **Push/Pull** — synchronize with remote repositories
- **History** — paginated commit history with hash, author, message, and timestamp

All Git operations are performed server-side using GitPython.

## Scheduled tasks & Ralph loop

### Task types

The scheduler supports four task types:

| Type | Description |
|------|-------------|
| `interval` | Run every N minutes (min 5) |
| `cron` | Run on a cron schedule (standard 5-field syntax) |
| `once` | Run once at a specific date/time |
| `goal` | Run repeatedly until a goal is met (Ralph loop) |

### Task features

- **Retry** — configurable retry count with backoff minutes
- **Time window** — optional start/end datetime range
- **Max runs** — limit total executions
- **Heartbeat** — periodic check-in during long runs
- **Notification** — ntfy push on task completion/failure
- **Persistent session** — optionally reuse the same OpenCode session across runs
- **Run metrics** — success rate, average runtime, last 10 outcomes
- **Run pruning** — old runs are automatically cleaned up (configurable retention)

### Ralph Loop

The Ralph Loop is a PRD-driven autonomous agent loop accessed via the **Tasks** tab:

1. Open the **Tasks** tab for any project.
2. The **Ralph Loop** sidebar card shows the current `prd.json` status.
3. Click **Init PRD** to scaffold a starter `prd.json` in the project root.
4. Edit `prd.json` to describe your user stories.
5. Click **Create Ralph Task** to pre-fill a goal-type scheduled task.
6. Save and enable the task — it runs OpenCode repeatedly until all stories have `passes: true`.

### PRD format

```json
{
  "project": "My App",
  "branchName": "ralph/feature-name",
  "description": "What this PRD covers",
  "userStories": [
    {
      "id": "US-001",
      "title": "Story title",
      "description": "As a user I want ...",
      "acceptanceCriteria": ["Criterion 1"],
      "priority": 1,
      "passes": false,
      "notes": ""
    }
  ]
}
```

## Notifications

Two notification channels:

- **Browser** — Uses the `Notification` API for agent replies and task completion (requires user permission)
- **ntfy** — Push notifications via a self-hosted or public ntfy topic URL

Configure in **Settings** → **Notifications** or via the toolbar notification controls.

## FAQ / Notes

- Frontend dev server proxies `/api` to `http://localhost:8080`.
- To use PostgreSQL, set `DATABASE_URL` in `.env`.
- `.env`, `.runtime`, local screenshots, and test captures are ignored by default.
- Refresh the page if you see stale connection or host-allow errors after a config change.

## Roadmap

**Shipping now (v0.1.x)** — Core chat, streaming, voice, file browser, Git, scheduled tasks, Ralph loop, notifications.

**Coming soon:**
- PWA installability for offline use
- Windows native support (PowerShell scripts)
- Sidebar resizing for desktop
- Performance optimizations for 1000+ projects
- Containerized deployment (Docker/Compose)

**Planned:**
- Plugin/extension system
- Team collaboration features
- Cloud deployment options
