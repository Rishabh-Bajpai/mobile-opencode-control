import React from "react";
import { extractReasoningPlainText, getPartActivityLabel, summarizePart } from "../../utils/messageUtils";

export function MessagePartCard({
  part,
  open = false,
  onToggle,
}: {
  part: Record<string, unknown>;
  open?: boolean;
  onToggle?: (nextOpen: boolean) => void;
}) {
  const partType = typeof part.type === "string" ? part.type : "part";
  const label = getPartActivityLabel(part);
  const summary = summarizePart(part);
  const reasoningText = label === "Thinking" ? extractReasoningPlainText(part) : "";

  return (
    <div className={`part-block part-${partType} ${open ? "open" : ""}`}>
      <button
        type="button"
        className="part-block-toggle"
        onClick={() => onToggle?.(!open)}
        aria-expanded={open}
      >
        <span>{label}</span>
        {summary ? <small>{summary}</small> : null}
      </button>
      {open ? (
        label === "Thinking" ? (
          reasoningText ? (
            <div className="message-rich-text">
              <p>{reasoningText}</p>
            </div>
          ) : (
            <p>Reasoning in progress</p>
          )
        ) : (
          <pre>{JSON.stringify(part, null, 2)}</pre>
        )
      ) : null}
    </div>
  );
}
