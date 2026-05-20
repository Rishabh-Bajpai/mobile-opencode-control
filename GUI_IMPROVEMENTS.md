# GUI Improvement Implementation Plan

## Overview

Three GUI improvements to make the mobile-opencode-control frontend more polished and usable:

1. **Markdown rendering** — Chat responses contain markdown but are displayed as raw text (only headings, lists, and code fences render; bold, italic, links, images, tables are all raw).

2. **Git diff view** — The current "Session file changes" panel (`DiffPanel`) dumps raw JSON. Replace with a proper diff view showing uncommitted git changes, while keeping the session `/diff` data visible too.

3. **Tool call cards** — Intermediate step tool calls (bash, read, write, edit, grep, glob, etc.) show raw `JSON.stringify()` blobs instead of readable content.

---

## 1. Markdown Rendering

### Problem

`frontend/src/components/chat/RichMessageText.tsx` and `RichTextLine.tsx` contain a custom hand-rolled markdown renderer that only handles:
- Headings (`#`, `##`, `###`)
- Lists (`-`, `*`)
- Fenced code blocks (` ``` `)
- Inline code (`` ` ``)

Everything else renders as raw text: **bold**, *italic*, [links](url), images, tables, blockquotes, strikethrough, task lists.

### Solution

Replace the custom renderer with `react-markdown` + `remark-gfm` (GitHub Flavored Markdown).

### Files to modify

| File | Action |
|------|--------|
| `frontend/package.json` | Add dependencies |
| `frontend/src/components/chat/RichMessageText.tsx` | Rewrite to use `ReactMarkdown` |
| `frontend/src/components/chat/RichTextLine.tsx` | Delete (replaced by library) |

### Implementation steps

#### Step 1.1: Install dependencies

```bash
npm --prefix frontend install react-markdown remark-gfm
```

#### Step 1.2: Rewrite `RichMessageText.tsx`

Replace the current content with:

```tsx
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function RichMessageText({ text }: { text: string }) {
  return (
    <div className="message-rich-text">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>
        {text}
      </ReactMarkdown>
    </div>
  );
}
```

This handles the full GitHub Flavored Markdown spec:
- **Bold** (`**bold**`) and *italic* (`*italic*`)
- ~~Strikethrough~~ (`~~text~~`)
- [Links](url) (`[text](url)`)
- Images (`![alt](url)`)
- Headings (`#` through `######`)
- Lists (ordered, unordered, task lists with `[ ]`/`[x]`)
- Tables (`| col1 | col2 |`)
- Blockquotes (`>`)
- Code fences with language hint (```` ```python ````)
- Inline code (`` `code` ``)
- Horizontal rules (`---`)

#### Step 1.3: Style the rendered markdown

Add CSS in `frontend/src/styles.css` for the rendered elements:

```css
.message-rich-text h1,
.message-rich-text h2,
.message-rich-text h3,
.message-rich-text h4 {
  margin: 0.5rem 0 0.25rem;
  font-size: inherit;
  font-weight: 700;
}

.message-rich-text p {
  margin: 0.25rem 0;
  line-height: 1.5;
}

.message-rich-text ul,
.message-rich-text ol {
  margin: 0.25rem 0;
  padding-left: 1.2rem;
}

.message-rich-text li {
  margin: 0.1rem 0;
}

.message-rich-text code {
  background: var(--bg-code, rgba(128,128,128,0.15));
  border-radius: 3px;
  padding: 0.1rem 0.3rem;
  font-size: 0.85em;
}

.message-rich-text pre {
  background: var(--bg-code-block, rgba(128,128,128,0.1));
  border-radius: 6px;
  padding: 0.6rem;
  overflow-x: auto;
  font-size: 0.82rem;
  line-height: 1.4;
  margin: 0.4rem 0;
}

.message-rich-text pre code {
  background: none;
  padding: 0;
  border-radius: 0;
}

.message-rich-text table {
  border-collapse: collapse;
  margin: 0.4rem 0;
  font-size: 0.85rem;
}

.message-rich-text th,
.message-rich-text td {
  border: 1px solid var(--border, rgba(128,128,128,0.3));
  padding: 0.3rem 0.5rem;
  text-align: left;
}

.message-rich-text th {
  font-weight: 700;
  background: var(--bg-th, rgba(128,128,128,0.08));
}

.message-rich-text blockquote {
  margin: 0.4rem 0;
  padding-left: 0.6rem;
  border-left: 3px solid var(--accent, #4a9eff);
  color: var(--text-muted, #aaa);
}

.message-rich-text a {
  color: var(--accent, #4a9eff);
  text-decoration: underline;
}

.message-rich-text img {
  max-width: 100%;
  border-radius: 6px;
  margin: 0.4rem 0;
}

.message-rich-text input[type="checkbox"] {
  margin-right: 0.3rem;
}
```

Use CSS variables that already exist in the app (like `--text-muted`, `--accent`, etc.) — fallback to reasonable defaults if undefined.

#### Step 1.4: Delete `RichTextLine.tsx`

It's no longer needed — `react-markdown` handles inline code and all other inline formatting.

---

## 2. Git Diff View

### Problem

`frontend/src/components/chat/DiffPanel.tsx` (15 lines) renders:

```tsx
<pre>{JSON.stringify(diff, null, 2)}</pre>
```

The session diff data has this structure:
```typescript
// From GET /api/projects/:id/diff
interface SessionDiffEntry {
  path: string;      // File path
  additions: number; // Lines added
  deletions: number; // Lines removed
}
```

Additionally, the frontend already fetches git status (`GET /api/projects/:id/git/status`) which returns:
```json
{
  "untracked": ["file1.txt"],
  "changed": ["modified.ts"],
  "staged": ["staged.py"],
  "branch": "main",
  "ahead": 0,
  "behind": 0,
  ...
}
```

But there's **no endpoint that returns actual unified diff content** (the +/- lines). We need one.

### Solution

1. Add a backend endpoint `GET /api/projects/:id/git/diff` that returns unified diff content for uncommitted changes
2. Rewrite `DiffPanel` to show both session diffs AND git diffs in tabs
3. Show real file-by-file diffs with green/red line highlighting

### Files to modify

| File | Action |
|------|--------|
| `backend/app/git_routes.py` | Add `GET /api/projects/:id/git/diff` endpoint |
| `frontend/src/types.ts` | Add `GitDiffEntry` type |
| `frontend/src/api.ts` | Add `apiGitDiff()` function |
| `frontend/src/components/chat/DiffPanel.tsx` | Complete rewrite |
| `frontend/src/App.tsx` | Fetch git diff alongside session diff |
| `frontend/src/styles.css` | Add diff view styles |

### Implementation steps

#### Step 2.1: Backend — Add git diff endpoint

In `backend/app/git_routes.py`, add:

```python
@git_bp.get("/projects/<int:project_id>/git/diff")
@auth_required
def get_project_git_diff(project_id: int):
    """Return unified diff for uncommitted changes (staged + unstaged vs HEAD)."""
    project = Project.query.get(project_id)
    if project is None:
        return jsonify({"error": "Project not found"}), 404

    repo = _open_repo(project.path)
    if repo is None:
        return jsonify({"diff": []})

    try:
        diffs = repo.index.diff(None)  # unstaged vs index
        staged_diffs = repo.index.diff("HEAD")  # staged vs HEAD
    except Exception:
        return jsonify({"diff": [], "error": "Failed to compute diff"}), 502

    entries = []
    for d in diffs + staged_diffs:
        patch = repo.git.diff(d.a_path or d.b_path, unified=5)
        entries.append({
            "path": d.b_path or d.a_path,
            "changeType": d.change_type,  # "A" added, "D" deleted, "M" modified, "R" renamed
            "patch": patch,  # unified diff string
        })

    # Also include untracked files as full content
    untracked = repo.untracked_files
    for u in untracked:
        try:
            content = Path(repo.working_dir, u).read_text()
            entries.append({
                "path": u,
                "changeType": "?",
                "patch": f"--- /dev/null\n+++ b/{u}\n@@ -0,0 +1 @@\n+{content}",
            })
        except OSError:
            pass

    return jsonify({"diff": entries})
```

**Note:** The `_open_repo` helper function already exists in `git_routes.py`. Use it.

#### Step 2.2: Frontend — Add types

In `frontend/src/types.ts`, add:

```typescript
export interface GitDiffEntry {
  path: string;
  changeType: "A" | "D" | "M" | "R" | "?";
  patch: string;  // unified diff string
}

export interface GitDiffResponse {
  diff: GitDiffEntry[];
}
```

#### Step 2.3: Frontend — Add API call

In `frontend/src/api.ts`, add:

```typescript
export async function apiGitDiff(projectId: number): Promise<GitDiffEntry[]> {
  const res = await fetch(`/api/projects/${projectId}/git/diff`);
  if (!res.ok) throw new Error("Failed to fetch git diff");
  const data: GitDiffResponse = await res.json();
  return data.diff;
}
```

#### Step 2.4: Frontend — Rewrite DiffPanel

Replace `frontend/src/components/chat/DiffPanel.tsx` with a component that has two tabs:

**Tab 1: "Session Changes"** — shows the current session `/diff` data (file list with +/- counts) in a readable format instead of raw JSON:

```
Session file changes (3 files)
├── src/components/Button.tsx  +12 -3
├── src/utils/helpers.ts        +0 -5
└── src/styles.css              +45 -12
```

**Tab 2: "Git Uncommitted"** — shows actual unified diffs from the git diff endpoint, file by file:

```
Git: main (2 ahead, 0 behind)
├── src/components/Button.tsx  [modified]
│   @@ -10,7 +10,9 @@
│    const x = 1;
│   +const y = 2;
│    ...
│
├── src/newfile.ts  [untracked]
│   @@ -0,0 +1,3 @@
│   +export function hello() {
│   +  return "world";
│   +}
```

Each file is an expandable `<details>` element. When collapsed, show just the path and change counts. When expanded, show the patch with:
- Green background for lines starting with `+`
- Red background for lines starting with `-`
- Grey for context lines (no prefix or `@@ ... @@` hunk headers)

#### Step 2.5: Parse the unified diff in the frontend

Add a helper function to parse unified diff text into hunks:

```typescript
// In DiffPanel.tsx or a new utils file

interface DiffHunk {
  header: string;     // e.g. "@@ -10,7 +10,9 @@"
  lines: DiffLine[];
}

interface DiffLine {
  type: "add" | "del" | "ctx" | "hunk";
  text: string;
}

function parseUnifiedDiff(patch: string): DiffHunk[] {
  const hunks: DiffHunk[] = [];
  let currentHunk: DiffHunk | null = null;

  for (const line of patch.split("\n")) {
    if (line.startsWith("@@")) {
      if (currentHunk) hunks.push(currentHunk);
      currentHunk = { header: line, lines: [] };
    } else if (currentHunk) {
      if (line.startsWith("+")) {
        currentHunk.lines.push({ type: "add", text: line });
      } else if (line.startsWith("-")) {
        currentHunk.lines.push({ type: "del", text: line });
      } else {
        currentHunk.lines.push({ type: "ctx", text: line });
      }
    }
  }
  if (currentHunk) hunks.push(currentHunk);
  return hunks;
}
```

#### Step 2.6: Add CSS for diff view

```css
.diff-panel {
  font-size: 0.82rem;
  border: 1px solid var(--border, rgba(128,128,128,0.25));
  border-radius: 6px;
  padding: 0.4rem;
  margin: 0.4rem 0;
}

.diff-panel summary {
  cursor: pointer;
  font-weight: 600;
  padding: 0.2rem 0.3rem;
}

.diff-tabs {
  display: flex;
  gap: 0;
  border-bottom: 1px solid var(--border, rgba(128,128,128,0.25));
  margin-bottom: 0.4rem;
}

.diff-tab {
  padding: 0.3rem 0.6rem;
  cursor: pointer;
  font-size: 0.82rem;
  border: none;
  background: none;
  color: var(--text-muted, #aaa);
  border-bottom: 2px solid transparent;
}

.diff-tab.active {
  color: var(--accent, #4a9eff);
  border-bottom-color: var(--accent, #4a9eff);
}

.diff-file {
  margin: 0.3rem 0;
  border: 1px solid var(--border, rgba(128,128,128,0.15));
  border-radius: 4px;
  overflow: hidden;
}

.diff-file summary {
  padding: 0.3rem 0.5rem;
  background: var(--bg-diff-header, rgba(128,128,128,0.06));
  font-family: monospace;
  font-size: 0.82rem;
}

.diff-file-content {
  overflow-x: auto;
  font-family: monospace;
  font-size: 0.78rem;
  line-height: 1.5;
}

.diff-hunk-header {
  padding: 0.1rem 0.5rem;
  background: var(--bg-hunk-header, rgba(128,128,128,0.08));
  color: var(--text-muted, #aaa);
  font-weight: 600;
}

.diff-line {
  padding: 0 0.5rem;
  white-space: pre;
  min-height: 1.3em;
}

.diff-line-add {
  background: rgba(0, 200, 80, 0.12);
  color: var(--diff-add, #4caf50);
}

.diff-line-del {
  background: rgba(255, 50, 50, 0.1);
  color: var(--diff-del, #f44336);
}

.diff-line-ctx {
  color: var(--text-primary, #ccc);
}

.diff-entry-placeholder {
  padding: 1rem;
  text-align: center;
  color: var(--text-muted, #aaa);
}
```

#### Step 2.7: In App.tsx

In the relevant section where `DiffPanel` is rendered (around line 4278), also fetch the git diff:

```typescript
// Add state
const [gitDiffEntries, setGitDiffEntries] = useState<GitDiffEntry[]>([]);

// Fetch alongside session diff
async function fetchDiffs(projectId: number) {
  const [sessionDiff, gitDiff] = await Promise.allSettled([
    fetchDiff(projectId),
    apiGitDiff(projectId),
  ]);
  if (sessionDiff.status === "fulfilled") setDiffEntries(sessionDiff.value);
  if (gitDiff.status === "fulfilled") setGitDiffEntries(gitDiff.value);
}
```

Then update the render:

```tsx
<DiffPanel
  sessionDiff={effectiveDiffEntries}
  gitDiff={gitDiffEntries}
/>
```

---

## 3. Tool Call Cards (Fix Raw JSON in MessagePartCard)

### Problem

`frontend/src/components/chat/MessagePartCard.tsx` line 39:
```tsx
<pre>{JSON.stringify(part, null, 2)}</pre>
```

This dumps every non-"Thinking" tool call part as raw JSON. Based on inspection of actual session data (`ses_1bd32ddb9ffeXnINIFyuWYWkPp`), the message parts have these structures:

```typescript
// type="tool" — the actual structure from OpenCode API
interface ToolPart {
  type: "tool";
  tool: string;         // "bash" | "read" | "write" | "edit" | "grep" | "glob" | "search" | "task" | "playwright_browser_*" | "fetch" | etc.
  callID: string;
  state: {
    status: "completed" | "running" | "error";
    input: Record<string, unknown>;   // tool-specific arguments
    output: string;                   // stdout / result text
    metadata?: Record<string, unknown>;
    title?: string;
    time?: { start: number; end: number };
  };
  id: string;
  sessionID: string;
  messageID: string;
}
```

Other part types:
```typescript
// type="step-start"
{ type: "step-start"; snapshot: string; id: string; sessionID: string; messageID: string }

// type="step-finish"
{ type: "step-finish"; reason: string; snapshot: string; tokens: {...}; cost: number; ... }

// type="reasoning"
{ type: "reasoning"; thinking: string }

// type="patch"
{ type: "patch"; hash: string; files: string[]; id: string; sessionID: string; messageID: string }

// type="text" (handled separately by RichMessageText)
{ type: "text"; text: string }

// type="file"
{ type: "file"; mime: string; filename: string; url: string; source?: {...} }
```

Each tool type's `state.input` has a specific schema:

| `tool` | `state.input` keys |
|--------|-------------------|
| `bash` | `{ command, description?, timeout? }` |
| `read` | `{ filePath, offset?, limit? }` |
| `write` | `{ filePath, content? }` |
| `edit` | `{ filePath, oldString?, newString? }` |
| `grep` | `{ pattern, include?, path? }` |
| `glob` | `{ pattern, path? }` |
| `search` | `{ query? }` |
| `task` | `{ description, subagent_type, prompt?, ... }` |
| `playwright_browser_run_code_unsafe` | `{ code }` |
| `playwright_browser_take_screenshot` | `{ filename, type }` |
| `playwright_browser_snapshot` | `{ depth? }` |
| `playwright_browser_*` | (varies) |
| `fetch` | `{ url? }` |
| `question` | `{ question?, options? }` |
| `apply_patch` | (patch text) |

### Solution

Replace the raw JSON dump in `MessagePartCard` with per-tool renderers. Each tool call gets a card with:
- **Header**: tool icon/name + brief summary
- **Input**: readable arguments (not JSON)
- **Output**: collapsible result content

### Files to modify

| File | Action |
|------|--------|
| `frontend/src/components/chat/MessagePartCard.tsx` | Replace `JSON.stringify` with per-tool rendering |
| `frontend/src/utils/messageUtils.ts` | Add tool-specific formatting helpers |
| `frontend/src/styles.css` | Add tool card styles |

### Implementation steps

#### Step 3.1: Rewrite `MessagePartCard.tsx`

The component already detects the part type via `getPartActivityLabel()`. The `label` is used to show the header. The main change is in the expanded content section:

Replace:
```tsx
{open ? (
  label === "Thinking" ? (
    reasoningText ? (
      <div className="message-rich-text"><p>{reasoningText}</p></div>
    ) : (
      <p>Reasoning in progress</p>
    )
  ) : (
    <pre>{JSON.stringify(part, null, 2)}</pre>
  )
) : null}
```

With:
```tsx
{open ? renderToolContent(part, label) : null}
```

Where `renderToolContent` is a function that switches on `part.tool` (or `label`):

```tsx
function renderToolContent(part: Record<string, unknown>, label: string) {
  // Handle reasoning/thinking specially (keep existing behavior)
  if (label === "Thinking") {
    const reasoningText = extractReasoning(part);
    return reasoningText ? (
      <div className="message-rich-text"><p>{reasoningText}</p></div>
    ) : (
      <p>Reasoning in progress</p>
    );
  }

  // For tool parts, render based on tool type
  if (part.type === "tool") {
    return <ToolCallView part={part as ToolPart} />;
  }

  // For patch parts
  if (part.type === "patch") {
    return <PatchView part={part as PatchPart} />;
  }

  // For file parts
  if (part.type === "file") {
    return <FileView part={part as FilePart} />;
  }

  // Fallback — show summary instead of raw JSON
  const summary = summarizePart(part);
  return <div className="tool-output"><pre>{summary}</pre></div>;
}
```

#### Step 3.2: Create `ToolCallView` component

```tsx
function ToolCallView({ part }: { part: ToolPart }) {
  const { tool, state } = part;
  const { input, output, status, metadata } = state || {};
  const hasOutput = output && output.length > 0;

  return (
    <div className="tool-call-view">
      <div className="tool-call-input">
        {renderToolInput(tool, input)}
      </div>
      <div className="tool-call-status">
        <span className={`status-${status || "running"}`}>
          {status || "running"}
        </span>
        {metadata?.truncated && <span className="truncated-badge">truncated</span>}
      </div>
      {hasOutput && (
        <details className="tool-call-output">
          <summary>Output ({output.length} chars)</summary>
          <pre>{output}</pre>
        </details>
      )}
    </div>
  );
}
```

#### Step 3.3: Create per-tool input renderers

```tsx
function renderToolInput(tool: string, input: Record<string, unknown> | undefined) {
  if (!input) return null;

  switch (tool) {
    case "bash":
      return (
        <div className="tool-input-bash">
          <code className="tool-command">{input.command as string}</code>
          {input.description && (
            <small className="tool-desc">{input.description as string}</small>
          )}
        </div>
      );

    case "read":
      return (
        <div className="tool-input-file">
          <span className="tool-label">Read file:</span>
          <code>{input.filePath as string}</code>
          {(input.offset !== undefined || input.limit !== undefined) && (
            <span className="tool-range">
              lines {input.offset as number}–{(input.offset as number) + (input.limit as number) - 1}
            </span>
          )}
        </div>
      );

    case "write":
      return (
        <div className="tool-input-file">
          <span className="tool-label">Write to:</span>
          <code>{input.filePath as string}</code>
        </div>
      );

    case "edit":
      return (
        <div className="tool-input-file">
          <span className="tool-label">Edit file:</span>
          <code>{input.filePath as string}</code>
        </div>
      );

    case "grep":
    case "search":
      return (
        <div className="tool-input-grep">
          <span className="tool-label">Search:</span>
          <code>{input.pattern as string || input.query as string}</code>
          {input.include && <span className="tool-filter">in {input.include as string}</span>}
        </div>
      );

    case "glob":
      return (
        <div className="tool-input-glob">
          <span className="tool-label">Pattern:</span>
          <code>{input.pattern as string}</code>
        </div>
      );

    case "task":
      return (
        <div className="tool-input-task">
          <span className="tool-label">Agent task:</span>
          <span>{input.description as string}</span>
        </div>
      );

    case "fetch":
      return (
        <div className="tool-input-fetch">
          <span className="tool-label">Fetch URL:</span>
          <code>{input.url as string}</code>
        </div>
      );

    default:
      // For unknown tools (playwright, etc.), show a readable summary
      if (tool.startsWith("playwright_browser")) {
        const action = tool.replace("playwright_browser_", "").replace(/_/g, " ");
        return (
          <div className="tool-input-browser">
            <span className="tool-label">Browser action:</span>
            <code>{action}</code>
          </div>
        );
      }
      // Fallback: show input keys
      return (
        <div className="tool-input-fallback">
          <code>{Object.keys(input).join(", ")}</code>
        </div>
      );
  }
}
```

#### Step 3.4: Patch and File views

```tsx
function PatchView({ part }: { part: PatchPart }) {
  return (
    <div className="patch-view">
      <span>Files changed:</span>
      <ul>
        {part.files?.map((f) => <li key={f}><code>{f}</code></li>)}
      </ul>
    </div>
  );
}

function FileView({ part }: { part: FilePart }) {
  return (
    <div className="file-view">
      <span>File: {part.filename}</span>
      {part.mime?.startsWith("image/") && part.url?.startsWith("data:") && (
        <img src={part.url} alt={part.filename} className="file-preview" />
      )}
      {part.url && !part.url.startsWith("data:") && (
        <a href={part.url} target="_blank" rel="noopener noreferrer">
          Open {part.filename}
        </a>
      )}
    </div>
  );
}
```

#### Step 3.5: Add CSS for tool cards

```css
.tool-call-view {
  font-size: 0.82rem;
}

.tool-call-input {
  margin-bottom: 0.3rem;
}

.tool-call-input .tool-label {
  color: var(--text-muted, #aaa);
  font-size: 0.78rem;
}

.tool-call-input code {
  background: rgba(128,128,128,0.1);
  border-radius: 3px;
  padding: 0.1rem 0.3rem;
  font-size: 0.85em;
  word-break: break-all;
}

.tool-command {
  display: block;
  font-family: monospace;
  font-size: 0.82rem;
  padding: 0.3rem;
  background: rgba(128,128,128,0.08);
  border-radius: 4px;
  margin-top: 0.2rem;
  white-space: pre-wrap;
  word-break: break-all;
}

.tool-desc {
  display: block;
  color: var(--text-muted, #aaa);
  margin-top: 0.2rem;
}

.tool-range {
  color: var(--text-muted, #aaa);
  font-size: 0.78rem;
  margin-left: 0.4rem;
}

.tool-filter {
  color: var(--text-muted, #aaa);
  font-size: 0.78rem;
  margin-left: 0.3rem;
}

.tool-call-status {
  margin-bottom: 0.3rem;
}

.status-completed {
  color: var(--success, #4caf50);
  font-size: 0.78rem;
}

.status-running {
  color: var(--accent, #4a9eff);
  font-size: 0.78rem;
  animation: pulse 1s infinite;
}

.status-error {
  color: var(--error, #f44336);
  font-size: 0.78rem;
}

.truncated-badge {
  font-size: 0.7rem;
  background: rgba(255, 152, 0, 0.2);
  color: #ff9800;
  padding: 0.05rem 0.3rem;
  border-radius: 3px;
  margin-left: 0.3rem;
}

.tool-call-output {
  margin-top: 0.3rem;
}

.tool-call-output summary {
  cursor: pointer;
  font-size: 0.78rem;
  color: var(--text-muted, #aaa);
  margin-bottom: 0.2rem;
}

.tool-call-output pre {
  background: rgba(128,128,128,0.06);
  border-radius: 4px;
  padding: 0.4rem;
  font-size: 0.78rem;
  line-height: 1.4;
  overflow-x: auto;
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 300px;
  overflow-y: auto;
}

.patch-view ul {
  margin: 0.2rem 0;
  padding-left: 1rem;
}

.patch-view li {
  margin: 0.1rem 0;
}

.file-view {
  margin: 0.2rem 0;
}

.file-preview {
  max-width: 100%;
  max-height: 200px;
  border-radius: 4px;
  margin-top: 0.3rem;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}
```

#### Step 3.6: Type definitions

In `frontend/src/types.ts`, add the structured types used above:

```typescript
export interface ToolPart {
  type: "tool";
  tool: string;
  callID: string;
  state: {
    status: "completed" | "running" | "error";
    input?: Record<string, unknown>;
    output?: string;
    metadata?: { truncated?: boolean; matches?: number };
    title?: string;
    time?: { start: number; end: number };
  };
  id: string;
  sessionID: string;
  messageID: string;
}

export interface PatchPart {
  type: "patch";
  hash: string;
  files: string[];
  id: string;
  sessionID: string;
  messageID: string;
}

export interface FilePart {
  type: "file";
  mime: string;
  filename: string;
  url: string;
  source?: Record<string, unknown>;
  id: string;
  sessionID: string;
  messageID: string;
}
```

---

## Testing notes

1. **Markdown**: Send a message containing `**bold**`, `*italic*`, `[link](url)`, a table, a task list, and a code fence. Verify each renders correctly.
2. **Git diff**: Open a project with uncommitted changes. Verify the DiffPanel shows both the session changes tab and the git uncommitted tab. Verify the git diff shows +/- highlighted lines.
3. **Tool cards**: Select a project with recent agent activity. Click to expand intermediate steps. Verify bash commands show the command text, read shows file path, edit shows file path, etc. — and no raw JSON is visible.

## File change summary

| File | Change |
|------|--------|
| `frontend/package.json` | Add `react-markdown` + `remark-gfm` |
| `frontend/src/components/chat/RichMessageText.tsx` | Rewrite to use `ReactMarkdown` |
| `frontend/src/components/chat/RichTextLine.tsx` | Delete |
| `frontend/src/components/chat/MessagePartCard.tsx` | Replace `JSON.stringify` with per-tool rendering |
| `frontend/src/components/chat/DiffPanel.tsx` | Complete rewrite with tabs + diff rendering |
| `frontend/src/types.ts` | Add `GitDiffEntry`, `ToolPart`, `PatchPart`, `FilePart`, `GitDiffResponse` |
| `frontend/src/api.ts` | Add `apiGitDiff()` |
| `frontend/src/App.tsx` | Fetch git diff alongside session diff |
| `frontend/src/styles.css` | Add all new CSS classes |
| `backend/app/git_routes.py` | Add `GET /api/projects/:id/git/diff` endpoint |
