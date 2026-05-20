import type { ChatMessage, ScheduledTaskRun, TimelineEvent } from "../types";
import type { TimelineEntry, RenderedTimelineEntry } from "../types/internal";
import { compactPathLabel } from "./fileUtils";
import { formatPartTypeLabel } from "./formatting";

export { formatPartTypeLabel } from "./formatting";

export function sanitizeActivitySnippet(value: string) {
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

export function extractReasoningPlainText(part: Record<string, unknown>) {
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

export function truncateSummary(value: string, maxLength = 96) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 1).trimEnd()}...`;
}

export function buildPartInstanceKey(scope: string, part: Record<string, unknown>, index: number) {
  const type = typeof part.type === "string" ? part.type : "part";
  return `${scope}:${index}:${type}`;
}

export function buildMessageStableKey(message: ChatMessage) {
  return message.id || `${message.role}:${message.createdAt}`;
}

export function normalizePartToken(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function getPartActivityLabel(part: Record<string, unknown>) {
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

export function extractTextFromUnknown(value: unknown, depth = 0): string {
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

export function getPartActivityCountLabel(label: string, count: number) {
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

export function getPartActivityDetail(part: Record<string, unknown>) {
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

export function getDefaultActivityDetail(label: string) {
  if (label === "Thinking") {
    return "Reasoning in progress";
  }
  if (label === "Working") {
    return "Running next step";
  }
  return "";
}

export function summarizeActivityParts(parts: Array<Record<string, unknown>>) {
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

export function summarizePart(part: Record<string, unknown>) {
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

export function tokenizeInlineCode(line: string) {
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

export function getNonTextParts(message: ChatMessage) {
  return message.parts.filter((part) => part.type !== "text");
}

export function isIntermediateAssistantMessage(message: ChatMessage) {
  return message.role === "assistant" && !message.text.trim() && getNonTextParts(message).length > 0;
}

export function buildGroupedTimelineEntries(entries: TimelineEntry[]): RenderedTimelineEntry[] {
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

export function timelineEventToTaskRun(event: TimelineEvent): ScheduledTaskRun | null {
  if (event.eventType !== "scheduled_task_run") {
    return null;
  }

  const payload = event.payload ?? {};
  const asString = (value: unknown) => (typeof value === "string" ? value : null);
  const asIdString = (value: unknown) => {
    if (typeof value === "string") {
      return value;
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
    return null;
  };
  const asBoolean = (value: unknown) => Boolean(value);
  const asNumber = (value: unknown) => (typeof value === "number" ? value : null);

  const taskRunId = asIdString(payload.taskRunId) ?? asIdString(payload.task_run_id) ?? event.id;
  const status = asString(payload.status) ?? "unknown";
  const trigger = asString(payload.trigger) ?? "schedule";

  return {
    id: taskRunId,
    taskId: asIdString(payload.taskId) ?? "",
    projectId: event.projectId,
    status,
    sessionId: asString(payload.sessionId),
    trigger,
    startedAt: asString(payload.startedAt) ?? event.createdAt,
    finishedAt: asString(payload.finishedAt),
    heartbeatLoaded: asBoolean(payload.heartbeatLoaded),
    runNumber: asNumber(payload.runNumber) ?? 1,
    modelUsed: asString(payload.modelUsed),
    agentUsed: asString(payload.agentUsed),
    timeoutUsed: asNumber(payload.timeoutUsed),
    goalAttempted: asBoolean(payload.goalAttempted),
    goalMet: typeof payload.goalMet === "boolean" ? payload.goalMet : null,
    goalOutput: asString(payload.goalOutput),
    retryAttempt: asNumber(payload.retryAttempt) ?? 0,
    outputPreview: asString(payload.outputPreview),
    error: asString(payload.error),
  };
}
