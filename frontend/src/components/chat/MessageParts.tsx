import React from "react";
import { buildPartInstanceKey, summarizeActivityParts } from "../../utils/messageUtils";
import { MessagePartCard } from "./MessagePartCard";

export function MessageParts({
  parts,
  partScope,
  expandedParts,
  onPartToggle,
}: {
  parts: Array<Record<string, unknown>>;
  partScope: string;
  expandedParts: Record<string, boolean>;
  onPartToggle: (partKey: string, nextOpen: boolean) => void;
}) {
  const nonTextParts = parts.filter((part) => part.type !== "text");
  if (nonTextParts.length === 0) {
    return null;
  }

  return (
    <div className="parts-list">
      {nonTextParts.map((part, index) => (
        <MessagePartCard
          key={buildPartInstanceKey(partScope, part, index)}
          part={part}
          open={expandedParts[buildPartInstanceKey(partScope, part, index)] ?? false}
          onToggle={(nextOpen) => onPartToggle(buildPartInstanceKey(partScope, part, index), nextOpen)}
        />
      ))}
    </div>
  );
}

export function CollapsedMessageParts({
  parts,
  groupOpen,
  onGroupToggle,
  partScope,
  expandedParts,
  onPartToggle,
}: {
  parts: Array<Record<string, unknown>>;
  groupOpen: boolean;
  onGroupToggle: (nextOpen: boolean) => void;
  partScope: string;
  expandedParts: Record<string, boolean>;
  onPartToggle: (partKey: string, nextOpen: boolean) => void;
}) {
  const nonTextParts = parts.filter((part) => part.type !== "text");
  if (nonTextParts.length === 0) {
    return null;
  }

  const activitySummary = summarizeActivityParts(nonTextParts);

  return (
    <div className={`message-parts-collapsed ${groupOpen ? "open" : ""}`}>
      <button
        type="button"
        className="message-parts-toggle"
        onClick={() => onGroupToggle(!groupOpen)}
        aria-expanded={groupOpen}
      >
        <span>Activity details</span>
        <small>{activitySummary.actionSummaries.join(" · ") || `${nonTextParts.length} actions`}</small>
      </button>
      {groupOpen ? (
        <MessageParts
          parts={nonTextParts}
          partScope={partScope}
          expandedParts={expandedParts}
          onPartToggle={onPartToggle}
        />
      ) : null}
    </div>
  );
}
