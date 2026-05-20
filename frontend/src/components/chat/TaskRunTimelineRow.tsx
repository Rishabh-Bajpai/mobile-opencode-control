import React from "react";
import type { ScheduledTaskRun } from "../../types";
import { formatCompactSessionId, formatRelativeTaskTime } from "../../utils/formatting";
import { taskStatusTone } from "../../utils/taskUtils";

export function TaskRunTimelineRow({ run }: { run: ScheduledTaskRun }) {
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
