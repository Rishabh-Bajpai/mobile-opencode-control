import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  const sortedSessions = useMemo(
    () => sortSessionsForDisplay(sessions, activeSessionId),
    [sessions, activeSessionId]
  );

  const activeSession = useMemo(
    () => sessions.find((s) => s.id === activeSessionId) ?? null,
    [sessions, activeSessionId]
  );

  const closeDropdown = useCallback(() => {
    setDropdownOpen(false);
    setFocusedIndex(-1);
  }, []);

  const itemCount = sortedSessions.length + 1; // sessions + "New session"

  useEffect(() => {
    if (!dropdownOpen) return;

    function handleClickOutside(event: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        closeDropdown();
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        closeDropdown();
        return;
      }

      if (event.key === "ArrowDown") {
        event.preventDefault();
        setFocusedIndex((prev) => (prev < itemCount - 1 ? prev + 1 : 0));
        return;
      }

      if (event.key === "ArrowUp") {
        event.preventDefault();
        setFocusedIndex((prev) => (prev > 0 ? prev - 1 : itemCount - 1));
        return;
      }

      if (event.key === "Enter" && focusedIndex >= 0) {
        event.preventDefault();
        if (focusedIndex < sortedSessions.length) {
          handleSelect(sortedSessions[focusedIndex].id);
        } else {
          handleNewSession();
        }
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [dropdownOpen, closeDropdown, focusedIndex, sortedSessions, itemCount]);

  function handleSelect(sessionId: string) {
    onSessionChange(sessionId);
    setDropdownOpen(false);
  }

  function handleNewSession() {
    onSessionCreate();
    setDropdownOpen(false);
  }

  function toggleDropdown() {
    if (!sessionLoading && !sessionSwitching) {
      setDropdownOpen((prev) => !prev);
    }
  }

  const triggerLabel = activeSession
    ? activeSession.title || "Untitled session"
    : "No session";
  const triggerTimestamp = activeSession
    ? formatSessionTimestamp(activeSession.updatedAt ?? activeSession.createdAt)
    : "";

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
        <div className="session-dropdown-wrapper" ref={wrapperRef}>
          <button
            type="button"
            className={`session-dropdown-trigger ${dropdownOpen ? "open" : ""}`}
            onClick={toggleDropdown}
            disabled={sessionLoading || sessionSwitching}
            aria-expanded={dropdownOpen}
          >
            <span className="session-trigger-label">
              {triggerLabel}
            </span>
            {triggerTimestamp && (
              <span className="session-trigger-time">{triggerTimestamp}</span>
            )}
            <span className="session-trigger-chevron">{dropdownOpen ? "▴" : "▾"}</span>
          </button>
          {dropdownOpen && (
            <div className="session-dropdown-panel" role="listbox" aria-label="Sessions">
              {sortedSessions.length === 0 ? (
                <div className="session-dropdown-empty">
                  {sessionLoading ? "Loading..." : "No session"}
                </div>
              ) : (
                <>
                  {sortedSessions.map((session, index) => {
                    const isActive = session.id === activeSessionId;
                    const label = session.title || "Untitled session";
                    const ts = formatSessionTimestamp(session.updatedAt ?? session.createdAt);
                    const isFocused = focusedIndex === index;
                    return (
                      <button
                        key={session.id}
                        type="button"
                        role="option"
                        aria-selected={isActive}
                        className={`session-dropdown-item ${isActive ? "active" : ""} ${isFocused ? "focused" : ""}`}
                        onClick={() => handleSelect(session.id)}
                      >
                        <span className="session-item-label">{label}</span>
                        <span className="session-item-time">{ts}</span>
                      </button>
                    );
                  })}
                  <div className="session-dropdown-divider" />
                  <button
                    type="button"
                    role="option"
                    className={`session-dropdown-item session-dropdown-new ${focusedIndex === sortedSessions.length ? "focused" : ""}`}
                    onClick={handleNewSession}
                  >
                    <span className="session-item-label">+ New session</span>
                  </button>
                </>
              )}
            </div>
          )}
        </div>
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
