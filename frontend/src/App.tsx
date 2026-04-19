import { FormEvent, KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent, UIEvent, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import {
  abortSession,
  createProjectSession,
  createProject,
  deleteProjectSession,
  deleteScheduledTask,
  fetchDiff,
  fetchAppState,
  fetchMessages,
  fetchOpenCodeCommands,
  fetchPendingApprovals,
  fetchProjectRuntime,
  fetchProjectSessions,
  fetchProjectFileContent,
  fetchProjectDirectoryEntries,
  fetchProjects,
  fetchSchedulerStatus,
  fetchScheduledTask,
  fetchScheduledTaskRuns,
  getAuthState,
  login,
  logout,
  opencodeHealth,
  respondPermission,
  runScheduledTaskNow,
  runCommand,
  saveScheduledTask,
  selectProject,
  sendMessage,
  speakText,
  projectArchiveDownloadUrl,
  projectFileDownloadUrl,
  syncProjects,
  transcribeAudio,
  updateProjectRuntime,
  updateProjectSession,
} from "./api";
import type {
  ChatMessage,
  OpenCodeCommand,
  Project,
  ProjectFileContent,
  ProjectFileEntry,
  ProjectSession,
  RuntimeAgentOption,
  RuntimeModelOption,
  ScheduledTask,
  ScheduledTaskRun,
  SessionDiffEntry,
  TimelineEvent,
} from "./types";


interface ApprovalRequest {
  permissionId: string;
  title: string;
  details: string;
  createdAt: string;
}

interface TelemetryMarker {
  id: string;
  event: string;
  category: TelemetryMarkerCategory;
  at: string;
  payload: Record<string, unknown>;
}

interface SchedulerStatus {
  running: boolean;
  pollIntervalSeconds: number;
  taskRunRetentionDays: number;
  lastLoopAt: string | null;
  lastLoopError: string | null;
  lastPruneAt: string | null;
  lastPrunedCount: number;
}

type DevFixtureMode =
  | "task-run-success"
  | "task-run-error"
  | "chat-loading"
  | "no-project"
  | "run-active"
  | "reconnecting"
  | "session-switching"
  | "approval-heavy"
  | "activity-chain"
  | "diff-empty"
  | "diff-large";

function resolveDevFixtureMode(): DevFixtureMode | null {
  if (!import.meta.env.DEV || typeof window === "undefined") {
    return null;
  }

  const value = new URLSearchParams(window.location.search).get("fixture");
  switch (value) {
    case "task-run-success":
    case "task-run-error":
    case "chat-loading":
    case "no-project":
    case "run-active":
    case "reconnecting":
    case "session-switching":
    case "approval-heavy":
    case "activity-chain":
    case "diff-empty":
    case "diff-large":
      return value;
    default:
      return null;
  }
}

function RuntimeControls({
  models,
  agents,
  selectedModel,
  selectedAgent,
  saving,
  error,
  onModelChange,
  onAgentChange,
}: {
  models: RuntimeModelOption[];
  agents: RuntimeAgentOption[];
  selectedModel: string | null;
  selectedAgent: string | null;
  saving: boolean;
  error: string | null;
  onModelChange: (value: string | null) => void;
  onAgentChange: (value: string | null) => void;
}) {
  return (
    <div className="runtime-controls">
      <label>
        <span>Model</span>
        <select
          value={selectedModel ?? ""}
          onChange={(event) => onModelChange(event.currentTarget.value || null)}
          disabled={saving}
        >
          <option value="">Server default</option>
          {models.map((model) => (
            <option key={model.id} value={model.id}>
              {model.providerName} / {model.name}
              {model.isDefault ? " (default)" : ""}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>Agent</span>
        <select
          value={selectedAgent ?? ""}
          onChange={(event) => onAgentChange(event.currentTarget.value || null)}
          disabled={saving}
        >
          <option value="">Server default</option>
          {agents.map((agent) => (
            <option key={agent.id} value={agent.id}>
              {agent.id}
            </option>
          ))}
        </select>
      </label>
      {saving ? <small>Saving runtime...</small> : null}
      {error ? <small className="runtime-error">{error}</small> : null}
    </div>
  );
}

function SessionControls({
  sessions,
  activeSessionId,
  loading,
  switching,
  switchTargetLabel,
  error,
  onChange,
  onCreate,
  onDelete,
}: {
  sessions: ProjectSession[];
  activeSessionId: string | null;
  loading: boolean;
  switching: boolean;
  switchTargetLabel: string | null;
  error: string | null;
  onChange: (value: string) => void;
  onCreate: () => void;
  onDelete: () => void;
}) {
  const activeSession = sessions.find((session) => session.id === activeSessionId) ?? null;
  const sortedSessions = useMemo(
    () => sortSessionsForDisplay(sessions, activeSessionId),
    [sessions, activeSessionId]
  );
  const deleteTargetLabel = activeSession
    ? `${activeSession.title || "Untitled session"} (${formatCompactSessionId(activeSession.id)})`
    : null;

  return (
    <div className="session-controls">
      <label>
        <span>Session</span>
        <select
          value={activeSessionId ?? ""}
          onChange={(event) => onChange(event.currentTarget.value)}
          disabled={loading || switching || sessions.length === 0}
        >
          <option value="">{loading ? "Loading sessions..." : "No session selected"}</option>
          {sortedSessions.map((session) => {
            return (
              <option key={session.id} value={session.id}>
                {formatSessionOptionLabel(session, activeSessionId)}
              </option>
            );
          })}
        </select>
      </label>
      <button type="button" className="secondary-button" onClick={onCreate} disabled={loading || switching}>
        {switching ? "Working..." : "New session"}
      </button>
      <button
        type="button"
        className="secondary-button session-delete-button"
        onClick={onDelete}
        disabled={loading || switching || !activeSession}
      >
        Delete session
      </button>
      {activeSession ? (
        <div className="session-controls-meta">
          {switching ? (
            <small className="session-switch-status">
              Switching to {switchTargetLabel || "selected session"}...
            </small>
          ) : null}
          <small>{formatSessionOptionLabel(activeSession, activeSessionId)}</small>
          <small>
            {formatCompactSessionId(activeSession.id)}
            {activeSession.summary.files > 0
              ? ` · +${activeSession.summary.additions}/-${activeSession.summary.deletions}`
              : ""}
          </small>
          <small className="session-delete-hint">Delete target: {deleteTargetLabel}</small>
          <small className="session-delete-warning">
            Deleting the current session will switch this project to the next most recent session.
          </small>
        </div>
      ) : null}
      {error ? <small className="runtime-error">{error}</small> : null}
    </div>
  );
}

function NotificationControls({
  supported,
  enabled,
  permission,
  onEnable,
  onDisable,
}: {
  supported: boolean;
  enabled: boolean;
  permission: NotificationPermission | "unsupported";
  onEnable: () => void;
  onDisable: () => void;
}) {
  const statusLabel = !supported
    ? "Browser notifications are not supported here."
    : !enabled
    ? "Notifications are off."
    : permission === "granted"
    ? "Notifications are on for final agent replies."
    : permission === "denied"
    ? "Browser permission is blocked. Enable it in site settings."
    : "Notifications will turn on after browser permission is granted.";

  return (
    <div className="notification-controls">
      <div className="toolbar-card-head">
        <strong>Notifications</strong>
        <span>Final agent replies in the background</span>
      </div>
      <small>{statusLabel}</small>
      <div className="notification-actions">
        <button type="button" className="secondary-button" onClick={onEnable} disabled={!supported || enabled}>
          Turn on
        </button>
        <button type="button" className="secondary-button" onClick={onDisable} disabled={!enabled}>
          Turn off
        </button>
      </div>
    </div>
  );
}

function CommandHelpBar({
  commands,
  onInsert,
  onOpenPicker,
  defaultOpen = false,
}: {
  commands: OpenCodeCommand[];
  onInsert: (commandName: string) => void;
  onOpenPicker: () => void;
  defaultOpen?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  useEffect(() => {
    if (defaultOpen) {
      setIsOpen(true);
    }
  }, [defaultOpen]);

  if (commands.length === 0) {
    return null;
  }

  return (
    <div className={`command-help-bar ${isOpen ? "open" : ""}`}>
      <button
        type="button"
        className="command-help-toggle"
        onClick={() => setIsOpen((current) => !current)}
        aria-expanded={isOpen}
      >
        Commands
        <span>{commands.length}</span>
      </button>
      {isOpen ? (
        <>
          <div className="command-help-actions">
            <button type="button" className="command-picker-button" onClick={onOpenPicker}>
              Browse commands
            </button>
          </div>
          <div className="command-chip-list">
            {commands.slice(0, 12).map((command) => (
              <button
                key={command.name}
                type="button"
                className="command-chip"
                title={command.description || `Insert /${command.name}`}
                onClick={() => onInsert(command.name)}
              >
                /{command.name}
              </button>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

function CommandPickerModal({
  open,
  query,
  commands,
  onClose,
  onQueryChange,
  onInsert,
}: {
  open: boolean;
  query: string;
  commands: OpenCodeCommand[];
  onClose: () => void;
  onQueryChange: (value: string) => void;
  onInsert: (commandName: string) => void;
}) {
  if (!open) {
    return null;
  }

  return (
    <div className="command-picker-overlay" role="dialog" aria-modal="true">
      <div className="command-picker-modal">
        <div className="command-picker-header">
          <strong>Server Commands</strong>
          <button type="button" onClick={onClose}>
            Close
          </button>
        </div>
        <input
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Search commands or descriptions"
          autoFocus
        />
        <div className="command-picker-list">
          {commands.length === 0 ? <p>No matching commands.</p> : null}
          {commands.map((command) => (
            <button
              key={command.name}
              type="button"
              className="command-picker-item"
              onClick={() => onInsert(command.name)}
            >
              <div>
                <strong>/{command.name}</strong>
                <p>{command.description || "No description from server."}</p>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function CapabilityWarning({ commands }: { commands: OpenCodeCommand[] }) {
  void commands;
  return null;
}

function scrollEntryIntoView(
  container: HTMLElement | null,
  entry: HTMLElement | null,
  behavior: ScrollBehavior = "smooth"
) {
  if (!container || !entry) {
    return;
  }

  const containerRect = container.getBoundingClientRect();
  const entryRect = entry.getBoundingClientRect();
  const nextTop = container.scrollTop + (entryRect.top - containerRect.top) - 24;
  container.scrollTo({ top: Math.max(0, nextTop), behavior });
}

function formatTimelineDayLabel(value: string) {
  const date = new Date(value);
  const today = new Date();
  const startOfDay = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const diffDays = Math.round((startOfToday - startOfDay) / 86_400_000);

  if (diffDays === 0) {
    return "Today";
  }
  if (diffDays === 1) {
    return "Yesterday";
  }
  return date.toLocaleDateString([], {
    month: "short",
    day: "numeric",
    year: date.getFullYear() === today.getFullYear() ? undefined : "numeric",
  });
}

function formatPartTypeLabel(value: string) {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[\s\-_]+/)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

function normalizePartToken(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function sanitizeActivitySnippet(value: string) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "";
  }
  if (normalized === "[object Object]") {
    return "";
  }
  if (/^\{.*\}$/.test(normalized) && normalized.includes(":")) {
    return "";
  }
  const token = normalizePartToken(normalized);
  if (token === "reasoningencryptedcontent" || token === "true" || token === "false") {
    return "";
  }
  const compact = normalized.replace(/\s+/g, "");
  if (
    compact.length > 120 &&
    !normalized.includes(" ") &&
    /^[A-Za-z0-9+/=_\-.]+$/.test(compact)
  ) {
    return "";
  }
  return normalized;
}

function extractReasoningPlainText(part: Record<string, unknown>) {
  const candidateKeys = ["reasoningText", "reasoning", "text", "summary", "detail", "message", "content", "output"];

  for (const key of candidateKeys) {
    if (!(key in part)) {
      continue;
    }
    const extracted = extractTextFromUnknown(part[key]);
    if (extracted) {
      return extracted;
    }
  }

  return "";
}

function truncateSummary(value: string, maxLength = 96) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 1).trimEnd()}...`;
}

function buildPartInstanceKey(scope: string, part: Record<string, unknown>, index: number) {
  const type = typeof part.type === "string" ? part.type : "part";
  return `${scope}:${index}:${type}`;
}

function buildMessageStableKey(message: ChatMessage) {
  return message.id || `${message.role}:${message.createdAt}`;
}

function compactPathLabel(value: string) {
  const normalized = value.replace(/\\/g, "/").trim();
  if (!normalized) {
    return "";
  }
  const segments = normalized.split("/").filter(Boolean);
  return segments[segments.length - 1] ?? normalized;
}

function getPartActivityLabel(part: Record<string, unknown>) {
  const partType = typeof part.type === "string" ? part.type : "part";
  const tool = typeof part.tool === "string" ? part.tool : partType;
  const token = normalizePartToken(tool === "part" ? partType : tool);

  switch (token) {
    case "bash":
      return "Running command";
    case "read":
      return "Reading files";
    case "write":
    case "edit":
    case "apply_patch":
      return "Editing files";
    case "glob":
    case "grep":
    case "search":
    case "explore":
      return "Searching codebase";
    case "task":
      return "Launching agent";
    case "question":
      return "Waiting for input";
    case "reasoning":
    case "reasoningencryptedcontent":
    case "reasoningcontent":
      return "Thinking";
    case "stepstart":
    case "stepfinish":
      return "Working";
    default:
      return formatPartTypeLabel(tool === "part" ? partType : tool);
  }
}

function extractTextFromUnknown(value: unknown, depth = 0): string {
  if (depth > 3 || value === null || value === undefined) {
    return "";
  }

  if (typeof value === "string") {
    return sanitizeActivitySnippet(value);
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const extracted = extractTextFromUnknown(item, depth + 1);
      if (extracted) {
        return extracted;
      }
    }
    return "";
  }

  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const priorityKeys = [
      "text",
      "summary",
      "detail",
      "details",
      "message",
      "content",
      "output",
      "reasoning",
      "reasoningText",
      "value",
      "title",
      "description",
    ];

    for (const key of priorityKeys) {
      if (!(key in record)) {
        continue;
      }
      const extracted = extractTextFromUnknown(record[key], depth + 1);
      if (extracted) {
        return extracted;
      }
    }
  }

  return "";
}

function getPartActivityCountLabel(label: string, count: number) {
  switch (label) {
    case "Running command":
      return `${count} ${count === 1 ? "command" : "commands"}`;
    case "Reading files":
      return `${count} ${count === 1 ? "file read" : "file reads"}`;
    case "Editing files":
      return `${count} ${count === 1 ? "edit" : "edits"}`;
    case "Searching codebase":
      return `${count} ${count === 1 ? "search" : "searches"}`;
    case "Launching agent":
      return `${count} ${count === 1 ? "agent launch" : "agent launches"}`;
    case "Waiting for input":
      return `${count} ${count === 1 ? "input request" : "input requests"}`;
    case "Thinking":
      return `${count} ${count === 1 ? "reasoning step" : "reasoning steps"}`;
    case "Working":
      return `${count} ${count === 1 ? "step" : "steps"}`;
    default:
      return `${count} ${label.toLowerCase()}`;
  }
}

function getPartActivityDetail(part: Record<string, unknown>) {
  const label = getPartActivityLabel(part);
  if (label === "Thinking") {
    const reasoningText = extractReasoningPlainText(part);
    return reasoningText ? truncateSummary(reasoningText, 140) : "";
  }

  const command = typeof part.command === "string" ? truncateSummary(part.command) : "";
  if (command) {
    return command;
  }

  const file = typeof part.file === "string" ? compactPathLabel(part.file) : "";
  if (file) {
    return file;
  }

  const title = typeof part.title === "string" ? truncateSummary(part.title, 80) : "";
  if (title) {
    return title;
  }

  const text = typeof part.text === "string" ? truncateSummary(part.text, 80) : "";
  if (text) {
    return text;
  }

  const status = typeof part.status === "string" ? truncateSummary(part.status, 80) : "";
  if (status) {
    return status;
  }

  const fallbackText = extractTextFromUnknown(part);
  if (fallbackText) {
    return truncateSummary(fallbackText, 80);
  }

  return "";
}

function getDefaultActivityDetail(label: string) {
  if (label === "Thinking") {
    return "Reasoning in progress";
  }
  if (label === "Working") {
    return "Running next step";
  }
  return "";
}

function summarizeActivityParts(parts: Array<Record<string, unknown>>) {
  const labels = parts.map(getPartActivityLabel).filter(Boolean);
  const labelCounts = new Map<string, number>();
  for (const label of labels) {
    labelCounts.set(label, (labelCounts.get(label) ?? 0) + 1);
  }

  const latestPart =
    [...parts]
      .reverse()
      .find((part) => {
        const label = getPartActivityLabel(part);
        return label !== "Working" && label !== "Thinking";
      }) ?? parts[parts.length - 1] ?? null;
  const latestLabel = latestPart ? getPartActivityLabel(latestPart) : "Agent activity";
  const latestDetail = latestPart
    ? getPartActivityDetail(latestPart) || getDefaultActivityDetail(latestLabel)
    : "";

  return {
    latestLabel,
    latestDetail,
    actionSummaries: [...labelCounts.entries()]
      .sort((left, right) => right[1] - left[1])
      .slice(0, 3)
      .map(([label, count]) => getPartActivityCountLabel(label, count)),
  };
}

function summarizePart(part: Record<string, unknown>) {
  const detail = getPartActivityDetail(part);
  if (detail) {
    return detail;
  }

  const defaultDetail = getDefaultActivityDetail(getPartActivityLabel(part));
  if (defaultDetail) {
    return defaultDetail;
  }

  const status = typeof part.status === "string" ? part.status : null;
  const tool = typeof part.tool === "string" ? part.tool : null;
  const title = typeof part.title === "string" ? part.title : null;
  const command = typeof part.command === "string" ? part.command : null;
  const file = typeof part.file === "string" ? part.file : null;
  const details = [title, tool, status, command, file].filter(Boolean);
  return details.join(" · ");
}

function tokenizeInlineCode(line: string) {
  const segments: Array<{ type: "text" | "code"; value: string }> = [];
  const pattern = /`([^`]+)`/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(line)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: "text", value: line.slice(lastIndex, match.index) });
    }
    segments.push({ type: "code", value: match[1] });
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < line.length) {
    segments.push({ type: "text", value: line.slice(lastIndex) });
  }

  return segments.length > 0 ? segments : [{ type: "text", value: line }];
}

function RichTextLine({ text }: { text: string }) {
  const tokens = tokenizeInlineCode(text);

  return (
    <>
      {tokens.map((token, index) =>
        token.type === "code" ? (
          <code key={`${token.type}-${index}`}>{token.value}</code>
        ) : (
          <span key={`${token.type}-${index}`}>{token.value}</span>
        )
      )}
    </>
  );
}

function RichMessageText({ text }: { text: string }) {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (!normalized) {
    return null;
  }

  const nodes: JSX.Element[] = [];
  const lines = normalized.split("\n");
  let paragraphLines: string[] = [];
  let listItems: string[] = [];
  let codeFence: string[] = [];
  let inCodeFence = false;

  const flushParagraph = () => {
    if (paragraphLines.length === 0) {
      return;
    }
    nodes.push(
      <p key={`paragraph-${nodes.length}`}>
        {paragraphLines.map((line, index) => (
          <span key={index}>
            {index > 0 ? <br /> : null}
            <RichTextLine text={line} />
          </span>
        ))}
      </p>
    );
    paragraphLines = [];
  };

  const flushList = () => {
    if (listItems.length === 0) {
      return;
    }
    nodes.push(
      <ul key={`list-${nodes.length}`}>
        {listItems.map((item, index) => (
          <li key={index}>
            <RichTextLine text={item} />
          </li>
        ))}
      </ul>
    );
    listItems = [];
  };

  const flushCodeFence = () => {
    if (codeFence.length === 0) {
      return;
    }
    nodes.push(
      <pre key={`code-${nodes.length}`} className="message-code-block">
        <code>{codeFence.join("\n")}</code>
      </pre>
    );
    codeFence = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();

    if (line.startsWith("```")) {
      flushParagraph();
      flushList();
      if (inCodeFence) {
        flushCodeFence();
      }
      inCodeFence = !inCodeFence;
      continue;
    }

    if (inCodeFence) {
      codeFence.push(rawLine);
      continue;
    }

    const trimmed = line.trim();
    if (!trimmed) {
      flushParagraph();
      flushList();
      continue;
    }

    if (/^[-*]\s+/.test(trimmed)) {
      flushParagraph();
      listItems.push(trimmed.replace(/^[-*]\s+/, ""));
      continue;
    }

    if (/^#{1,3}\s+/.test(trimmed)) {
      flushParagraph();
      flushList();
      const headingLevel = Math.min(4, trimmed.match(/^#+/)?.[0].length ?? 3);
      const HeadingTag = `h${headingLevel}` as keyof JSX.IntrinsicElements;
      nodes.push(
        <HeadingTag key={`heading-${nodes.length}`} className="message-heading">
          <RichTextLine text={trimmed.replace(/^#{1,3}\s+/, "")} />
        </HeadingTag>
      );
      continue;
    }

    flushList();
    paragraphLines.push(trimmed);
  }

  flushParagraph();
  flushList();
  flushCodeFence();

  return <div className="message-rich-text">{nodes}</div>;
}

function MessagePartCard({
  part,
  open = false,
  onToggle,
}: {
  part: Record<string, unknown>;
  open?: boolean;
  onToggle?: (nextOpen: boolean) => void;
}) {
  const partType = typeof part.type === "string" ? part.type : "part";
  const label = getPartActivityLabel(part);
  const summary = summarizePart(part);
  const reasoningText = label === "Thinking" ? extractReasoningPlainText(part) : "";

  return (
    <div className={`part-block part-${partType} ${open ? "open" : ""}`}>
      <button
        type="button"
        className="part-block-toggle"
        onClick={() => onToggle?.(!open)}
        aria-expanded={open}
      >
        <span>{label}</span>
        {summary ? <small>{summary}</small> : null}
      </button>
      {open ? (
        label === "Thinking" ? (
          reasoningText ? (
            <div className="message-rich-text">
              <p>{reasoningText}</p>
            </div>
          ) : (
            <p>Reasoning in progress</p>
          )
        ) : (
          <pre>{JSON.stringify(part, null, 2)}</pre>
        )
      ) : null}
    </div>
  );
}

function AgentActivityCard({
  partItems,
  stateKey,
  latestLabel,
  latestDetail,
  actionSummaries,
  createdAt,
  open,
  onToggle,
  expandedParts,
  onPartToggle,
}: {
  partItems: Array<{ key: string; part: Record<string, unknown> }>;
  stateKey: string;
  latestLabel: string;
  latestDetail: string;
  actionSummaries: string[];
  createdAt: string;
  open: boolean;
  onToggle: (nextOpen: boolean) => void;
  expandedParts: Record<string, boolean>;
  onPartToggle: (partKey: string, nextOpen: boolean) => void;
}) {
  const timestamp = new Date(createdAt).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  return (
    <div className="message-row other activity-row">
      <div className={`agent-activity-card ${open ? "open" : ""}`} data-activity-key={stateKey}>
        <button
          type="button"
          className="agent-activity-toggle"
          onClick={() => onToggle(!open)}
          aria-expanded={open}
        >
          <div className="agent-activity-summary">
            <strong>Agent activity</strong>
            <small>{partItems.length} actions</small>
          </div>
          <div className="agent-activity-meta">
            <span>{latestLabel}</span>
            <small>{timestamp}</small>
          </div>
        </button>
        {open ? <div className="agent-activity-body">
          {latestDetail ? <div className="agent-activity-detail">Latest: {latestDetail}</div> : null}
          {actionSummaries.length > 0 ? (
            <div className="agent-activity-tags">
              {actionSummaries.map((label) => (
                <span key={label}>{label}</span>
              ))}
            </div>
          ) : null}
          <div className="parts-list compact">
            {partItems.map(({ key, part }) => (
              <MessagePartCard
                key={key}
                part={part}
                open={expandedParts[key] ?? false}
                onToggle={(nextOpen) => onPartToggle(key, nextOpen)}
              />
            ))}
          </div>
        </div> : null}
      </div>
    </div>
  );
}

function getSuggestedProjectRoot(projects: Project[], activeProjectId: string | null) {
  const activeProject = projects.find((project) => project.id === activeProjectId) ?? null;
  const sourcePath = activeProject?.path || projects[0]?.path || "";
  const slashIndex = sourcePath.lastIndexOf("/");
  if (slashIndex <= 0) {
    return sourcePath ? `${sourcePath}/` : "";
  }
  return `${sourcePath.slice(0, slashIndex + 1)}`;
}

function normalizeProjectRootPath(path: string) {
  const trimmed = path.trim();
  if (!trimmed || trimmed === "/") {
    return trimmed;
  }
  return trimmed.replace(/\/+$/, "");
}

function buildProjectPathFromRoot(rootPath: string, projectName: string) {
  const normalizedName = projectName.trim();
  const normalizedRoot = normalizeProjectRootPath(rootPath);
  if (!normalizedName) {
    return normalizedRoot;
  }
  if (!normalizedRoot) {
    return normalizedName;
  }
  if (normalizedRoot === "/") {
    return `/${normalizedName}`;
  }
  return `${normalizedRoot}/${normalizedName}`;
}

function extractRootFromProjectPath(pathValue: string, projectName: string) {
  const normalizedPath = pathValue.trim();
  const normalizedName = projectName.trim();
  if (!normalizedName) {
    return normalizeProjectRootPath(normalizedPath);
  }
  const suffix = `/${normalizedName}`;
  if (normalizedPath.endsWith(suffix)) {
    return normalizeProjectRootPath(normalizedPath.slice(0, normalizedPath.length - suffix.length));
  }
  return normalizeProjectRootPath(normalizedPath);
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function detectLanguageFromPath(path: string) {
  const extension = path.toLowerCase().split(".").pop() || "";
  switch (extension) {
    case "ts":
    case "tsx":
      return "TypeScript";
    case "js":
    case "jsx":
      return "JavaScript";
    case "py":
      return "Python";
    case "json":
      return "JSON";
    case "md":
      return "Markdown";
    case "css":
      return "CSS";
    case "html":
      return "HTML";
    case "yml":
    case "yaml":
      return "YAML";
    case "sh":
      return "Shell";
    default:
      return "Text";
  }
}

function formatShortSessionLabel(sessionId: string | null) {
  if (!sessionId) {
    return "Local project chat";
  }
  return "OpenCode session";
}

function formatCompactSessionId(sessionId: string | null) {
  if (!sessionId) {
    return "No session";
  }
  if (sessionId.length <= 18) {
    return sessionId;
  }
  return `${sessionId.slice(0, 8)}...${sessionId.slice(-6)}`;
}

function formatSessionTimestamp(value: string | null) {
  if (!value) {
    return "unknown time";
  }

  const date = new Date(value);
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);

  if (date.toDateString() === yesterday.toDateString()) {
    return `Yesterday ${date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  }

  if (sameDay) {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatSessionOptionLabel(session: ProjectSession, activeSessionId: string | null) {
  const parts = [session.title || "Untitled session"];
  if (session.id === activeSessionId) {
    parts.push("Current");
  }
  parts.push(formatSessionTimestamp(session.updatedAt ?? session.createdAt));
  if (session.summary.files > 0) {
    parts.push(`${session.summary.files} files`);
  }
  return parts.join(" · ");
}

function sortSessionsForDisplay(sessions: ProjectSession[], activeSessionId: string | null) {
  return [...sessions].sort((left, right) => {
    if (left.id === activeSessionId) {
      return -1;
    }
    if (right.id === activeSessionId) {
      return 1;
    }

    const leftTime = new Date(left.updatedAt ?? left.createdAt ?? 0).getTime();
    const rightTime = new Date(right.updatedAt ?? right.createdAt ?? 0).getTime();
    return rightTime - leftTime;
  });
}

type TimelineEntry =
  | {
      kind: "message";
      id: string;
      createdAt: string;
      message: ChatMessage;
    }
  | {
      kind: "task_run";
      id: string;
      createdAt: string;
      run: ScheduledTaskRun;
    };

type RenderedTimelineEntry =
  | TimelineEntry
  | {
      kind: "activity";
      id: string;
      stateKey: string;
      createdAt: string;
      messages: ChatMessage[];
      childIds: string[];
      partItems: Array<{ key: string; part: Record<string, unknown> }>;
      latestLabel: string;
      latestDetail: string;
      actionSummaries: string[];
    };


function timelineEventToTaskRun(event: TimelineEvent): ScheduledTaskRun | null {
  if (event.eventType !== "scheduled_task_run") {
    return null;
  }

  const payload = event.payload ?? {};
  const asString = (value: unknown) => (typeof value === "string" ? value : null);
  const asBoolean = (value: unknown) => Boolean(value);

  const taskRunId = asString(payload.taskRunId) ?? asString(payload.task_run_id) ?? event.id;
  const status = asString(payload.status) ?? "unknown";
  const trigger = asString(payload.trigger) ?? "schedule";

  return {
    id: taskRunId,
    taskId: asString(payload.taskId) ?? "",
    projectId: event.projectId,
    status,
    sessionId: asString(payload.sessionId),
    trigger,
    startedAt: asString(payload.startedAt) ?? event.createdAt,
    finishedAt: asString(payload.finishedAt),
    heartbeatLoaded: asBoolean(payload.heartbeatLoaded),
    outputPreview: asString(payload.outputPreview),
    error: asString(payload.error),
  };
}

function getNonTextParts(message: ChatMessage) {
  return message.parts.filter((part) => part.type !== "text");
}

function isIntermediateAssistantMessage(message: ChatMessage) {
  return message.role === "assistant" && !message.text.trim() && getNonTextParts(message).length > 0;
}

function buildGroupedTimelineEntries(entries: TimelineEntry[]): RenderedTimelineEntry[] {
  const next: RenderedTimelineEntry[] = [];
  let pendingMessages: ChatMessage[] = [];

  const flushPending = () => {
    if (pendingMessages.length === 0) {
      return;
    }
    const partItems = pendingMessages.flatMap((message) =>
      getNonTextParts(message).map((part, index) => ({
        key: buildPartInstanceKey(`activity:${buildMessageStableKey(message)}`, part, index),
        part,
      }))
    );
    const parts = partItems.map((item) => item.part);
    const activitySummary = summarizeActivityParts(parts);
    const firstMessage = pendingMessages[0];
    next.push({
      kind: "activity",
      id: `a-${buildMessageStableKey(firstMessage)}`,
      stateKey: `activity:${buildMessageStableKey(firstMessage)}`,
      createdAt: firstMessage.createdAt,
      messages: pendingMessages,
      childIds: pendingMessages.map((message) => `m-${buildMessageStableKey(message)}`),
      partItems,
      latestLabel: activitySummary.latestLabel,
      latestDetail: activitySummary.latestDetail,
      actionSummaries: activitySummary.actionSummaries,
    });
    pendingMessages = [];
  };

  for (const entry of entries) {
    if (entry.kind === "message" && isIntermediateAssistantMessage(entry.message)) {
      pendingMessages.push(entry.message);
      continue;
    }
    flushPending();
    next.push(entry);
  }

  flushPending();
  return next;
}

type TelemetryMarkerCategory = "search" | "project" | "chat" | "stream" | "system";
type TelemetryTimeWindow = "1m" | "5m" | "15m" | "all";

const NOTIFICATION_PREFERENCE_KEY = "opencode:final-message-notifications";

const TELEMETRY_CATEGORIES: TelemetryMarkerCategory[] = [
  "search",
  "project",
  "chat",
  "stream",
  "system",
];

const TELEMETRY_TIME_WINDOWS: Array<{ value: TelemetryTimeWindow; label: string }> = [
  { value: "1m", label: "Last 1m" },
  { value: "5m", label: "Last 5m" },
  { value: "15m", label: "Last 15m" },
  { value: "all", label: "All" },
];

function markerTimeWindowMs(windowValue: TelemetryTimeWindow): number | null {
  if (windowValue === "1m") {
    return 60_000;
  }
  if (windowValue === "5m") {
    return 5 * 60_000;
  }
  if (windowValue === "15m") {
    return 15 * 60_000;
  }
  return null;
}

function inferTelemetryCategory(event: string): TelemetryMarkerCategory {
  if (event.startsWith("search.")) {
    return "search";
  }
  if (event.startsWith("project.")) {
    return "project";
  }
  if (event.startsWith("chat.")) {
    return "chat";
  }
  if (event.startsWith("stream.")) {
    return "stream";
  }
  return "system";
}

function schedulerHeartbeatState(input: {
  schedulerStatus: SchedulerStatus | null;
  schedulerError: string | null;
  schedulerLoading: boolean;
}): { level: "ok" | "warn" | "error" | "idle"; label: string } {
  if (input.schedulerLoading && !input.schedulerStatus) {
    return { level: "idle", label: "scheduler checking" };
  }
  if (input.schedulerError) {
    return { level: "error", label: "scheduler error" };
  }
  if (!input.schedulerStatus) {
    return { level: "idle", label: "scheduler unknown" };
  }
  if (!input.schedulerStatus.running) {
    return { level: "error", label: "scheduler stopped" };
  }

  const loopAt = input.schedulerStatus.lastLoopAt
    ? new Date(input.schedulerStatus.lastLoopAt).getTime()
    : 0;
  if (!Number.isFinite(loopAt) || loopAt <= 0) {
    return { level: "warn", label: "scheduler warming" };
  }

  const ageMs = Date.now() - loopAt;
  const warnThresholdMs = Math.max(input.schedulerStatus.pollIntervalSeconds * 3000, 120_000);
  const errorThresholdMs = Math.max(input.schedulerStatus.pollIntervalSeconds * 10000, 600_000);

  if (ageMs > errorThresholdMs) {
    return { level: "error", label: "scheduler stale" };
  }
  if (ageMs > warnThresholdMs) {
    return { level: "warn", label: "scheduler delayed" };
  }
  return { level: "ok", label: "scheduler healthy" };
}


function extractJsonFromEventLines(eventLines: string[]): Record<string, unknown> | null {
  const payloadLines = eventLines
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .filter(Boolean);

  if (payloadLines.length === 0) {
    return null;
  }

  const payload = payloadLines.join("\n");
  try {
    const parsed = JSON.parse(payload) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}


function findPermissionId(value: unknown): string | null {
  if (typeof value === "string") {
    return null;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findPermissionId(item);
      if (found) {
        return found;
      }
    }
    return null;
  }

  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const candidates = [
      record.permissionID,
      record.permissionId,
      record.permission_id,
      record.id,
    ];
    for (const candidate of candidates) {
      if (typeof candidate === "string" && candidate.trim()) {
        return candidate;
      }
    }

    for (const item of Object.values(record)) {
      const found = findPermissionId(item);
      if (found) {
        return found;
      }
    }
  }

  return null;
}


function isPermissionResolved(value: unknown): boolean {
  if (typeof value === "string") {
    const text = value.toLowerCase();
    return (
      text.includes("allow") ||
      text.includes("deny") ||
      text.includes("reject") ||
      text.includes("approve")
    );
  }

  if (Array.isArray(value)) {
    return value.some((item) => isPermissionResolved(item));
  }

  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const response = record.response ?? record.decision ?? record.action;
    if (typeof response === "string") {
      return true;
    }
    return Object.values(record).some((item) => isPermissionResolved(item));
  }

  return false;
}


function parseApprovalFromStreamData(data: string): {
  request: ApprovalRequest | null;
  resolvedPermissionId: string | null;
} {
  try {
    const wrapper = JSON.parse(data) as { event?: string[] };
    const lines = Array.isArray(wrapper.event) ? wrapper.event : [];
    const payload = extractJsonFromEventLines(lines);
    if (!payload) {
      return { request: null, resolvedPermissionId: null };
    }

    const typeValue = String(payload.type || "").toLowerCase();
    if (!typeValue.includes("permission")) {
      return { request: null, resolvedPermissionId: null };
    }

    const properties =
      payload.properties && typeof payload.properties === "object"
        ? (payload.properties as Record<string, unknown>)
        : payload;

    const permissionId = findPermissionId(properties);
    if (!permissionId) {
      return { request: null, resolvedPermissionId: null };
    }

    const details = JSON.stringify(properties);
    const resolved = isPermissionResolved(properties);
    if (resolved) {
      return { request: null, resolvedPermissionId: permissionId };
    }

    return {
      request: {
        permissionId,
        title: "Permission requested",
        details,
        createdAt: new Date().toISOString(),
      },
      resolvedPermissionId: null,
    };
  } catch {
    return { request: null, resolvedPermissionId: null };
  }
}

function formatProjectPreview(preview: string | null) {
  const fallback = "Local project chat";
  const raw = (preview || "").trim();
  if (!raw) {
    return fallback;
  }

  const withoutCodeFences = raw.replace(/```[\s\S]*?```/g, " ");
  const normalized = withoutCodeFences.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return fallback;
  }

  const firstSentence = normalized.split(/(?<=[.!?])\s+/)[0] ?? normalized;
  const cleaned = firstSentence
    .replace(/^[-*#>\s`]+/, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .trim();

  const compact = cleaned || normalized;
  if (/^scheduled task run/i.test(compact)) {
    return "Scheduled task update";
  }
  if (/^agent activity/i.test(compact)) {
    return "Agent activity update";
  }
  if (/^the review found no issues/i.test(compact)) {
    return "Review completed with no issues.";
  }

  if (compact.length <= 110) {
    return compact;
  }

  return `${compact.slice(0, 107).trimEnd()}...`;
}


function nextReconnectDelayMs(attempt: number): number {
  const baseDelay = 1000;
  const capDelay = 15000;
  const exp = Math.min(capDelay, baseDelay * 2 ** attempt);
  const jitter = Math.floor(Math.random() * 350);
  return exp + jitter;
}


function LoginView({
  error,
  loading,
  onSubmit,
}: {
  error: string | null;
  loading: boolean;
  onSubmit: (password: string) => Promise<void>;
}) {
  const [password, setPassword] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await onSubmit(password);
  }

  return (
    <div className="auth-screen">
      <form className="auth-card" onSubmit={handleSubmit}>
        <h1>OpenCode Controller</h1>
        <p>Single-password access</p>
        <input
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="Enter password"
          autoComplete="current-password"
        />
        <button disabled={loading} type="submit">
          {loading ? "Signing in..." : "Sign in"}
        </button>
        {error ? <span className="error">{error}</span> : null}
      </form>
    </div>
  );
}

function projectInitials(name: string): string {
  const tokens = name
    .split(/[^A-Za-z0-9]+/)
    .map((token) => token.trim())
    .filter(Boolean);

  if (tokens.length === 0) {
    return "OC";
  }

  const initials = tokens.slice(0, 2).map((token) => token[0]?.toUpperCase() ?? "");
  return initials.join("") || name.slice(0, 2).toUpperCase();
}

function ProjectItem({
  project,
  active,
  highlighted,
  onSelect,
}: {
  project: Project;
  active: boolean;
  highlighted: boolean;
  onSelect: (projectId: string) => void;
}) {
  const time = new Date(project.lastActivityAt).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  const preview = formatProjectPreview(project.lastMessagePreview);

  return (
    <button
      className={`project-item ${active ? "active" : ""} ${highlighted ? "highlighted" : ""}`}
      onClick={() => onSelect(project.id)}
      type="button"
      title={project.path}
    >
      <div className="project-avatar" aria-hidden="true">
        {projectInitials(project.name)}
      </div>
      <div className="project-main">
        <div className="project-row">
          <strong>{project.name}</strong>
          <span>{time}</span>
        </div>
        <div className="project-row secondary">
          <small>{preview}</small>
          <small>{project.sessionStatus}</small>
        </div>
      </div>
    </button>
  );
}

function VirtualizedProjectList({
  projects,
  activeProjectId,
  highlightedProjectId,
  onSelect,
  emptyLabel,
  searchQuery,
  totalLabel,
  hasMore,
  isLoadingMore,
  onReachEnd,
  rowHeight = 84,
}: {
  projects: Project[];
  activeProjectId: string | null;
  highlightedProjectId: string | null;
  onSelect: (projectId: string) => void;
  emptyLabel: string;
  searchQuery: string;
  totalLabel: string;
  hasMore: boolean;
  isLoadingMore: boolean;
  onReachEnd: () => void;
  rowHeight?: number;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const overscan = 6;

  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(560);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const updateSize = () => {
      setViewportHeight(container.clientHeight || 560);
    };

    updateSize();

    const observer = new ResizeObserver(() => {
      updateSize();
    });
    observer.observe(container);

    return () => {
      observer.disconnect();
    };
  }, []);

  const totalHeight = projects.length * rowHeight;
  const highlightedIndex = highlightedProjectId
    ? projects.findIndex((project) => project.id === highlightedProjectId)
    : -1;
  const startIndex = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const endIndex = Math.min(
    projects.length,
    Math.ceil((scrollTop + viewportHeight) / rowHeight) + overscan
  );
  const visible = projects.slice(startIndex, endIndex);

  useEffect(() => {
    if (highlightedIndex < 0) {
      return;
    }

    const container = containerRef.current;
    if (!container) {
      return;
    }

    const rowTop = highlightedIndex * rowHeight;
    const rowBottom = rowTop + rowHeight;
    const viewTop = container.scrollTop;
    const viewBottom = viewTop + container.clientHeight;

    if (rowTop < viewTop) {
      container.scrollTop = rowTop;
      return;
    }
    if (rowBottom > viewBottom) {
      container.scrollTop = Math.max(0, rowBottom - container.clientHeight);
    }
  }, [highlightedIndex]);

  return (
    <div
      className="project-list project-list-virtualized"
      ref={containerRef}
      onScroll={(event) => {
        const nextScrollTop = event.currentTarget.scrollTop;
        setScrollTop(nextScrollTop);

        if (!hasMore || isLoadingMore) {
          return;
        }

        const visibleBottom = nextScrollTop + event.currentTarget.clientHeight;
        const threshold = Math.max(220, rowHeight * 3);
        if (visibleBottom >= event.currentTarget.scrollHeight - threshold) {
          onReachEnd();
        }
      }}
    >
      {projects.length === 0 ? (
        <div className="project-list-empty-card">
          <strong>{emptyLabel}</strong>
          <small>
            {isLoadingMore
              ? "Loading chats..."
              : searchQuery
                ? `No chats matched "${searchQuery}".`
                : "Create a project to start a local OpenCode chat."}
          </small>
        </div>
      ) : null}
      <div className="project-virtual-canvas" style={{ height: totalHeight }}>
        {visible.map((project, offset) => {
          const index = startIndex + offset;
          return (
            <div
              className="project-virtual-row"
              key={project.id}
              style={{ transform: `translateY(${index * rowHeight}px)` }}
            >
              <ProjectItem
                project={project}
                active={project.id === activeProjectId}
                highlighted={project.id === highlightedProjectId}
                onSelect={onSelect}
              />
            </div>
          );
        })}
      </div>
      {projects.length > 0 || isLoadingMore ? (
        <div className="project-list-footer">
          <span>{isLoadingMore ? "Loading more chats..." : totalLabel}</span>
          {hasMore && !isLoadingMore ? <small>Scroll for more</small> : null}
        </div>
      ) : null}
    </div>
  );
}

function MessageParts({
  parts,
  partScope,
  expandedParts,
  onPartToggle,
}: {
  parts: Array<Record<string, unknown>>;
  partScope: string;
  expandedParts: Record<string, boolean>;
  onPartToggle: (partKey: string, nextOpen: boolean) => void;
}) {
  const nonTextParts = parts.filter((part) => part.type !== "text");
  if (nonTextParts.length === 0) {
    return null;
  }

  return (
    <div className="parts-list">
      {nonTextParts.map((part, index) => (
        <MessagePartCard
          key={buildPartInstanceKey(partScope, part, index)}
          part={part}
          open={expandedParts[buildPartInstanceKey(partScope, part, index)] ?? false}
          onToggle={(nextOpen) => onPartToggle(buildPartInstanceKey(partScope, part, index), nextOpen)}
        />
      ))}
    </div>
  );
}

function CollapsedMessageParts({
  parts,
  groupOpen,
  onGroupToggle,
  partScope,
  expandedParts,
  onPartToggle,
}: {
  parts: Array<Record<string, unknown>>;
  groupOpen: boolean;
  onGroupToggle: (nextOpen: boolean) => void;
  partScope: string;
  expandedParts: Record<string, boolean>;
  onPartToggle: (partKey: string, nextOpen: boolean) => void;
}) {
  const nonTextParts = parts.filter((part) => part.type !== "text");
  if (nonTextParts.length === 0) {
    return null;
  }

  const activitySummary = summarizeActivityParts(nonTextParts);

  return (
    <div className={`message-parts-collapsed ${groupOpen ? "open" : ""}`}>
      <button
        type="button"
        className="message-parts-toggle"
        onClick={() => onGroupToggle(!groupOpen)}
        aria-expanded={groupOpen}
      >
        <span>Activity details</span>
        <small>{activitySummary.actionSummaries.join(" · ") || `${nonTextParts.length} actions`}</small>
      </button>
      {groupOpen ? (
        <MessageParts
          parts={nonTextParts}
          partScope={partScope}
          expandedParts={expandedParts}
          onPartToggle={onPartToggle}
        />
      ) : null}
    </div>
  );
}

function MessageBubble({
  message,
  canSpeak,
  speaking,
  attachedTop,
  attachedBottom,
  showParts,
  collapseParts,
  onSpeak,
  activityOpen,
  onActivityToggle,
  expandedParts,
  onPartToggle,
}: {
  message: ChatMessage;
  canSpeak: boolean;
  speaking: boolean;
  attachedTop: boolean;
  attachedBottom: boolean;
  showParts: boolean;
  collapseParts: boolean;
  onSpeak: (message: ChatMessage) => void;
  activityOpen: boolean;
  onActivityToggle: (nextOpen: boolean) => void;
  expandedParts: Record<string, boolean>;
  onPartToggle: (partKey: string, nextOpen: boolean) => void;
}) {
  const own = message.role === "user";
  const timestamp = new Date(message.createdAt).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  return (
    <div
      className={`message-row ${own ? "own" : "other"} ${attachedTop ? "attached-top" : ""} ${attachedBottom ? "attached-bottom" : ""}`}
    >
      <article
        className={`bubble ${own ? "own" : "other"} ${attachedTop ? "attached-top" : ""} ${attachedBottom ? "attached-bottom" : ""}`}
      >
        {canSpeak ? (
          <button type="button" className="speak-button" onClick={() => onSpeak(message)}>
            {speaking ? "Playing..." : "Play"}
          </button>
        ) : null}
        <RichMessageText text={message.text} />
        {showParts ? (
          collapseParts ? (
            <CollapsedMessageParts
              parts={message.parts}
              groupOpen={activityOpen}
              onGroupToggle={onActivityToggle}
              partScope={`message:${buildMessageStableKey(message)}`}
              expandedParts={expandedParts}
              onPartToggle={onPartToggle}
            />
          ) : (
            <MessageParts
              parts={message.parts}
              partScope={`message:${buildMessageStableKey(message)}`}
              expandedParts={expandedParts}
              onPartToggle={onPartToggle}
            />
          )
        ) : null}
        <small>{timestamp}</small>
      </article>
    </div>
  );
}

function TaskRunTimelineRow({ run }: { run: ScheduledTaskRun }) {
  const started = run.startedAt ? new Date(run.startedAt) : null;
  const finished = run.finishedAt ? new Date(run.finishedAt) : null;
  const status = run.status.toLowerCase();
  const title = run.trigger === "manual" ? "Scheduled task run (manual)" : "Scheduled task run";
  const tone = taskStatusTone(run.status);

  return (
    <div className="message-row other">
      <article className={`task-run-row ${status} ${tone}`}>
        <header>
          <div className="task-run-row-title">
            <strong>{title}</strong>
            <small>{started ? started.toLocaleString() : "Unknown time"}</small>
          </div>
          <span className={`task-status-badge ${tone}`}>{status}</span>
        </header>
        <div className="task-run-row-meta">
          <span className="task-status-badge idle">
            {run.heartbeatLoaded ? "heartbeat loaded" : "heartbeat missing"}
          </span>
          {run.sessionId ? <span className="task-status-badge idle">{formatCompactSessionId(run.sessionId)}</span> : null}
          <span className="task-status-badge idle">
            {finished ? `finished ${formatRelativeTaskTime(run.finishedAt)}` : "still running"}
          </span>
        </div>
        {run.outputPreview ? <p className="task-preview">{run.outputPreview}</p> : null}
        {run.error ? <p className="task-error">{run.error}</p> : null}
      </article>
    </div>
  );
}

function formatRelativeTaskTime(value: string | null) {
  if (!value) {
    return "Not scheduled";
  }

  const date = new Date(value);
  const deltaMs = date.getTime() - Date.now();
  const absMinutes = Math.round(Math.abs(deltaMs) / 60_000);

  if (absMinutes < 1) {
    return deltaMs >= 0 ? "in under a minute" : "less than a minute ago";
  }

  if (absMinutes < 60) {
    return deltaMs >= 0 ? `in ${absMinutes}m` : `${absMinutes}m ago`;
  }

  const absHours = Math.round(absMinutes / 60);
  if (absHours < 24) {
    return deltaMs >= 0 ? `in ${absHours}h` : `${absHours}h ago`;
  }

  const absDays = Math.round(absHours / 24);
  return deltaMs >= 0 ? `in ${absDays}d` : `${absDays}d ago`;
}

function formatElapsedShort(ms: number) {
  const safeMs = Math.max(0, ms);
  const totalSeconds = Math.floor(safeMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function taskStatusTone(status: string) {
  const normalized = status.toLowerCase();
  if (normalized === "success" || normalized === "completed") {
    return "success";
  }
  if (normalized === "running") {
    return "running";
  }
  if (normalized === "failed" || normalized === "error") {
    return "error";
  }
  return "idle";
}

function DiffPanel({ diff }: { diff: SessionDiffEntry[] }) {
  if (diff.length === 0) {
    return null;
  }

  return (
    <details className="diff-panel">
      <summary>Session file changes ({diff.length})</summary>
      <pre>{JSON.stringify(diff, null, 2)}</pre>
    </details>
  );
}

function ProjectFilesPanel({
  projectId,
  entries,
  truncated,
  loading,
  loadedDirectories,
  loadingDirectories,
  loadError,
  query,
  onQueryChange,
  selectedFilePath,
  onSelectFile,
  onExpandDirectory,
  content,
  contentLoading,
  contentError,
  mobile,
}: {
  projectId: string;
  entries: ProjectFileEntry[];
  truncated: boolean;
  loading: boolean;
  loadedDirectories: string[];
  loadingDirectories: string[];
  loadError: string | null;
  query: string;
  onQueryChange: (value: string) => void;
  selectedFilePath: string | null;
  onSelectFile: (path: string) => void;
  onExpandDirectory: (path: string) => Promise<void>;
  content: ProjectFileContent | null;
  contentLoading: boolean;
  contentError: string | null;
  mobile: boolean;
}) {
  const [collapsedDirectories, setCollapsedDirectories] = useState<Set<string>>(new Set());
  const [listScrollTop, setListScrollTop] = useState(0);
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [treePaneWidth, setTreePaneWidth] = useState(34);
  const [mobileTreePaneHeight, setMobileTreePaneHeight] = useState(38);
  const [downloadingArchive, setDownloadingArchive] = useState(false);
  const [downloadingFilePath, setDownloadingFilePath] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const resizingSplitterRef = useRef(false);

  useEffect(() => {
    setCollapsedDirectories(new Set());
    setListScrollTop(0);
    setFocusedIndex(0);
    setTreePaneWidth(34);
    setMobileTreePaneHeight(38);
  }, [projectId]);

  const normalizedQuery = query.trim().toLowerCase();
  const dedupedEntries = useMemo(() => {
    const seen = new Set<string>();
    const unique: ProjectFileEntry[] = [];
    for (const entry of entries) {
      const key = `${entry.path}:${entry.isDir ? "d" : "f"}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      unique.push(entry);
    }
    unique.sort((left, right) => {
      const leftParent = left.path.includes("/") ? left.path.slice(0, left.path.lastIndexOf("/")) : "";
      const rightParent = right.path.includes("/") ? right.path.slice(0, right.path.lastIndexOf("/")) : "";

      if (leftParent === rightParent) {
        if (left.isDir !== right.isDir) {
          return left.isDir ? -1 : 1;
        }

        return left.name.localeCompare(right.name, undefined, {
          numeric: true,
          sensitivity: "base",
        });
      }

      return left.path.localeCompare(right.path, undefined, {
        numeric: true,
        sensitivity: "base",
      });
    });
    return unique;
  }, [entries]);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      if (!resizingSplitterRef.current || !panelRef.current) {
        return;
      }
      const rect = panelRef.current.getBoundingClientRect();
      if (mobile) {
        const relativeY = event.clientY - rect.top;
        const nextHeightPercent = (relativeY / rect.height) * 100;
        const clamped = Math.min(70, Math.max(22, nextHeightPercent));
        setMobileTreePaneHeight(clamped);
      } else {
        const relativeX = event.clientX - rect.left;
        const nextWidthPercent = (relativeX / rect.width) * 100;
        const clamped = Math.min(70, Math.max(20, nextWidthPercent));
        setTreePaneWidth(clamped);
      }
    };

    const handlePointerUp = () => {
      resizingSplitterRef.current = false;
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [mobile]);

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

  const visibleEntries = useMemo(() => {
    if (!normalizedQuery) {
      return dedupedEntries;
    }
    return dedupedEntries.filter((entry) => entry.path.toLowerCase().includes(normalizedQuery));
  }, [dedupedEntries, normalizedQuery]);

  const flattenedEntries = useMemo(() => {
    const rows: ProjectFileEntry[] = [];
    for (const entry of visibleEntries) {
      if (entry.depth > 0) {
        const segments = entry.path.split("/");
        let hidden = false;
        for (let index = 1; index < segments.length; index += 1) {
          const parentPath = segments.slice(0, index).join("/");
          if (collapsedDirectories.has(parentPath)) {
            hidden = true;
            break;
          }
        }
        if (hidden) {
          continue;
        }
      }
      rows.push(entry);
    }
    return rows;
  }, [visibleEntries, collapsedDirectories]);

  const rowHeight = 34;
  const visibleWindow = mobile ? 10 : 18;
  const startIndex = Math.max(0, Math.floor(listScrollTop / rowHeight) - 8);
  const endIndex = Math.min(
    flattenedEntries.length,
    startIndex + visibleWindow + 16
  );
  const virtualRows = flattenedEntries.slice(startIndex, endIndex);
  const totalHeight = flattenedEntries.length * rowHeight;

  const fileEntries = visibleEntries.filter((entry) => !entry.isDir);
  const selectedFileDownloadUrl = selectedFilePath
    ? projectFileDownloadUrl(projectId, selectedFilePath)
    : null;
  const archiveDownloadUrl = projectArchiveDownloadUrl(projectId);
  const textLines = content?.text ? content.text.split("\n") : [];

  useEffect(() => {
    if (flattenedEntries.length === 0) {
      setFocusedIndex(0);
      return;
    }
    if (focusedIndex >= flattenedEntries.length) {
      setFocusedIndex(flattenedEntries.length - 1);
    }
  }, [flattenedEntries.length, focusedIndex]);

  useEffect(() => {
    const list = listRef.current;
    if (!list || flattenedEntries.length === 0) {
      return;
    }
    const rowTop = focusedIndex * rowHeight;
    const rowBottom = rowTop + rowHeight;
    const viewTop = list.scrollTop;
    const viewBottom = viewTop + list.clientHeight;
    if (rowTop < viewTop) {
      list.scrollTop = rowTop;
      return;
    }
    if (rowBottom > viewBottom) {
      list.scrollTop = rowBottom - list.clientHeight;
    }
  }, [focusedIndex, flattenedEntries.length]);

  function findParentDirectoryPath(path: string): string | null {
    const segments = path.split("/");
    if (segments.length < 2) {
      return null;
    }
    return segments.slice(0, -1).join("/");
  }

  function handleTreeKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (flattenedEntries.length === 0) {
      return;
    }

    const focusedEntry = flattenedEntries[focusedIndex] ?? null;
    if (!focusedEntry) {
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setFocusedIndex((current) => Math.min(flattenedEntries.length - 1, current + 1));
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setFocusedIndex((current) => Math.max(0, current - 1));
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      if (focusedEntry.isDir) {
        toggleDirectory(focusedEntry.path);
      } else {
        onSelectFile(focusedEntry.path);
      }
      return;
    }

    if (event.key === "ArrowRight" && focusedEntry.isDir) {
      event.preventDefault();
      if (collapsedDirectories.has(focusedEntry.path)) {
        toggleDirectory(focusedEntry.path);
      } else if (!loadedDirectories.includes(focusedEntry.path)) {
        void onExpandDirectory(focusedEntry.path);
      }
      return;
    }

    if (event.key === "ArrowLeft") {
      event.preventDefault();
      if (focusedEntry.isDir && !collapsedDirectories.has(focusedEntry.path)) {
        toggleDirectory(focusedEntry.path);
        return;
      }
      const parentPath = findParentDirectoryPath(focusedEntry.path);
      if (!parentPath) {
        return;
      }
      const parentIndex = flattenedEntries.findIndex(
        (entry) => entry.isDir && entry.path === parentPath
      );
      if (parentIndex >= 0) {
        setFocusedIndex(parentIndex);
      }
    }
  }

  function toggleDirectory(path: string) {
    const willExpand = collapsedDirectories.has(path);
    setCollapsedDirectories((current) => {
      const next = new Set(current);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
    if (willExpand && !loadedDirectories.includes(path) && !loadingDirectories.includes(path)) {
      void onExpandDirectory(path);
    }
  }

  function handleSplitterPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault();
    resizingSplitterRef.current = true;
  }

  async function downloadFromUrl(url: string, fallbackName: string) {
    const response = await fetch(url, {
      credentials: "include",
    });
    if (!response.ok) {
      let message = `Download failed (${response.status})`;
      try {
        const body = (await response.json()) as { error?: string };
        if (body.error) {
          message = body.error;
        }
      } catch {
        // ignore parse failure
      }
      throw new Error(message);
    }

    const blob = await response.blob();
    const disposition = response.headers.get("content-disposition") || "";
    const match = disposition.match(/filename\*?=(?:UTF-8''|"?)([^";]+)/i);
    const suggestedName = match ? decodeURIComponent(match[1].replace(/"/g, "")) : fallbackName;

    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = suggestedName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => {
      URL.revokeObjectURL(objectUrl);
    }, 1000);
  }

  async function handleDownloadArchive() {
    setDownloadError(null);
    setDownloadingArchive(true);
    try {
      await downloadFromUrl(archiveDownloadUrl, "project-files.zip");
    } catch (error) {
      setDownloadError(error instanceof Error ? error.message : "Failed to download archive");
    } finally {
      setDownloadingArchive(false);
    }
  }

  async function handleDownloadFile() {
    if (!selectedFilePath || !selectedFileDownloadUrl) {
      return;
    }
    setDownloadError(null);
    setDownloadingFilePath(selectedFilePath);
    try {
      const fallbackName = selectedFilePath.split("/").pop() || "file";
      await downloadFromUrl(selectedFileDownloadUrl, fallbackName);
    } catch (error) {
      setDownloadError(error instanceof Error ? error.message : "Failed to download file");
    } finally {
      setDownloadingFilePath((current) => (current === selectedFilePath ? null : current));
    }
  }

  return (
    <div className={`project-files-panel ${mobile ? "mobile" : ""}`}>
      <div className="project-files-toolbar">
        <input
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Filter files by path"
        />
        <button
          type="button"
          className={`ghost-button download-button ${downloadingArchive ? "downloading" : ""}`}
          onClick={() => {
            void handleDownloadArchive();
          }}
          disabled={downloadingArchive}
        >
          {downloadingArchive ? "Downloading zip..." : "Download zip"}
        </button>
      </div>
      {downloadError ? <div className="project-files-error">{downloadError}</div> : null}
      <div
        className="project-files-content"
        ref={panelRef}
        style={
          mobile
            ? {
                gridTemplateColumns: "1fr",
                gridTemplateRows: `minmax(160px, ${mobileTreePaneHeight}%) 8px minmax(220px, ${
                  100 - mobileTreePaneHeight
                }%)`,
              }
            : {
                gridTemplateColumns: `minmax(240px, ${treePaneWidth}%) 8px minmax(320px, ${
                  100 - treePaneWidth
                }%)`,
              }
        }
      >
        <div
          className="project-files-list"
          aria-label="Project files"
          tabIndex={0}
          ref={listRef}
          onScroll={(event) => setListScrollTop(event.currentTarget.scrollTop)}
          onKeyDown={handleTreeKeyDown}
        >
          {loading ? <div className="project-files-muted">Loading files...</div> : null}
          {loadError ? <div className="project-files-error">{loadError}</div> : null}
          {!loading && !loadError && visibleEntries.length === 0 ? (
            <div className="project-files-muted">No files match this filter.</div>
          ) : null}
          {!loading && !loadError ? (
            <div className="project-files-canvas" style={{ height: `${totalHeight}px` }}>
              {virtualRows.map((entry, index) => {
                const absoluteIndex = startIndex + index;
                const isSelected = entry.path === selectedFilePath;
                if (entry.isDir) {
                  const collapsed = collapsedDirectories.has(entry.path);
                  const directoryLoading = loadingDirectories.includes(entry.path);
                  const directoryLoaded = loadedDirectories.includes(entry.path);
                  return (
                    <button
                      type="button"
                      key={`${entry.path}:d:${absoluteIndex}`}
                      className={`project-file-row dir ${absoluteIndex === focusedIndex ? "focused" : ""}`}
                      style={{
                        top: `${absoluteIndex * rowHeight}px`,
                        paddingLeft: `${0.6 + entry.depth * 0.85}rem`,
                      }}
                      onClick={() => {
                        setFocusedIndex(absoluteIndex);
                        toggleDirectory(entry.path);
                      }}
                    >
                      <span>{collapsed ? "▸" : "▾"}</span>
                      <strong>{entry.name}</strong>
                      <small>{directoryLoading ? "loading" : directoryLoaded ? "folder" : "expand"}</small>
                    </button>
                  );
                }

                return (
                  <button
                    type="button"
                    key={`${entry.path}:f:${absoluteIndex}`}
                    className={`project-file-row file ${isSelected ? "active" : ""} ${absoluteIndex === focusedIndex ? "focused" : ""}`}
                    style={{
                      top: `${absoluteIndex * rowHeight}px`,
                      paddingLeft: `${0.6 + entry.depth * 0.85}rem`,
                    }}
                    onClick={() => {
                      setFocusedIndex(absoluteIndex);
                      onSelectFile(entry.path);
                    }}
                  >
                    <span>📄</span>
                    <strong>{entry.name}</strong>
                    <small>{formatFileSize(entry.size)}</small>
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
        <div
          className={`project-files-splitter ${mobile ? "mobile" : ""}`}
          role="separator"
          aria-label="Resize file tree and preview"
          aria-orientation={mobile ? "horizontal" : "vertical"}
          onPointerDown={handleSplitterPointerDown}
        />
        <div className="project-file-preview">
          <div className="project-file-preview-head">
            <strong>{selectedFilePath || "Select a file"}</strong>
            {selectedFileDownloadUrl ? (
              <button
                type="button"
                className={`ghost-button download-button ${
                  downloadingFilePath === selectedFilePath ? "downloading" : ""
                }`}
                onClick={() => {
                  void handleDownloadFile();
                }}
                disabled={downloadingFilePath === selectedFilePath}
              >
                {downloadingFilePath === selectedFilePath ? "Downloading..." : "Download"}
              </button>
            ) : null}
          </div>
          {contentLoading ? <div className="project-files-muted">Loading preview...</div> : null}
          {contentError ? <div className="project-files-error">{contentError}</div> : null}
          {!selectedFilePath && !contentLoading ? (
            <div className="project-files-muted">Choose a file to preview it.</div>
          ) : null}
          {content && !contentLoading && !contentError ? (
            <div className="project-file-preview-body">
              <div className="project-file-meta">
                <span>{detectLanguageFromPath(content.path)}</span>
                <span>{formatFileSize(content.size)}</span>
                {content.modifiedAt ? <span>{new Date(content.modifiedAt).toLocaleString()}</span> : null}
                {content.truncated ? <span>Preview truncated</span> : null}
              </div>
              {content.mimeType.startsWith("image/") ? (
                <img src={selectedFileDownloadUrl || ""} alt={content.path} className="project-file-image-preview" />
              ) : null}
              {content.mimeType === "application/pdf" ? (
                <iframe src={selectedFileDownloadUrl || ""} title={content.path} className="project-file-pdf-preview" />
              ) : null}
              {!content.mimeType.startsWith("image/") && content.mimeType !== "application/pdf" && content.isBinary ? (
                <div className="project-files-muted">Binary file preview is not available. Use Download.</div>
              ) : null}
              {!content.isBinary && !content.mimeType.startsWith("image/") && content.mimeType !== "application/pdf" ? (
                <div className="project-file-code">
                  {textLines.map((line, index) => (
                    <div key={`${content.path}-${index}`} className="project-file-code-line">
                      <span className="project-file-line-number">{index + 1}</span>
                      <code>{line || " "}</code>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
          {!loading && !loadError && fileEntries.length === 0 ? (
            <div className="project-files-muted">No files available in this project yet.</div>
          ) : null}
        </div>
      </div>
      {truncated ? <div className="project-files-muted">File list is truncated for performance.</div> : null}
    </div>
  );
}

function ScheduledTaskPanel({
  loading,
  saving,
  running,
  deleting,
  error,
  instruction,
  intervalMinutes,
  enabled,
  task,
  runs,
  onInstructionChange,
  onIntervalChange,
  onEnabledChange,
  onSave,
  onRunNow,
  onDelete,
}: {
  loading: boolean;
  saving: boolean;
  running: boolean;
  deleting: boolean;
  error: string | null;
  instruction: string;
  intervalMinutes: number;
  enabled: boolean;
  task: ScheduledTask | null;
  runs: ScheduledTaskRun[];
  onInstructionChange: (value: string) => void;
  onIntervalChange: (value: number) => void;
  onEnabledChange: (value: boolean) => void;
  onSave: () => Promise<void>;
  onRunNow: () => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const taskTone = task ? taskStatusTone(task.lastStatus) : "idle";

  return (
    <details className="task-panel">
      <summary>
        Scheduled task {task ? "configured" : "not configured"}
        {task ? ` (${task.lastStatus})` : ""}
      </summary>
      <div className="task-panel-content">
        {loading ? <p className="task-muted">Loading task...</p> : null}
        {error ? <p className="error">{error}</p> : null}

        {task ? (
          <div className="task-overview">
            <span className={`task-status-badge ${taskTone}`}>{task.enabled ? "Enabled" : "Paused"}</span>
            <span className={`task-status-badge ${taskTone}`}>Last {task.lastStatus.toLowerCase()}</span>
            <span className="task-status-badge idle">Next {formatRelativeTaskTime(task.nextRunAt)}</span>
            <span className="task-status-badge idle">Last run {formatRelativeTaskTime(task.lastRunAt)}</span>
          </div>
        ) : null}

        <label>
          <span>Instruction</span>
          <textarea
            value={instruction}
            onChange={(event) => onInstructionChange(event.target.value)}
            placeholder="Instruction to run in dedicated task session"
          />
        </label>

        <div className="task-inline-fields">
          <label>
            <span>Interval (minutes)</span>
            <input
              type="number"
              min={5}
              value={intervalMinutes}
              onChange={(event) => onIntervalChange(Number(event.target.value) || 5)}
            />
          </label>
          <label className="task-enabled">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(event) => onEnabledChange(event.target.checked)}
            />
            <span>Enabled</span>
          </label>
        </div>

        <div className="task-actions">
          <button type="button" disabled={saving} onClick={() => void onSave()}>
            {saving ? "Saving..." : "Save task"}
          </button>
          <button type="button" disabled={running || !task} onClick={() => void onRunNow()}>
            {running ? "Running..." : "Run now"}
          </button>
          <button
            type="button"
            className="danger"
            disabled={deleting || !task}
            onClick={() => void onDelete()}
          >
            {deleting ? "Deleting..." : "Delete"}
          </button>
        </div>

        {task ? (
          <div className="task-status-meta">
            <small>next: {task.nextRunAt ? new Date(task.nextRunAt).toLocaleString() : "-"}</small>
            <small>last: {task.lastRunAt ? new Date(task.lastRunAt).toLocaleString() : "-"}</small>
          </div>
        ) : null}

        <div className="task-runs">
          <strong>Recent runs</strong>
          {runs.length === 0 ? (
            <p className="task-muted">No runs yet.</p>
          ) : (
            <ul>
              {runs.slice(0, 8).map((run) => (
                <li key={run.id} className={`task-run-item ${taskStatusTone(run.status)}`}>
                  <div className="task-run-item-main">
                    <strong>{run.trigger === "manual" ? "Manual run" : "Scheduled run"}</strong>
                    <small>{run.startedAt ? new Date(run.startedAt).toLocaleString() : "Unknown time"}</small>
                  </div>
                  <div className="task-run-item-meta">
                    <span className={`task-status-badge ${taskStatusTone(run.status)}`}>{run.status}</span>
                    <span className="task-status-badge idle">{run.heartbeatLoaded ? "heartbeat loaded" : "heartbeat missing"}</span>
                  </div>
                  {run.outputPreview ? <p>{run.outputPreview}</p> : null}
                  {run.error ? <p className="task-error-inline">{run.error}</p> : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </details>
  );
}

function ChatStateCard({
  title,
  detail,
}: {
  title: string;
  detail: string;
}) {
  return (
    <div className="empty-state">
      <div className="empty-pill">
        <p>{title}</p>
        <small>{detail}</small>
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <ChatStateCard
      title="This session is ready."
      detail="Send a prompt to start, then use the Stop button in the composer if you need to interrupt a run."
    />
  );
}

function FixtureBanner({ mode }: { mode: DevFixtureMode }) {
  return <div className="fixture-banner">Fixture mode: {mode}</div>;
}

function ChatTransitionStrip({
  tone,
  label,
  detail,
}: {
  tone: "idle" | "info" | "warn";
  label: string;
  detail: string;
}) {
  return (
    <div className={`chat-transition-strip ${tone}`} role="status" aria-live="polite">
      <strong>{label}</strong>
      <small>{detail}</small>
    </div>
  );
}

function parseSlashCommand(input: string): { command: string; argumentsList: string[] } | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/")) {
    return null;
  }

  const segments = trimmed
    .slice(1)
    .split(" ")
    .map((segment) => segment.trim())
    .filter(Boolean);
  if (segments.length === 0) {
    return null;
  }

  return {
    command: segments[0],
    argumentsList: segments.slice(1),
  };
}

export function App() {
  const PROJECTS_PAGE_SIZE = 120;
  const fixtureMode = useMemo(() => resolveDevFixtureMode(), []);

  const [authLoading, setAuthLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [projectError, setProjectError] = useState<string | null>(null);

  const [newProjectName, setNewProjectName] = useState("");
  const [newProjectRootPath, setNewProjectRootPath] = useState("");
  const [newProjectPath, setNewProjectPath] = useState("");
  const [defaultProjectRoot, setDefaultProjectRoot] = useState("");
  const [projectSearch, setProjectSearch] = useState("");
  const [highlightedProjectId, setHighlightedProjectId] = useState<string | null>(null);
  const [creatingProject, setCreatingProject] = useState(false);
  const [, setSyncingProjects] = useState(false);
  const [loadingMoreProjects, setLoadingMoreProjects] = useState(false);
  const [projectsHasMore, setProjectsHasMore] = useState(false);
  const [projectsTotal, setProjectsTotal] = useState(0);
  const [searchProjects, setSearchProjects] = useState<Project[]>([]);
  const [searchHasMore, setSearchHasMore] = useState(false);
  const [searchTotal, setSearchTotal] = useState(0);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchDebouncing, setSearchDebouncing] = useState(false);
  const [basePageLoads, setBasePageLoads] = useState(0);
  const [searchPageLoads, setSearchPageLoads] = useState(0);
  const [lastBaseLoadMs, setLastBaseLoadMs] = useState<number | null>(null);
  const [lastSearchLoadMs, setLastSearchLoadMs] = useState<number | null>(null);
  const [lastSearchQuery, setLastSearchQuery] = useState("");
  const [telemetryMarkers, setTelemetryMarkers] = useState<TelemetryMarker[]>([]);
  const [markerCategoryFilter, setMarkerCategoryFilter] = useState<
    Record<TelemetryMarkerCategory, boolean>
  >({
    search: true,
    project: true,
    chat: true,
    stream: true,
    system: true,
  });
  const [markerTimeWindow, setMarkerTimeWindow] = useState<TelemetryTimeWindow>("all");

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [composerValue, setComposerValue] = useState("");
  const [sending, setSending] = useState(false);
  const [aborting, setAborting] = useState(false);
  const [runIntentActive, setRunIntentActive] = useState(false);
  const [stopFeedbackLabel, setStopFeedbackLabel] = useState<string | null>(null);
  const [stopFeedbackUntilMs, setStopFeedbackUntilMs] = useState<number | null>(null);
  const [recording, setRecording] = useState(false);
  const [transcribingAudio, setTranscribingAudio] = useState(false);
  const [speakingMessageId, setSpeakingMessageId] = useState<string | null>(null);
  const [diffEntries, setDiffEntries] = useState<SessionDiffEntry[]>([]);
  const [projectFileEntries, setProjectFileEntries] = useState<ProjectFileEntry[]>([]);
  const [projectFilesTruncated, setProjectFilesTruncated] = useState(false);
  const [projectFilesLoading, setProjectFilesLoading] = useState(false);
  const [projectFileLoadedDirs, setProjectFileLoadedDirs] = useState<string[]>([]);
  const [projectFileLoadingDirs, setProjectFileLoadingDirs] = useState<string[]>([]);
  const [projectFilesError, setProjectFilesError] = useState<string | null>(null);
  const [projectFileQuery, setProjectFileQuery] = useState("");
  const [selectedProjectFilePath, setSelectedProjectFilePath] = useState<string | null>(null);
  const [selectedProjectFileContent, setSelectedProjectFileContent] = useState<ProjectFileContent | null>(null);
  const [projectFileContentLoading, setProjectFileContentLoading] = useState(false);
  const [projectFileContentError, setProjectFileContentError] = useState<string | null>(null);
  const [streamStatus, setStreamStatus] = useState("idle");
  const [reconnectStartedAtMs, setReconnectStartedAtMs] = useState<number | null>(null);
  const [reconnectAttemptCount, setReconnectAttemptCount] = useState(0);
  const [pendingApprovals, setPendingApprovals] = useState<ApprovalRequest[]>([]);
  const [respondingPermissionId, setRespondingPermissionId] = useState<string | null>(null);

  const [taskLoading, setTaskLoading] = useState(false);
  const [taskSaving, setTaskSaving] = useState(false);
  const [taskRunning, setTaskRunning] = useState(false);
  const [taskDeleting, setTaskDeleting] = useState(false);
  const [taskError, setTaskError] = useState<string | null>(null);
  const [scheduledTask, setScheduledTask] = useState<ScheduledTask | null>(null);
  const [scheduledRuns, setScheduledRuns] = useState<ScheduledTaskRun[]>([]);
  const [taskTimelineEvents, setTaskTimelineEvents] = useState<TimelineEvent[]>([]);
  const [taskInstructionInput, setTaskInstructionInput] = useState("");
  const [taskIntervalInput, setTaskIntervalInput] = useState(15);
  const [taskEnabledInput, setTaskEnabledInput] = useState(true);

  const [opencodeStatus, setOpencodeStatus] = useState("checking...");
  const [schedulerStatus, setSchedulerStatus] = useState<SchedulerStatus | null>(null);
  const [schedulerLoading, setSchedulerLoading] = useState(false);
  const [schedulerError, setSchedulerError] = useState<string | null>(null);
  const [availableCommands, setAvailableCommands] = useState<OpenCodeCommand[]>([]);
  const [runtimeModels, setRuntimeModels] = useState<RuntimeModelOption[]>([]);
  const [runtimeAgents, setRuntimeAgents] = useState<RuntimeAgentOption[]>([]);
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [runtimeLoading, setRuntimeLoading] = useState(false);
  const [runtimeSaving, setRuntimeSaving] = useState(false);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [projectSessions, setProjectSessions] = useState<ProjectSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [sessionLoading, setSessionLoading] = useState(false);
  const [sessionSwitching, setSessionSwitching] = useState(false);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [sessionSwitchTargetLabel, setSessionSwitchTargetLabel] = useState<string | null>(null);
  const [commandPickerOpen, setCommandPickerOpen] = useState(false);
  const [commandSearch, setCommandSearch] = useState("");
  const [expandedActivityEntries, setExpandedActivityEntries] = useState<Record<string, boolean>>({});
  const [expandedMessageEntries, setExpandedMessageEntries] = useState<Record<string, boolean>>({});
  const [expandedPartEntries, setExpandedPartEntries] = useState<Record<string, boolean>>({});
  const [notificationsEnabled, setNotificationsEnabled] = useState(() => {
    if (typeof window === "undefined") {
      return false;
    }
    return window.localStorage.getItem(NOTIFICATION_PREFERENCE_KEY) === "true";
  });
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission | "unsupported">(() => {
    if (typeof window === "undefined" || !("Notification" in window)) {
      return "unsupported";
    }
    return Notification.permission;
  });
  const [isChatNearBottom, setIsChatNearBottom] = useState(true);
  const [unreadEntryId, setUnreadEntryId] = useState<string | null>(null);
  const [isMobileViewport, setIsMobileViewport] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(max-width: 720px)").matches
  );
  const [desktopProjectControlsCollapsed, setDesktopProjectControlsCollapsed] = useState(true);
  const [desktopChatToolbarCollapsed, setDesktopChatToolbarCollapsed] = useState(true);
  const [activeMainView, setActiveMainView] = useState<"chat" | "files">("chat");
  const [mobileProjectListOpen, setMobileProjectListOpen] = useState(false);
  const [mobileSettingsOpen, setMobileSettingsOpen] = useState(false);
  const [mobileNewProjectOpen, setMobileNewProjectOpen] = useState(false);
  const [clockTick, setClockTick] = useState(() => Date.now());
  const suggestedProjectRoot = useMemo(
    () => getSuggestedProjectRoot(projects, activeProjectId),
    [projects, activeProjectId]
  );

  const eventSourceRef = useRef<EventSource | null>(null);
  const refreshDebounceRef = useRef<number | null>(null);
  const streamReconnectTimerRef = useRef<number | null>(null);
  const streamReconnectAttemptRef = useRef(0);
  const projectFileDirectoryRequestsRef = useRef<Set<string>>(new Set());
  const syncInFlightRef = useRef(false);
  const desktopProjectSearchInputRef = useRef<HTMLInputElement | null>(null);
  const mobileProjectSearchInputRef = useRef<HTMLInputElement | null>(null);
  const projectSearchDebounceRef = useRef<number | null>(null);
  const searchRequestIdRef = useRef(0);
  const firstMessageMarkerProjectsRef = useRef<Set<string>>(new Set());
  const chatBodyRef = useRef<HTMLElement | null>(null);
  const timelineEntryRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const latestReadEntryIdByChatRef = useRef<Record<string, string>>({});
  const pendingOpenScrollRef = useRef<string | null>(null);
  const previousChatKeyRef = useRef<string | null>(null);
  const schedulerCardRef = useRef<HTMLDivElement | null>(null);
  const debugPanelRef = useRef<HTMLDetailsElement | null>(null);
  const schedulerCardPulseTimerRef = useRef<number | null>(null);
  const [schedulerCardPulse, setSchedulerCardPulse] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const mediaChunksRef = useRef<BlobPart[]>([]);
  const speakingAudioRef = useRef<HTMLAudioElement | null>(null);
  const speakingUrlRef = useRef<string | null>(null);
  const messageLoadRequestRef = useRef(0);
  const messageRequestInFlightRef = useRef(false);
  const pendingMessageRefreshRef = useRef<string | null>(null);
  const pendingScrollAnchorRef = useRef<{ entryId: string; top: number } | null>(null);
  const lastFinalAssistantMessageIdByChatRef = useRef<Record<string, string>>({});
  const previousActivityEntriesRef = useRef<Array<{ stateKey: string; childIds: string[] }>>([]);
  const taskLoadRequestRef = useRef(0);
  const sessionLoadRequestRef = useRef(0);
  const projectFilePreviewRequestRef = useRef(0);

  function addTelemetryMarker(event: string, payload?: Record<string, unknown>) {
    const marker: TelemetryMarker = {
      id: `tm-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      event,
      category: inferTelemetryCategory(event),
      at: new Date().toISOString(),
      payload: payload ?? {},
    };
    setTelemetryMarkers((current) => {
      const next = [...current, marker];
      if (next.length <= 80) {
        return next;
      }
      return next.slice(next.length - 80);
    });
  }

  function getPreferredSearchInput() {
    if (typeof document !== "undefined") {
      const activeElement = document.activeElement;
      if (activeElement === mobileProjectSearchInputRef.current) {
        return mobileProjectSearchInputRef.current;
      }
      if (activeElement === desktopProjectSearchInputRef.current) {
        return desktopProjectSearchInputRef.current;
      }
    }

    return isMobileViewport ? mobileProjectSearchInputRef.current : desktopProjectSearchInputRef.current;
  }

  function captureVisibleTimelineAnchor() {
    if (isChatNearBottom) {
      pendingScrollAnchorRef.current = null;
      return;
    }

    const body = chatBodyRef.current;
    if (!body) {
      pendingScrollAnchorRef.current = null;
      return;
    }

    const bodyTop = body.getBoundingClientRect().top;
    for (const entry of renderedTimelineEntries) {
      const node = timelineEntryRefs.current[entry.id];
      if (!node) {
        continue;
      }
      const rect = node.getBoundingClientRect();
      if (rect.bottom > bodyTop + 24) {
        pendingScrollAnchorRef.current = {
          entryId: entry.id,
          top: rect.top - bodyTop,
        };
        return;
      }
    }

    pendingScrollAnchorRef.current = null;
  }

  function resetTimelineExpansionState() {
    setExpandedActivityEntries({});
    setExpandedMessageEntries({});
    setExpandedPartEntries({});
    previousActivityEntriesRef.current = [];
  }

  function focusSchedulerCard() {
    if (debugPanelRef.current && !debugPanelRef.current.open) {
      debugPanelRef.current.open = true;
    }
    const card = schedulerCardRef.current;
    if (!card) {
      return;
    }
    card.scrollIntoView({ behavior: "smooth", block: "nearest" });
    card.focus();
    setSchedulerCardPulse(true);
    if (schedulerCardPulseTimerRef.current !== null) {
      window.clearTimeout(schedulerCardPulseTimerRef.current);
    }
    schedulerCardPulseTimerRef.current = window.setTimeout(() => {
      schedulerCardPulseTimerRef.current = null;
      setSchedulerCardPulse(false);
    }, 1400);
  }

  async function requestBrowserNotificationPermission() {
    if (typeof window === "undefined" || !("Notification" in window)) {
      return;
    }
    if (Notification.permission !== "default") {
      setNotificationPermission(Notification.permission);
      return;
    }
    try {
      const nextPermission = await Notification.requestPermission();
      setNotificationPermission(nextPermission);
    } catch {
      // Ignore notification permission failures.
    }
  }

  async function handleEnableNotifications() {
    setNotificationsEnabled(true);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(NOTIFICATION_PREFERENCE_KEY, "true");
    }
    await requestBrowserNotificationPermission();
  }

  function handleDisableNotifications() {
    setNotificationsEnabled(false);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(NOTIFICATION_PREFERENCE_KEY, "false");
    }
  }

  function stopSpeakingAudio() {
    if (speakingAudioRef.current) {
      speakingAudioRef.current.pause();
      speakingAudioRef.current = null;
    }
    if (speakingUrlRef.current) {
      URL.revokeObjectURL(speakingUrlRef.current);
      speakingUrlRef.current = null;
    }
    setSpeakingMessageId(null);
  }

  function cleanupMediaRecorder() {
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.ondataavailable = null;
      mediaRecorderRef.current.onstop = null;
      if (mediaRecorderRef.current.state !== "inactive") {
        mediaRecorderRef.current.stop();
      }
      mediaRecorderRef.current = null;
    }

    if (mediaStreamRef.current) {
      for (const track of mediaStreamRef.current.getTracks()) {
        track.stop();
      }
      mediaStreamRef.current = null;
    }
    mediaChunksRef.current = [];
    setRecording(false);
  }

  useEffect(() => {
    async function bootstrap() {
      try {
        const authenticated = await getAuthState();
        setIsAuthenticated(authenticated);
      } catch {
        setIsAuthenticated(false);
      } finally {
        setAuthLoading(false);
      }
    }

    void bootstrap();
  }, []);

  useEffect(() => {
    const preferredRoot = normalizeProjectRootPath(suggestedProjectRoot || defaultProjectRoot);
    if (!preferredRoot) {
      return;
    }
    setNewProjectRootPath((current) => (current.trim() ? current : preferredRoot));
    setNewProjectPath((current) => (current.trim() ? current : preferredRoot));
  }, [defaultProjectRoot, suggestedProjectRoot]);

  function handleNewProjectNameInput(value: string) {
    setNewProjectName(value);
    const nextName = value.trim();
    const rootPath =
      newProjectRootPath || normalizeProjectRootPath(suggestedProjectRoot || defaultProjectRoot);
    setNewProjectPath(buildProjectPathFromRoot(rootPath, nextName));
  }

  function handleNewProjectPathInput(value: string) {
    const currentName = newProjectName.trim();
    const nextRootPath = extractRootFromProjectPath(value, currentName);
    setNewProjectRootPath(nextRootPath);
    if (!currentName) {
      setNewProjectPath(value);
      return;
    }
    setNewProjectPath(buildProjectPathFromRoot(nextRootPath, currentName));
  }

  async function refreshProjectsAndStatus(preferredProjectId?: string | null) {
    const requestedLimit = Math.max(PROJECTS_PAGE_SIZE, projects.length || 0);
    const startedAt = performance.now();
    const [projectData, health] = await Promise.all([
      fetchProjects({ limit: requestedLimit, offset: 0 }),
      opencodeHealth(),
    ]);
    setBasePageLoads((current) => current + 1);
    setLastBaseLoadMs(performance.now() - startedAt);
    setProjects(projectData.projects);
    setProjectsHasMore(projectData.hasMore);
    setProjectsTotal(projectData.total);
    const preferredProjectIsVisible =
      !!preferredProjectId && projectData.projects.some((project) => project.id === preferredProjectId);
    const serverActiveProjectIsVisible =
      !!projectData.activeProjectId &&
      projectData.projects.some((project) => project.id === projectData.activeProjectId);
    const nextActiveProjectId =
      (preferredProjectIsVisible ? preferredProjectId : null) ??
      (serverActiveProjectIsVisible ? projectData.activeProjectId : null) ??
      projectData.projects[0]?.id ??
      null;
    setActiveProjectId(nextActiveProjectId);

    if (health.healthy) {
      const version = health.upstream?.version ?? "unknown";
      setOpencodeStatus(`connected (v${version})`);
    } else {
      setOpencodeStatus(`offline (${health.error ?? "unknown"})`);
    }

    return nextActiveProjectId;
  }

  async function loadMoreProjects() {
    if (loadingMoreProjects || !projectsHasMore) {
      return;
    }

    setLoadingMoreProjects(true);
    try {
      const startedAt = performance.now();
      const page = await fetchProjects({ limit: PROJECTS_PAGE_SIZE, offset: projects.length });
      setBasePageLoads((current) => current + 1);
      setLastBaseLoadMs(performance.now() - startedAt);
      setProjects((current) => {
        const seen = new Set(current.map((project) => project.id));
        const additions = page.projects.filter((project) => !seen.has(project.id));
        return [...current, ...additions];
      });
      setProjectsHasMore(page.hasMore);
      setProjectsTotal(page.total);
      if (!activeProjectId && page.projects[0]) {
        setActiveProjectId(page.activeProjectId ?? page.projects[0].id);
      }
    } finally {
      setLoadingMoreProjects(false);
    }
  }

  async function loadSearchProjects(query: string, offset: number, reset: boolean) {
    if (searchLoading) {
      return;
    }

    const requestId = searchRequestIdRef.current + 1;
    searchRequestIdRef.current = requestId;
    setSearchLoading(true);
    setSearchDebouncing(false);

    try {
      const startedAt = performance.now();
      const page = await fetchProjects({
        limit: PROJECTS_PAGE_SIZE,
        offset,
        query,
      });

      if (requestId !== searchRequestIdRef.current) {
        return;
      }

      if (reset) {
        setSearchProjects(page.projects);
      } else {
        setSearchProjects((current) => {
          const seen = new Set(current.map((project) => project.id));
          const additions = page.projects.filter((project) => !seen.has(project.id));
          return [...current, ...additions];
        });
      }

      setSearchHasMore(page.hasMore);
      setSearchTotal(page.total);
      setSearchPageLoads((current) => current + 1);
      setLastSearchLoadMs(performance.now() - startedAt);
      setLastSearchQuery(query);
    } finally {
      if (requestId === searchRequestIdRef.current) {
        setSearchLoading(false);
      }
    }
  }

  async function handleSyncProjects() {
    if (syncInFlightRef.current) {
      return;
    }

    syncInFlightRef.current = true;
    setSyncingProjects(true);
    setProjectError(null);
    try {
      const result = await syncProjects();
      setProjects(result.projects);
      setProjectsHasMore(false);
      setProjectsTotal(result.projects.length);
      if (searchQuery) {
        void loadSearchProjects(searchQuery, 0, true);
      }
      const activeProjectStillVisible =
        !!activeProjectId && result.projects.some((project) => project.id === activeProjectId);
      const syncedActiveProjectVisible =
        !!result.activeProjectId && result.projects.some((project) => project.id === result.activeProjectId);
      const nextActiveId =
        (activeProjectStillVisible ? activeProjectId : null) ??
        (syncedActiveProjectVisible ? result.activeProjectId : null) ??
        result.projects[0]?.id ??
        null;
      setActiveProjectId(nextActiveId);
      if (nextActiveId) {
        await loadMessages(nextActiveId);
        void loadDiff(nextActiveId);
        void loadPendingApprovals(nextActiveId);
      }
    } catch (error) {
      setProjectError(error instanceof Error ? error.message : "Unable to sync projects");
    } finally {
      syncInFlightRef.current = false;
      setSyncingProjects(false);
    }
  }

  useEffect(() => {
    if (!isAuthenticated) {
      setSearchDebouncing(false);
      return;
    }

    async function loadInitial() {
      try {
        const appState = await fetchAppState();
        const normalizedDefaultRoot = normalizeProjectRootPath(appState.defaultProjectRoot || "");
        if (normalizedDefaultRoot) {
          setDefaultProjectRoot(normalizedDefaultRoot);
        }
        const nextActiveProjectId = await refreshProjectsAndStatus();
        if (nextActiveProjectId) {
          await loadMessages(nextActiveProjectId);
          void loadDiff(nextActiveProjectId);
          void loadPendingApprovals(nextActiveProjectId);
          return;
        }

        const synced = await syncProjects();
        setProjects(synced.projects);
        setProjectsHasMore(false);
        setProjectsTotal(synced.projects.length);
        const syncedActiveId = synced.activeProjectId ?? synced.projects[0]?.id ?? null;
        setActiveProjectId(syncedActiveId);
        if (syncedActiveId) {
          await loadMessages(syncedActiveId);
          void loadDiff(syncedActiveId);
          void loadPendingApprovals(syncedActiveId);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to load app state";
        setProjectError(message);
      }
    }

    void loadInitial();
  }, [isAuthenticated]);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 720px)");
    const update = () => {
      setIsMobileViewport(media.matches);
    };

    update();
    media.addEventListener("change", update);
    return () => {
      media.removeEventListener("change", update);
    };
  }, []);

  useEffect(() => {
    if (!isMobileViewport) {
      setMobileProjectListOpen(false);
      setMobileSettingsOpen(false);
      return;
    }

    if (!activeProjectId) {
      setMobileProjectListOpen(true);
    }
  }, [activeProjectId, isMobileViewport]);


  const activeProject = useMemo(
    () => projects.find((project) => project.id === activeProjectId) ?? null,
    [projects, activeProjectId]
  );
  const activeSession = useMemo(
    () => projectSessions.find((session) => session.id === activeSessionId) ?? null,
    [projectSessions, activeSessionId]
  );
  const showMobileProjectList = isMobileViewport && (mobileProjectListOpen || !activeProjectId);
  const filteredCommandList = useMemo(() => {
    const query = commandSearch.trim().toLowerCase();
    if (!query) {
      return availableCommands;
    }
    return availableCommands.filter((command) => {
      return (
        command.name.toLowerCase().includes(query) ||
        command.description.toLowerCase().includes(query)
      );
    });
  }, [availableCommands, commandSearch]);
  const preferredProjectRoot = normalizeProjectRootPath(suggestedProjectRoot || defaultProjectRoot);
  const hasStreamingActivity = useMemo(() => {
    let latestAssistantTextMs = 0;
    let latestIntermediateAssistantMs = 0;

    for (const message of messages) {
      if (message.role !== "assistant") {
        continue;
      }

      const timestamp = new Date(message.createdAt).getTime();
      if (!Number.isFinite(timestamp)) {
        continue;
      }

      if (message.text.trim()) {
        latestAssistantTextMs = Math.max(latestAssistantTextMs, timestamp);
      } else if (getNonTextParts(message).length > 0) {
        latestIntermediateAssistantMs = Math.max(latestIntermediateAssistantMs, timestamp);
      }
    }

    return latestIntermediateAssistantMs > latestAssistantTextMs;
  }, [messages]);
  const hasActiveRun =
    (fixtureMode === "run-active" || Boolean(activeProject)) &&
    (sending ||
      aborting ||
      runIntentActive ||
      hasStreamingActivity ||
      fixtureMode === "run-active" ||
      activeProject?.sessionStatus === "running");
  const showReconnectFixture = fixtureMode === "reconnecting";
  const showLoadingFixture = fixtureMode === "chat-loading";
  const showSessionSwitchFixture = fixtureMode === "session-switching";
  const showApprovalFixture = fixtureMode === "approval-heavy";
  const showActivityChainFixture = fixtureMode === "activity-chain";
  const showDiffEmptyFixture = fixtureMode === "diff-empty";
  const showDiffLargeFixture = fixtureMode === "diff-large";
  const activeChatKey = activeProjectId && activeSessionId ? `${activeProjectId}:${activeSessionId}` : null;
  const fixturePendingApprovals = useMemo<ApprovalRequest[]>(() => {
    if (!showApprovalFixture) {
      return [];
    }

    const now = Date.now();
    return [
      {
        permissionId: "fixture-perm-shell",
        title: "Permission requested",
        details: "Allow shell command execution in /tmp for fixture preview?",
        createdAt: new Date(now - 35_000).toISOString(),
      },
      {
        permissionId: "fixture-perm-write",
        title: "Permission requested",
        details: "Allow file write in src/components for fixture preview?",
        createdAt: new Date(now - 24_000).toISOString(),
      },
      {
        permissionId: "fixture-perm-network",
        title: "Permission requested",
        details: "Allow network request to docs provider for fixture preview?",
        createdAt: new Date(now - 14_000).toISOString(),
      },
    ];
  }, [showApprovalFixture]);
  const visiblePendingApprovals = showApprovalFixture ? fixturePendingApprovals : pendingApprovals;
  const hasBlockingApprovals = visiblePendingApprovals.length > 0;
  const timelineEntries = useMemo<TimelineEntry[]>(() => {
    const messageEntries: TimelineEntry[] = messages.map((message) => ({
      kind: "message",
      id: `m-${buildMessageStableKey(message)}`,
      createdAt: message.createdAt,
      message,
    }));

    const runEntries: TimelineEntry[] = [];
    for (const event of taskTimelineEvents) {
      const run = timelineEventToTaskRun(event);
      if (!run) {
        continue;
      }
      runEntries.push({
        kind: "task_run",
        id: `t-${event.id}`,
        createdAt: event.createdAt,
        run,
      });
    }

    const toMillis = (value: string) => {
      const parsed = new Date(value).getTime();
      return Number.isFinite(parsed) ? parsed : 0;
    };

    return [...messageEntries, ...runEntries].sort(
      (a, b) => toMillis(a.createdAt) - toMillis(b.createdAt)
    );
  }, [messages, taskTimelineEvents]);
  const effectiveTimelineEntries = useMemo<TimelineEntry[]>(() => {
    if (fixtureMode === "task-run-success" || fixtureMode === "task-run-error") {
      const now = new Date();
      const startedAt = new Date(now.getTime() - 2 * 60_000).toISOString();
      const finishedAt = fixtureMode === "task-run-success" ? now.toISOString() : new Date(now.getTime() - 30_000).toISOString();
      return [
        {
          kind: "task_run",
          id: `fixture-${fixtureMode}`,
          createdAt: startedAt,
          run: {
            id: `fixture-${fixtureMode}`,
            taskId: "fixture-task",
            projectId: activeProjectId ?? "fixture-project",
            status: fixtureMode === "task-run-success" ? "completed" : "failed",
            sessionId: activeSessionId,
            trigger: fixtureMode === "task-run-success" ? "schedule" : "manual",
            startedAt,
            finishedAt,
            heartbeatLoaded: fixtureMode === "task-run-success",
            outputPreview:
              fixtureMode === "task-run-success"
                ? "Checked repository state and posted a clean status update."
                : "Attempted scheduled review run before hitting a fixture error.",
            error: fixtureMode === "task-run-success" ? null : "Fixture error: simulated task failure for UI review.",
          },
        },
      ];
    }

    if (showActivityChainFixture) {
      const now = Date.now();
      const entries: TimelineEntry[] = [
        {
          kind: "message",
          id: "fixture-activity-user",
          createdAt: new Date(now - 70_000).toISOString(),
          message: {
            id: "fixture-activity-user",
            role: "user",
            createdAt: new Date(now - 70_000).toISOString(),
            text: "Review this repository and summarize the recent runtime UX changes.",
            parts: [{ type: "text", text: "Review this repository and summarize the recent runtime UX changes." }],
          },
        },
      ];

      for (let index = 0; index < 6; index += 1) {
        entries.push({
          kind: "message",
          id: `fixture-activity-${index}`,
          createdAt: new Date(now - (58_000 - index * 8_000)).toISOString(),
          message: {
            id: `fixture-activity-${index}`,
            role: "assistant",
            createdAt: new Date(now - (58_000 - index * 8_000)).toISOString(),
            text: "",
            parts: [
              {
                type: "tool-call",
                tool: index % 2 === 0 ? "read" : "grep",
                status: "completed",
                detail: index % 2 === 0 ? `Scanned App.tsx section ${index + 1}` : `Matched transition selector set ${index + 1}`,
              },
            ],
          },
        });
      }

      entries.push({
        kind: "message",
        id: "fixture-activity-final",
        createdAt: new Date(now - 8_000).toISOString(),
        message: {
          id: "fixture-activity-final",
          role: "assistant",
          createdAt: new Date(now - 8_000).toISOString(),
          text: "Runtime stop controls and transition strips were polished with reconnect context and fixture-backed QA states.",
          parts: [
            {
              type: "text",
              text: "Runtime stop controls and transition strips were polished with reconnect context and fixture-backed QA states.",
            },
          ],
        },
      });

      return entries;
    }

    return timelineEntries;
  }, [activeProjectId, activeSessionId, fixtureMode, showActivityChainFixture, timelineEntries]);
  const renderedTimelineEntries = useMemo<RenderedTimelineEntry[]>(
    () => buildGroupedTimelineEntries(effectiveTimelineEntries),
    [effectiveTimelineEntries]
  );

  const searchQuery = projectSearch.trim();
  const isSearchMode = searchQuery.length > 0;
  const visibleProjects = isSearchMode ? searchProjects : projects;
  const visibleProjectsHasMore = isSearchMode ? searchHasMore : projectsHasMore;
  const visibleProjectsTotal = isSearchMode ? searchTotal : projectsTotal;
  const isLoadingVisibleProjects = isSearchMode ? searchLoading : loadingMoreProjects;
  const searchSummaryLabel = searchQuery
    ? `${visibleProjects.length} result${visibleProjects.length === 1 ? "" : "s"}${visibleProjectsTotal > visibleProjects.length ? ` of ${visibleProjectsTotal}` : ""} for "${searchQuery}"`
    : `${visibleProjects.length} chat${visibleProjects.length === 1 ? "" : "s"}`;
  const reconnectElapsedMs = showReconnectFixture
    ? 42_000
    : reconnectStartedAtMs !== null
    ? Math.max(0, clockTick - reconnectStartedAtMs)
    : 0;
  const reconnectElapsedLabel = formatElapsedShort(reconnectElapsedMs);
  const reconnectAttemptLabel = showReconnectFixture
    ? 3
    : reconnectAttemptCount;
  const stopFeedbackVisible =
    Boolean(stopFeedbackLabel) &&
    stopFeedbackUntilMs !== null &&
    clockTick <= stopFeedbackUntilMs;
  const mobileSearchStatusLabel = searchQuery
    ? searchDebouncing
      ? `Searching for "${searchQuery}"...`
      : searchLoading
      ? `Loading results for "${searchQuery}"...`
      : searchSummaryLabel
    : searchSummaryLabel;
  const effectiveDiffEntries = useMemo<SessionDiffEntry[]>(() => {
    if (showDiffEmptyFixture) {
      return [];
    }

    if (showDiffLargeFixture) {
      return Array.from({ length: 28 }, (_, index) => ({
        path: `src/fixtures/file-${String(index + 1).padStart(2, "0")}.ts`,
        additions: 8 + index,
        deletions: index % 4,
      }));
    }

    return diffEntries;
  }, [diffEntries, showDiffEmptyFixture, showDiffLargeFixture]);
  const transitionStatus = useMemo(() => {
    if (showReconnectFixture || streamStatus === "reconnecting") {
      const attemptText = reconnectAttemptLabel > 0 ? `Retry ${reconnectAttemptLabel}` : "Retry pending";
      return {
        tone: "warn" as const,
        label: "Reconnecting to session stream",
        detail: `${attemptText} · ${reconnectElapsedLabel} elapsed. Waiting for the live event stream to reconnect. New updates will appear automatically.`,
      };
    }
    if (showSessionSwitchFixture || sessionSwitching) {
      const destination = showSessionSwitchFixture
        ? "voice_typing · Current · 01:44 PM"
        : sessionSwitchTargetLabel || "selected session";
      return {
        tone: "info" as const,
        label: "Switching sessions",
        detail: `Loading ${destination} and refreshing the current chat state.`,
      };
    }
    if (showLoadingFixture || messagesLoading) {
      return {
        tone: "info" as const,
        label: "Loading this session",
        detail: "Fetching message history, activity, and pending approvals for the selected project.",
      };
    }
    return null;
  }, [messagesLoading, reconnectAttemptLabel, reconnectElapsedLabel, sessionSwitchTargetLabel, sessionSwitching, showLoadingFixture, showReconnectFixture, showSessionSwitchFixture, streamStatus]);

  useEffect(() => {
    if (!hasActiveRun) {
      return;
    }
    setRunIntentActive(true);
  }, [hasActiveRun]);

  useEffect(() => {
    if (!runIntentActive) {
      return;
    }
    if (fixtureMode === "run-active") {
      return;
    }
    if (sending || aborting) {
      return;
    }
    if (streamStatus === "reconnecting") {
      return;
    }
    if (activeProject?.sessionStatus === "running") {
      return;
    }
    if (hasStreamingActivity) {
      return;
    }
    setRunIntentActive(false);
  }, [aborting, activeProject?.sessionStatus, fixtureMode, hasStreamingActivity, runIntentActive, sending, streamStatus]);

  useEffect(() => {
    const activityEntries = renderedTimelineEntries.filter(
      (entry): entry is Extract<RenderedTimelineEntry, { kind: "activity" }> => entry.kind === "activity"
    );
    if (activityEntries.length === 0) {
      previousActivityEntriesRef.current = [];
      return;
    }

    setExpandedActivityEntries((current) => {
      const next: Record<string, boolean> = {};
      const previousEntries = previousActivityEntriesRef.current;
      const previousLastEntry = previousEntries[previousEntries.length - 1] ?? null;

      activityEntries.forEach((entry, index) => {
        if (entry.stateKey in current) {
          next[entry.stateKey] = current[entry.stateKey];
          return;
        }

        const overlappingPreviousEntry = previousEntries.find((previousEntry) =>
          previousEntry.childIds.some((childId) => entry.childIds.includes(childId))
        );
        if (overlappingPreviousEntry && overlappingPreviousEntry.stateKey in current) {
          next[entry.stateKey] = current[overlappingPreviousEntry.stateKey];
          return;
        }

        const isLastActivity = index === activityEntries.length - 1;
        if (
          isLastActivity &&
          previousLastEntry &&
          previousLastEntry.stateKey in current
        ) {
          next[entry.stateKey] = current[previousLastEntry.stateKey];
        }
      });

      previousActivityEntriesRef.current = activityEntries.map((entry) => ({
        stateKey: entry.stateKey,
        childIds: entry.childIds,
      }));
      return next;
    });
  }, [renderedTimelineEntries]);

  useEffect(() => {
    const shouldTick = stopFeedbackVisible || streamStatus === "reconnecting";
    if (!shouldTick) {
      return;
    }
    const intervalId = window.setInterval(() => {
      setClockTick(Date.now());
    }, 500);
    return () => {
      window.clearInterval(intervalId);
    };
  }, [stopFeedbackVisible, streamStatus]);

  const schedulerHeartbeat = useMemo(
    () =>
      schedulerHeartbeatState({
        schedulerStatus,
        schedulerError,
        schedulerLoading,
      }),
    [schedulerStatus, schedulerError, schedulerLoading]
  );
  const timeFilteredTelemetryMarkers = useMemo(() => {
    const windowMs = markerTimeWindowMs(markerTimeWindow);
    if (windowMs === null) {
      return telemetryMarkers;
    }

    const cutoff = Date.now() - windowMs;
    return telemetryMarkers.filter((marker) => {
      const markerTime = new Date(marker.at).getTime();
      return Number.isFinite(markerTime) && markerTime >= cutoff;
    });
  }, [telemetryMarkers, markerTimeWindow]);
  const filteredTelemetryMarkers = useMemo(
    () => timeFilteredTelemetryMarkers.filter((marker) => markerCategoryFilter[marker.category]),
    [timeFilteredTelemetryMarkers, markerCategoryFilter]
  );
  const previewTelemetryMarkers = useMemo(
    () => filteredTelemetryMarkers.slice(Math.max(0, filteredTelemetryMarkers.length - 5)).reverse(),
    [filteredTelemetryMarkers]
  );
  const telemetryCategoryCounts = useMemo(() => {
    const counts: Record<TelemetryMarkerCategory, number> = {
      search: 0,
      project: 0,
      chat: 0,
      stream: 0,
      system: 0,
    };
    for (const marker of timeFilteredTelemetryMarkers) {
      counts[marker.category] += 1;
    }
    return counts;
  }, [timeFilteredTelemetryMarkers]);

  useEffect(() => {
    if (!isAuthenticated) {
      setSearchDebouncing(false);
      return;
    }

    if (projectSearchDebounceRef.current !== null) {
      window.clearTimeout(projectSearchDebounceRef.current);
      projectSearchDebounceRef.current = null;
    }

    if (!searchQuery) {
      setSearchProjects([]);
      setSearchHasMore(false);
      setSearchTotal(0);
      setSearchLoading(false);
      setSearchDebouncing(false);
      searchRequestIdRef.current += 1;
      return;
    }

    setSearchDebouncing(true);
    projectSearchDebounceRef.current = window.setTimeout(() => {
      projectSearchDebounceRef.current = null;
      setSearchDebouncing(false);
      void loadSearchProjects(searchQuery, 0, true);
    }, 220);

    return () => {
      if (projectSearchDebounceRef.current !== null) {
        window.clearTimeout(projectSearchDebounceRef.current);
        projectSearchDebounceRef.current = null;
      }
    };
  }, [isAuthenticated, searchQuery]);

  useEffect(() => {
    if (visibleProjects.length === 0) {
      setHighlightedProjectId(null);
      return;
    }

    if (isSearchMode && searchLoading && highlightedProjectId) {
      return;
    }

    if (highlightedProjectId && visibleProjects.some((project) => project.id === highlightedProjectId)) {
      return;
    }

    if (activeProjectId && visibleProjects.some((project) => project.id === activeProjectId)) {
      setHighlightedProjectId(activeProjectId);
      return;
    }

    setHighlightedProjectId(visibleProjects[0].id);
  }, [visibleProjects, highlightedProjectId, activeProjectId, isSearchMode, searchLoading]);

  useEffect(() => {
    function isEditableTarget(target: EventTarget | null): boolean {
      if (!(target instanceof HTMLElement)) {
        return false;
      }
      const tag = target.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
        return true;
      }
      return target.isContentEditable;
    }

    function onKeyDown(event: KeyboardEvent) {
      if (!isAuthenticated) {
        return;
      }

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        const searchInput = getPreferredSearchInput();
        searchInput?.focus();
        searchInput?.select();
        addTelemetryMarker("search.focus.shortcut", { shortcut: "ctrl_or_meta+k" });
        return;
      }

      if (event.shiftKey && event.key.toLowerCase() === "s" && !isEditableTarget(event.target)) {
        event.preventDefault();
        focusSchedulerCard();
        addTelemetryMarker("scheduler.focus.shortcut", { shortcut: "shift+s" });
        return;
      }

      const isSearchFocused =
        document.activeElement === desktopProjectSearchInputRef.current ||
        document.activeElement === mobileProjectSearchInputRef.current;
      if (isSearchFocused && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
        event.preventDefault();
        if (visibleProjects.length === 0) {
          return;
        }

        const currentIndex = highlightedProjectId
          ? visibleProjects.findIndex((project) => project.id === highlightedProjectId)
          : -1;

        if (event.key === "ArrowDown") {
          const nextIndex = Math.min(visibleProjects.length - 1, Math.max(0, currentIndex + 1));
          setHighlightedProjectId(visibleProjects[nextIndex].id);
          return;
        }

        const nextIndex = Math.max(0, currentIndex <= 0 ? 0 : currentIndex - 1);
        setHighlightedProjectId(visibleProjects[nextIndex].id);
        return;
      }

      if (isSearchFocused && event.key === "Enter") {
        event.preventDefault();
        if (highlightedProjectId) {
          void handleSelectProject(highlightedProjectId);
        }
        return;
      }

      if (isSearchFocused && event.key === "Escape") {
        event.preventDefault();
        setProjectSearch("");
        getPreferredSearchInput()?.blur();
        return;
      }

      if (event.key === "/" && !isEditableTarget(event.target)) {
        event.preventDefault();
        getPreferredSearchInput()?.focus();
        addTelemetryMarker("search.focus.shortcut", { shortcut: "/" });
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [isAuthenticated, visibleProjects, highlightedProjectId]);

  async function loadMessages(
    projectId: string,
    options?: { silent?: boolean }
  ) {
    const requestId = messageLoadRequestRef.current + 1;
    messageLoadRequestRef.current = requestId;
    messageRequestInFlightRef.current = true;
    captureVisibleTimelineAnchor();
    if (!options?.silent) {
      setMessagesLoading(true);
    }
    setProjectError(null);
    try {
      const messageResult = await fetchMessages(projectId);
      if (requestId !== messageLoadRequestRef.current) {
        return;
      }
      setActiveSessionId(messageResult.sessionId);
      updateProjectSessionSelection(projectId, messageResult.sessionId);
      setMessages(messageResult.messages);
      setTaskTimelineEvents(messageResult.timelineEvents ?? []);
    } catch (error) {
      if (requestId !== messageLoadRequestRef.current) {
        return;
      }
      setProjectError(error instanceof Error ? error.message : "Failed to load messages");
      setMessages([]);
      setTaskTimelineEvents([]);
    } finally {
      messageRequestInFlightRef.current = false;
      const pendingProjectId = pendingMessageRefreshRef.current;
      if (pendingProjectId && pendingProjectId === projectId) {
        pendingMessageRefreshRef.current = null;
        void loadMessages(projectId, { silent: true });
      }
      if (requestId === messageLoadRequestRef.current) {
        if (!options?.silent) {
          setMessagesLoading(false);
        }
      }
    }
  }

  async function loadDiff(projectId: string) {
    try {
      const diffResult = await fetchDiff(projectId);
      setDiffEntries(diffResult.diff);
    } catch {
      setDiffEntries([]);
    }
  }

  async function loadPendingApprovals(projectId: string) {
    try {
      const result = await fetchPendingApprovals(projectId);
      setPendingApprovals(result.approvals);
    } catch {
      setPendingApprovals([]);
    }
  }

  async function loadProjectDirectoryEntries(
    projectId: string,
    directory: string,
    reset = false
  ) {
    const normalizedDirectory = directory.trim();
    const requestKey = `${projectId}:${normalizedDirectory}`;
    if (projectFileDirectoryRequestsRef.current.has(requestKey)) {
      return;
    }
    projectFileDirectoryRequestsRef.current.add(requestKey);

    if (reset || normalizedDirectory.length === 0) {
      setProjectFilesLoading(true);
      setProjectFilesError(null);
    }
    setProjectFileLoadingDirs((current) =>
      current.includes(normalizedDirectory) ? current : [...current, normalizedDirectory]
    );

    try {
      const result = await fetchProjectDirectoryEntries(projectId, normalizedDirectory);
      setProjectFileEntries((current) => {
        const next = reset ? [] : [...current];
        const seen = new Set(next.map((entry) => `${entry.path}:${entry.isDir ? "d" : "f"}`));
        for (const entry of result.entries) {
          const key = `${entry.path}:${entry.isDir ? "d" : "f"}`;
          if (seen.has(key)) {
            continue;
          }
          seen.add(key);
          next.push(entry);
        }
        return next;
      });
      setProjectFilesTruncated((current) => current || result.truncated);
      setProjectFileLoadedDirs((current) =>
        current.includes(normalizedDirectory) ? current : [...current, normalizedDirectory]
      );
    } catch (error) {
      setProjectFilesError(
        error instanceof Error ? error.message : "Failed to load project files"
      );
      if (reset) {
        setProjectFileEntries([]);
        setProjectFilesTruncated(false);
        setProjectFileLoadedDirs([]);
      }
    } finally {
      projectFileDirectoryRequestsRef.current.delete(requestKey);
      setProjectFileLoadingDirs((current) =>
        current.filter((item) => item !== normalizedDirectory)
      );
      if (reset || normalizedDirectory.length === 0) {
        setProjectFilesLoading(false);
      }
    }
  }

  async function loadProjectFilePreview(projectId: string, path: string) {
    const requestId = projectFilePreviewRequestRef.current + 1;
    projectFilePreviewRequestRef.current = requestId;
    setProjectFileContentLoading(true);
    setProjectFileContentError(null);
    try {
      const result = await fetchProjectFileContent(projectId, path);
      if (requestId !== projectFilePreviewRequestRef.current) {
        return;
      }
      setSelectedProjectFileContent(result);
    } catch (error) {
      if (requestId !== projectFilePreviewRequestRef.current) {
        return;
      }
      setProjectFileContentError(error instanceof Error ? error.message : "Failed to load file preview");
      setSelectedProjectFileContent(null);
    } finally {
      if (requestId === projectFilePreviewRequestRef.current) {
        setProjectFileContentLoading(false);
      }
    }
  }

  async function loadTaskDetails(projectId: string) {
    const requestId = taskLoadRequestRef.current + 1;
    taskLoadRequestRef.current = requestId;
    setTaskLoading(true);
    setTaskError(null);
    try {
      const [taskResult, runsResult] = await Promise.all([
        fetchScheduledTask(projectId),
        fetchScheduledTaskRuns(projectId, 20),
      ]);
      if (requestId !== taskLoadRequestRef.current) {
        return;
      }
      setScheduledTask(taskResult.task);
      setScheduledRuns(runsResult.runs);

      if (taskResult.task) {
        setTaskInstructionInput(taskResult.task.instruction);
        setTaskIntervalInput(taskResult.task.intervalMinutes);
        setTaskEnabledInput(taskResult.task.enabled);
      } else {
        setTaskInstructionInput("");
        setTaskIntervalInput(15);
        setTaskEnabledInput(true);
      }
    } catch (error) {
      if (requestId !== taskLoadRequestRef.current) {
        return;
      }
      setTaskError(error instanceof Error ? error.message : "Failed to load scheduled task");
      setScheduledTask(null);
      setScheduledRuns([]);
    } finally {
      if (requestId === taskLoadRequestRef.current) {
        setTaskLoading(false);
      }
    }
  }

  async function loadSchedulerStatus() {
    setSchedulerLoading(true);
    setSchedulerError(null);
    try {
      const result = await fetchSchedulerStatus();
      setSchedulerStatus(result.scheduler);
    } catch (error) {
      setSchedulerError(error instanceof Error ? error.message : "Failed to load scheduler status");
      setSchedulerStatus(null);
    } finally {
      setSchedulerLoading(false);
    }
  }

  async function loadAvailableCommands() {
    try {
      const result = await fetchOpenCodeCommands();
      setAvailableCommands(result.commands);
    } catch {
      setAvailableCommands([]);
    }
  }

  async function loadProjectRuntime(projectId: string) {
    setRuntimeLoading(true);
    setRuntimeError(null);
    try {
      const result = await fetchProjectRuntime(projectId);
      setRuntimeModels(result.models);
      setRuntimeAgents(result.agents);
      setSelectedModel(result.selectedModel);
      setSelectedAgent(result.selectedAgent);
    } catch (error) {
      setRuntimeError(error instanceof Error ? error.message : "Failed to load runtime controls");
      setRuntimeModels([]);
      setRuntimeAgents([]);
      setSelectedModel(null);
      setSelectedAgent(null);
    } finally {
      setRuntimeLoading(false);
    }
  }

  function updateProjectSessionSelection(projectId: string, sessionId: string | null) {
    setProjects((current) =>
      current.map((project) =>
        project.id === projectId ? { ...project, lastSessionId: sessionId } : project
      )
    );
    setSearchProjects((current) =>
      current.map((project) =>
        project.id === projectId ? { ...project, lastSessionId: sessionId } : project
      )
    );
  }

  async function loadProjectSessions(projectId: string) {
    const requestId = sessionLoadRequestRef.current + 1;
    sessionLoadRequestRef.current = requestId;
    setSessionLoading(true);
    setSessionError(null);
    try {
      const result = await fetchProjectSessions(projectId);
      if (requestId !== sessionLoadRequestRef.current) {
        return;
      }
      setProjectSessions(result.sessions);
      setActiveSessionId(result.activeSessionId);
      updateProjectSessionSelection(projectId, result.activeSessionId);
    } catch (error) {
      if (requestId !== sessionLoadRequestRef.current) {
        return;
      }
      setSessionError(error instanceof Error ? error.message : "Failed to load sessions");
      setProjectSessions([]);
      setActiveSessionId(null);
    } finally {
      if (requestId === sessionLoadRequestRef.current) {
        setSessionLoading(false);
      }
    }
  }

  async function saveProjectRuntimeSelection(input: {
    model: string | null;
    agent: string | null;
  }) {
    if (!activeProjectId) {
      return;
    }
    setRuntimeSaving(true);
    setRuntimeError(null);
    try {
      const result = await updateProjectRuntime(activeProjectId, input);
      setSelectedModel(result.selectedModel);
      setSelectedAgent(result.selectedAgent);
      addTelemetryMarker("project.runtime.update", {
        projectId: activeProjectId,
        model: result.selectedModel,
        agent: result.selectedAgent,
      });
    } catch (error) {
      setRuntimeError(error instanceof Error ? error.message : "Failed to save runtime controls");
      await loadProjectRuntime(activeProjectId);
    } finally {
      setRuntimeSaving(false);
    }
  }

  async function handleSaveTask() {
    if (!activeProjectId) {
      return;
    }

    setTaskSaving(true);
    setTaskError(null);
    try {
      const response = await saveScheduledTask(activeProjectId, {
        instruction: taskInstructionInput,
        intervalMinutes: taskIntervalInput,
        enabled: taskEnabledInput,
      });
      setScheduledTask(response.task);
      await loadTaskDetails(activeProjectId);
      await refreshProjectsAndStatus(activeProjectId);
    } catch (error) {
      setTaskError(error instanceof Error ? error.message : "Failed to save task");
    } finally {
      setTaskSaving(false);
    }
  }

  async function handleRunTaskNow() {
    if (!activeProjectId) {
      return;
    }

    setTaskRunning(true);
    setTaskError(null);
    try {
      const response = await runScheduledTaskNow(activeProjectId);
      setScheduledTask(response.task);
      await loadTaskDetails(activeProjectId);
      await refreshProjectsAndStatus(activeProjectId);
    } catch (error) {
      setTaskError(error instanceof Error ? error.message : "Failed to run task now");
    } finally {
      setTaskRunning(false);
    }
  }

  async function handleDeleteTask() {
    if (!activeProjectId) {
      return;
    }

    setTaskDeleting(true);
    setTaskError(null);
    try {
      await deleteScheduledTask(activeProjectId);
      setScheduledTask(null);
      setScheduledRuns([]);
      setTaskTimelineEvents([]);
      setTaskInstructionInput("");
      setTaskIntervalInput(15);
      setTaskEnabledInput(true);
      await refreshProjectsAndStatus(activeProjectId);
    } catch (error) {
      setTaskError(error instanceof Error ? error.message : "Failed to delete task");
    } finally {
      setTaskDeleting(false);
    }
  }

  function scheduleStreamRefresh(projectId: string) {
    if (refreshDebounceRef.current !== null) {
      window.clearTimeout(refreshDebounceRef.current);
    }

    refreshDebounceRef.current = window.setTimeout(() => {
      if (messageRequestInFlightRef.current) {
        pendingMessageRefreshRef.current = projectId;
      } else {
        void loadMessages(projectId, { silent: true });
      }
      refreshDebounceRef.current = null;
    }, 700);
  }

  useEffect(() => {
    if (!isAuthenticated || !activeProjectId) {
      setStreamStatus("idle");
      setRunIntentActive(false);
      setReconnectStartedAtMs(null);
      setReconnectAttemptCount(0);
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      if (streamReconnectTimerRef.current !== null) {
        window.clearTimeout(streamReconnectTimerRef.current);
        streamReconnectTimerRef.current = null;
      }
      return;
    }

    let cancelled = false;

    const connect = () => {
      if (cancelled) {
        return;
      }

      setStreamStatus("connecting");
      const stream = new EventSource(`/api/projects/${activeProjectId}/stream`, {
        withCredentials: true,
      });
      eventSourceRef.current = stream;

      stream.onopen = () => {
        streamReconnectAttemptRef.current = 0;
        setStreamStatus("live");
        setReconnectStartedAtMs(null);
        setReconnectAttemptCount(0);
        addTelemetryMarker("stream.chat.open", { projectId: activeProjectId });
      };

      stream.onmessage = (event) => {
        const parsed = parseApprovalFromStreamData(event.data);
        if (parsed.request) {
          setPendingApprovals((current) => {
            if (current.some((item) => item.permissionId === parsed.request?.permissionId)) {
              return current;
            }
            return [...current, parsed.request!];
          });
        }
        if (parsed.resolvedPermissionId) {
          setPendingApprovals((current) =>
            current.filter((item) => item.permissionId !== parsed.resolvedPermissionId)
          );
        }
        scheduleStreamRefresh(activeProjectId);
      };

      stream.onerror = () => {
        if (cancelled) {
          return;
        }

        stream.close();
        if (eventSourceRef.current === stream) {
          eventSourceRef.current = null;
        }
        setStreamStatus("reconnecting");
        setReconnectStartedAtMs((current) => current ?? Date.now());
        addTelemetryMarker("stream.chat.error", { projectId: activeProjectId });

        const attempt = streamReconnectAttemptRef.current;
        const delay = nextReconnectDelayMs(attempt);
        setReconnectAttemptCount(attempt + 1);
        streamReconnectAttemptRef.current = Math.min(attempt + 1, 5);
        streamReconnectTimerRef.current = window.setTimeout(() => {
          streamReconnectTimerRef.current = null;
          connect();
        }, delay);
      };
    };

    connect();

    return () => {
      cancelled = true;
      if (streamReconnectTimerRef.current !== null) {
        window.clearTimeout(streamReconnectTimerRef.current);
        streamReconnectTimerRef.current = null;
      }
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    };
  }, [isAuthenticated, activeProjectId, activeSessionId]);

  useEffect(() => {
    // Intentionally disable aggressive project SSE sync because some OpenCode servers
    // emit frequent project events, which causes constant UI refresh loops.
  }, [isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated || !activeProjectId) {
      taskLoadRequestRef.current += 1;
      sessionLoadRequestRef.current += 1;
      projectFilePreviewRequestRef.current += 1;
      setScheduledTask(null);
      setScheduledRuns([]);
      setTaskTimelineEvents([]);
      setTaskInstructionInput("");
      setTaskIntervalInput(15);
      setTaskEnabledInput(true);
      setTaskError(null);
      setTaskLoading(false);
      setRuntimeModels([]);
      setRuntimeAgents([]);
      setSelectedModel(null);
      setSelectedAgent(null);
      setRuntimeError(null);
      setRuntimeLoading(false);
      setProjectSessions([]);
      setActiveSessionId(null);
      setSessionError(null);
      setSessionLoading(false);
      setProjectFileEntries([]);
      setProjectFilesTruncated(false);
      setProjectFilesError(null);
      setProjectFilesLoading(false);
      setProjectFileLoadedDirs([]);
      setProjectFileLoadingDirs([]);
      setProjectFileQuery("");
      setSelectedProjectFilePath(null);
      setSelectedProjectFileContent(null);
      setProjectFileContentError(null);
      setProjectFileContentLoading(false);
      return;
    }

    void loadTaskDetails(activeProjectId);
    void loadProjectRuntime(activeProjectId);
    void loadProjectSessions(activeProjectId);
    projectFileDirectoryRequestsRef.current.clear();
    setProjectFileEntries([]);
    setProjectFilesTruncated(false);
    setProjectFileLoadedDirs([]);
    setProjectFileLoadingDirs([]);
    void loadProjectDirectoryEntries(activeProjectId, "", true);
    setSelectedProjectFilePath(null);
    setSelectedProjectFileContent(null);
    setProjectFileContentError(null);
    setProjectFileContentLoading(false);
  }, [isAuthenticated, activeProjectId]);

  useEffect(() => {
    if (!activeProjectId && activeMainView !== "chat") {
      setActiveMainView("chat");
    }
  }, [activeMainView, activeProjectId]);

  useEffect(() => {
    return () => {
      if (schedulerCardPulseTimerRef.current !== null) {
        window.clearTimeout(schedulerCardPulseTimerRef.current);
        schedulerCardPulseTimerRef.current = null;
      }
      cleanupMediaRecorder();
      stopSpeakingAudio();
    };
  }, []);

  useEffect(() => {
    if (!isAuthenticated) {
      setSchedulerStatus(null);
      setSchedulerError(null);
      setSchedulerLoading(false);
      setAvailableCommands([]);
      return;
    }

    void loadSchedulerStatus();
    void loadAvailableCommands();
    const intervalId = window.setInterval(() => {
      void loadSchedulerStatus();
    }, 45000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated) {
      return;
    }

    const intervalId = window.setInterval(() => {
      void handleSyncProjects();
    }, 90000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [isAuthenticated]);

  useEffect(() => {
    const body = chatBodyRef.current;
    if (!body) {
      return;
    }

    const latestEntryId = timelineEntries[timelineEntries.length - 1]?.id ?? null;
    if (!latestEntryId) {
      setUnreadEntryId(null);
      return;
    }

    const previousChatKey = previousChatKeyRef.current;
    const openingChat = activeChatKey !== previousChatKey;
    previousChatKeyRef.current = activeChatKey;

    if (!activeChatKey) {
      setUnreadEntryId(null);
      return;
    }

    const lastReadEntryId = latestReadEntryIdByChatRef.current[activeChatKey] ?? null;
    const lastReadIndex = lastReadEntryId
      ? timelineEntries.findIndex((entry) => entry.id === lastReadEntryId)
      : -1;
    const firstUnreadEntry =
      lastReadIndex >= 0 ? timelineEntries[lastReadIndex + 1] ?? null : timelineEntries[timelineEntries.length - 1] ?? null;

    if (openingChat) {
      pendingOpenScrollRef.current = firstUnreadEntry?.id ?? latestEntryId;
      setUnreadEntryId(firstUnreadEntry?.id ?? null);
      return;
    }

    if (isChatNearBottom) {
      latestReadEntryIdByChatRef.current[activeChatKey] = latestEntryId;
      setUnreadEntryId(null);
      return;
    }

    setUnreadEntryId(firstUnreadEntry?.id ?? null);
  }, [activeChatKey, isChatNearBottom, timelineEntries]);

  useEffect(() => {
    if (!activeChatKey) {
      pendingOpenScrollRef.current = null;
      return;
    }

    const targetEntryId = pendingOpenScrollRef.current;
    if (!targetEntryId) {
      return;
    }

    const entry = timelineEntryRefs.current[targetEntryId] ?? null;
    if (!entry) {
      return;
    }

    scrollEntryIntoView(chatBodyRef.current, entry, "auto");
    pendingOpenScrollRef.current = null;
  }, [activeChatKey, timelineEntries]);

  useLayoutEffect(() => {
    const body = chatBodyRef.current;
    if (!body) {
      pendingScrollAnchorRef.current = null;
      return;
    }

    if (isChatNearBottom) {
      body.scrollTop = Math.max(0, body.scrollHeight - body.clientHeight);
      return;
    }

    const pendingAnchor = pendingScrollAnchorRef.current;
    if (!pendingAnchor) {
      return;
    }

    const entry = timelineEntryRefs.current[pendingAnchor.entryId];
    if (!entry) {
      pendingScrollAnchorRef.current = null;
      return;
    }

    const bodyTop = body.getBoundingClientRect().top;
    const nextTop = entry.getBoundingClientRect().top - bodyTop;
    body.scrollTop += nextTop - pendingAnchor.top;
    pendingScrollAnchorRef.current = null;
  }, [isChatNearBottom, renderedTimelineEntries]);

  useEffect(() => {
    if (typeof window !== "undefined" && "Notification" in window) {
      setNotificationPermission(Notification.permission);
    }
  }, []);

  useEffect(() => {
    if (!activeChatKey || typeof document === "undefined") {
      return;
    }

    const latestFinalAssistantMessage = [...messages]
      .reverse()
      .find((message) => message.role === "assistant" && message.text.trim());
    if (!latestFinalAssistantMessage) {
      return;
    }

    const previousMessageId = lastFinalAssistantMessageIdByChatRef.current[activeChatKey] ?? null;
    const shouldNotify =
      notificationsEnabled &&
      document.hidden &&
      previousMessageId !== latestFinalAssistantMessage.id &&
      typeof window !== "undefined" &&
      "Notification" in window &&
      Notification.permission === "granted";

    if (shouldNotify) {
      const notification = new Notification(activeProject?.name || "Agent reply", {
        body: latestFinalAssistantMessage.text.trim().slice(0, 180),
        tag: `${activeChatKey}:${latestFinalAssistantMessage.id}`,
      });
      notification.onclick = () => {
        window.focus();
        notification.close();
      };
    }

    lastFinalAssistantMessageIdByChatRef.current[activeChatKey] = latestFinalAssistantMessage.id;
  }, [activeChatKey, activeProject?.name, messages, notificationsEnabled]);

  useEffect(() => {
    if (!activeProjectId || messages.length === 0) {
      return;
    }

    if (firstMessageMarkerProjectsRef.current.has(activeProjectId)) {
      return;
    }

    firstMessageMarkerProjectsRef.current.add(activeProjectId);
    addTelemetryMarker("chat.first_message_render", {
      projectId: activeProjectId,
      messageCount: messages.length,
      firstMessageId: messages[0]?.id ?? null,
    });
  }, [activeProjectId, messages]);

  async function handleLogin(password: string) {
    setAuthError(null);
    setAuthLoading(true);
    try {
      await login(password);
      setIsAuthenticated(true);
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Failed to sign in");
    } finally {
      setAuthLoading(false);
    }
  }

  async function handleLogout() {
    await logout();
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    if (streamReconnectTimerRef.current !== null) {
      window.clearTimeout(streamReconnectTimerRef.current);
      streamReconnectTimerRef.current = null;
    }
    if (refreshDebounceRef.current !== null) {
      window.clearTimeout(refreshDebounceRef.current);
      refreshDebounceRef.current = null;
    }
    if (projectSearchDebounceRef.current !== null) {
      window.clearTimeout(projectSearchDebounceRef.current);
      projectSearchDebounceRef.current = null;
    }
    if (schedulerCardPulseTimerRef.current !== null) {
      window.clearTimeout(schedulerCardPulseTimerRef.current);
      schedulerCardPulseTimerRef.current = null;
    }
    cleanupMediaRecorder();
    stopSpeakingAudio();
    searchRequestIdRef.current += 1;
    setIsAuthenticated(false);
    setProjects([]);
    setProjectsHasMore(false);
    setProjectsTotal(0);
    setSearchProjects([]);
    setSearchHasMore(false);
    setSearchTotal(0);
    setSearchLoading(false);
    setSearchDebouncing(false);
    setBasePageLoads(0);
    setSearchPageLoads(0);
    setLastBaseLoadMs(null);
    setLastSearchLoadMs(null);
    setLastSearchQuery("");
    setTelemetryMarkers([]);
    setMarkerCategoryFilter({
      search: true,
      project: true,
      chat: true,
      stream: true,
      system: true,
    });
    setMarkerTimeWindow("all");
    firstMessageMarkerProjectsRef.current = new Set();
    timelineEntryRefs.current = {};
    latestReadEntryIdByChatRef.current = {};
    previousChatKeyRef.current = null;
    pendingOpenScrollRef.current = null;
    messageLoadRequestRef.current += 1;
    taskLoadRequestRef.current += 1;
    sessionLoadRequestRef.current += 1;
    projectFilePreviewRequestRef.current += 1;
    setActiveProjectId(null);
    setActiveSessionId(null);
    setScheduledTask(null);
    setScheduledRuns([]);
    setTaskTimelineEvents([]);
    setTaskInstructionInput("");
    setTaskIntervalInput(15);
    setTaskEnabledInput(true);
    setTaskError(null);
    setSchedulerStatus(null);
    setSchedulerError(null);
    setSchedulerLoading(false);
    setSchedulerCardPulse(false);
    setAvailableCommands([]);
    setCommandPickerOpen(false);
    setCommandSearch("");
    setRuntimeModels([]);
    setRuntimeAgents([]);
    setSelectedModel(null);
    setSelectedAgent(null);
    setRuntimeLoading(false);
    setRuntimeSaving(false);
    setRuntimeError(null);
    setProjectSessions([]);
    setSessionLoading(false);
    setSessionSwitching(false);
    setSessionError(null);
    setMobileProjectListOpen(false);
    setMobileSettingsOpen(false);
    setRecording(false);
    setTranscribingAudio(false);
    setSpeakingMessageId(null);
    setMessages([]);
    setDiffEntries([]);
    setRunIntentActive(false);
    setStopFeedbackLabel(null);
    setStopFeedbackUntilMs(null);
    setReconnectStartedAtMs(null);
    setReconnectAttemptCount(0);
    setPendingApprovals([]);
  }

  async function handleSelectProject(projectId: string) {
    messageLoadRequestRef.current += 1;
    taskLoadRequestRef.current += 1;
    sessionLoadRequestRef.current += 1;
    projectFilePreviewRequestRef.current += 1;
    await selectProject(projectId);
    addTelemetryMarker("project.select", {
      projectId,
      mode: isSearchMode ? "search" : "base",
      searchQuery,
    });
    setActiveProjectId(projectId);
    setHighlightedProjectId(projectId);
    setPendingApprovals([]);
    setStopFeedbackLabel(null);
    setStopFeedbackUntilMs(null);
    setActiveSessionId(null);
    resetTimelineExpansionState();
    setUnreadEntryId(null);
    setIsChatNearBottom(true);
    setMobileProjectListOpen(false);
    setMobileSettingsOpen(false);
    setMessages([]);
    setTaskTimelineEvents([]);
    setDiffEntries([]);
    await Promise.all([loadMessages(projectId), loadPendingApprovals(projectId)]);
    void loadDiff(projectId);
  }

  async function ensureBaseProjectLoaded(projectId: string) {
    if (projects.some((project) => project.id === projectId) || !projectsHasMore) {
      return;
    }

    let nextProjects = projects;
    let nextHasMore: boolean = projectsHasMore;
    let nextOffset = projects.length;

    while (!nextProjects.some((project) => project.id === projectId) && nextHasMore) {
      const page = await fetchProjects({ limit: PROJECTS_PAGE_SIZE, offset: nextOffset });
      const seen = new Set(nextProjects.map((project) => project.id));
      const additions = page.projects.filter((project) => !seen.has(project.id));
      nextProjects = [...nextProjects, ...additions];
      nextHasMore = page.hasMore;
      nextOffset = nextProjects.length;
    }

    setProjects(nextProjects);
    setProjectsHasMore(nextHasMore);
    setProjectsTotal((current) => Math.max(current, nextProjects.length));
  }

  function handleProjectSearchKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Escape") {
      return;
    }

    event.preventDefault();
    if (projectSearch.trim()) {
      addTelemetryMarker("search.clear.escape", { queryLength: projectSearch.trim().length });
    }
    setProjectSearch("");
    event.currentTarget.blur();
  }

  async function handleSwitchSession(nextSessionId: string) {
    if (!activeProjectId || !nextSessionId || nextSessionId === activeSessionId) {
      return;
    }

    const targetSession = projectSessions.find((session) => session.id === nextSessionId) ?? null;
    setSessionSwitching(true);
    setSessionSwitchTargetLabel(
      targetSession ? formatSessionOptionLabel(targetSession, nextSessionId) : formatCompactSessionId(nextSessionId)
    );
    setSessionError(null);
    setProjectError(null);
    setStopFeedbackLabel(null);
    setStopFeedbackUntilMs(null);
    resetTimelineExpansionState();
    setUnreadEntryId(null);
    setIsChatNearBottom(true);
    setMobileSettingsOpen(false);
    try {
      const result = await updateProjectSession(activeProjectId, nextSessionId);
      setActiveSessionId(result.activeSessionId);
      updateProjectSessionSelection(activeProjectId, result.activeSessionId);
      setPendingApprovals([]);
      await Promise.all([
        loadProjectSessions(activeProjectId),
        loadMessages(activeProjectId),
        loadPendingApprovals(activeProjectId),
      ]);
      void loadDiff(activeProjectId);
    } catch (error) {
      setSessionError(error instanceof Error ? error.message : "Failed to switch session");
    } finally {
      setSessionSwitching(false);
      setSessionSwitchTargetLabel(null);
    }
  }

  async function handleCreateSession() {
    if (!activeProjectId) {
      return;
    }

    setSessionSwitching(true);
    setSessionError(null);
    setProjectError(null);
    setStopFeedbackLabel(null);
    setStopFeedbackUntilMs(null);
    resetTimelineExpansionState();
    setUnreadEntryId(null);
    setIsChatNearBottom(true);
    setMobileSettingsOpen(false);
    try {
      const result = await createProjectSession(activeProjectId);
      setActiveSessionId(result.activeSessionId);
      updateProjectSessionSelection(activeProjectId, result.activeSessionId);
      setPendingApprovals([]);
      setMessages([]);
      setTaskTimelineEvents([]);
      setDiffEntries([]);
      await Promise.all([
        loadProjectSessions(activeProjectId),
        loadMessages(activeProjectId),
        loadPendingApprovals(activeProjectId),
      ]);
      void loadDiff(activeProjectId);
    } catch (error) {
      setSessionError(error instanceof Error ? error.message : "Failed to create session");
    } finally {
      setSessionSwitching(false);
    }
  }

  async function handleDeleteSession() {
    if (!activeProjectId || !activeSessionId) {
      return;
    }

    const targetSession = projectSessions.find((session) => session.id === activeSessionId) ?? null;
    const targetLabel = targetSession ? formatSessionOptionLabel(targetSession, activeSessionId) : formatCompactSessionId(activeSessionId);
    const confirmMessage = [
      "Delete this session?",
      "",
      targetLabel,
      "",
      "This removes the session from OpenCode for this project.",
      "If it is the last session, this project will also be removed from the chat list.",
    ].join("\n");
    if (!window.confirm(confirmMessage)) {
      return;
    }

    setSessionSwitching(true);
    setSessionError(null);
    setProjectError(null);
    setStopFeedbackLabel(null);
    setStopFeedbackUntilMs(null);
    resetTimelineExpansionState();
    setUnreadEntryId(null);
    setIsChatNearBottom(true);
    setMobileSettingsOpen(false);
    try {
      const result = await deleteProjectSession(activeProjectId, activeSessionId);
      setProjectSessions(result.sessions);
      setActiveSessionId(result.activeSessionId);
      updateProjectSessionSelection(activeProjectId, result.activeSessionId);
      setPendingApprovals([]);
      setMessages([]);
      setTaskTimelineEvents([]);
      setDiffEntries([]);
      if (result.projectDeleted) {
        setProjects((current) => current.filter((project) => project.id !== activeProjectId));
        setSearchProjects((current) => current.filter((project) => project.id !== activeProjectId));
        setActiveSessionId(null);
        setActiveProjectId(result.activeProjectId ?? null);
        const nextProjectId = await refreshProjectsAndStatus(result.activeProjectId ?? null);
        if (nextProjectId) {
          await Promise.all([
            loadMessages(nextProjectId),
            loadPendingApprovals(nextProjectId),
          ]);
          void loadDiff(nextProjectId);
        }
        return;
      }
      if (result.activeSessionId) {
        await Promise.all([
          loadMessages(activeProjectId),
          loadPendingApprovals(activeProjectId),
        ]);
        void loadDiff(activeProjectId);
      }
    } catch (error) {
      setSessionError(error instanceof Error ? error.message : "Failed to delete session");
    } finally {
      setSessionSwitching(false);
    }
  }

  async function handleCreateProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setProjectError(null);

    const trimmedProjectName = newProjectName.trim();
    if (!trimmedProjectName) {
      setProjectError("Project name is required");
      return;
    }

    const effectiveRootPath =
      normalizeProjectRootPath(newProjectRootPath) || normalizeProjectRootPath(newProjectPath);
    const targetProjectPath = buildProjectPathFromRoot(effectiveRootPath, trimmedProjectName);
    if (!targetProjectPath) {
      setProjectError("Project root path is required");
      return;
    }

    setCreatingProject(true);
    try {
      await createProject({
        name: trimmedProjectName,
        path: targetProjectPath,
      });
      setNewProjectName("");
      setNewProjectRootPath(preferredProjectRoot);
      setNewProjectPath(preferredProjectRoot);
      setMobileNewProjectOpen(false);
      await refreshProjectsAndStatus(activeProjectId);
    } catch (error) {
      setProjectError(error instanceof Error ? error.message : "Unable to create project");
    } finally {
      setCreatingProject(false);
    }
  }

  async function pickDirectoryNameWithFileInput(): Promise<string | null> {
    return new Promise((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.setAttribute("webkitdirectory", "");
      input.setAttribute("directory", "");
      input.style.position = "fixed";
      input.style.left = "-10000px";

      const cleanup = () => {
        input.removeEventListener("change", handleChange);
        input.remove();
      };

      const handleChange = () => {
        const files = input.files;
        if (!files || files.length === 0) {
          cleanup();
          resolve(null);
          return;
        }

        const firstFile = files[0] as File & { webkitRelativePath?: string };
        const relativePath = typeof firstFile.webkitRelativePath === "string" ? firstFile.webkitRelativePath : "";
        const directoryName = relativePath.split("/").filter(Boolean)[0] ?? null;
        cleanup();
        resolve(directoryName);
      };

      input.addEventListener("change", handleChange);
      document.body.appendChild(input);
      input.click();
    });
  }

  async function handlePickProjectDirectory() {
    const pickerWindow = window as Window & {
      showDirectoryPicker?: () => Promise<{ name?: string }>;
    };

    if (pickerWindow.showDirectoryPicker) {
      try {
        const handle = await pickerWindow.showDirectoryPicker();
        const fallbackName = typeof handle.name === "string" ? handle.name.trim() : "";
        if (preferredProjectRoot && fallbackName) {
          const nextRootPath = preferredProjectRoot;
          setNewProjectRootPath(nextRootPath);
          setNewProjectName(fallbackName);
          setNewProjectPath(buildProjectPathFromRoot(nextRootPath, fallbackName));
          setProjectError(null);
        } else {
          setProjectError("Folder selected. Paste the absolute path if the browser cannot expose it directly.");
        }
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        setProjectError(error instanceof Error ? error.message : "Unable to open folder picker");
      }
      return;
    }

    try {
      const fallbackName = await pickDirectoryNameWithFileInput();
      if (!fallbackName) {
        setProjectError("Folder picker is not supported in this browser. Enter the path manually.");
        return;
      }

      if (preferredProjectRoot) {
        const nextRootPath = preferredProjectRoot;
        setNewProjectRootPath(nextRootPath);
        setNewProjectName(fallbackName);
        setNewProjectPath(buildProjectPathFromRoot(nextRootPath, fallbackName));
        setProjectError(null);
      } else {
        setProjectError("Folder selected. Enter the absolute path manually for this browser.");
      }
    } catch (error) {
      setProjectError(error instanceof Error ? error.message : "Unable to open folder picker");
    }
  }

  async function handleSelectProjectFile(path: string) {
    if (!activeProjectId) {
      return;
    }
    setSelectedProjectFilePath(path);
    await loadProjectFilePreview(activeProjectId, path);
  }

  async function handleSendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeProjectId || sending || hasBlockingApprovals) {
      return;
    }

    const text = composerValue.trim();
    if (!text) {
      return;
    }

    setSending(true);
    setRunIntentActive(true);
    setProjectError(null);
    if (notificationsEnabled) {
      void requestBrowserNotificationPermission();
    }

    const userEcho: ChatMessage = {
      id: `local-${Date.now()}`,
      role: "user",
      createdAt: new Date().toISOString(),
      text,
      parts: [{ type: "text", text }],
    };
    setMessages((current) => [...current, userEcho]);
    setIsChatNearBottom(true);
    setUnreadEntryId(null);
    setComposerValue("");

    try {
      const parsed = parseSlashCommand(text);
      const result = parsed
        ? await runCommand(activeProjectId, parsed.command, parsed.argumentsList)
        : await sendMessage(activeProjectId, text);

      setMessages((current) => [...current, result.message]);
      await refreshProjectsAndStatus(activeProjectId);
      await Promise.all([
        loadMessages(activeProjectId),
        loadPendingApprovals(activeProjectId),
      ]);
      void loadDiff(activeProjectId);
    } catch (error) {
      setProjectError(error instanceof Error ? error.message : "Failed to send message");
      setMessages((current) => current.filter((message) => message.id !== userEcho.id));
      setComposerValue(text);
    } finally {
      setSending(false);
    }
  }

  async function handleAbortGeneration() {
    if (!activeProjectId || aborting) {
      return;
    }

    addTelemetryMarker("chat.stop.composer_click", {
      projectId: activeProjectId,
      streamStatus,
    });
    setRunIntentActive(true);
    setAborting(true);
    setProjectError(null);
    try {
      await abortSession(activeProjectId);
      setRunIntentActive(false);
      setStopFeedbackLabel("Stop requested. Waiting for final session update...");
      setStopFeedbackUntilMs(Date.now() + 4_000);
      addTelemetryMarker("chat.abort.manual", { projectId: activeProjectId });
      await Promise.all([
        loadMessages(activeProjectId),
        loadPendingApprovals(activeProjectId),
      ]);
      void loadDiff(activeProjectId);
      await refreshProjectsAndStatus(activeProjectId);
    } catch (error) {
      setProjectError(error instanceof Error ? error.message : "Failed to abort generation");
    } finally {
      setAborting(false);
    }
  }

  function handleChatScroll(event: UIEvent<HTMLElement>) {
    const body = event.currentTarget;
    const nearBottom = body.scrollHeight - body.scrollTop - body.clientHeight < 180;
    setIsChatNearBottom(nearBottom);

    if (!nearBottom || !activeChatKey || timelineEntries.length === 0) {
      return;
    }

    const latestEntryId = timelineEntries[timelineEntries.length - 1]?.id;
    if (!latestEntryId) {
      return;
    }

    latestReadEntryIdByChatRef.current[activeChatKey] = latestEntryId;
    setUnreadEntryId(null);
  }

  function handleScrollToUnread() {
    const targetEntryId = unreadEntryId ?? timelineEntries[timelineEntries.length - 1]?.id ?? null;
    if (!targetEntryId) {
      return;
    }

    scrollEntryIntoView(chatBodyRef.current, timelineEntryRefs.current[targetEntryId] ?? null);
  }

  async function handleTranscribeBlob(audioBlob: Blob) {
    setTranscribingAudio(true);
    setProjectError(null);
    try {
      const result = await transcribeAudio({ audio: audioBlob });
      if (result.text?.trim()) {
        setComposerValue((current) => (current ? `${current} ${result.text.trim()}` : result.text.trim()));
      }
      addTelemetryMarker("chat.stt.transcribed", { chars: result.text?.length ?? 0 });
    } catch (error) {
      setProjectError(error instanceof Error ? error.message : "Failed to transcribe audio");
    } finally {
      setTranscribingAudio(false);
    }
  }

  async function handleToggleRecording() {
    if (recording) {
      const recorder = mediaRecorderRef.current;
      if (recorder && recorder.state !== "inactive") {
        recorder.stop();
      }
      setRecording(false);
      return;
    }

    setProjectError(null);
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("This browser does not support microphone recording");
      }
      if (typeof MediaRecorder === "undefined") {
        throw new Error("This browser does not support MediaRecorder");
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      mediaStreamRef.current = stream;
      mediaRecorderRef.current = recorder;
      mediaChunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          mediaChunksRef.current.push(event.data);
        }
      };

      recorder.onstop = () => {
        const blob = new Blob(mediaChunksRef.current, {
          type: recorder.mimeType || "audio/webm",
        });
        cleanupMediaRecorder();
        if (blob.size > 0) {
          void handleTranscribeBlob(blob);
        }
      };

      recorder.start();
      setRecording(true);
      addTelemetryMarker("chat.stt.record_start");
    } catch (error) {
      setProjectError(error instanceof Error ? error.message : "Microphone access failed");
      cleanupMediaRecorder();
    }
  }

  async function handleSpeakMessage(message: ChatMessage) {
    const text = message.text?.trim();
    if (!text) {
      return;
    }

    if (speakingMessageId === message.id) {
      stopSpeakingAudio();
      return;
    }

    stopSpeakingAudio();
    setProjectError(null);
    setSpeakingMessageId(message.id);

    try {
      const audioBlob = await speakText({ text, format: "mp3" });
      const url = URL.createObjectURL(audioBlob);
      speakingUrlRef.current = url;
      const audio = new Audio(url);
      speakingAudioRef.current = audio;
      audio.onended = () => {
        stopSpeakingAudio();
      };
      await audio.play();
      addTelemetryMarker("chat.tts.play", { messageId: message.id, chars: text.length });
    } catch (error) {
      setProjectError(error instanceof Error ? error.message : "Failed to play TTS audio");
      stopSpeakingAudio();
    }
  }

  function handleInsertCommand(commandName: string) {
    const nextValue = `/${commandName} `;
    setComposerValue(nextValue);
    setCommandPickerOpen(false);
    setCommandSearch("");
  }

  async function handlePermissionDecision(
    permissionId: string,
    responseValue: "approve" | "deny"
  ) {
    if (!activeProjectId || respondingPermissionId) {
      return;
    }

    setRespondingPermissionId(permissionId);
    setProjectError(null);
    try {
      await respondPermission(activeProjectId, permissionId, responseValue, false);
      setPendingApprovals((current) =>
        current.filter((item) => item.permissionId !== permissionId)
      );

      const decisionMessage: ChatMessage = {
        id: `permission-${permissionId}-${Date.now()}`,
        role: "system",
        createdAt: new Date().toISOString(),
        text: `Permission ${responseValue === "approve" ? "approved" : "denied"}: ${permissionId}`,
        parts: [],
      };
      setMessages((current) => [...current, decisionMessage]);
    } catch (error) {
      setProjectError(
        error instanceof Error ? error.message : "Failed to submit permission decision"
      );
    } finally {
      setRespondingPermissionId(null);
    }
  }

  function handleExportTelemetrySnapshot() {
    const selectedMarkerCategories = TELEMETRY_CATEGORIES.filter(
      (category) => markerCategoryFilter[category]
    );
    const snapshot = {
      capturedAt: new Date().toISOString(),
      mode: isSearchMode ? "search" : "base",
      renderedProjects: visibleProjects.length,
      visibleTotal: visibleProjectsTotal,
      activeProjectId,
      highlightedProjectId,
      base: {
        loadedProjects: projects.length,
        total: projectsTotal,
        hasMore: projectsHasMore,
        pageLoads: basePageLoads,
        lastLoadMs: lastBaseLoadMs,
      },
      search: {
        query: searchQuery,
        loadedProjects: searchProjects.length,
        total: searchTotal,
        hasMore: searchHasMore,
        pageLoads: searchPageLoads,
        lastLoadMs: lastSearchLoadMs,
        lastQuery: lastSearchQuery,
      },
      stream: {
        status: streamStatus,
      },
      markerFilter: {
        timeWindow: markerTimeWindow,
        selectedCategories: selectedMarkerCategories,
        totalMarkers: telemetryMarkers.length,
        timeWindowMarkers: timeFilteredTelemetryMarkers.length,
        exportedMarkers: filteredTelemetryMarkers.length,
      },
      markers: filteredTelemetryMarkers,
    };

    const blob = new Blob([JSON.stringify(snapshot, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    anchor.href = url;
    anchor.download = `project-telemetry-${timestamp}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function handleResetTelemetryCounters() {
    setBasePageLoads(0);
    setSearchPageLoads(0);
    setLastBaseLoadMs(null);
    setLastSearchLoadMs(null);
    setLastSearchQuery("");
    setTelemetryMarkers([]);
    setMarkerCategoryFilter({
      search: true,
      project: true,
      chat: true,
      stream: true,
      system: true,
    });
    setMarkerTimeWindow("all");
    firstMessageMarkerProjectsRef.current = new Set();
  }

  function handleToggleMarkerCategory(category: TelemetryMarkerCategory) {
    setMarkerCategoryFilter((current) => ({
      ...current,
      [category]: !current[category],
    }));
  }

  function handleChangeMarkerTimeWindow(value: TelemetryTimeWindow) {
    setMarkerTimeWindow(value);
  }

  if (authLoading && !isAuthenticated) {
    return <div className="loading-screen">Loading...</div>;
  }

  if (!isAuthenticated) {
    return <LoginView loading={authLoading} error={authError} onSubmit={handleLogin} />;
  }

  return (
    <div className="shell">
      <CommandPickerModal
        open={commandPickerOpen}
        query={commandSearch}
        commands={filteredCommandList}
        onClose={() => {
          setCommandPickerOpen(false);
          setCommandSearch("");
        }}
        onQueryChange={setCommandSearch}
        onInsert={handleInsertCommand}
      />
      {showMobileProjectList ? (
        <section className={`mobile-projects-screen ${showMobileProjectList ? "open" : ""}`}>
          <div className="mobile-projects-topbar">
            <div className="mobile-projects-title">
              <span className="mobile-app-avatar" aria-hidden="true">
                OC
              </span>
              <div>
                <h1>OpenCode</h1>
                <p>{visibleProjects.length} chats</p>
              </div>
            </div>
            <div className="mobile-projects-actions">
                <button type="button" className="mobile-icon-button" onClick={() => setMobileNewProjectOpen((current) => !current)}>
                {mobileNewProjectOpen ? "Close" : "Create"}
                </button>
              <button type="button" className="mobile-icon-button" onClick={handleLogout}>
                Exit
              </button>
            </div>
          </div>

          <div className="mobile-search-wrap">
            <input
              ref={mobileProjectSearchInputRef}
              value={projectSearch}
              onChange={(event) => setProjectSearch(event.target.value)}
              onKeyDown={handleProjectSearchKeyDown}
              placeholder="Search chats"
            />
            {searchQuery ? (
              <button type="button" className="mobile-clear-search-button" onClick={() => setProjectSearch("")}>Clear</button>
            ) : null}
          </div>
          <div className="search-status-line">{mobileSearchStatusLabel}</div>
          {mobileNewProjectOpen ? (
            <form
              className="mobile-new-project-card"
              onSubmit={(event) => {
                handleCreateProject(event);
              }}
            >
              <div className="mobile-new-project-head">
                <strong>Create chat project</strong>
                <small>Folder name will match project name</small>
              </div>
              <input
                value={newProjectName}
                onChange={(event) => handleNewProjectNameInput(event.target.value)}
                placeholder="Project name"
              />
              <input
                value={newProjectPath}
                onChange={(event) => handleNewProjectPathInput(event.target.value)}
                placeholder={preferredProjectRoot || "Project root path"}
              />
              {preferredProjectRoot ? <small>Root path: {preferredProjectRoot}</small> : null}
              <div className="mobile-new-project-actions">
                <button type="button" className="mobile-icon-button" onClick={() => setMobileNewProjectOpen(false)}>
                  Cancel
                </button>
                <button disabled={creatingProject} type="submit" className="mobile-sync-button">
                  {creatingProject ? "Creating" : "Create chat"}
                </button>
              </div>
            </form>
          ) : null}

          {activeProject ? (
            <button
              type="button"
              className="mobile-active-chat-pill"
              onClick={() => {
                setMobileProjectListOpen(false);
                setMobileSettingsOpen(false);
              }}
            >
              <span className="mobile-active-chat-avatar">{projectInitials(activeProject.name)}</span>
              <span className="mobile-active-chat-copy">
                <strong>{activeProject.name}</strong>
                <small>Open current conversation</small>
              </span>
            </button>
          ) : null}

          <div className="mobile-project-list-wrap">
            <VirtualizedProjectList
              key={searchQuery.toLowerCase()}
              projects={visibleProjects}
              activeProjectId={activeProjectId}
              highlightedProjectId={null}
              onSelect={handleSelectProject}
              emptyLabel={searchQuery ? "No matching chats" : "No chats yet"}
              searchQuery={searchQuery}
              totalLabel={`${visibleProjects.length} shown`}
              hasMore={visibleProjectsHasMore}
              isLoadingMore={isLoadingVisibleProjects}
              rowHeight={72}
              onReachEnd={() => {
                if (isSearchMode) {
                  void loadSearchProjects(searchQuery, searchProjects.length, false);
                  return;
                }
                void loadMoreProjects();
              }}
            />
          </div>
        </section>
      ) : null}
      <aside className="sidebar">
        <div className="sidebar-top">
          <h2>
            Projects ({visibleProjects.length}
            {visibleProjectsTotal > visibleProjects.length ? `/${visibleProjectsTotal}` : ""})
          </h2>
          <div className="sidebar-actions">
            <button onClick={handleLogout} type="button">
              Logout
            </button>
          </div>
        </div>

        <form className={`new-project ${desktopProjectControlsCollapsed ? "collapsed" : ""}`} onSubmit={handleCreateProject}>
          <div className="new-project-head">
            <div>
              <strong>Projects</strong>
              <small>Search and create local chat folders</small>
            </div>
            <button
              type="button"
              className="new-project-collapse-button"
              onClick={() => setDesktopProjectControlsCollapsed((current) => !current)}
              aria-expanded={!desktopProjectControlsCollapsed}
            >
              {desktopProjectControlsCollapsed ? "Expand" : "Collapse"}
            </button>
          </div>
          <input
            ref={desktopProjectSearchInputRef}
            value={projectSearch}
            onChange={(event) => setProjectSearch(event.target.value)}
            onKeyDown={handleProjectSearchKeyDown}
            onFocus={() => {
              addTelemetryMarker("search.focus", {
                mode: isSearchMode ? "search" : "base",
                queryLength: searchQuery.length,
              });
            }}
            placeholder="Search projects (Ctrl+K)"
          />
          <div className="search-inline-actions">
            {searchQuery ? (
              <button type="button" className="secondary-button search-clear-button" onClick={() => setProjectSearch("")}>
                Clear search
              </button>
            ) : null}
          </div>
          <small className="search-status-line">{searchSummaryLabel}</small>
          <div className={`new-project-extra ${desktopProjectControlsCollapsed ? "collapsed" : ""}`}>
            <input
              value={newProjectName}
              onChange={(event) => handleNewProjectNameInput(event.target.value)}
              placeholder="Project name"
            />
            <input
              value={newProjectPath}
              onChange={(event) => handleNewProjectPathInput(event.target.value)}
              placeholder={preferredProjectRoot || "Project root path"}
            />
            <div className="new-project-hint-row">
              <small>{preferredProjectRoot ? `Root path: ${preferredProjectRoot}` : "Enter an absolute root folder path"}</small>
              <button
                type="button"
                className="ghost-button"
                onClick={() => {
                  const nextRootPath = preferredProjectRoot;
                  setNewProjectRootPath(nextRootPath);
                  setNewProjectPath(buildProjectPathFromRoot(nextRootPath, newProjectName.trim()));
                }}
                disabled={!preferredProjectRoot}
              >
                Use suggested
              </button>
            </div>
            <div className="new-project-actions-row">
              <button type="button" className="ghost-button" onClick={() => void handlePickProjectDirectory()}>
                Choose folder
              </button>
              <button disabled={creatingProject} type="submit">
                {creatingProject ? "Creating..." : "Create chat"}
              </button>
            </div>
          </div>
        </form>

        <VirtualizedProjectList
          key={searchQuery.toLowerCase()}
          projects={visibleProjects}
          activeProjectId={activeProjectId}
          highlightedProjectId={highlightedProjectId}
          onSelect={handleSelectProject}
          emptyLabel={searchQuery ? "No matching projects" : "No projects yet"}
          searchQuery={searchQuery}
          totalLabel={`${visibleProjects.length} shown${visibleProjectsTotal > visibleProjects.length ? ` of ${visibleProjectsTotal}` : ""}`}
          hasMore={visibleProjectsHasMore}
          isLoadingMore={isLoadingVisibleProjects}
          rowHeight={84}
          onReachEnd={() => {
            if (isSearchMode) {
              void loadSearchProjects(searchQuery, searchProjects.length, false);
              return;
            }
            void loadMoreProjects();
          }}
        />
      </aside>

      <main className={`chat-pane ${showMobileProjectList ? "" : "visible"}`}>
        <header className="chat-header">
          {isMobileViewport ? (
            <button
              type="button"
              className="mobile-menu-button mobile-back-button"
              onClick={() => setMobileProjectListOpen(true)}
            >
              ←
            </button>
          ) : null}
          {isMobileViewport && activeProject ? (
            <div className="mobile-chat-avatar" aria-hidden="true">
              {projectInitials(activeProject.name)}
            </div>
          ) : null}
          {!isMobileViewport && activeProject ? (
            <div className="chat-project-badge" aria-hidden="true">
              {projectInitials(activeProject.name)}
            </div>
          ) : null}
          <div className="chat-header-main">
            <h3>{activeProject?.name ?? "No project selected"}</h3>
            <p className="chat-project-path">
              {activeProject
                ? isMobileViewport
                  ? formatShortSessionLabel(activeSessionId)
                  : activeProject.path
                : "Pick a project from the left sidebar."}
            </p>
            {activeProject && !isMobileViewport ? (
              <p className="chat-header-meta">
                <span>Session {formatCompactSessionId(activeSessionId)}</span>
                {activeSession && activeSession.summary.files > 0 ? (
                  <span>
                    {activeSession.summary.files} files, +{activeSession.summary.additions}/-
                    {activeSession.summary.deletions}
                  </span>
                ) : null}
              </p>
            ) : null}
          </div>
          <div className="chat-header-controls">
            {activeProject ? (
              <div className="main-view-toggle" role="tablist" aria-label="Main view">
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeMainView === "chat"}
                  className={activeMainView === "chat" ? "active" : ""}
                  onClick={() => setActiveMainView("chat")}
                >
                  Chat
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeMainView === "files"}
                  className={activeMainView === "files" ? "active" : ""}
                  onClick={() => setActiveMainView("files")}
                >
                  Files
                </button>
              </div>
            ) : null}
            {!isMobileViewport ? (
              <span className="status">
                OpenCode: {opencodeStatus} | stream: {streamStatus}
                {hasActiveRun ? <span className="run-active-badge">Run active</span> : null}
                <button
                  type="button"
                  className={`scheduler-heartbeat ${schedulerHeartbeat.level}`}
                  onClick={focusSchedulerCard}
                  title="Show scheduler details (Shift+S)"
                >
                  {schedulerHeartbeat.label}
                </button>
              </span>
            ) : null}
            {isMobileViewport ? (
              <button
                type="button"
                className="mobile-menu-button"
                onClick={() => setMobileSettingsOpen(true)}
              >
                ⋮
              </button>
            ) : null}
          </div>
        </header>

        {activeProject && !isMobileViewport ? (
          <section className={`chat-toolbar ${desktopChatToolbarCollapsed ? "collapsed" : ""}`}>
            <div className="chat-toolbar-head">
              <div>
                <strong>Workspace controls</strong>
                <span>Runtime, command help, and task scheduling</span>
              </div>
              <button
                type="button"
                className="chat-toolbar-collapse-button"
                onClick={() => setDesktopChatToolbarCollapsed((current) => !current)}
                aria-expanded={!desktopChatToolbarCollapsed}
              >
                {desktopChatToolbarCollapsed ? "Expand" : "Collapse"}
              </button>
            </div>
            <div className={`chat-toolbar-content ${desktopChatToolbarCollapsed ? "collapsed" : ""}`}>
              <div className="chat-toolbar-grid">
                <div className="toolbar-card runtime-card">
                  <div className="toolbar-card-head">
                    <strong>Runtime</strong>
                    <span>Model and agent</span>
                  </div>
                  <RuntimeControls
                    models={runtimeModels}
                    agents={runtimeAgents}
                    selectedModel={selectedModel}
                    selectedAgent={selectedAgent}
                    saving={runtimeSaving || runtimeLoading}
                    error={runtimeError}
                    onModelChange={(value) => {
                      void saveProjectRuntimeSelection({ model: value, agent: selectedAgent });
                    }}
                    onAgentChange={(value) => {
                      void saveProjectRuntimeSelection({ model: selectedModel, agent: value });
                    }}
                  />
                  <SessionControls
                    sessions={projectSessions}
                    activeSessionId={activeSessionId}
                    loading={sessionLoading}
                    switching={sessionSwitching}
                    switchTargetLabel={sessionSwitchTargetLabel}
                    error={sessionError}
                    onChange={(value) => {
                      void handleSwitchSession(value);
                    }}
                    onCreate={() => {
                      void handleCreateSession();
                    }}
                    onDelete={() => {
                      void handleDeleteSession();
                    }}
                  />
                </div>

                <div className="toolbar-card notifications-card">
                  <NotificationControls
                    supported={notificationPermission !== "unsupported"}
                    enabled={notificationsEnabled}
                    permission={notificationPermission}
                    onEnable={() => {
                      void handleEnableNotifications();
                    }}
                    onDisable={handleDisableNotifications}
                  />
                </div>

                <div className="toolbar-card commands-card">
                  <CommandHelpBar
                    commands={availableCommands}
                    onInsert={handleInsertCommand}
                    onOpenPicker={() => setCommandPickerOpen(true)}
                    defaultOpen={!isMobileViewport}
                  />
                </div>
              </div>

              <ScheduledTaskPanel
                loading={taskLoading}
                saving={taskSaving}
                running={taskRunning}
                deleting={taskDeleting}
                error={taskError}
                instruction={taskInstructionInput}
                intervalMinutes={taskIntervalInput}
                enabled={taskEnabledInput}
                task={scheduledTask}
                runs={scheduledRuns}
                onInstructionChange={setTaskInstructionInput}
                onIntervalChange={setTaskIntervalInput}
                onEnabledChange={setTaskEnabledInput}
                onSave={handleSaveTask}
                onRunNow={handleRunTaskNow}
                onDelete={handleDeleteTask}
              />
            </div>
          </section>
        ) : null}

        {activeProject && isMobileViewport ? (
          <div className="mobile-chat-meta-strip visible">
            <button type="button" className={`scheduler-heartbeat ${schedulerHeartbeat.level}`} onClick={focusSchedulerCard}>
              {schedulerHeartbeat.label}
            </button>
            {hasActiveRun ? <span className="meta-pill run-active-pill">Run active</span> : null}
            <span className="meta-pill">{selectedAgent || "default agent"}</span>
            <span className="meta-pill">{selectedModel || "server model"}</span>
          </div>
        ) : null}

        {activeMainView === "chat" ? (
        <section className="chat-body" ref={chatBodyRef} onScroll={handleChatScroll}>
          {fixtureMode ? <FixtureBanner mode={fixtureMode} /> : null}
          {stopFeedbackVisible ? (
            <div className="stop-feedback-row" role="status" aria-live="polite">
              {stopFeedbackLabel}
            </div>
          ) : null}
          <div className={`chat-transition-shell ${transitionStatus ? "active" : ""}`}>
            {transitionStatus ? (
              <ChatTransitionStrip
                tone={transitionStatus.tone}
                label={transitionStatus.label}
                detail={transitionStatus.detail}
              />
            ) : null}
          </div>
          <CapabilityWarning commands={availableCommands} />
          {fixtureMode === "no-project" ? (
            <ChatStateCard
              title="Select a project to start chatting."
              detail="Fixture preview for the no-project state. Remove `?fixture=no-project` to return to the live chat."
            />
          ) : !activeProject ? (
            <ChatStateCard
              title="Select a project to start chatting."
              detail="Choose a project from the sidebar to load its OpenCode session and message history."
            />
          ) : null}
          {activeProject && fixtureMode !== "no-project" && renderedTimelineEntries.length === 0 && !messagesLoading && fixtureMode !== "chat-loading" ? <EmptyState /> : null}
          {fixtureMode === "chat-loading" ? (
            <ChatStateCard
              title="Loading this session..."
              detail="Fixture preview for the loading state. Remove `?fixture=chat-loading` to return to the live chat."
            />
          ) : messagesLoading && !sessionSwitching ? (
            <ChatStateCard
              title="Loading this session..."
              detail="Fetching message history, activity, and pending approvals for the selected project."
            />
          ) : null}
          {activeProject && fixtureMode !== "no-project" && hasBlockingApprovals ? (
            <div className="approval-list">
              {visiblePendingApprovals.map((approval) => (
                <article className="approval-card" key={approval.permissionId}>
                  <header>
                    <strong>{approval.title}</strong>
                    <span>{approval.permissionId}</span>
                  </header>
                  <p>{approval.details}</p>
                  <div className="approval-actions">
                    <button
                      type="button"
                      disabled={respondingPermissionId === approval.permissionId}
                      onClick={() => handlePermissionDecision(approval.permissionId, "approve")}
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      className="danger"
                      disabled={respondingPermissionId === approval.permissionId}
                      onClick={() => handlePermissionDecision(approval.permissionId, "deny")}
                    >
                      Deny
                    </button>
                  </div>
                </article>
              ))}
            </div>
          ) : null}
          {activeProject && renderedTimelineEntries.length > 0 ? (
            <div className="messages-list">
              {renderedTimelineEntries.map((entry, index) => {
                const previousEntry = index > 0 ? renderedTimelineEntries[index - 1] : null;
                const nextEntry = index < renderedTimelineEntries.length - 1 ? renderedTimelineEntries[index + 1] : null;
                const entryDay = new Date(entry.createdAt).toDateString();
                const previousDay = previousEntry ? new Date(previousEntry.createdAt).toDateString() : null;
                const showDaySeparator = entryDay !== previousDay;
                const previousMessage = previousEntry?.kind === "message" ? previousEntry.message : null;
                const nextMessage = nextEntry?.kind === "message" ? nextEntry.message : null;
                const attachedTop =
                  entry.kind === "message" &&
                  previousMessage !== null &&
                  previousMessage.role === entry.message.role &&
                  !showDaySeparator;
                const attachedBottom =
                  entry.kind === "message" &&
                  nextMessage !== null &&
                  nextEntry !== null &&
                  nextMessage.role === entry.message.role &&
                  new Date(nextEntry.createdAt).toDateString() === entryDay;

                return (
                  <div
                    key={entry.id}
                    ref={(node) => {
                      timelineEntryRefs.current[entry.id] = node;
                      if (entry.kind === "activity") {
                        for (const childId of entry.childIds) {
                          timelineEntryRefs.current[childId] = node;
                        }
                      }
                    }}
                    data-entry-id={entry.id}
                  >
                    {showDaySeparator ? (
                      <div className="message-day-separator">
                        <span>{formatTimelineDayLabel(entry.createdAt)}</span>
                      </div>
                    ) : null}
                    {entry.kind === "message" ? (
                      <MessageBubble
                        message={entry.message}
                        canSpeak={Boolean(entry.message.text?.trim())}
                        speaking={speakingMessageId === entry.message.id}
                        attachedTop={attachedTop}
                        attachedBottom={attachedBottom}
                        showParts={entry.message.role !== "assistant" || !entry.message.text.trim()}
                        collapseParts={entry.message.role === "assistant" && Boolean(entry.message.text.trim())}
                        onSpeak={handleSpeakMessage}
                        activityOpen={expandedMessageEntries[buildMessageStableKey(entry.message)] ?? false}
                        onActivityToggle={(nextOpen) => {
                          const messageKey = buildMessageStableKey(entry.message);
                          setExpandedMessageEntries((current) => ({
                            ...current,
                            [messageKey]: nextOpen,
                          }));
                        }}
                        expandedParts={expandedPartEntries}
                        onPartToggle={(partKey, nextOpen) => {
                          setExpandedPartEntries((current) => ({
                            ...current,
                            [partKey]: nextOpen,
                          }));
                        }}
                      />
                      ) : entry.kind === "activity" ? (
                        <AgentActivityCard
                          partItems={entry.partItems}
                          stateKey={entry.stateKey}
                          latestLabel={entry.latestLabel}
                          latestDetail={entry.latestDetail}
                          actionSummaries={entry.actionSummaries}
                          createdAt={entry.createdAt}
                          open={expandedActivityEntries[entry.stateKey] ?? false}
                          onToggle={(nextOpen) => {
                            setExpandedActivityEntries((current) => ({
                              ...current,
                              [entry.stateKey]: nextOpen,
                            }));
                          }}
                          expandedParts={expandedPartEntries}
                          onPartToggle={(partKey, nextOpen) => {
                            setExpandedPartEntries((current) => ({
                              ...current,
                              [partKey]: nextOpen,
                            }));
                          }}
                        />
                      ) : (
                      <TaskRunTimelineRow run={entry.run} />
                    )}
                  </div>
                );
              })}
            </div>
          ) : null}
          {showDiffEmptyFixture ? (
            <div className="timeline-note-card">
              <strong>No file changes detected</strong>
              <small>Fixture preview for an empty diff response in this session.</small>
            </div>
          ) : null}
          {showDiffLargeFixture ? (
            <div className="timeline-note-card">
              <strong>Large diff summary: {effectiveDiffEntries.length} files changed</strong>
              <small>Fixture preview for heavy-change sessions before expanding the detailed diff panel.</small>
            </div>
          ) : null}
          <DiffPanel diff={effectiveDiffEntries} />
          {unreadEntryId ? (
            <button
              type="button"
              className="scroll-to-unread"
              onClick={handleScrollToUnread}
              title="Jump to newest unread message"
              aria-label="Jump to newest unread message"
            >
              ↓
            </button>
          ) : null}
        </section>
        ) : (
          <section className="files-workspace">
            {activeProject ? (
              <ProjectFilesPanel
                projectId={activeProject.id}
                entries={projectFileEntries}
                truncated={projectFilesTruncated}
                loading={projectFilesLoading}
                loadedDirectories={projectFileLoadedDirs}
                loadingDirectories={projectFileLoadingDirs}
                loadError={projectFilesError}
                query={projectFileQuery}
                onQueryChange={setProjectFileQuery}
                selectedFilePath={selectedProjectFilePath}
                onSelectFile={(path) => {
                  void handleSelectProjectFile(path);
                }}
                onExpandDirectory={async (path) => {
                  await loadProjectDirectoryEntries(activeProject.id, path, false);
                }}
                content={selectedProjectFileContent}
                contentLoading={projectFileContentLoading}
                contentError={projectFileContentError}
                mobile={isMobileViewport}
              />
            ) : (
              <ChatStateCard
                title="No project selected"
                detail="Pick a project to browse files."
              />
            )}
          </section>
        )}

        {activeProject && isMobileViewport ? (
          <section className={`mobile-settings-screen ${mobileSettingsOpen ? "open" : ""}`}>
            <div className="mobile-settings-screen-head">
              <button type="button" className="mobile-back-button" onClick={() => setMobileSettingsOpen(false)}>
                ←
              </button>
              <div className="mobile-settings-screen-title">
                <strong>Chat Settings</strong>
                <small>{activeProject.name}</small>
                {sessionSwitching || showSessionSwitchFixture ? (
                  <small>
                    Switching to {showSessionSwitchFixture ? "voice_typing · Current · 01:44 PM" : sessionSwitchTargetLabel || "selected session"}...
                  </small>
                ) : null}
              </div>
            </div>
            <div className="mobile-settings-screen-body">
              <div className="toolbar-card runtime-card">
                <div className="toolbar-card-head">
                  <strong>Runtime</strong>
                  <span>Model, agent, and session</span>
                </div>
                <RuntimeControls
                  models={runtimeModels}
                  agents={runtimeAgents}
                  selectedModel={selectedModel}
                  selectedAgent={selectedAgent}
                  saving={runtimeSaving || runtimeLoading}
                  error={runtimeError}
                  onModelChange={(value) => {
                    void saveProjectRuntimeSelection({ model: value, agent: selectedAgent });
                  }}
                  onAgentChange={(value) => {
                    void saveProjectRuntimeSelection({ model: selectedModel, agent: value });
                  }}
                />
                <SessionControls
                  sessions={projectSessions}
                  activeSessionId={activeSessionId}
                  loading={sessionLoading}
                  switching={sessionSwitching}
                  switchTargetLabel={sessionSwitchTargetLabel}
                  error={sessionError}
                  onChange={(value) => {
                    void handleSwitchSession(value);
                  }}
                  onCreate={() => {
                    void handleCreateSession();
                  }}
                  onDelete={() => {
                    void handleDeleteSession();
                  }}
                />
              </div>
              <div className="toolbar-card notifications-card">
                <NotificationControls
                  supported={notificationPermission !== "unsupported"}
                  enabled={notificationsEnabled}
                  permission={notificationPermission}
                  onEnable={() => {
                    void handleEnableNotifications();
                  }}
                  onDisable={handleDisableNotifications}
                />
              </div>
              <div className="toolbar-card commands-card">
                <CommandHelpBar
                  commands={availableCommands}
                  onInsert={handleInsertCommand}
                  onOpenPicker={() => setCommandPickerOpen(true)}
                  defaultOpen={false}
                />
              </div>
              <ScheduledTaskPanel
                loading={taskLoading}
                saving={taskSaving}
                running={taskRunning}
                deleting={taskDeleting}
                error={taskError}
                instruction={taskInstructionInput}
                intervalMinutes={taskIntervalInput}
                enabled={taskEnabledInput}
                task={scheduledTask}
                runs={scheduledRuns}
                onInstructionChange={setTaskInstructionInput}
                onIntervalChange={setTaskIntervalInput}
                onEnabledChange={setTaskEnabledInput}
                onSave={handleSaveTask}
                onRunNow={handleRunTaskNow}
                onDelete={handleDeleteTask}
              />
            </div>
          </section>
        ) : null}

        {activeMainView === "chat" ? (
        <form className="composer" onSubmit={handleSendMessage}>
          <button
            type="button"
            className="command-launch-button"
            onClick={() => setCommandPickerOpen(true)}
            disabled={availableCommands.length === 0 || hasActiveRun}
            title="Browse available server commands"
          >
            /
          </button>
          <input
            disabled={
              !activeProject ||
              sending ||
              transcribingAudio ||
              hasBlockingApprovals
            }
            value={composerValue}
            onChange={(event) => setComposerValue(event.target.value)}
            placeholder={
              !activeProject
                ? "Select a project to start"
                : hasBlockingApprovals
                ? "Respond to pending approval before sending new prompts"
                : transcribingAudio
                ? "Transcribing audio..."
                : "Message"
            }
          />
          <div className="composer-actions">
            <button
              type="button"
              className={`mic-button ${recording ? "recording" : ""}`}
              onClick={() => void handleToggleRecording()}
              disabled={!activeProject || hasActiveRun || transcribingAudio || hasBlockingApprovals}
              title={recording ? "Stop recording" : "Start voice input"}
            >
              {transcribingAudio ? "..." : recording ? "Stop" : "Mic"}
            </button>
            {hasActiveRun ? (
              <button
                type="button"
                className="composer-stop-button"
                onClick={() => void handleAbortGeneration()}
                disabled={!activeProject || aborting}
              >
                {aborting ? "Stopping..." : "Stop"}
              </button>
            ) : (
              <button
                disabled={!activeProject || sending || transcribingAudio || hasBlockingApprovals}
                type="submit"
              >
                {sending ? "..." : "Send"}
              </button>
            )}
          </div>
        </form>
        ) : null}

        {projectError ? <div className="toast error">{projectError}</div> : null}
      </main>
    </div>
  );
}
