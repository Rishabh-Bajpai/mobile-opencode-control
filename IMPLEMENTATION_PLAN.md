# Implementation Plan

> Comprehensive plan for fixing 7 issues in the mobile-opencode-control app.
> Based on analysis of the codebase and the official [OpenCode reference implementation](https://github.com/anomalyco/opencode/tree/dev).

---

## Implementation Status Summary

| Issue | Status | Remaining Work |
|-------|--------|----------------|
| #1 Questions | ✅ **COMPLETE** | None |
| #5 Session bug | ⚡ **PARTIAL** | `_resolve_project_session` only re-raises when explicit `session_id` provided, not on `last_session_id` fallback |
| #4 File tree | ⚡ **PARTIAL** | Auto-collapse `useEffect` modified but not removed; handles the race case but could be cleaner |
| #3 Notifications | ⚡ **PARTIAL** | Functionally works; route path differs from plan; possible bugs in browser/ntfy/both delivery logic |
| #2 Project ordering | ❌ **MISSING** | Backend updates `last_activity_at` on select; frontend `useMemo` sort (active project first) not done |
| #6 Multi-session | ❌ **NOT STARTED** | Phase 1 (session tab bar) not implemented; still uses dropdown |
| #7 Streaming | ❌ **NOT STARTED** | No `text.delta`/`text.ended` parsing, no incremental updates, no heartbeat handling |

---

## Original Issues (from user)

1. **Missing Question Features** — The app lacks OpenCode's question/input prompts, where the AI asks the user for input during conversations.
2. **Project List Ordering** — Chat projects should be arranged by last-opened order (like Telegram).
3. **PWA Notifications** — Notifications are not working in the PWA app.
4. **File View Tree Bug** — Only dot-prefixed folders show their contents correctly; other folders' files appear interleaved among parent files.
5. **Session Switching Bug** — Changing from Session A to B then sending a message sends it to A (wrong session).
6. **Multi-Session Simultaneous Conversations** — Add support for multiple concurrent sessions within a single project.
7. **Streaming Issues** — The message streaming approach may introduce several of the above issues.

---

## Priority & Execution Order

| Priority | Issue | Effort | Impact | Dependencies | Current Status |
|----------|-------|--------|--------|-------------|----------------|
| **P0** | #5 Session switching bug | ~50 lines, 3 files | Fixes broken core feature | None | ⚡ Partial |
| **P0** | #4 File view tree bug | ~150 lines, 2 files | Fixes broken file browser | None | ⚡ Partial |
| **P0** | #3 Notifications | ~150 lines, 3 files | Core PWA + ntfy feature | None | ⚡ Partial |
| **P1** | #1 Question features | ~400 lines, 5 files | Enables interactive AI loop | None | ✅ Complete |
| **P1** | #2 Project ordering | ~30 lines, 2 files | UX polish | None | ❌ Missing |
| **P1** | #6 Multi-session | ~200 lines, 3 files | Major UX improvement | #5 (done) | ❌ Not started |
| **P2** | #7 Streaming improvements | ~400 lines, 4 files | Performance/real-time fix | #1 (done) | ❌ Not started |

---

## ✅ Issue #1 — Missing Question Features (P1) — COMPLETE

**Status: ✅ FULLY IMPLEMENTED — all plan requirements met.**

### Root Cause (Historical)

The OpenCode server emits `question.asked`/`question.replied`/`question.rejected` bus events through its SSE stream (`/global/event`), but:
- Backend `_stream()` only parsed events with `"permission"` in the type — question events were ignored
- No backend routes existed for proxying OpenCode's question endpoints
- No question state management or UI existed in the frontend

### What Was Implemented

**Backend — OpenCodeClient** (`backend/app/opencode.py`):
- `list_questions()` — GET /question
- `reply_question()` — POST /question/:id/reply
- `reject_question()` — POST /question/:id/reject

**Backend — API Routes** (`backend/app/routes/messages.py`):
- `GET /api/projects/<id>/questions` — list pending questions
- `POST /api/projects/<id>/questions/<request_id>/reply` — answer questions
- `POST /api/projects/<id>/questions/<request_id>/reject` — dismiss questions
- SSE `_update_pending_questions_from_event()` — parses `question.asked` events

**Frontend — Types** (`frontend/src/types.ts`):
- `QuestionOption`, `QuestionInfo`, `QuestionRequest`, `QuestionTool` interfaces

**Frontend — API** (`frontend/src/api.ts`):
- `fetchPendingQuestions()`, `replyQuestion()`, `rejectQuestion()`

**Frontend — Component** (`frontend/src/components/ui/QuestionCard.tsx`):
- Renders question text + radio/checkbox options + custom text input
- Sits at the bottom of the chat (above composer)
- Blocks sending while questions are pending
- Auto-scrolls when questions arrive

**Frontend — State & SSE** (`frontend/src/App.tsx`):
- `pendingQuestions`, `questionDrafts`, `respondingQuestionId` state
- `parseQuestionFromStreamData()` — SSE event parsing
- `handleReplyQuestion()` / `handleRejectQuestion()` handlers
- Composer disabled via `hasBlockingQuestions`

### Files changed
- `backend/app/opencode.py` — 3 new methods
- `backend/app/routes/messages.py` — 3 new routes + `_update_pending_questions_from_event`
- `backend/app/routes/helpers.py` — `_parse_question_event` helper
- `frontend/src/types.ts` — 3 new interfaces
- `frontend/src/api.ts` — 3 new functions
- `frontend/src/App.tsx` — state, SSE parsing, handler wiring
- `frontend/src/components/ui/QuestionCard.tsx` — UI component
- `frontend/src/styles.css` — question card styles

---

## ⚡ Issue #5 — Session Switching Bug (P0) — PARTIAL

**Status: ⚡ PARTIALLY IMPLEMENTED**

### Root Cause (Historical)

The `sendMessage()` API call originally sent **no sessionId** in the request body. The backend resolved the session from `project.last_session_id` via `_ensure_project_session()`, which called `_resolve_project_session(project, client, session_id=None)`. This function could **silently nullify** `last_session_id` on HTTP errors, causing the first session to be used as fallback.

### What's Implemented

**1. `sendMessage()` accepts sessionId** (`frontend/src/api.ts`):
```typescript
export async function sendMessage(projectId: string, text: string, sessionId?: string | null) {
  body: JSON.stringify({ text, sessionId: sessionId ?? null }),
}
```

**2. Callers pass activeSessionId** (`frontend/src/App.tsx`):
```typescript
await sendMessage(activeProjectId, text, activeSessionId)
await runCommand(activeProjectId, parsed.command, parsed.argumentsList, activeSessionId)
```

**3. Backend uses provided sessionId** (`backend/app/routes/messages.py:83-96`):
```python
requested_session_id = str(body.get("sessionId") or "").strip() or None
if requested_session_id:
    session_id = _resolve_project_session(project, opencode_client,
        session_id=requested_session_id, create_if_missing=False)
else:
    session_id = _ensure_project_session(project, opencode_client)
```

**4. `{ silent: true }` in handleSwitchSession** (`frontend/src/App.tsx`):
```typescript
loadProjectSessions(activeProjectId, { silent: true })
```

### What's Still Missing

**5. `_resolve_project_session` incomplete re-raise** (`backend/app/routes/helpers.py:628-632`):
```python
except requests.HTTPError as exc:
    project.last_session_id = None
    db.session.commit()
    if session_id:
        raise ValueError("Selected session could not be loaded") from exc
    # ^^^ only re-raises when explicit session_id is provided
    # When resolving from project.last_session_id (session_id=None),
    # it falls through silently and picks the first session from the list
```

**Remaining work**: The re-raise should happen **regardless** of whether `session_id` was explicit or from `last_session_id`. When `last_session_id` fails to load, it should propagate the error instead of silently falling back to the first session.

### Files changed
- `frontend/src/api.ts` — sendMessage signature
- `frontend/src/App.tsx` — callers pass sessionId, silent mode
- `backend/app/routes/messages.py` — sessionId parsing in send_project_message
- `backend/app/routes/helpers.py` — _resolve_project_session re-raise logic

---

## ⚡ Issue #4 — File View Tree Bug (P0) — PARTIAL

**Status: ⚡ PARTIALLY IMPLEMENTED**

### Root Cause (Historical)

Two problems:
1. Auto-collapse race condition: An `useEffect` auto-collapsed any directory not yet in `loadedDirectories`, undoing user expansions when async fetches completed out of order.
2. Flat-list approach: Parent-child relationships were implicit (path-based) rather than explicit, producing interleaving artifacts.

### What's Implemented

**1. Tree structure building** (`frontend/src/utils/fileUtils.ts`):
- `buildFileTree()` — converts flat entry list into `TreeNode[]` with explicit parent-child links
- `flattenFileTree()` — flattens tree respecting collapsed state

**2. Tree-based rendering** (`frontend/src/components/projects/ProjectFilesPanel.tsx`):
- Uses `buildFileTree`/`flattenFileTree` instead of flat array
- Proper nesting with indentation

**3. Stale request deduplication** (`frontend/src/App.tsx`):
- `projectFileLoadGenerationRef` counter
- `loadProjectDirectoryEntries` checks generation before applying state

**4. Auto-collapse useEffect** — Modified (but not removed):
```typescript
// Current behavior: only collapses when current.size === 0 (initial state)
// This avoids the race condition but the effect still exists
if (current.size === 0) { ... }
```

### What's Still Missing

**Remaining work**: The auto-collapse `useEffect` should be **removed entirely** as the plan specified. The initial collapse state should be set at declaration time instead:
```typescript
const [collapsedDirectories, setCollapsedDirectories] = useState<Set<string>>(() => {
  // Compute initial collapsed state here, not in a useEffect
  const initial = new Set<string>();
  for (const entry of entries) {
    if (entry.isDir) initial.add(entry.path);
  }
  return initial;
});
```

### Files changed
- `frontend/src/utils/fileUtils.ts` — `buildFileTree`, `flattenFileTree`
- `frontend/src/components/projects/ProjectFilesPanel.tsx` — tree rendering, remove auto-collapse effect
- `frontend/src/App.tsx` — stale request dedup ref, loadProjectDirectoryEntries

---

## ⚡ Issue #3 — PWA Notifications (P0) — PARTIAL

**Status: ⚡ PARTIALLY IMPLEMENTED — functionally works, some bugs possible**

### Root Cause (Historical)

Current notification code used `document.hidden` + `new Notification()`:
- `document.hidden` behavior is inconsistent in PWA standalone mode across browsers
- iOS Safari PWA doesn't support the Notification API
- No **ntfy** or **service worker push** channel existed
- No configuration UI for ntfy topic URL

### What's Implemented

**Backend — Notification routes** (`backend/app/routes/notifications.py`):
- `GET /api/notifications/settings` — get notification settings
- `PUT /api/notifications/settings` — save notification settings
- `POST /api/notifications/ntfy/test` — test ntfy connectivity
- `POST /api/notifications/ntfy/send` — send ntfy notification
- `_send_ntfy_notification()` helper in helpers.py

**Frontend — API** (`frontend/src/api.ts`):
- `fetchNotificationSettings()`, `saveNotificationSettings()`
- `testNtfyNotification()`, `sendNtfyNotification()`

**Frontend — Component** (`frontend/src/components/toolbar/NotificationControls.tsx`):
- Notification channel selector (Browser / ntfy / Both / Off)
- ntfy topic URL input with placeholder
- Turn on / Turn off / Save settings / Test ntfy buttons

**Frontend — Notification effect** (`frontend/src/App.tsx`):
- Browser notifications fire without `document.hidden` guard
- ntfy channel calls `sendNtfyNotification()`
- Channel-based routing: browser, ntfy, both, off

**Frontend — Types** (`frontend/src/types.ts`):
- `NotificationChannel` type: `"browser" | "ntfy" | "both" | "off"`
- `NotificationSettings` interface

### Possible Bugs & Remaining Work

1. **Route naming difference**: Plan specified `/api/notify/ntfy`, actual is `/api/notifications/ntfy/send` — not a functional issue, but the plan should reflect reality.

2. **Notification delivery logic**: The user noted "notification only to browser or ntfy or both may have some bugs". Possible issues:
   - Browser notification may fire even when `channel === "ntfy"` (incorrect routing)
   - ntfy may not fire when `channel === "both"` (missing fallback)
   - The `sendNtfyNotification` sends `ntfyTopicUrl` with the request but the backend reads it from `AppSetting` — potential mismatch
   - Need to verify the notification effect's channel-based conditions

3. **Missing frontend `useMemo` sort** (cross-reference with #2): The notification card and runtime card are in a grid that doesn't prioritize the active project.

### Files changed
- `backend/app/routes/notifications.py` — all notification routes
- `backend/app/routes/helpers.py` — `_send_ntfy_notification`
- `frontend/src/api.ts` — notification API functions
- `frontend/src/App.tsx` — notification state, effect, handler wiring
- `frontend/src/components/toolbar/NotificationControls.tsx` — UI component
- `frontend/src/types.ts` — NotificationChannel type

---

## ❌ Issue #2 — Project List Ordering (P1) — MISSING FRONTEND PART

**Status: ❌ PARTIALLY MISSING — backend done, frontend not done**

### Root Cause

Projects are ordered by `Project.last_activity_at DESC` on the backend. However, `last_activity_at` is only updated when sending a message or switching sessions — **not** when simply clicking/selecting a project. The frontend also doesn't sort active project first.

### What's Implemented

**Backend — last_activity_at updates** — both done:
1. On project select (`backend/app/routes/projects.py:220`):
```python
project.last_activity_at = _utc_now()
```
2. On session switch (`backend/app/routes/sessions.py:127`):
```python
project.last_activity_at = _utc_now()
```

### What's Still Missing

**Frontend sort memo** (`frontend/src/App.tsx` or project list component):

The active project should always appear first, regardless of `last_activity_at`. Currently the list relies solely on backend `ORDER BY last_activity_at DESC`.

**Fix**:
```typescript
const sortedProjects = useMemo(() => {
    return [...projects].sort((a, b) => {
        if (a.id === activeProjectId) return -1;
        if (b.id === activeProjectId) return 1;
        return new Date(b.lastActivityAt).getTime() - new Date(a.lastActivityAt).getTime();
    });
}, [projects, activeProjectId]);
```

Apply in the component that renders the project list (likely in `frontend/src/components/projects/` or `frontend/src/App.tsx`).

### Files changed
- `backend/app/routes/projects.py` — ✅ done
- `backend/app/routes/sessions.py` — ✅ done
- `frontend/src/App.tsx` or project list component — ❌ pending

---

## ❌ Issue #6 — Multi-Session Simultaneous Conversations (P1) — NOT STARTED

**Status: ❌ NOT STARTED — session switching works (from #5) but UI is still a dropdown**

### Requirement

Allow multiple active conversations (sessions) per project to be visible and interactable simultaneously, similar to Telegram's chat list.

### Design

```
┌─────────────────────────────────────────────────────┐
│  Project: my-app                                     │
│  ┌─────────────────────────────────────────────────┐ │
│  │ [Session A]  [Session B]  [+]                    │ │
│  ├─────────────────────────────────────────────────┤ │
│  │  Session A messages...                           │ │
│  │  ...                                            │ │
│  ├─────────────────────────────────────────────────┤ │
│  │  [Composer for Session A]                       │ │
│  └─────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────┘
```

### Current State

Session management is handled by `RuntimeControls` (merged into the same `.runtime-controls` grid as Model/Agent):
- `<select>` dropdown for session switching
- "New session" and "Delete" buttons below
- Single active session model — no multi-pane or unified timeline

### Fix (Phased)

**Phase 1 — Session tabs (replaces the dropdown):**
1. Replace the `<select>` in `RuntimeControls` with a horizontal tab bar of session buttons
2. Each session tab shows a truncated label + timestamp
3. Active session is highlighted; clicking a tab switches (using the already-working `handleSwitchSession`)
4. Add a "+" tab at the end for `handleCreateSession`
5. Move session back to a `SessionTabs` component (currently inlined in `RuntimeControls`)
6. **Files**: `frontend/src/components/toolbar/RuntimeControls.tsx`, `frontend/src/styles.css`, `frontend/src/App.tsx`

**Phase 2 — Multiple active session panes:**
1. Allow multiple sessions to be "pinned" as active
2. Show each session's messages in a separate scrollable pane (vertical split or carousel)
3. Each pane has its own composer
4. The SSE stream filters events by sessionId per pane

**Phase 3 — Unified timeline (Telegram-like):**
1. Show all sessions' messages interleaved in a single timeline
2. Each message is tagged with its session label/color
3. Composer has a session selector (or sends to the active session, showing in the unified view)

**Note:** Phase 1 is the most impactful with the least code. Phase 2-3 are major rearchitectures (~600+ lines each).

### Files changed
- `frontend/src/components/toolbar/RuntimeControls.tsx` — extract session UI back to separate component
- `frontend/src/components/toolbar/SessionTabs.tsx` — NEW: session tab bar component
- `frontend/src/App.tsx` — wire session tab bar
- `frontend/src/styles.css` — session tab styles
- Phase 2-3: extensive changes across chat components

---

## ❌ Issue #7 — Streaming Improvements (P2) — NOT STARTED

**Status: ❌ NOT STARTED — question.asked is parsed (from #1), but text events and incremental updates are not**

### Root Cause

The SSE stream is used as a **poll signal** rather than as the actual data source. The frontend ignores most event types and triggers debounced REST reloads (700ms) for every event. This adds latency and race conditions.

### Current State

- `question.asked` events **are** parsed (part of Issue #1 implementation)
- All other event types (`text.delta`, `text.ended`, `prompted`, etc.) trigger a 700ms debounced full reload via `scheduleStreamRefresh`
- No heartbeat handling

### Reference Implementation

OpenCode's SSE stream (`packages/opencode/src/server/routes/instance/httpapi/handlers/event.ts`):
- Subscribes to **all** bus events via `bus.subscribeAll()`
- Pushes typed JSON events: `text.delta`, `tool.called`, `question.asked`, etc.
- 10-second heartbeat to keep connection alive

### Fix

**1. Parse all event types in the frontend** (`frontend/src/App.tsx` `stream.onmessage` handler):
```typescript
stream.onmessage = (event) => {
  const data = JSON.parse(event.data);
  const sessionId = data.sessionId;
  const rawEvents: string[] = data.event;

  let hasMessageUpdate = false;
  let hasQuestionUpdate = false;

  for (const raw of rawEvents) {
    if (raw.startsWith("event: ")) {
      const eventType = raw.slice(7).trim();
      if (eventType.includes("permission")) {
        // existing permission handling
      } else if (eventType === "question.asked") {
        hasQuestionUpdate = true;
      } else if (["text.delta", "text.ended", "prompted"].includes(eventType)) {
        hasMessageUpdate = true;
      }
    }
  }

  if (hasQuestionUpdate) loadPendingQuestions(activeProjectId);
  if (hasMessageUpdate) scheduleStreamRefresh(activeProjectId);
};
```

**2. Add incremental message update** instead of full reload:
For events like `text.delta`, update the last assistant message's text in-place rather than reloading all messages. This requires:
- Tracking the last assistant message ID per session
- Appending `delta` text to it
- Using `text.ended` events to mark completion

**3. Add heartbeat handling** — the OpenCode SSE sends heartbeats every 10s; use them to detect stale connections.

**Note:** Full incremental update (step 2) is a significant refactor. Step 1 alone (better event classification) is already valuable.

### Files changed
- `frontend/src/App.tsx` — stream event parsing, incremental update logic, heartbeat handling
- `frontend/src/utils/streamUtils.ts` — event type classification utilities
- `backend/app/routes/messages.py` — possible minor stream improvements (forward heartbeat metadata)

---

## Reference Links

### OpenCode Repository
- **Main repo**: https://github.com/anomalyco/opencode/tree/dev
- **Server package**: https://github.com/anomalyco/opencode/tree/dev/packages/opencode
- **Question service**: https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/question/index.ts
- **Question API (groups)**: https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/server/routes/instance/httpapi/groups/question.ts
- **Question API (handlers)**: https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/server/routes/instance/httpapi/handlers/question.ts
- **Question schema**: https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/question/schema.ts
- **SSE handler**: https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/server/routes/instance/httpapi/handlers/event.ts
- **SSE endpoint**: https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/server/routes/instance/httpapi/groups/event.ts
- **Session events**: https://github.com/anomalyco/opencode/blob/dev/packages/core/src/session-event.ts
- **Session messages (v2)**: https://github.com/anomalyco/opencode/blob/dev/packages/core/src/session-message.ts
- **Bus system**: https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/bus/index.ts
- **Main server**: https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/server/server.ts
- **Web app (Solid.js)**: https://github.com/anomalyco/opencode/tree/dev/packages/app
- **Desktop (Electron)**: https://github.com/anomalyco/opencode/tree/dev/packages/desktop

### ntfy
- **Documentation**: https://docs.ntfy.sh/
- **Publishing API**: https://docs.ntfy.sh/publish/
- **Hosted ntfy.sh**: https://ntfy.sh
- **Self-hosting**: https://docs.ntfy.sh/install/

### This App's Key Files
- `frontend/src/App.tsx` — Main UI component (~4612 lines, monolithic)
- `frontend/src/api.ts` — Frontend API wrapper
- `frontend/src/types.ts` — TypeScript types
- `frontend/src/styles.css` — Styles
- `frontend/public/sw.js` — Service Worker
- `backend/app/routes/messages.py` — Message & question routes
- `backend/app/routes/helpers.py` — Shared helper functions
- `backend/app/routes/notifications.py` — Notification routes
- `backend/app/routes/sessions.py` — Session management routes
- `backend/app/routes/projects.py` — Project CRUD routes
- `backend/app/routes/runtime.py` — Runtime model/agent routes
- `backend/app/routes/tasks.py` — Task/scheduler routes
- `backend/app/opencode.py` — OpenCode HTTP client wrapper
- `backend/app/config.py` — Configuration
- `backend/app/models.py` — SQLAlchemy models
- `backend/app/scheduler.py` — Task scheduler
- `.env.example` — Environment config template

---

## Effort Summary

| Issue | Frontend files | Backend files | New types | Status | Remaining est. lines |
|-------|---------------|--------------|-----------|--------|---------------------|
| #1 Questions | 4 | 3 | 3 | ✅ Complete | 0 |
| #5 Session bug | 2 | 2 | 0 | ⚡ Partial | ~5 |
| #4 File tree | 3 | 0 | 0 | ⚡ Partial | ~10 |
| #3 Notifications | 3 | 2 | 1 | ⚡ Partial | debug |
| #2 Project order | 1 | 2 | 0 | ❌ Missing | ~15 |
| #6 Multi-session | 3 | 0 | 0 | ❌ Not started | ~200 (Phase 1) |
| #7 Streaming | 2 | 1 | 0 | ❌ Not started | ~400 |

**Total remaining: ~630 lines across remaining open items**
