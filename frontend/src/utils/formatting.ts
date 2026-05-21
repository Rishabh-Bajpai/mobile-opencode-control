import type { ProjectSession } from "../types";

export function formatTimelineDayLabel(value: string) {
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

export function formatPartTypeLabel(value: string) {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[\s\-_]+/)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

export function formatFileSize(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatShortSessionLabel(sessionId: string | null) {
  if (!sessionId) {
    return "Local project chat";
  }
  return "OpenCode session";
}

export function formatCompactSessionId(sessionId: string | null) {
  if (!sessionId) {
    return "No session";
  }
  if (sessionId.length <= 18) {
    return sessionId;
  }
  return `${sessionId.slice(0, 8)}...${sessionId.slice(-6)}`;
}

export function formatSessionTimestamp(value: string | null) {
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

export function formatSessionOptionLabel(session: ProjectSession, activeSessionId: string | null) {
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

export function buildSessionTabLabel(session: ProjectSession) {
  const title = session.title || "Untitled session";
  const timestamp = formatSessionTimestamp(session.updatedAt ?? session.createdAt);
  return `${title} · ${timestamp}`;
}

export function formatProjectPreview(preview: string | null) {
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

export function formatRelativeTaskTime(value: string | null) {
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

export function formatElapsedShort(ms: number) {
  const safeMs = Math.max(0, ms);
  const totalSeconds = Math.floor(safeMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
