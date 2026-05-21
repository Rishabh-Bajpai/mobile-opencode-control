import React from "react";
import type { OpenCodeCommand } from "../../types";

export function CommandPickerModal({
  open,
  query,
  commands,
  onClose,
  onQueryChange,
  onInsert,
}: {
  open: boolean;
  query: string;
  commands: OpenCodeCommand[];
  onClose: () => void;
  onQueryChange: (value: string) => void;
  onInsert: (commandName: string) => void;
}) {
  if (!open) {
    return null;
  }

  return (
    <div className="command-picker-overlay" role="dialog" aria-modal="true">
      <div className="command-picker-modal">
        <div className="command-picker-header">
          <strong>Server Commands</strong>
          <button type="button" onClick={onClose}>
            Close
          </button>
        </div>
        <input
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Search commands or descriptions"
          autoFocus
        />
        <div className="command-picker-list">
          {commands.length === 0 ? <p>No matching commands.</p> : null}
          {commands.map((command) => (
            <button
              key={command.name}
              type="button"
              className="command-picker-item"
              onClick={() => onInsert(command.name)}
            >
              <div>
                <strong>/{command.name}</strong>
                <p>{command.description || "No description from server."}</p>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
