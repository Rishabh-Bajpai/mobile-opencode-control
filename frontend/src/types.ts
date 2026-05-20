export type SessionStatus = "idle" | "running" | "waiting_approval" | "error";

export type NotificationChannel = "off" | "browser" | "ntfy" | "both";

export interface Project {
  id: string;
  name: string;
  path: string;
  lastSessionId: string | null;
  lastMessagePreview: string | null;
  sessionStatus: SessionStatus;
  hasScheduledTask: boolean;
  createdAt: string;
  updatedAt: string;
  lastActivityAt: string;
}

export interface ProjectsResponse {
  projects: Project[];
  activeProjectId: string | null;
  limit: number;
  offset: number;
  total: number;
  hasMore: boolean;
}

export interface ProjectsSyncResponse {
  projects: Project[];
  activeProjectId: string | null;
  imported: number;
  updated: number;
  skipped: number;
}

export interface AppStateResponse {
  activeProjectId: string | null;
  defaultProjectRoot: string | null;
  defaultModel: string | null;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  createdAt: string;
  text: string;
  parts: Array<Record<string, unknown>>;
  tokens?: {
    input: number;
    output: number;
    reasoning: number;
    cacheRead: number;
    cacheWrite: number;
  };
  mode?: string;
  summary?: boolean;
}

export interface TimelineEvent {
  id: string;
  projectId: string;
  eventType: string;
  createdAt: string;
  payload: Record<string, unknown>;
}

export interface OpenCodeCommand {
  name: string;
  description: string;
}

export interface RuntimeModelOption {
  id: string;
  providerId: string;
  providerName: string;
  modelId: string;
  name: string;
  isDefault: boolean;
  contextLimit: number;
}

export interface RuntimeAgentOption {
  id: string;
  description: string;
}

export interface ProjectRuntimeOptions {
  selectedModel: string | null;
  selectedAgent: string | null;
  models: RuntimeModelOption[];
  agents: RuntimeAgentOption[];
}

export interface ProjectSession {
  id: string;
  title: string;
  slug: string;
  directory: string;
  version: string;
  createdAt: string | null;
  updatedAt: string | null;
  isActive: boolean;
  summary: {
    files: number;
    additions: number;
    deletions: number;
  };
}

export interface ProjectSessionsResponse {
  activeSessionId: string | null;
  sessions: ProjectSession[];
}

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
  tool?: {
    messageID: string;
    callID: string;
  };
}

export interface NotificationSettings {
  channel: NotificationChannel;
  ntfyTopicUrl: string;
}

export interface SessionDiffEntry {
  [key: string]: unknown;
}

export interface GitDiffEntry {
  path: string;
  changeType: "A" | "D" | "M" | "R" | "?";
  patch: string;
}

export interface GitDiffResponse {
  diff: GitDiffEntry[];
}

export interface ToolPart {
  type: "tool";
  tool: string;
  callID: string;
  state: {
    status: "completed" | "running" | "error";
    input?: Record<string, unknown>;
    output?: string;
    metadata?: { truncated?: boolean; matches?: number; [key: string]: unknown };
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

export interface ProjectFileEntry {
  path: string;
  name: string;
  isDir: boolean;
  size: number;
  modifiedAt: string | null;
  depth: number;
}

export interface ProjectFileTreeResponse {
  rootPath: string;
  entries: ProjectFileEntry[];
  truncated: boolean;
}

export interface ProjectDirectoryListResponse {
  rootPath: string;
  directory: string;
  entries: ProjectFileEntry[];
  truncated: boolean;
}

export interface ProjectFileContent {
  path: string;
  size: number;
  modifiedAt: string | null;
  mimeType: string;
  isBinary: boolean;
  encoding: string | null;
  truncated: boolean;
  text: string;
}

export interface ScheduledTask {
  id: string;
  projectId: string;
  name: string;
  description: string | null;
  instruction: string;
  taskType: "interval" | "cron" | "once" | "goal";
  cronExpression: string | null;
  onceRunAt: string | null;
  intervalMinutes: number;
  timezone: string;
  model: string | null;
  agent: string | null;
  enabled: boolean;
  startsAt: string | null;
  endsAt: string | null;
  maxRuns: number | null;
  runTimeoutMinutes: number | null;
  heartbeatEnabled: boolean;
  goalDefinition: string | null;
  autoDisableOnGoalMet: boolean;
  retryCount: number;
  retryBackoffMinutes: number;
  notificationUrl: string | null;
  persistentSessionId: string | null;
  totalRuns: number;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastStatus: string;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ScheduledTaskRun {
  id: string;
  taskId: string;
  projectId: string;
  status: string;
  sessionId: string | null;
  trigger: string;
  startedAt: string | null;
  finishedAt: string | null;
  heartbeatLoaded: boolean;
  runNumber: number;
  modelUsed: string | null;
  agentUsed: string | null;
  timeoutUsed: number | null;
  goalAttempted: boolean;
  goalMet: boolean | null;
  goalOutput: string | null;
  retryAttempt: number;
  outputPreview: string | null;
  error: string | null;
}

export interface ScheduledTaskMetrics {
  totalRuns: number;
  successRate: number | null;
  avgRuntimeSeconds: number | null;
  lastOutcomes: string[];
}

export interface ScheduledTaskDetails {
  task: ScheduledTask | null;
  tasks: ScheduledTask[];
  runs: ScheduledTaskRun[];
  metrics?: ScheduledTaskMetrics;
}

export interface PrdUserStory {
  id: string;
  title: string;
  description: string;
  acceptanceCriteria: string[];
  priority: number;
  passes: boolean;
  notes: string;
}

export interface PrdData {
  project: string;
  branchName: string;
  description: string;
  userStories: PrdUserStory[];
}

export interface PrdResponse {
  prd: PrdData | null;
}
