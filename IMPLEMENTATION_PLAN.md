# Implementation Plan

> Comprehensive plan for fixing 7 issues in the mobile-opencode-control app.
> Based on analysis of the codebase and the official [OpenCode reference implementation](https://github.com/anomalyco/opencode/tree/dev).

---

## Implementation Status Summary

| Issue | Status | Remaining Work |
|-------|--------|----------------|
| #1 Questions | ✅ **COMPLETE** | None |
| #5 Session bug | ✅ **COMPLETE** | None |
| #4 File tree | ✅ **COMPLETE** | None |
| #3 Notifications | ✅ **COMPLETE** | None — routing logic verified correct |
| #2 Project ordering | ✅ **COMPLETE** | None |
| #6 Multi-session | ✅ **PHASE 1 COMPLETE** | Custom dropdown replaced session tabs; Phase 2-3 not started |
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
| **P0** | #5 Session switching bug | ~50 lines, 3 files | Fixes broken core feature | None | ✅ Complete |
| **P0** | #4 File view tree bug | ~150 lines, 2 files | Fixes broken file browser | None | ✅ Complete |
| **P0** | #3 Notifications | ~150 lines, 3 files | Core PWA + ntfy feature | None | ✅ Complete |
| **P1** | #1 Question features | ~400 lines, 5 files | Enables interactive AI loop | None | ✅ Complete |
| **P1** | #2 Project ordering | ~30 lines, 2 files | UX polish | None | ✅ Complete |
| **P1** | #6 Multi-session | ~200 lines, 3 files | Major UX improvement | #5 (done) | ✅ Phase 1 done |
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

## ✅ Issue #5 — Session Switching Bug (P0) — COMPLETE

**Status: ✅ FULLY IMPLEMENTED**

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

**5. `_resolve_project_session` re-raises on any candidate failure** (`backend/app/routes/helpers.py:618-633`):
```python
had_candidate = candidate_session_id is not None

if candidate_session_id:
    try:
        session = opencode_client.get_session(candidate_session_id)
        ...
    except requests.HTTPError as exc:
        project.last_session_id = None
        db.session.commit()
        if had_candidate:
            raise ValueError("Selected session could not be loaded") from exc
```

Now re-raises regardless of whether `session_id` was explicit or from `project.last_session_id`.

### Files changed
- `frontend/src/api.ts` — sendMessage signature
- `frontend/src/App.tsx` — callers pass sessionId, silent mode
- `backend/app/routes/messages.py` — sessionId parsing in send_project_message
- `backend/app/routes/helpers.py` — _resolve_project_session re-raise logic

---

## ✅ Issue #4 — File View Tree Bug (P0) — COMPLETE

**Status: ✅ FULLY IMPLEMENTED**

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

**4. Auto-collapse useEffect removed** — Initial collapse state set at declaration:
```typescript
const [collapsedDirectories, setCollapsedDirectories] = useState<Set<string>>(() => {
  const initial = new Set<string>();
  for (const entry of entries) {
    if (entry.isDir) initial.add(entry.path);
  }
  return initial;
});
```

The auto-collapse `useEffect` that caused race conditions has been removed entirely.

### Files changed
- `frontend/src/utils/fileUtils.ts` — `buildFileTree`, `flattenFileTree`
- `frontend/src/components/projects/ProjectFilesPanel.tsx` — tree rendering, remove auto-collapse effect
- `frontend/src/App.tsx` — stale request dedup ref, loadProjectDirectoryEntries

---

## ✅ Issue #3 — PWA Notifications (P0) — COMPLETE

**Status: ✅ FULLY IMPLEMENTED — routing logic verified correct**

### Notification routing verified

The channel-based routing in `frontend/src/App.tsx` is correct:
- `browser` → only `shouldNotifyBrowser` fires
- `ntfy` → only `shouldNotifyNtfy` fires
- `both` → both fire
- `off` → neither fires (`notificationsEnabled` is false)

The backend `/api/notifications/ntfy/send` properly falls back to saved `AppSetting` when no `ntfyTopicUrl` is provided in the request body.

### Files changed
- `backend/app/routes/notifications.py` — all notification routes
- `backend/app/routes/helpers.py` — `_send_ntfy_notification`
- `frontend/src/api.ts` — notification API functions
- `frontend/src/App.tsx` — notification state, effect, handler wiring
- `frontend/src/components/toolbar/NotificationControls.tsx` — UI component
- `frontend/src/types.ts` — NotificationChannel type

---

## ✅ Issue #2 — Project List Ordering (P1) — COMPLETE

**Status: ✅ FULLY IMPLEMENTED**

### What's Implemented

**Backend — last_activity_at updates** — both done:
1. On project select (`backend/app/routes/projects.py:220`)
2. On session switch (`backend/app/routes/sessions.py:127`)

**Frontend sort memo** (`frontend/src/App.tsx`):
```typescript
const sortedVisibleProjects = useMemo(() => {
  return [...visibleProjects].sort((a, b) => {
    if (a.id === activeProjectId) return -1;
    if (b.id === activeProjectId) return 1;
    return new Date(b.lastActivityAt).getTime() - new Date(a.lastActivityAt).getTime();
  });
}, [visibleProjects, activeProjectId]);
```

Active project always appears first, regardless of `last_activity_at`. All rendering, keyboard navigation, and highlighting logic use `sortedVisibleProjects`.

### Files changed
- `backend/app/routes/projects.py` — ✅ done
- `backend/app/routes/sessions.py` — ✅ done
- `frontend/src/App.tsx` or project list component — ❌ pending

---

## ✅ Issue #6 — Multi-Session Simultaneous Conversations (P1) — PHASE 1 COMPLETE

**Status: ✅ PHASE 1 COMPLETE — custom dropdown replaces session tabs**

### Phase 1 — Session dropdown (COMPLETE)

1. ✅ Replaced the tab bar with a custom dropdown selector in `RuntimeControls`
2. ✅ Trigger button shows current session label + timestamp + chevron (▾/▴)
3. ✅ Dropdown panel is scrollable (max-height 240px), dark-themed, matches app colors
4. ✅ Each row shows session label (left) + timestamp (right, muted)
5. ✅ Active session highlighted with accent border-left + background
6. ✅ "+ New session" action at bottom with divider
7. ✅ Click outside or Escape key closes dropdown
8. ✅ "Delete" button below the dropdown
9. ✅ Disabled during sessionLoading/sessionSwitching

**Files changed**:
- `frontend/src/components/toolbar/RuntimeControls.tsx` — custom dropdown with open/close, click-outside, Escape handling
- `frontend/src/styles.css` — `.session-dropdown-trigger`, `.session-dropdown-panel`, `.session-dropdown-item`, `.session-dropdown-item.active`, `.session-dropdown-new`, `.session-section`

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
| #5 Session bug | 2 | 2 | 0 | ✅ Complete | 0 |
| #4 File tree | 3 | 0 | 0 | ✅ Complete | 0 |
| #3 Notifications | 3 | 2 | 1 | ✅ Complete | 0 |
| #2 Project order | 1 | 2 | 0 | ✅ Complete | 0 |
| #6 Multi-session | 2 | 0 | 0 | ✅ Phase 1 | ~600 (Phase 2-3) |
| #7 Streaming | 2 | 1 | 0 | ❌ Not started | ~400 |

**Total remaining: ~1000 lines (Phase 2-3 of #6 + all of #7)**
