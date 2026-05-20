import React, { useMemo } from "react";
import type { ProjectSession, RuntimeAgentOption, RuntimeModelOption } from "../../types";
import { formatSessionTimestamp } from "../../utils/formatting";
import { sortSessionsForDisplay } from "../../utils/projectUtils";

export function RuntimeControls({
  models,
  agents,
  sessions,
  activeSessionId,
  selectedModel,
  selectedAgent,
  saving,
  sessionLoading,
  sessionSwitching,
  error,
  onModelChange,
  onAgentChange,
  onSessionChange,
  onSessionCreate,
  onSessionDelete,
}: {
  models: RuntimeModelOption[];
  agents: RuntimeAgentOption[];
  sessions: ProjectSession[];
  activeSessionId: string | null;
  selectedModel: string | null;
  selectedAgent: string | null;
  saving: boolean;
  sessionLoading: boolean;
  sessionSwitching: boolean;
  error: string | null;
  onModelChange: (value: string | null) => void;
  onAgentChange: (value: string | null) => void;
  onSessionChange: (value: string) => void;
  onSessionCreate: () => void;
  onSessionDelete: () => void;
}) {
  const sortedSessions = useMemo(
    () => sortSessionsForDisplay(sessions, activeSessionId),
    [sessions, activeSessionId]
  );
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
      {sortedSessions.length === 0 ? (
        <div className="session-tabs-empty">{sessionLoading ? "Loading sessions..." : "No session selected"}</div>
      ) : (
        <label>
          <span>Session</span>
          <select
            value={activeSessionId ?? ""}
            onChange={(e) => onSessionChange(e.target.value)}
            disabled={sessionLoading || sessionSwitching}
          >
            {sortedSessions.map((session) => (
              <option key={session.id} value={session.id}>
                {session.title || "Untitled session"} — {formatSessionTimestamp(session.updatedAt ?? session.createdAt)}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="session-actions-row">
        <button type="button" className="secondary-button" onClick={onSessionCreate} disabled={sessionLoading || sessionSwitching}>
          {sessionSwitching ? "Working..." : "New session"}
        </button>
        <button
          type="button"
          className="secondary-button session-delete-button"
          onClick={onSessionDelete}
          disabled={sessionLoading || sessionSwitching || !activeSessionId}
        >
          Delete
        </button>
      </div>
      {saving ? <small>Saving runtime...</small> : null}
      {error ? <small className="runtime-error">{error}</small> : null}
    </div>
  );
}
