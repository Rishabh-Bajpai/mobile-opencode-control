import React, { useMemo } from "react";
import type { RuntimeAgentOption, RuntimeModelOption, ScheduledTask, ScheduledTaskRun } from "../../types";
import { formatRelativeTaskTime } from "../../utils/formatting";
import { taskStatusTone } from "../../utils/taskUtils";

export function ScheduledTaskPanel({
  loading,
  saving,
  running,
  deleting,
  error,
  instruction,
  name,
  description,
  taskType,
  intervalMinutes,
  cronExpression,
  onceRunAt,
  startsAtDate,
  startsAtTime,
  endsAtDate,
  endsAtTime,
  timezone,
  model,
  agent,
  maxRuns,
  runTimeoutMinutes,
  retryCount,
  retryBackoffMinutes,
  heartbeatEnabled,
  goalDefinition,
  autoDisableOnGoalMet,
  notificationUrl,
  enabled,
  task,
  tasks,
  runs,
  previewRuns,
  runtimeModels,
  runtimeAgents,
  globalDefaultModel,
  ralphPanel,
  onNewTask,
  onSelectTask,
  onNameChange,
  onDescriptionChange,
  onTaskTypeChange,
  onInstructionChange,
  onIntervalChange,
  onCronExpressionChange,
  onOnceRunAtChange,
  onStartsAtDateChange,
  onStartsAtTimeChange,
  onEndsAtDateChange,
  onEndsAtTimeChange,
  onTimezoneChange,
  onModelChange,
  onAgentChange,
  onMaxRunsChange,
  onRunTimeoutMinutesChange,
  onRetryCountChange,
  onRetryBackoffMinutesChange,
  onHeartbeatEnabledChange,
  onGoalDefinitionChange,
  onAutoDisableOnGoalMetChange,
  onNotificationUrlChange,
  onEnabledChange,
  onSave,
  onRunNow,
  onDelete,
  onPauseResume,
  onPreview,
}: {
  loading: boolean;
  saving: boolean;
  running: boolean;
  deleting: boolean;
  error: string | null;
  name: string;
  description: string;
  instruction: string;
  taskType: ScheduledTask["taskType"];
  intervalMinutes: number;
  cronExpression: string;
  onceRunAt: string;
  startsAtDate: string;
  startsAtTime: string;
  endsAtDate: string;
  endsAtTime: string;
  timezone: string;
  model: string;
  agent: string;
  maxRuns: string;
  runTimeoutMinutes: string;
  retryCount: string;
  retryBackoffMinutes: string;
  heartbeatEnabled: boolean;
  goalDefinition: string;
  autoDisableOnGoalMet: boolean;
  notificationUrl: string;
  enabled: boolean;
  task: ScheduledTask | null;
  tasks: ScheduledTask[];
  runs: ScheduledTaskRun[];
  previewRuns: string[];
  runtimeModels: RuntimeModelOption[];
  runtimeAgents: RuntimeAgentOption[];
  globalDefaultModel: string | null;
  ralphPanel?: React.ReactNode;
  onNewTask: () => void;
  onSelectTask: (task: ScheduledTask) => void;
  onNameChange: (value: string) => void;
  onDescriptionChange: (value: string) => void;
  onTaskTypeChange: (value: ScheduledTask["taskType"]) => void;
  onInstructionChange: (value: string) => void;
  onIntervalChange: (value: number) => void;
  onCronExpressionChange: (value: string) => void;
  onOnceRunAtChange: (value: string) => void;
  onStartsAtDateChange: (value: string) => void;
  onStartsAtTimeChange: (value: string) => void;
  onEndsAtDateChange: (value: string) => void;
  onEndsAtTimeChange: (value: string) => void;
  onTimezoneChange: (value: string) => void;
  onModelChange: (value: string) => void;
  onAgentChange: (value: string) => void;
  onMaxRunsChange: (value: string) => void;
  onRunTimeoutMinutesChange: (value: string) => void;
  onRetryCountChange: (value: string) => void;
  onRetryBackoffMinutesChange: (value: string) => void;
  onHeartbeatEnabledChange: (value: boolean) => void;
  onGoalDefinitionChange: (value: string) => void;
  onAutoDisableOnGoalMetChange: (value: boolean) => void;
  onNotificationUrlChange: (value: string) => void;
  onEnabledChange: (value: boolean) => void;
  onSave: () => Promise<void>;
  onRunNow: () => Promise<void>;
  onDelete: () => Promise<void>;
  onPauseResume: () => Promise<void>;
  onPreview: () => Promise<void>;
}) {
  const taskTone = task ? taskStatusTone(task.lastStatus) : "idle";
  const visibleRuns = task ? runs.filter((run) => run.taskId === task.id) : runs;
  const defaultModel = useMemo(() => {
    if (globalDefaultModel) {
      const found = runtimeModels.find((m) => m.id === globalDefaultModel);
      if (found) return found;
    }
    return runtimeModels.find((m) => m.isDefault) ?? null;
  }, [runtimeModels, globalDefaultModel]);
  const defaultAgent = useMemo(() => {
    const buildAgent = runtimeAgents.find((a) => a.id === "build");
    if (buildAgent) return buildAgent;
    return runtimeAgents.length > 0 ? runtimeAgents[0] : null;
  }, [runtimeAgents]);

  return (
    <section className="tasks-workspace">
      <div className="tasks-shell">
        <aside className="tasks-browser">
          <div className="tasks-browser-head">
            <div>
              <p className="tasks-kicker">Automation Deck</p>
              <h2>Tasks</h2>
              <small>Review older jobs, reopen them, or draft a fresh one.</small>
            </div>
            <button type="button" className="secondary-button" onClick={onNewTask}>
              New task
            </button>
          </div>

          {ralphPanel ? ralphPanel : null}

          {loading ? <p className="task-muted">Loading tasks...</p> : null}
          {error ? <p className="error">{error}</p> : null}

          <div className="tasks-browser-list">
            {tasks.length === 0 ? (
              <div className="tasks-browser-empty">
                <strong>No saved tasks yet</strong>
                <p>Start with a new task and it will appear here for later edits.</p>
              </div>
            ) : (
              tasks.map((item) => {
                const itemRuns = runs.filter((run) => run.taskId === item.id);
                const latestRun = itemRuns[0] ?? null;
                const tone = taskStatusTone(item.lastStatus);

                return (
                  <button
                    key={item.id}
                    type="button"
                    className={`task-browser-item ${task?.id === item.id ? "active" : ""}`}
                    onClick={() => onSelectTask(item)}
                  >
                    <div className="task-browser-item-top">
                      <strong>{item.name || `Task ${item.id}`}</strong>
                      <span className={`task-status-badge ${tone}`}>{item.lastStatus}</span>
                    </div>
                    <p>{item.description || item.instruction || "No description"}</p>
                    <div className="task-browser-item-meta">
                      <span>{item.taskType}</span>
                      <span>{item.enabled ? "enabled" : "paused"}</span>
                      <span>{item.nextRunAt ? `next ${formatRelativeTaskTime(item.nextRunAt)}` : "no next run"}</span>
                    </div>
                    {latestRun ? (
                      <small>
                        Latest run {latestRun.startedAt ? new Date(latestRun.startedAt).toLocaleString() : "Unknown time"}
                      </small>
                    ) : (
                      <small>No runs yet</small>
                    )}
                  </button>
                );
              })
            )}
          </div>
        </aside>

        <div className="tasks-editor">
          <div className="tasks-editor-head">
            <div>
              <p className="tasks-kicker">{task ? "Editing task" : "Drafting task"}</p>
              <h3>{task ? task.name || `Task ${task.id}` : "New scheduled task"}</h3>
              <small>Tasks run in dedicated task sessions. Previous tasks stay editable here.</small>
            </div>
            {task ? (
              <div className="task-overview">
                <span className={`task-status-badge ${taskTone}`}>{task.enabled ? "Enabled" : "Paused"}</span>
                <span className={`task-status-badge ${taskTone}`}>Last {task.lastStatus.toLowerCase()}</span>
                <span className="task-status-badge idle">Next {formatRelativeTaskTime(task.nextRunAt)}</span>
                <span className="task-status-badge idle">Last run {formatRelativeTaskTime(task.lastRunAt)}</span>
              </div>
            ) : null}
          </div>

          <div className="tasks-editor-grid">
            <div className="tasks-editor-card">
              <div className="task-inline-fields">
                <label>
                  <span>Name</span>
                  <input value={name} onChange={(event) => onNameChange(event.target.value)} />
                </label>
                <label>
                  <span>Type</span>
                  <select value={taskType} onChange={(event) => onTaskTypeChange(event.target.value as ScheduledTask["taskType"])}>
                    <option value="interval">Interval</option>
                    <option value="cron">Cron</option>
                    <option value="once">One-time</option>
                    <option value="goal">Goal</option>
                  </select>
                </label>
              </div>

              <label>
                <span>Description</span>
                <input value={description} onChange={(event) => onDescriptionChange(event.target.value)} placeholder="Optional notes" />
              </label>

              <label>
                <span>Instruction</span>
                <textarea
                  value={instruction}
                  onChange={(event) => onInstructionChange(event.target.value)}
                  placeholder="Instruction to run in dedicated task session"
                />
              </label>

              <div className="task-inline-fields">
                {taskType === "interval" || taskType === "goal" ? <label>
                  <span>Interval (minutes)</span>
                  <input
                    type="number"
                    min={5}
                    value={intervalMinutes}
                    onChange={(event) => onIntervalChange(Number(event.target.value) || 5)}
                  />
                </label> : null}
                {taskType === "cron" ? <label>
                  <span>Cron expression</span>
                  <input value={cronExpression} onChange={(event) => onCronExpressionChange(event.target.value)} placeholder="0 9 * * *" />
                </label> : null}
                {taskType === "once" ? <label>
                  <span>Run once at</span>
                  <input type="datetime-local" value={onceRunAt} onChange={(event) => onOnceRunAtChange(event.target.value)} />
                </label> : null}
                <label>
                  <span>Timezone</span>
                  <input value={timezone} onChange={(event) => onTimezoneChange(event.target.value)} placeholder="UTC" />
                </label>
              </div>

              <div className="task-inline-fields">
                <label>
                  <span>Start date</span>
                  <input type="date" value={startsAtDate} onChange={(event) => onStartsAtDateChange(event.target.value)} />
                </label>
                <label>
                  <span>Start time</span>
                  <input type="time" value={startsAtTime} onChange={(event) => onStartsAtTimeChange(event.target.value)} />
                </label>
                <label>
                  <span>End date</span>
                  <input type="date" value={endsAtDate} onChange={(event) => onEndsAtDateChange(event.target.value)} />
                </label>
                <label>
                  <span>End time</span>
                  <input type="time" value={endsAtTime} onChange={(event) => onEndsAtTimeChange(event.target.value)} />
                </label>
              </div>

              <div className="task-inline-fields">
                <label>
                  <span>Model</span>
                  <select value={model} onChange={(event) => onModelChange(event.target.value)}>
                    <option value="">{defaultModel ? `${defaultModel.providerName} / ${defaultModel.name}` : "Server default"}</option>
                    {runtimeModels.map((item) => <option key={item.id} value={item.id}>{item.providerName} / {item.name}</option>)}
                  </select>
                </label>
                <label>
                  <span>Agent</span>
                  <select value={agent} onChange={(event) => onAgentChange(event.target.value)}>
                    <option value="">{defaultAgent ? defaultAgent.id : "Server default"}</option>
                    {runtimeAgents.map((item) => <option key={item.id} value={item.id}>{item.id}</option>)}
                  </select>
                </label>
              </div>

              <div className="task-inline-fields">
                <label>
                  <span>Max runs</span>
                  <input type="number" min={0} value={maxRuns} onChange={(event) => onMaxRunsChange(event.target.value)} placeholder="unlimited" />
                </label>
                <label>
                  <span>Timeout minutes</span>
                  <input type="number" min={1} value={runTimeoutMinutes} onChange={(event) => onRunTimeoutMinutesChange(event.target.value)} placeholder="none" />
                </label>
                <label>
                  <span>Retries</span>
                  <input type="number" min={0} value={retryCount} onChange={(event) => onRetryCountChange(event.target.value)} />
                </label>
                <label>
                  <span>Retry backoff</span>
                  <input type="number" min={1} value={retryBackoffMinutes} onChange={(event) => onRetryBackoffMinutesChange(event.target.value)} placeholder="minutes" />
                </label>
                <div className="task-checkbox-row">
                  <label className="task-enabled">
                    <input
                      type="checkbox"
                      checked={enabled}
                      onChange={(event) => onEnabledChange(event.target.checked)}
                    />
                    <span>Enabled</span>
                  </label>
                  <label className="task-enabled">
                    <input type="checkbox" checked={heartbeatEnabled} onChange={(event) => onHeartbeatEnabledChange(event.target.checked)} />
                    <span>Use heartbeat file</span>
                  </label>
                  {taskType === "goal" ? <label className="task-enabled">
                    <input
                      type="checkbox"
                      checked={autoDisableOnGoalMet}
                      onChange={(event) => onAutoDisableOnGoalMetChange(event.target.checked)}
                    />
                    <span>Pause when goal is met</span>
                  </label> : null}
                </div>
              </div>

              {taskType === "goal" ? <label>
                <span>Goal definition</span>
                <textarea value={goalDefinition} onChange={(event) => onGoalDefinitionChange(event.target.value)} placeholder="Describe the objective. The agent will report GOAL_MET: yes/no." />
              </label> : null}

              <label>
                <span>Notification URL</span>
                <input value={notificationUrl} onChange={(event) => onNotificationUrlChange(event.target.value)} placeholder="Optional ntfy topic URL" />
              </label>

              <div className="task-actions">
                <button type="button" className="secondary-button" onClick={() => void onPreview()}>
                  Preview next runs
                </button>
                <button type="button" disabled={saving} onClick={() => void onSave()}>
                  {saving ? "Saving..." : "Save task"}
                </button>
                <button type="button" disabled={running || !task} onClick={() => void onRunNow()}>
                  {running ? "Running..." : "Run now"}
                </button>
                <button type="button" disabled={saving || !task} onClick={() => void onPauseResume()}>
                  {task?.enabled ? "Pause" : "Resume"}
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

              {previewRuns.length > 0 ? (
                <div className="task-preview-strip">
                  {previewRuns.map((run) => <small key={run} className="task-status-badge idle">{new Date(run).toLocaleString()}</small>)}
                </div>
              ) : null}

              {task ? (
                <div className="task-status-meta">
                  <small>next: {task.nextRunAt ? new Date(task.nextRunAt).toLocaleString() : "-"}</small>
                  <small>last: {task.lastRunAt ? new Date(task.lastRunAt).toLocaleString() : "-"}</small>
                </div>
              ) : null}
            </div>

            <div className="tasks-editor-card tasks-runs-card">
              <div className="tasks-runs-head">
                <div>
                  <strong>Recent runs</strong>
                  <small>Execution history for the selected task only.</small>
                </div>
              </div>
              <div className="task-runs">
                {visibleRuns.length === 0 ? (
                  <p className="task-muted">No runs yet.</p>
                ) : (
                  <ul>
                    {visibleRuns.slice(0, 12).map((run) => (
                      <li key={run.id} className={`task-run-item ${taskStatusTone(run.status)}`}>
                        <div className="task-run-item-main">
                          <strong>#{run.runNumber} {run.trigger === "manual" ? "Manual run" : "Scheduled run"}</strong>
                          <small>{run.startedAt ? new Date(run.startedAt).toLocaleString() : "Unknown time"}</small>
                        </div>
                        <div className="task-run-item-meta">
                          <span className={`task-status-badge ${taskStatusTone(run.status)}`}>{run.status}</span>
                          <span className="task-status-badge idle">{run.heartbeatLoaded ? "heartbeat loaded" : "no heartbeat"}</span>
                          {run.modelUsed ? <span className="task-status-badge idle">{run.modelUsed}</span> : null}
                          {run.agentUsed ? <span className="task-status-badge idle">{run.agentUsed}</span> : null}
                          {run.goalAttempted ? <span className="task-status-badge idle">goal {run.goalMet ? "met" : "open"}</span> : null}
                        </div>
                        {run.outputPreview ? <p>{run.outputPreview}</p> : null}
                        {run.error ? <p className="task-error-inline">{run.error}</p> : null}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
