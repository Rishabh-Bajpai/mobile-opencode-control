import type { ChatMessage, ScheduledTaskRun, TimelineEvent, ProjectFileEntry } from "../types";

export interface ApprovalRequest {
  permissionId: string;
  title: string;
  details: string;
  createdAt: string;
}

export interface QuestionAnswerDraft {
  optionSelections: Record<number, string[]>;
  customValues: Record<number, string>;
}

export interface FileTreeNode {
  entry: ProjectFileEntry;
  children: FileTreeNode[];
}

export interface FlattenedFileRow {
  entry: ProjectFileEntry;
  depth: number;
}

export interface TelemetryMarker {
  id: string;
  event: string;
  category: TelemetryMarkerCategory;
  at: string;
  payload: Record<string, unknown>;
}

export interface SchedulerStatus {
  running: boolean;
  pollIntervalSeconds: number;
  taskRunRetentionDays: number;
  lastLoopAt: string | null;
  lastLoopError: string | null;
  lastPruneAt: string | null;
  lastPrunedCount: number;
}

export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

export type DevFixtureMode =
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

export type TimelineEntry =
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

export type RenderedTimelineEntry =
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

export type TelemetryMarkerCategory = "search" | "project" | "chat" | "stream" | "system";

export type TelemetryTimeWindow = "1m" | "5m" | "15m" | "all";

export const NOTIFICATION_PREFERENCE_KEY = "opencode:final-message-notifications";

export const TELEMETRY_CATEGORIES: TelemetryMarkerCategory[] = [
  "search",
  "project",
  "chat",
  "stream",
  "system",
];

export const TELEMETRY_TIME_WINDOWS: Array<{ value: TelemetryTimeWindow; label: string }> = [
  { value: "1m", label: "Last 1m" },
  { value: "5m", label: "Last 5m" },
  { value: "15m", label: "Last 15m" },
  { value: "all", label: "All" },
];
