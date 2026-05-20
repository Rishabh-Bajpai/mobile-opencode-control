# Implementation Plan

> Comprehensive plan for fixing 7 issues in the mobile-opencode-control app.
> Based on analysis of the codebase and the official [OpenCode reference implementation](https://github.com/anomalyco/opencode/tree/dev).

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

| Priority | Issue | Effort | Impact | Dependencies |
|----------|-------|--------|--------|-------------|
| **P0** | #5 Session switching bug | ~50 lines, 3 files | Fixes broken core feature | None |
| **P0** | #4 File view tree bug | ~150 lines, 2 files | Fixes broken file browser | None |
| **P0** | #3 Notifications | ~150 lines, 3 files | Core PWA + ntfy feature | None |
| **P1** | #1 Question features | ~400 lines, 5 files | Enables interactive AI loop | None |
| **P1** | #2 Project ordering | ~30 lines, 2 files | UX polish | None |
| **P1** | #6 Multi-session | ~600 lines, 6 files | Major UX improvement | #5 (must fix sessions first) |
| **P2** | #7 Streaming improvements | ~400 lines, 4 files | Performance/real-time fix | #1 (questions depend on stream) |

---

## Issue #5 — Session Switching Bug (P0)

### Root Cause

The `sendMessage()` API call sends **no sessionId** in the request body:

```typescript
// frontend/src/api.ts:131
body: JSON.stringify({ text })  // <--- missing sessionId!
```

The backend resolves the session from `project.last_session_id` via `_ensure_project_session()`, which calls `_resolve_project_session(project, client, session_id=None)`. This function can **silently nullify** `last_session_id` on HTTP errors:

```python
# backend/app/routes.py:557
except requests.HTTPError:
    project.last_session_id = None  # <--- silent corruption!
```

When `last_session_id` is null, the fallback picks the **first session from the list** (often Session A), so messages go to the wrong session.

### Fix

**1. Pass `sessionId` in the API call** (`frontend/src/api.ts`):
```typescript
export async function sendMessage(projectId: string, sessionId: string, text: string) {
  return request(`/api/projects/${projectId}/messages`, {
    method: "POST",
    body: JSON.stringify({ sessionId, text }),  // <--- add sessionId
  });
}
```

**2. Update caller** (`frontend/src/App.tsx:~6128`):
```typescript
const result = parsed
  ? await runCommand(activeProjectId, parsed.command, parsed.argumentsList)
  : await sendMessage(activeProjectId, activeSessionId, text);  // <--- pass sessionId
```

**3. Backend: use provided sessionId** (`backend/app/routes.py` — `send_project_message`):
```python
body = request.get_json(silent=True) or {}
text = str(body.get("text") or "").strip()
session_id = str(body.get("sessionId") or "").strip() or None
if session_id:
    session_id = _resolve_project_session(project, opencode_client, session_id=session_id, create_if_missing=False)
else:
    session_id = _ensure_project_session(project, opencode_client)
```

**4. Fix `_resolve_project_session`** — don't silently nullify `last_session_id` on HTTP errors:
```python
except requests.HTTPError as exc:
    project.last_session_id = None
    db.session.commit()
    raise  # <--- re-raise instead of silently continuing
```

**5. Use `{ silent: true }` consistently** (`App.tsx`) — after explicit user action, don't let `loadProjectSessions()` overwrite `activeSessionId`:
```typescript
// In handleSwitchSession, after the switch is confirmed:
await Promise.all([
  loadProjectSessions(activeProjectId, { silent: true }),  // was: no options
  ...
]);
```

---

## Issue #4 — File View Tree Bug (P0)

### Root Cause

Two problems:

1. **Auto-collapse race condition** (`App.tsx:2327-2337`): An `useEffect` auto-collapses any directory not yet in `loadedDirectories`. If the user expands dir A, then B, and A's async fetch completes first, the effect re-collapses B (undoing the user's action) because B isn't in `loadedDirectories` yet.

2. **Flat-list approach**: The file tree is a flat array sorted by string comparison. Parent-child relationships are implicit (path-based) rather than explicit. This makes the view fragile and produces interleaving artifacts for complex directory structures.

### Fix

**1. Remove the auto-collapse effect** (`App.tsx:2327-2337`):
```typescript
// DELETE this entire useEffect — it causes race conditions
useEffect(() => {
  setCollapsedDirectories((current) => {
    const next = new Set(current);
    for (const entry of dedupedEntries) {
      if (entry.isDir && !loadedDirectories.includes(entry.path)) {
        next.add(entry.path);
      }
    }
    return next;
  });
}, [dedupedEntries, loadedDirectories]);
```

**2. Build a proper tree structure** for rendering in `ProjectFilesPanel` (`App.tsx`):
```typescript
interface TreeNode {
  entry: ProjectFileEntry;
  children: TreeNode[];
}

function buildTree(entries: ProjectFileEntry[]): TreeNode[] {
  const roots: TreeNode[] = [];
  const map = new Map<string, TreeNode>();
  
  // Sort by path length ascending so parents come before children
  const sorted = [...entries].sort((a, b) => a.path.localeCompare(b.path));
  
  for (const entry of sorted) {
    const node: TreeNode = { entry, children: [] };
    map.set(entry.path, node);
    
    const parentPath = entry.path.includes("/")
      ? entry.path.slice(0, entry.path.lastIndexOf("/"))
      : null;
    
    if (parentPath && map.has(parentPath)) {
      map.get(parentPath)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}
```

**3. Replace the flattening logic** to use the tree:
```typescript
function flattenTree(nodes: TreeNode[], collapsed: Set<string>): ProjectFileEntry[] {
  const result: ProjectFileEntry[] = [];
  function walk(list: TreeNode[]) {
    for (const node of list) {
      result.push(node.entry);
      if (node.entry.isDir && !collapsed.has(node.entry.path)) {
        walk(node.children);
      }
    }
  }
  walk(nodes);
  return result;
}
```

**4. Add stale request deduplication** with an abort counter on project switch:
```typescript
const fileLoadGenerationRef = useRef(0);
async function loadProjectDirectoryEntries(projectId, directory, reset) {
  const generation = ++fileLoadGenerationRef.current;
  // ... fetch ...
  if (generation !== fileLoadGenerationRef.current) return; // stale
  // ... update state ...
}
```

### Files changed
- `frontend/src/App.tsx` — `ProjectFilesPanel`, remove auto-collapse effect, add tree building/flattening
- `backend/app/routes.py` — optional: simplify depth calculation

---

## Issue #3 — PWA Notifications (P0)

### Root Cause

Current notification code (`App.tsx:5596-5629`) uses `document.hidden` + `new Notification()`:
- `document.hidden` behavior is inconsistent in PWA standalone mode across browsers
- iOS Safari PWA doesn't support the Notification API
- No **ntfy** or **service worker push** channel exists
- No configuration UI for ntfy topic URL

### Fix

**1. Add `NOTIFICATION_NTFY_TOPIC_URL` config option** (`.env` + `config.py`):
```python
# backend/app/config.py
notification_ntfy_topic_url: str = ""  # e.g. https://ntfy.homelabrb.duckdns.org/Chanakya
```

**2. Add backend notification route** (`backend/app/routes.py`):
```python
@app.post("/api/notify/ntfy")
@auth_required
def notify_via_ntfy():
    body = request.get_json(silent=True) or {}
    message = str(body.get("message") or "").strip()
    title = str(body.get("title") or "OpenCode Controller").strip()
    topic_url = current_app.config.get("NOTIFICATION_NTFY_TOPIC_URL", "")
    if not topic_url or not message:
        return jsonify({"error": "Missing topic URL or message"}), 400
    try:
        resp = requests.post(
            topic_url,
            data=message.encode("utf-8"),
            headers={
                "Title": title,
                "Priority": "4",
                "Tags": "robot",
                "Markdown": "yes",
            },
            timeout=10,
        )
        resp.raise_for_status()
        return jsonify({"ok": True})
    except Exception as exc:
        return jsonify({"error": f"ntfy failed: {exc}"}), 502
```

**3. Add ntfy API function** (`frontend/src/api.ts`):
```typescript
export async function sendNtfyNotification(projectId: string, message: string, title?: string) {
  return request("/api/notify/ntfy", {
    method: "POST",
    body: JSON.stringify({ message, title, projectId }),
  });
}
```

**4. Update notification effect** (`App.tsx:5596-5629`):
- Add a notification channel selector: `"browser" | "ntfy" | "both"`
- For `"browser"`: fire `new Notification()` as before, but remove `document.hidden` guard so it works in PWA standalone mode
- For `"ntfy"`: call `sendNtfyNotification()` with the message
- For `"both"`: do both

**5. Add notification config UI** in the settings/toolbar panel:
- Notification channel selector (Browser / ntfy / Both)
- ntfy topic URL input (stored in backend `AppSetting`)
- Test button to verify ntfy connectivity

### ntfy Reference

ntfy API is simple HTTP POST:
```bash
curl -d "Backup successful" ntfy.sh/mytopic
curl -H "Title: Alert" -H "Priority: high" -H "Tags: warning" -d "Disk full" ntfy.sh/mytopic
```

The user's ntfy server: `https://ntfy.homelabrb.duckdns.org/Chanakya`

### Files changed
- `.env` — add `NOTIFICATION_NTFY_TOPIC_URL`
- `backend/app/config.py` — add config field
- `backend/app/routes.py` — add `POST /api/notify/ntfy` route
- `frontend/src/api.ts` — add `sendNtfyNotification()`
- `frontend/src/App.tsx` — update notification effect and settings UI

---

## Issue #1 — Missing Question Features (P1)

### Root Cause

The OpenCode server emits `question.asked`/`question.replied`/`question.rejected` bus events through its SSE stream (`/global/event`), but:

- Backend `_stream()` only parses events with `"permission"` in the type — question events are ignored
- No backend routes exist for proxying OpenCode's question endpoints (`GET /question`, `POST /question/:id/reply`, `POST /question/:id/reject`)
- No question state management or UI exists in the frontend

### OpenCode Question API Reference

**Schema** (from `packages/opencode/src/question/index.ts`):
```typescript
interface Option { label: string; description: string; }
interface Info { question: string; header: string; options: Option[]; multiple?: boolean; custom?: boolean; }
interface Tool { messageID: string; callID: string; }
interface Request { id: string; sessionID: string; questions: Info[]; tool?: Tool; }
type Answer = string[];  // selected option labels
interface Reply { answers: Answer[]; }
```

**Bus Events**: `question.asked` (payload: `Request`), `question.replied` (payload: `{ sessionID, requestID, answers }`), `question.rejected` (payload: `{ sessionID, requestID }`)

**HTTP Endpoints** (from `packages/opencode/src/server/routes/instance/httpapi/groups/question.ts`):
| Method | Route | Description |
|--------|-------|-------------|
| GET | `/question` | List all pending questions |
| POST | `/question/:requestID/reply` | Answer with `{ answers: string[][] }` |
| POST | `/question/:requestID/reject` | Reject/dismiss the question |

### Fix

**1. Add question methods to `OpenCodeClient`** (`backend/app/opencode.py`):
```python
def list_questions(self) -> list[dict]:
    response = requests.get(f"{self.base_url}/question", headers=self._headers(), timeout=10)
    response.raise_for_status()
    data = response.json()
    return data if isinstance(data, list) else []

def respond_question(self, request_id: str, answers: list[list[str]]) -> bool:
    response = requests.post(
        f"{self.base_url}/question/{request_id}/reply",
        json={"answers": answers},
        headers=self._headers(),
        timeout=20,
    )
    response.raise_for_status()
    return bool(response.json())

def reject_question(self, request_id: str) -> bool:
    response = requests.post(
        f"{self.base_url}/question/{request_id}/reject",
        headers=self._headers(),
        timeout=10,
    )
    response.raise_for_status()
    return bool(response.json())
```

**2. Add question API routes** (`backend/app/routes.py`):
```python
@app.get("/api/projects/<int:project_id>/questions")
@auth_required
def list_pending_questions(project_id: int):
    try:
        questions = opencode_client.list_questions()
        return jsonify({"questions": questions})
    except Exception as exc:
        return jsonify({"error": str(exc)}), 502

@app.post("/api/projects/<int:project_id>/questions/<request_id>/reply")
@auth_required
def reply_to_question(project_id: int, request_id: str):
    body = request.get_json(silent=True) or {}
    answers = body.get("answers", [])
    try:
        success = opencode_client.respond_question(request_id, answers)
        return jsonify({"ok": success})
    except Exception as exc:
        return jsonify({"error": str(exc)}), 502

@app.post("/api/projects/<int:project_id>/questions/<request_id>/reject")
@auth_required
def reject_question(project_id: int, request_id: str):
    try:
        success = opencode_client.reject_question(request_id)
        return jsonify({"ok": success})
    except Exception as exc:
        return jsonify({"error": str(exc)}), 502
```

**3. Parse question events in SSE stream** (`backend/app/routes.py` — `_stream()`):
Add a function similar to `_update_pending_approvals_from_event` that detects `question.asked` events and stores them in `AppSetting` (keyed by project_id).
Also emit them in the SSE data so the frontend can detect them immediately.

**4. Add question types** (`frontend/src/types.ts`):
```typescript
export interface QuestionOption {
  label: string;
  description: string;
}

export interface QuestionInfo {
  question: string;
  header: string;
  options: QuestionOption[];
  multiple?: boolean;
  custom?: boolean;
}

export interface QuestionRequest {
  id: string;
  sessionID: string;
  questions: QuestionInfo[];
  tool?: { messageID: string; callID: string };
}
```

**5. Add question API functions** (`frontend/src/api.ts`):
```typescript
export async function fetchPendingQuestions(projectId: string): Promise<{ questions: QuestionRequest[] }> {
  return request(`/api/projects/${projectId}/questions`);
}

export async function respondQuestion(projectId: string, requestId: string, answers: string[][]): Promise<{ ok: boolean }> {
  return request(`/api/projects/${projectId}/questions/${requestId}/reply`, {
    method: "POST",
    body: JSON.stringify({ answers }),
  });
}

export async function rejectQuestion(projectId: string, requestId: string): Promise<{ ok: boolean }> {
  return request(`/api/projects/${projectId}/questions/${requestId}/reject`, {
    method: "POST",
  });
}
```

**6. Add question state and UI** (`frontend/src/App.tsx`):
- Add `pendingQuestions: QuestionRequest[]` state variable
- Parse question events from SSE stream in `parseApprovalFromStreamData` (or a new parallel function)
- Add a `QuestionCard` component (renders question text + radio/checkbox options + custom text input)
- Show question card(s) above the composer (like approval cards)
- Block sending while questions are pending (like `hasBlockingApprovals`)
- Add `respondQuestion` / `rejectQuestion` handlers wired to the UI

### Files changed
- `backend/app/opencode.py` — 3 new methods
- `backend/app/routes.py` — 3 new routes + SSE stream parsing
- `frontend/src/types.ts` — 3 new interfaces
- `frontend/src/api.ts` — 3 new functions
- `frontend/src/App.tsx` — state, SSE parsing, UI component

---

## Issue #2 — Project List Ordering (P1)

### Root Cause

Projects are ordered by `Project.last_activity_at DESC` on the backend (`routes.py:1371`). However, `last_activity_at` is only updated when sending a message or switching sessions — **not** when simply clicking/selecting a project. So the order doesn't reflect "last opened" behavior.

### Fix

**1. Update `last_activity_at` on project select** (`backend/app/routes.py` — the `selectProject` route or the frontend's `handleSelectProject`):
```python
# In the select/switch project route:
project.last_activity_at = _utc_now()
db.session.commit()
```

**2. Frontend: sort active project first, rest by lastActivityAt** (`App.tsx`):
```typescript
const sortedProjects = useMemo(() => {
    return [...projects].sort((a, b) => {
        if (a.id === activeProjectId) return -1;
        if (b.id === activeProjectId) return 1;
        return new Date(b.lastActivityAt).getTime() - new Date(a.lastActivityAt).getTime();
    });
}, [projects, activeProjectId]);
```

### Files changed
- `backend/app/routes.py` — add `last_activity_at` update in select/switch
- `frontend/src/App.tsx` — add project sorting memo (or use backend ordering)

---

## Issue #6 — Multi-Session Simultaneous Conversations (P1)

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
│  │  [Composer for Session A]                      │ │
│  └─────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────┘
```

### Fix (Phased)

**Phase 1 — Session tabs (replaces the dropdown):**
1. Replace `SessionControls` (`<select>`) with a horizontal tab bar of session buttons
2. Each session shows a truncated label + timestamp
3. Active session is highlighted; clicking a tab switches (using the already-working `handleSwitchSession`)
4. Add a "+" tab at the end for `handleCreateSession`

**Phase 2 — Multiple active session panes:**
1. Allow multiple sessions to be "pinned" as active
2. Show each session's messages in a separate scrollable pane (vertical split or carousel)
3. Each pane has its own composer
4. The SSE stream filters events by sessionId per pane

**Phase 3 — Unified timeline (Telegram-like):**
1. Show all sessions' messages interleaved in a single timeline
2. Each message is tagged with its session label/color
3. Composer has a session selector (or sends to the active session, showing in the unified view)

**Note:** Phase 1 is the most impactful with the least code. Phase 2-3 are major rearchitectures.

### Files changed
- `frontend/src/App.tsx` — session tab bar, multi-pane rendering
- `frontend/src/styles.css` — session tab styles
- Phase 2-3: extensive changes

---

## Issue #7 — Streaming Improvements (P2)

### Root Cause

The SSE stream is used as a **poll signal** rather than as the actual data source. The frontend ignores most event types and triggers debounced REST reloads (700ms) for every event. This adds latency and race conditions.

### Reference Implementation

OpenCode's SSE stream (`packages/opencode/src/server/routes/instance/httpapi/handlers/event.ts`):
- Subscribes to **all** bus events via `bus.subscribeAll()`
- Pushes typed JSON events: `text.delta`, `tool.called`, `question.asked`, etc.
- 10-second heartbeat to keep connection alive
- The frontend (Solid.js app) uses TanStack Query to reactively update state from these events

Our app's `GET /api/projects/<id>/stream` already proxies the raw OpenCode events but the frontend ignores most of them.

### Fix

**1. Parse all event types in the frontend** (`App.tsx` `stream.onmessage` handler):
```typescript
// Current: only checks for permission events
// New: parse all typed events
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
- `frontend/src/App.tsx` — stream event handling, incremental update logic
- `backend/app/routes.py` — possible minor stream improvements

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
- `frontend/src/App.tsx` — Main UI component (~7490 lines, monolithic)
- `frontend/src/api.ts` — Frontend API wrapper
- `frontend/src/types.ts` — TypeScript types
- `frontend/src/styles.css` — Styles
- `frontend/public/sw.js` — Service Worker
- `backend/app/routes.py` — All Flask routes (~2486 lines)
- `backend/app/opencode.py` — OpenCode HTTP client wrapper
- `backend/app/config.py` — Configuration
- `backend/app/models.py` — SQLAlchemy models
- `backend/app/scheduler.py` — Task scheduler
- `.env.example` — Environment config template

---

## Effort Summary

| Issue | Frontend files | Backend files | New types | Total est. lines |
|-------|---------------|--------------|-----------|-----------------|
| #5 Session bug | 1 | 1 | 0 | ~50 |
| #4 File tree | 1 | 0 | 0 | ~150 |
| #3 Notifications | 2 | 3 | 0 | ~150 |
| #1 Questions | 3 | 4 | 3 | ~400 |
| #2 Project order | 1 | 1 | 0 | ~30 |
| #6 Multi-session | 2 | 0 | 0 | ~600 |
| #7 Streaming | 1 | 1 | 0 | ~400 |

**Total: ~1780 lines across ~18 file changes** (many files touched by multiple issues; the monolithic `App.tsx` and `routes.py` are touched by almost all).
