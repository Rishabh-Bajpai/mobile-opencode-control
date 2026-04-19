# OpenCode Web Controller - Implementation Tasks

This plan follows `PDR.md` and is designed as milestone gates.
Do not start the next milestone until the current milestone is fully validated.

## Delivery Rules

- Every milestone must ship a functionally complete vertical slice.
- Every milestone must pass its validation checklist before moving forward.
- Keep commits small and aligned to subtasks.
- Keep Linux as the only supported host OS.
- Follow Telegram-like UI fidelity patterns from the referenced series where compatible with PRD scope.
- Do not add out-of-scope features (multi-user chat, group chat, video/audio calling).

---

## Current Bugfix Plan - Chat UX Stability

Goal: fix session loading latency, message expansion stability, scroll anchoring during live updates, and background final-message notifications.

### Tasks

- [ ] Reduce chat hydration latency by prioritizing message history and deferring secondary loads where possible.
- [ ] Stop full chat reloads on every SSE event and replace them with lighter incremental refresh behavior.
- [ ] Add a dedicated initial pending-approvals fetch path so approvals are present when reopening a chat.
- [ ] Make activity card expansion state fully controlled and independent from new incoming messages.
- [ ] Make nested part and submessage expansion state stable across rerenders and live inserts.
- [ ] Reset all message/activity toggles to closed when opening a chat, without auto-opening the latest activity.
- [ ] Preserve viewport position when the user is reading older content and new messages/activity arrive.
- [ ] Keep unread tracking independent from forced viewport jumps.
- [ ] Add browser notifications for new final agent messages when the tab is backgrounded.
- [ ] Verify the full flow on desktop and mobile-sized layouts using the local dev scripts.

---

## Milestone 0 - Project Bootstrap and Environment (Gate 0)

Goal: create a reproducible local dev environment and project skeleton.

### Tasks

- [x] Create repository structure:
  - [x] `backend/` (Flask API gateway)
  - [x] `frontend/` (PWA client)
  - [x] `infra/` (Docker Compose and deployment files)
  - [x] `docs/` (runbooks, API notes)
- [ ] Create Python virtual environment for backend and enforce usage:
  - [x] Create venv: `python3 -m venv .venv`
  - [x] Activate venv (Linux): `source .venv/bin/activate`
  - [x] Add `.venv` to `.gitignore`
  - [x] Add `backend/requirements.txt` (or `pyproject.toml`) pinned dependencies
  - [ ] Add `Makefile` targets (`venv`, `install`, `run-backend`, `test-backend`)
- [x] Initialize frontend app scaffold (React or Vue as selected during implementation)
- [x] Add shared `.env.example` with required variables (app auth, OpenCode URL, STT/TTS)
- [ ] Add baseline linting/formatting/test commands for backend and frontend

### Validation (must pass)

- [ ] Fresh clone setup works on Linux with documented steps only.
- [ ] Running setup creates and uses `.venv` successfully.
- [x] Backend starts from venv and responds on health endpoint.
- [x] Frontend dev server starts and reaches placeholder home screen.

---

## Milestone 1 - Backend Foundation + OpenCode Connectivity (Gate 1)

Goal: backend can securely talk to OpenCode server and expose stable app APIs.

### Tasks

- [x] Implement backend configuration loader (env-driven, typed, validated)
- [x] Implement single-password login/session cookie auth for app routes
- [x] Implement OpenCode upstream client wrapper:
  - [x] Base URL and timeout handling
  - [x] Optional basic auth pass-through for `OPENCODE_SERVER_USERNAME/PASSWORD`
  - [ ] Standardized error mapping and retries where safe
- [ ] Implement app endpoints:
  - [ ] `GET /api/health` (app + upstream health summary)
  - [x] `GET /api/projects` (from app DB, with recency sorting)
  - [x] `POST /api/projects` (register project folder)
  - [x] `GET /api/opencode/health` -> upstream `/global/health`
  - [x] Adapter endpoints for session/message/command operations
- [ ] Persist foundational entities in DB:
  - [x] projects
  - [ ] interactive_session_mapping (one per project)
  - [x] app_settings (last selected project/session)

### Validation (must pass)

- [x] Login required for protected APIs.
- [x] `GET /api/opencode/health` returns upstream status when server is up.
- [x] A project can be created/listed and remains after restart.
- [x] Last selected project/session persists across backend restart.

---

## Milestone 2 - Core Chat Flow (Single Project, Single Session) (Gate 2)

Goal: complete prompt-response loop for one project with stored history.

### Tasks

- [ ] Implement/create interactive session rule (exactly one per project)
- [x] Implement send prompt flow to OpenCode session endpoint
- [x] Implement fetch/paginate message history from persistence
- [x] Persist normalized timeline events and rendered messages
- [ ] Implement command execution endpoints (at least `/models`, `/agent`, `/clear` mapping)
- [x] Implement stop action (`abort`) support
- [ ] Frontend chat view:
  - [x] project list + active chat pane
  - [x] message composer
  - [x] slash command menu
  - [x] markdown + code rendering
  - [x] sticky chat header (`56px` target rhythm)
  - [x] empty chat state component
  - [x] sticky date separator component
  - [x] mobile back navigation from active chat to project list

### Validation (must pass)

- [x] User can create/select a project and send prompts successfully.
- [x] Reloading the app restores same project and conversation history.
- [x] Slash commands are invokable from UI and affect active session.
- [x] Abort action stops running generation.
- [ ] Header/composer/list proportions feel Telegram-like on both mobile and desktop.

---

## Milestone 3 - Real-Time Streaming + Intermediate Steps UX (Gate 3)

Goal: production-grade streaming with clear separation of thinking/steps/output.

### Tasks

- [x] Implement SSE subscription to OpenCode `/event`
- [x] Implement reconnect strategy with exponential backoff and jitter
- [x] Implement stream lifecycle controls (cancel stale listeners on project switch)
- [ ] Implement backend event queue + throttled fanout to frontend sockets
- [ ] Implement UI message types:
  - [ ] final response
  - [ ] intermediate steps/progress
  - [ ] tool output blocks
  - [ ] error traces
- [x] Implement collapsible blocks for long content and file changes
- [ ] Implement diff metadata summary row (path/type/size estimate)
- [x] Implement smart auto-scroll strategy:
  - [x] if unread marker exists, scroll to unread boundary
  - [x] otherwise keep viewport near latest message during active stream
- [x] Implement message bubble grouping states (single/top/middle/bottom)

### Validation (must pass)

- [ ] Streaming updates appear live with no major layout jumps on mobile.
- [ ] After temporary network drop, stream reconnects and context is restored.
- [ ] Long logs/diffs are collapsible and readable.
- [ ] Thinking/intermediate/tool output is visibly distinct from final answer.
- [ ] Message grouping and metadata rows are stable while new chunks stream in.

---

## Milestone 4 - Approval Flow and Interaction Locks (Gate 4)

Goal: approval prompts are safely handled with binary actions.

### Tasks

- [x] Detect and persist permission request events from OpenCode
- [x] Build approval UI component (Approve / Deny only)
- [x] Wire decision API to `/session/:id/permissions/:permissionID`
- [x] Lock or constrain free text input when approval response is required
- [x] Persist approval decisions with timestamps in timeline

### Validation (must pass)

- [x] Any OpenCode permission prompt appears as binary UI controls.
- [x] Approve and deny both work end-to-end.
- [x] Approval decisions are visible in historical timeline.
- [x] Input cannot accidentally bypass pending approval state.

---

## Milestone 5 - Multi-Project Scale + Session Governance (Gate 5)

Goal: support target scale and strict project/session rules.

### Tasks

- [ ] Enforce one interactive session per project invariant at API level
- [x] Implement project list virtualization for large datasets
- [x] Implement recent activity sorting and quick switching
- [ ] Ensure up to 10 concurrent running project sessions are stable
- [ ] Ensure up to 1000 stored project chats remain performant

### Validation (must pass)

- [ ] 1000 projects can be loaded and navigated with acceptable UI responsiveness.
- [ ] 10 active sessions can run concurrently without crashes.
- [ ] Session mapping remains correct under rapid project switching.

---

## Milestone 6 - Scheduled Task Engine (One Task Per Project) (Gate 6)

Goal: each project has one robust scheduled task run in dedicated task sessions.

### Tasks

- [x] Build server-side scheduler service (browser-independent runtime)
- [x] Add task model and storage (one task max per project)
- [x] Implement schedule parser/validator and minimum interval rule (>= 5 min)
- [ ] Implement task execution pipeline:
  - [x] create dedicated task session
  - [x] auto-read `heartbeat_instruction.md`
  - [x] execute scheduled instruction
  - [x] persist output/status/errors
  - [ ] cleanup temporary session per policy
- [x] Add task management UI in project settings/chat header
- [x] Handle restart recovery (interrupted runs marked clearly and rescheduled safely)

### Validation (must pass)

- [x] A scheduled task executes at expected time without browser open.
- [x] `heartbeat_instruction.md` is read before task instruction.
- [x] Task run logs/results are visible in timeline/history.
- [x] Attempting to add second task for a project is rejected.

---

## Milestone 7 - STT/TTS Integration (Gate 7)

Goal: voice input/output works without disrupting text workflow.

### Tasks

- [x] Backend STT endpoint: `POST /api/stt/transcribe`
- [x] Backend TTS endpoint: `POST /api/tts/speak`
- [ ] Wire provider config:
  - [x] `STT_BASE_URL`, `STT_MODEL`, `STT_API_KEY`
  - [x] `TTS_BASE_URL`, `TTS_MODEL`, `TTS_VOICE`, `TTS_API_KEY`
- [x] Frontend mic recorder + upload + transcript insertion flow
- [x] Frontend TTS playback controls per assistant message
- [x] Graceful fallback if STT/TTS fails (text chat always works)

### Validation (must pass)

- [x] Voice recording transcribes and inserts editable text.
- [x] TTS plays assistant responses.
- [x] STT/TTS failures do not break prompt/response text flow.

---

## Milestone 8 - PWA, Mobile Polish, and Production Hardening (Gate 8)

Goal: installable Telegram-like PWA that is stable for daily use.

### Tasks

- [ ] Add web manifest + service worker + install prompt
- [x] Implement responsive shell for mobile and desktop parity
- [ ] Implement Telegram-like sidebar ergonomics:
  - [ ] persisted width in local storage
  - [ ] resize handle on desktop
  - [ ] safe min/max width constraints per viewport
- [ ] Optimize message rendering performance and memory usage
- [ ] Add structured logging and error boundaries
- [ ] Add backup/export utility for DB data
- [ ] Finalize Docker Compose for backend + frontend + DB
- [ ] Add operator docs:
  - [x] install/runbook
  - [x] env setup
  - [ ] troubleshooting guide

### Validation (must pass)

- [ ] App is installable as PWA on mobile and desktop browsers.
- [ ] Core flows work on mobile screen sizes without UX breakage.
- [ ] Full restart/redeploy retains data and returns to last active project.
- [ ] End-to-end smoke test passes for: login, prompt, stream, approval, schedule, STT, TTS.
- [ ] Sidebar resizing and persisted width work correctly on desktop.

---

---

## Milestone 9 - Windows Support (Gate 9)

Goal: app runs natively on Windows 10/11 (non-WSL).

### Tasks

- [ ] Create Windows-compatible setup scripts in PowerShell:
  - [ ] Create `scripts/setup.ps1` (interactive setup)
  - [ ] Create `scripts/start-app.ps1` (starts all services)
  - [ ] Create `scripts/stop-app.ps1` (stops all services)
- [ ] Create Windows venv helper:
  - [ ] Detect Python on Windows (`python` or `py` launcher)
  - [ ] Use `Scripts\python.exe` path convention
  - [ ] Handle spaces in project root path
- [ ] Create Windows Task Scheduler integration:
  - [ ] Create `scripts/install-autostart-windows.ps1`
  - [ ] Generate Task Scheduler XML for auto-start
  - [ ] Handle Windows service startup at login
- [ ] Ensure backend works on Windows:
  - [ ] Test Flask starts on Windows port binding
  - [ ] Test SQLite path handling (backslashes)
  - [ ] Test faster-whisper + TTS on Windows (PyTorch + Coqui)
- [ ] Ensure frontend works on Windows:
  - [ ] Test npm start on Windows
  - [ ] Test Vite dev server on Windows
- [ ] Add Windows troubleshooting docs:
  - [ ] common errors and fixes
  - [ ] Python/Node installation guidance
  - [ ] Port conflict resolution

### Validation (must pass)

- [ ] Setup script runs on Windows PowerShell 5.1+.
- [ ] All three services start without errors on Windows.
- [ ] Frontend loads at localhost:5173.
- [ ] Backend health check passes.
- [ ] Stop script cleanly shuts down all services.

---

## Final Release Checklist

- [ ] All milestone gates passed in sequence.
- [ ] No open blocker bugs in core flows.
- [ ] Security review completed for single-user password/session model.
- [ ] Performance targets from `PDR.md` measured and documented.
- [ ] Release tag created with deployment instructions.
