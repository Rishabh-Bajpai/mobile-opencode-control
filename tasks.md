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
- [x] Stop full chat reloads on every SSE event and replace them with lighter incremental refresh behavior.
- [ ] Add a dedicated initial pending-approvals fetch path so approvals are present when reopening a chat.
- [ ] Make activity card expansion state fully controlled and independent from new incoming messages.
- [ ] Make nested part and submessage expansion state stable across rerenders and live inserts.
- [ ] Reset all message/activity toggles to closed when opening a chat, without auto-opening the latest activity.
- [ ] Preserve viewport position when the user is reading older content and new messages/activity arrive.
- [ ] Keep unread tracking independent from forced viewport jumps.
- [ ] Add browser notifications for new final agent messages when the tab is backgrounded.
- [x] Refresh the session list in the background so sessions created outside the app appear without switching projects.
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

- [x] Add web manifest + service worker + install prompt
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
  - [x] troubleshooting guide

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

---

## Milestone 10 - Redesigned Task Scheduling System (Gate 10)

Goal: transform task scheduling from a simple interval-based runner into a flexible agent-style task system supporting interval/cron/one-time/goal-based tasks with full configurability.

### Current State (issues to fix)

The existing implementation (`backend/app/scheduler.py`, `models.py:ScheduledTask`, `routes.py:1687-1816`) has these problems:

**Configuration & Input**
- No model/agent selection — tasks always use OpenCode default (`scheduler.py:284,293`)
- No timezone support — `next_run_at` is UTC-only; tasks fire at wrong wall-clock times
- No task name/title — tasks are anonymous
- No description/notes field

**Scheduling Logic**
- Interval-only scheduling — no cron, no specific time-of-day triggers
- No end/expiration date (`ends_at`)
- No max run count limit
- No "run once" one-time task
- No pause/resume (only enable/disable)
- 20s poll granularity is imprecise
- No concurrency limit — all due tasks fire simultaneously
- No skip/miss detection when scheduler is down

**Task Scope & Multiplicity**
- One task per project only (`unique=True` on `project_id`)
- No task groups
- Tasks require a project directory — no standalone tasks

**Objective-Based / Goal-Oriented Tasks**
- No stop condition evaluation — tasks fire on interval regardless of goal state
- No result-checking loop — can't evaluate "is goal met?"
- No auto-injected stop prompt
- Sessions are throwaway — no persistent context across runs for goal-tracking
- No task completion criteria — agent reports done but system doesn't evaluate

**Error Handling & Resilience**
- No retry policy — one failure = task marked failed
- Permission prompts block tasks with no timeout/escalation
- Hard dependency on `heartbeat_instruction.md` — can't disable
- No task-level timeout — runaway agent hangs indefinitely
- No notifications on failure

**Visibility & Observability**
- Output preview truncated to 1200 chars
- No full run logs (tool calls, file changes)
- No task metrics (success rate, avg runtime)

**UI/UX**
- Interval-only input — no cron builder, no date/time picker for one-time tasks
- No "next run" preview given current settings
- No "view in OpenCode" link for run sessions

### New Data Models

**Task types (mutually exclusive):**
- `interval` — run every N minutes (improved version of current)
- `cron` — run based on cron expression (e.g. `0 8 * * 1-5`)
- `once` — run exactly once at a specific datetime
- `goal` — keep running until an objective condition is met

**New ScheduledTask fields:**
- `name` (string) — human-readable task name
- `description` (text, nullable) — optional notes
- `task_type` (string) — `interval` | `cron` | `once` | `goal`
- `cron_expression` (string, nullable) — for cron type tasks
- `once_run_at` (datetime, nullable) — for once type tasks
- `interval_minutes` (int) — for interval type tasks
- `timezone` (string) — e.g. `America/New_York`
- `model` (string, nullable) — per-task model override
- `agent` (string, nullable) — per-task agent override
- `enabled` (bool) — pause/resume
- `starts_at` (datetime, nullable) — task becomes active at this time
- `ends_at` (datetime, nullable) — task expires at this time
- `max_runs` (int, nullable) — stop after N runs (0 = unlimited)
- `run_timeout_minutes` (int, nullable) — max runtime per run
- `heartbeat_enabled` (bool) — whether to read `heartbeat_instruction.md`
- `goal_definition` (text, nullable) — natural language objective (e.g. "Monitor NVDA stock. When price > $250, send email to me@example.com")
- `goal_check_expression` (text, nullable) — programmatic stop condition (e.g. `stock_price > 250`)
- `goal_check_script` (text, nullable) — executable script to evaluate condition
- `notification_email` (string, nullable) — email to notify on completion/failure
- `auto_disable_on_goal_met` (bool) — disable task when goal achieved
- `retry_count` (int) — number of retries on failure
- `retry_backoff_minutes` (int) — backoff multiplier between retries
- `created_at`, `updated_at`
- `next_run_at`, `last_run_at`, `last_status`, `last_error`
- `total_runs` (int) — running count of executions
- `runs` (relationship to ScheduledTaskRun)

**New ScheduledTaskRun fields:**
- `run_number` (int) — sequential run number for this task
- `model_used` (string, nullable) — actual model used
- `agent_used` (string, nullable) — actual agent used
- `timeout_used` (int, nullable) — timeout that was applied
- `heartbeat_used` (bool) — whether heartbeat was loaded
- `goal_attempted` (bool) — whether goal evaluation ran
- `goal_met` (bool, nullable) — whether goal was met this run
- `goal_output` (text, nullable) — output of goal check
- `retry_attempt` (int) — which retry attempt this is
- Standard fields: id, task_id, project_id, status, session_id, trigger, started_at, finished_at, output_preview, error

### Backend Tasks

- [x] Add new fields to `ScheduledTask` and `ScheduledTaskRun` models
- [x] Update `ScheduledTask` with `unique=False` on `project_id` (allow multiple per project)
- [x] Implement cron expression parser (or use `croniter` library)
- [x] Implement timezone-aware datetime handling throughout scheduler
- [x] Implement all four task types in scheduler:
  - [x] interval: existing behavior, improved with new fields
  - [x] cron: evaluate cron expression, calculate next_run_at
  - [x] once: set enabled=False after first run
  - [x] goal: evaluate condition after each run, decide stop/continue
- [x] Implement model + agent selection per task in `send_message()`
- [ ] Implement task-level timeout (kill session if exceeded)
- [x] Implement heartbeat as optional (configurable flag)
- [x] Implement retry policy with exponential backoff
- [x] Implement concurrency limit (max N concurrent task sessions)
- [x] Implement auto-injected "stop when done" completion prompt
- [x] Implement goal condition evaluator (agent judgment; arbitrary script/expression execution deferred)
- [x] Implement `pause`/`resume` API (preserves next_run_at state)
- [x] Implement `max_runs` enforcement (disable task after N runs)
- [x] Implement `ends_at` enforcement (disable task after date)
- [x] Update scheduler status endpoint with concurrency stats
- [x] Update task CRUD routes for all new fields
- [x] Add task validation (e.g. cron expression syntax check)
- [x] Update `recover_interrupted_runs()` for all new task types
- [ ] Add "view session in OpenCode" URL to task run response
- [x] Add basic metrics to task detail/run responses: success rate, avg runtime, last N outcomes per task
- [x] Add optional ntfy-compatible HTTP notification URL support

### Frontend Tasks

- [x] Update `ScheduledTask` and `ScheduledTaskRun` TypeScript types
- [x] Add task type selector UI (interval / cron / once / goal)
- [x] Add model + agent picker per task
- [x] Add timezone selector
- [ ] Add start date + end date pickers
- [x] Add max runs input
- [x] Add run timeout input
- [x] Add heartbeat toggle
- [x] Add goal definition textarea
- [ ] Add goal check script editor (deferred; arbitrary script execution not implemented in MVP)
- [x] Add notification URL field (ntfy-compatible HTTP notification)
- [ ] Add notification email field
- [x] Add cron expression builder UI (or raw input with preview)
- [x] Add "next 5 run times" preview given current settings
- [x] Add "pause task" / "resume task" buttons
- [ ] Add "view in OpenCode" link button for run sessions
- [ ] Add task metrics display (success rate, trends)
- [ ] Improve run history UI:
  - [x] Show run number, model used, goal met status
  - [ ] Pagination with time range filter
  - [ ] Full output expansion
- [x] Add task name + description fields to task form
- [x] Add multiple tasks list view per project
- [ ] Add task group/organization (future-proof)

### Validation (must pass)

- [ ] User can create multiple tasks for the same project.
- [ ] Interval tasks fire at correct wall-clock times across timezones.
- [ ] Cron tasks fire at correct times based on cron expression.
- [ ] One-time tasks fire exactly once and then disable themselves.
- [ ] Goal tasks keep running until condition is met, then auto-stop.
- [ ] User can select a custom model per task.
- [ ] User can select a custom agent per task.
- [ ] Tasks can be paused and resumed without losing their next-run time.
- [ ] Tasks respect start date, end date, and max runs limits.
- [ ] Failed tasks retry with configured backoff.
- [ ] Tasks timeout after configured duration.
- [ ] `heartbeat_instruction.md` is optional per task.
- [ ] Run history shows full output, model used, and goal status.
- [ ] "View in OpenCode" button links to the correct session.
- [ ] Task metrics (success rate, avg runtime) are visible.
- [ ] One-time tasks: schedule for a specific datetime and never run again.

---

### Open Questions / Design Decisions Needed

Decisions for the first implementation pass:

- **Scope**: MVP first. Implement multiple tasks, interval/cron/once/goal task types, model/agent overrides, timezone support, pause/resume, raw cron preview, optional heartbeat, run limits, persistent goal sessions, and basic observability. Defer high-risk or heavy items where noted.
- **Goal condition evaluation**: agent judgment via structured response/prompting. Do not execute arbitrary user scripts in this pass.
- **Notifications**: in-app/browser notifications plus optional HTTP notification via ntfy-compatible topic URL.
- **Concurrency model**: queued with configurable global concurrency limit, defaulting to conservative parallelism.
- **Goal sessions**: persistent session per goal task for context continuity.
- **Migration strategy**: best-effort startup migration is acceptable; existing task data is not critical for this user.
- **Multiplicity**: allow multiple scheduled tasks per project now.
- **Cron UI**: raw cron expression input with validation and next-run preview.

Deferred or constrained for MVP:

- Arbitrary `goal_check_expression` and `goal_check_script` execution are not implemented for security reasons.
- SMTP email is not implemented; HTTP notification uses ntfy-compatible POST.
- Full cron builder and task groups are deferred.
- Full run log capture/tool-call archival is deferred beyond existing run output/timeline storage.

Historical open questions:

1. **Goal condition evaluation**: Should it be a shell script, a Python expression, or a natural language check by the agent itself?
2. **Notification system**: Email via SMTP, or webhook-based? Who owns the email config?
3. **Concurrency model**: Should multiple tasks run in parallel (current), or should there be a queue?
4. **Session persistence for goal tasks**: Should goal-based tasks keep their session across runs for continuity?
5. **Heartbeat auto-injection**: Should the system auto-add "complete your objective and stop" to the agent prompt, or is that the user's job?
6. **Task priority**: Should tasks have a priority field to order execution?
7. **Task templates**: Should there be pre-built task templates (e.g. "daily email", "stock monitor")?
8. **Database migration strategy**: How to safely migrate the existing `ScheduledTask` table without losing data?
