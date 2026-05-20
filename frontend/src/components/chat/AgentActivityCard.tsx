import React from "react";
import { MessagePartCard } from "./MessagePartCard";

export function AgentActivityCard({
  partItems,
  stateKey,
  latestLabel,
  latestDetail,
  actionSummaries,
  createdAt,
  open,
  onToggle,
  expandedParts,
  onPartToggle,
}: {
  partItems: Array<{ key: string; part: Record<string, unknown> }>;
  stateKey: string;
  latestLabel: string;
  latestDetail: string;
  actionSummaries: string[];
  createdAt: string;
  open: boolean;
  onToggle: (nextOpen: boolean) => void;
  expandedParts: Record<string, boolean>;
  onPartToggle: (partKey: string, nextOpen: boolean) => void;
}) {
  const timestamp = new Date(createdAt).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  return (
    <div className="message-row other activity-row">
      <div className={`agent-activity-card ${open ? "open" : ""}`} data-activity-key={stateKey}>
        <button
          type="button"
          className="agent-activity-toggle"
          onClick={() => onToggle(!open)}
          aria-expanded={open}
        >
          <div className="agent-activity-summary">
            <strong>Agent activity</strong>
            <small>{partItems.length} actions</small>
          </div>
          <div className="agent-activity-meta">
            <span>{latestLabel}</span>
            <small>{timestamp}</small>
          </div>
        </button>
        {open ? <div className="agent-activity-body">
          {latestDetail ? <div className="agent-activity-detail">Latest: {latestDetail}</div> : null}
          {actionSummaries.length > 0 ? (
            <div className="agent-activity-tags">
              {actionSummaries.map((label) => (
                <span key={label}>{label}</span>
              ))}
            </div>
          ) : null}
          <div className="parts-list compact">
            {partItems.map(({ key, part }) => (
              <MessagePartCard
                key={key}
                part={part}
                open={expandedParts[key] ?? false}
                onToggle={(nextOpen) => onPartToggle(key, nextOpen)}
              />
            ))}
          </div>
        </div> : null}
      </div>
    </div>
  );
}
