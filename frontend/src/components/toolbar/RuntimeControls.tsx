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
      <div className="session-section">
        <span className="session-section-label">Sessions</span>
        {sortedSessions.length === 0 ? (
          <div className="session-tabs-empty">{sessionLoading ? "Loading..." : "No session"}</div>
        ) : (
          <div className="session-tabs" role="tablist">
            {sortedSessions.map((session) => {
              const isActive = session.id === activeSessionId;
              const label = session.title || "Untitled";
              const truncated = label.length > 24 ? label.slice(0, 24) + "…" : label;
              const ts = formatSessionTimestamp(session.updatedAt ?? session.createdAt);
              return (
                <button
                  key={session.id}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  className={`session-tab ${isActive ? "active" : ""}`}
                  onClick={() => onSessionChange(session.id)}
                  disabled={sessionLoading || sessionSwitching}
                  title={`${label} — ${ts}`}
                >
                  <span className="session-tab-label">{truncated}</span>
                  <span className="session-tab-time">{ts}</span>
                </button>
              );
            })}
            <button
              type="button"
              className="session-tab session-tab-new"
              onClick={onSessionCreate}
              disabled={sessionLoading || sessionSwitching}
              title="New session"
              aria-label="New session"
            >
              +
            </button>
          </div>
        )}
        <div className="session-actions-row">
          <button
            type="button"
            className="secondary-button session-delete-button"
            onClick={onSessionDelete}
            disabled={sessionLoading || sessionSwitching || !activeSessionId}
          >
            Delete
          </button>
        </div>
      </div>
      {saving ? <small>Saving runtime...</small> : null}
      {error ? <small className="runtime-error">{error}</small> : null}
    </div>
  );
}
