import type { QuestionRequest } from "../types";
import type { ApprovalRequest } from "../types/internal";

export function extractJsonFromEventLines(eventLines: string[]): Record<string, unknown> | null {
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

export function findPermissionId(value: unknown): string | null {
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

export function isPermissionResolved(value: unknown): boolean {
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

export function parseApprovalFromStreamData(data: string): {
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

export function parseQuestionFromStreamData(data: string): {
  request: QuestionRequest | null;
  resolvedQuestionId: string | null;
} {
  try {
    const wrapper = JSON.parse(data) as { event?: string[] };
    const lines = Array.isArray(wrapper.event) ? wrapper.event : [];
    const payload = extractJsonFromEventLines(lines);
    if (!payload) {
      return { request: null, resolvedQuestionId: null };
    }

    const typeValue = String(payload.type || "").toLowerCase();
    const properties =
      payload.properties && typeof payload.properties === "object"
        ? (payload.properties as Record<string, unknown>)
        : payload;

    if (typeValue === "question.asked") {
      const id = typeof properties.id === "string" ? properties.id : null;
      const sessionID =
        typeof properties.sessionID === "string"
          ? properties.sessionID
          : typeof properties.sessionId === "string"
            ? properties.sessionId
            : null;
      const questions = Array.isArray(properties.questions) ? properties.questions : null;
      if (!id || !sessionID || !questions || questions.length === 0) {
        return { request: null, resolvedQuestionId: null };
      }
      return {
        request: {
          id,
          sessionID,
          questions: questions as QuestionRequest["questions"],
          tool: properties.tool && typeof properties.tool === "object" ? (properties.tool as QuestionRequest["tool"]) : undefined,
        },
        resolvedQuestionId: null,
      };
    }

    if (typeValue === "question.replied" || typeValue === "question.rejected") {
      const requestId =
        typeof properties.requestID === "string"
          ? properties.requestID
          : typeof properties.requestId === "string"
            ? properties.requestId
            : typeof properties.id === "string"
              ? properties.id
              : null;
      return { request: null, resolvedQuestionId: requestId };
    }
  } catch {
    // ignore malformed event frames
  }

  return { request: null, resolvedQuestionId: null };
}
