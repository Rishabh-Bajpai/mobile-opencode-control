import type {
  ChatMessage,
  AppStateResponse,
  OpenCodeCommand,
  Project,
  ProjectSession,
  ProjectRuntimeOptions,
  ProjectSessionsResponse,
  ProjectFileContent,
  ProjectDirectoryListResponse,
  ProjectsResponse,
  ScheduledTaskDetails,
  ScheduledTaskMetrics,
  ScheduledTaskRun,
  ScheduledTask,
  ProjectsSyncResponse,
  SessionDiffEntry,
  TimelineEvent,
} from "./types";


async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    ...init,
  });

  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const body = (await response.json()) as { error?: string };
      if (body.error) {
        message = body.error;
      }
    } catch {
      // Ignore parse error and keep fallback message.
    }
    throw new Error(message);
  }

  return (await response.json()) as T;
}

export async function getAuthState(): Promise<boolean> {
  const data = await request<{ isAuthenticated: boolean }>("/api/auth/me");
  return data.isAuthenticated;
}

export async function login(password: string): Promise<void> {
  await request<{ ok: boolean }>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ password }),
  });
}

export async function logout(): Promise<void> {
  await request<{ ok: boolean }>("/api/auth/logout", { method: "POST" });
}

export async function fetchAppState(): Promise<AppStateResponse> {
  return request<AppStateResponse>("/api/state");
}

export async function fetchLanUrl(): Promise<{ url: string | null; port: number; ip: string | null }> {
  const response = await fetch("/api/lan-url");
  if (!response.ok) {
    throw new Error(`LAN URL fetch failed (${response.status})`);
  }
  return response.json() as Promise<{ url: string | null; port: number; ip: string | null }>;
}

export async function fetchProjects(input?: {
  limit?: number;
  offset?: number;
  query?: string;
}): Promise<ProjectsResponse> {
  const params = new URLSearchParams();
  if (typeof input?.limit === "number") {
    params.set("limit", String(input.limit));
  }
  if (typeof input?.offset === "number") {
    params.set("offset", String(input.offset));
  }
  if (typeof input?.query === "string" && input.query.trim()) {
    params.set("q", input.query.trim());
  }

  const query = params.toString();
  const path = query ? `/api/projects?${query}` : "/api/projects";
  return request<ProjectsResponse>(path);
}

export async function syncProjects(): Promise<ProjectsSyncResponse> {
  return request<ProjectsSyncResponse>("/api/projects/sync", {
    method: "POST",
  });
}

export async function createProject(input: {
  name: string;
  path: string;
}): Promise<Project> {
  const data = await request<{ project: Project }>("/api/projects", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return data.project;
}

export async function selectProject(projectId: string): Promise<void> {
  await request<{ ok: boolean }>(`/api/projects/${projectId}/select`, {
    method: "POST",
  });
}

export async function fetchMessages(projectId: string): Promise<{
  sessionId: string;
  messages: ChatMessage[];
  timelineEvents: TimelineEvent[];
}> {
  return request(`/api/projects/${projectId}/messages`);
}

export async function sendMessage(projectId: string, text: string): Promise<{
  sessionId: string;
  message: ChatMessage;
}> {
  return request(`/api/projects/${projectId}/messages`, {
    method: "POST",
    body: JSON.stringify({ text }),
  });
}

export async function abortSession(projectId: string): Promise<{ ok: boolean; sessionId: string }> {
  return request(`/api/projects/${projectId}/abort`, {
    method: "POST",
  });
}

export async function runCommand(
  projectId: string,
  command: string,
  argumentsList: string[]
): Promise<{
  sessionId: string;
  message: ChatMessage;
}> {
  return request(`/api/projects/${projectId}/commands`, {
    method: "POST",
    body: JSON.stringify({ command, arguments: argumentsList }),
  });
}

export async function fetchDiff(projectId: string): Promise<{
  sessionId: string;
  diff: SessionDiffEntry[];
}> {
  return request(`/api/projects/${projectId}/diff`);
}

export async function fetchPendingApprovals(projectId: string): Promise<{
  approvals: Array<{
    permissionId: string;
    title: string;
    details: string;
    createdAt: string;
  }>;
}> {
  return request(`/api/projects/${projectId}/approvals`);
}

export async function respondPermission(
  projectId: string,
  permissionId: string,
  responseValue: "approve" | "deny",
  remember = false
): Promise<{ ok: boolean; response: string }> {
  return request(`/api/projects/${projectId}/permissions/${permissionId}`, {
    method: "POST",
    body: JSON.stringify({ response: responseValue, remember }),
  });
}

export async function opencodeHealth(): Promise<{
  healthy: boolean;
  upstream?: { healthy?: boolean; version?: string };
  error?: string;
}> {
  return request("/api/opencode/health");
}

export async function fetchOpenCodeCommands(): Promise<{ commands: OpenCodeCommand[] }> {
  return request("/api/opencode/commands");
}

export async function fetchProjectRuntime(projectId: string): Promise<ProjectRuntimeOptions> {
  return request(`/api/projects/${projectId}/runtime`);
}

export async function updateProjectRuntime(
  projectId: string,
  input: { model: string | null; agent: string | null }
): Promise<{ ok: boolean; selectedModel: string | null; selectedAgent: string | null }> {
  return request(`/api/projects/${projectId}/runtime`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export async function fetchProjectSessions(projectId: string): Promise<ProjectSessionsResponse> {
  return request(`/api/projects/${projectId}/sessions`);
}

export async function createProjectSession(projectId: string): Promise<{
  ok: boolean;
  activeSessionId: string;
}> {
  return request(`/api/projects/${projectId}/sessions`, {
    method: "POST",
  });
}

export async function updateProjectSession(
  projectId: string,
  sessionId: string
): Promise<{ ok: boolean; activeSessionId: string }> {
  return request(`/api/projects/${projectId}/session`, {
    method: "PUT",
    body: JSON.stringify({ sessionId }),
  });
}

export async function deleteProjectSession(
  projectId: string,
  sessionId: string
): Promise<{
  ok: boolean;
  deletedSessionId: string;
  activeSessionId: string | null;
  sessions: ProjectSession[];
  projectDeleted?: boolean;
  deletedProjectId?: string | null;
  activeProjectId?: string | null;
}> {
  return request(`/api/projects/${projectId}/sessions/${encodeURIComponent(sessionId)}`, {
    method: "DELETE",
  });
}

export async function fetchProjectDirectoryEntries(
  projectId: string,
  directory: string
): Promise<ProjectDirectoryListResponse> {
  const params = new URLSearchParams();
  if (directory.trim()) {
    params.set("dir", directory.trim());
  }
  const query = params.toString();
  const path = query
    ? `/api/projects/${projectId}/files/list?${query}`
    : `/api/projects/${projectId}/files/list`;
  return request(path);
}

export async function fetchProjectFileContent(projectId: string, path: string): Promise<ProjectFileContent> {
  const params = new URLSearchParams({ path });
  return request(`/api/projects/${projectId}/files/content?${params.toString()}`);
}

export function projectFileDownloadUrl(projectId: string, path: string): string {
  const params = new URLSearchParams({ path });
  return `/api/projects/${projectId}/files/download?${params.toString()}`;
}

export function projectArchiveDownloadUrl(projectId: string): string {
  return `/api/projects/${projectId}/files/archive`;
}

export async function fetchSchedulerStatus(): Promise<{
  scheduler: {
    running: boolean;
    pollIntervalSeconds: number;
    taskRunRetentionDays: number;
    lastLoopAt: string | null;
    lastLoopError: string | null;
    lastPruneAt: string | null;
    lastPrunedCount: number;
  };
}> {
  return request("/api/scheduler/status");
}

export async function transcribeAudio(input: {
  audio: Blob;
  filename?: string;
  model?: string;
  language?: string;
}): Promise<{ text: string; model: string; raw: Record<string, unknown> }> {
  const form = new FormData();
  form.append("audio", input.audio, input.filename ?? "recording.webm");
  if (input.model) {
    form.append("model", input.model);
  }
  if (input.language) {
    form.append("language", input.language);
  }

  const response = await fetch("/api/stt/transcribe", {
    method: "POST",
    credentials: "include",
    body: form,
  });

  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const body = (await response.json()) as { error?: string };
      if (body.error) {
        message = body.error;
      }
    } catch {
      // Ignore parse failures.
    }
    throw new Error(message);
  }

  return (await response.json()) as { text: string; model: string; raw: Record<string, unknown> };
}

export async function speakText(input: {
  text: string;
  model?: string;
  voice?: string;
  format?: string;
}): Promise<Blob> {
  const response = await fetch("/api/tts/speak", {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const body = (await response.json()) as { error?: string };
      if (body.error) {
        message = body.error;
      }
    } catch {
      // Ignore parse failures.
    }
    throw new Error(message);
  }

  return await response.blob();
}

export async function fetchScheduledTask(projectId: string): Promise<ScheduledTaskDetails> {
  return request(`/api/projects/${projectId}/task`);
}

export async function saveScheduledTask(
  projectId: string,
  input: Partial<ScheduledTask> & { instruction: string; intervalMinutes: number; enabled: boolean }
): Promise<{ task: ScheduledTask }> {
  return request(`/api/projects/${projectId}/task`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export async function deleteScheduledTask(
  projectId: string,
  taskId?: string | null
): Promise<{ ok: boolean; deleted: boolean }> {
  const query = taskId ? `?taskId=${encodeURIComponent(taskId)}` : "";
  return request(`/api/projects/${projectId}/task${query}`, {
    method: "DELETE",
  });
}

export async function runScheduledTaskNow(
  projectId: string,
  taskId?: string | null
): Promise<{ task: ScheduledTask; run: ScheduledTaskRun; metrics?: ScheduledTaskMetrics }> {
  return request(`/api/projects/${projectId}/task/run`, {
    method: "POST",
    body: JSON.stringify({ taskId }),
  });
}

export async function fetchScheduledTaskRuns(
  projectId: string,
  limit = 20
): Promise<{ runs: ScheduledTaskRun[] }> {
  return request(`/api/projects/${projectId}/task/runs?limit=${encodeURIComponent(String(limit))}`);
}

export async function fetchScheduledTasks(projectId: string): Promise<{ tasks: ScheduledTask[] }> {
  return request(`/api/projects/${projectId}/tasks`);
}

export async function pauseScheduledTask(projectId: string, taskId: string): Promise<{ task: ScheduledTask }> {
  return request(`/api/projects/${projectId}/tasks/${encodeURIComponent(taskId)}/pause`, { method: "POST" });
}

export async function resumeScheduledTask(projectId: string, taskId: string): Promise<{ task: ScheduledTask }> {
  return request(`/api/projects/${projectId}/tasks/${encodeURIComponent(taskId)}/resume`, { method: "POST" });
}

export async function previewScheduledTask(
  projectId: string,
  input: Partial<ScheduledTask>
): Promise<{ runs: string[] }> {
  return request(`/api/projects/${projectId}/tasks/preview`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}
