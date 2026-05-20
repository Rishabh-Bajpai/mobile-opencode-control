import React from "react";
import { extractReasoningPlainText, getPartActivityLabel, summarizePart } from "../../utils/messageUtils";
import type { ToolPart, PatchPart, FilePart } from "../../types";

function renderTodoItem(todo: Record<string, unknown>) {
  const content = typeof todo.content === "string" ? todo.content : "Untitled";
  const status = typeof todo.status === "string" ? todo.status : "pending";
  const priority = typeof todo.priority === "string" ? todo.priority : "medium";
  const statusCls = `todo-status todo-status-${status}`;
  const priorityCls = `todo-priority todo-priority-${priority}`;
  return (
    <div className="todo-item">
      <span className={statusCls}>{status === "completed" ? "✓" : status === "in_progress" ? "⟳" : "○"}</span>
      <span className="todo-content">{content}</span>
      <span className={priorityCls}>{priority}</span>
    </div>
  );
}

function ToolCallCard({ part }: { part: ToolPart }) {
  const { tool, state } = part;
  const statusIcon = state.status === "completed" ? "✓" : state.status === "running" ? "⟳" : "✗";
  const statusCls = `tool-status tool-status-${state.status}`;
  const input = state.input ?? {};
  const inputKeys = Object.keys(input);

  let inputSummary: React.ReactNode = null;
  if (tool === "Bash" && typeof input.command === "string") {
    inputSummary = <code className="tool-input-cmd">{input.command}</code>;
  } else if (tool === "Read" && typeof input.file_path === "string") {
    inputSummary = <code className="tool-input-path">{input.file_path}</code>;
  } else if (tool === "Write" && typeof input.file_path === "string") {
    inputSummary = <code className="tool-input-path">{input.file_path}</code>;
  } else if (tool === "Edit" && typeof input.file_path === "string") {
    inputSummary = <code className="tool-input-path">{input.file_path}</code>;
  } else if (tool === "Grep" && typeof input.pattern === "string") {
    inputSummary = <code className="tool-input-pattern">/{input.pattern}/</code>;
  } else if (tool === "Glob" && typeof input.pattern === "string") {
    inputSummary = <code className="tool-input-pattern">{input.pattern}</code>;
  } else if (tool === "Task" && typeof input.description === "string") {
    inputSummary = <span>{input.description}</span>;
  } else if (tool === "WebFetch" && typeof input.url === "string") {
    inputSummary = <code className="tool-input-url">{input.url}</code>;
  } else if (tool === "todowrite" && Array.isArray(input.todos)) {
    inputSummary = (
      <div className="todo-list">
        {(input.todos as Record<string, unknown>[]).map((todo, i) => (
          <div key={i}>{renderTodoItem(todo)}</div>
        ))}
      </div>
    );
  } else if (inputKeys.length > 0) {
    inputSummary = (
      <div className="tool-input-params">
        {inputKeys.map((k) => (
          <div key={k} className="tool-input-param">
            <span className="tool-param-key">{k}:</span>{" "}
            <span className="tool-param-val">{formatValue(input[k]).slice(0, 200)}</span>
          </div>
        ))}
      </div>
    );
  }

  let outputNode: React.ReactNode = null;
  if (state.output) {
    const truncated = state.metadata?.truncated;
    const outputText = typeof state.output === "string"
      ? state.output.length > 5000
        ? state.output.slice(0, 5000) + "\n… (truncated)"
        : state.output
      : JSON.stringify(state.output, null, 2);
    outputNode = (
      <div className="tool-output">
        <div className="tool-output-header">
          Output{truncated ? " (truncated)" : ""}
        </div>
        <pre className="tool-output-content">{outputText}</pre>
      </div>
    );
  }

  const matches = state.metadata?.matches;
  const matchInfo = typeof matches === "number" && matches > 0 ? `${matches} match${matches === 1 ? "" : "es"}` : null;

  return (
    <div className="tool-call-card">
      <div className="tool-call-header">
        <span className={statusCls}>{statusIcon}</span>
        <span className="tool-name">{tool}</span>
        {matchInfo && <small className="tool-match-count">{matchInfo}</small>}
      </div>
      {inputSummary && <div className="tool-call-input">{inputSummary}</div>}
      {outputNode}
    </div>
  );
}

function formatValue(val: unknown): string {
  if (val === null || val === undefined) return "";
  if (typeof val === "string") return val;
  if (typeof val === "number" || typeof val === "boolean") return String(val);
  if (Array.isArray(val)) return val.map((v) => formatValue(v)).join(", ");
  if (typeof val === "object") return JSON.stringify(val).slice(0, 200);
  return String(val);
}

function PatchCard({ part }: { part: PatchPart }) {
  return (
    <div className="patch-card">
      <div className="patch-card-header">
        <span className="patch-label">Patch</span>
        <code className="patch-hash">{part.hash.slice(0, 8)}</code>
      </div>
      <ul className="patch-file-list">
        {part.files.map((f) => (
          <li key={f} className="patch-file-item">{f}</li>
        ))}
      </ul>
    </div>
  );
}

function FileCard({ part }: { part: FilePart }) {
  return (
    <div className="file-card">
      <div className="file-card-header">
        <span className="file-label">File</span>
        <code className="file-name">{part.filename}</code>
        <small className="file-mime">{part.mime}</small>
      </div>
      {part.url ? (
        <a className="file-link" href={part.url} target="_blank" rel="noopener noreferrer">Open</a>
      ) : null}
    </div>
  );
}

function StepCard({ part }: { part: Record<string, unknown> }) {
  const partType = typeof part.type === "string" ? part.type : "step";
  const snapshot = typeof part.snapshot === "string" ? part.snapshot : null;
  const reason = typeof part.reason === "string" ? part.reason : null;
  const tokens = part.tokens as Record<string, unknown> | undefined;
  const cost = typeof part.cost === "number" ? part.cost : null;

  return (
    <div className="step-card">
      {partType === "step-start" && snapshot && (
        <div className="step-info">
          <span className="step-label">Snapshot:</span>
          <code className="step-value">{snapshot}</code>
        </div>
      )}
      {partType === "step-finish" && (
        <>
          {reason && (
            <div className="step-info">
              <span className="step-label">Reason:</span>
              <code className="step-value">{reason}</code>
            </div>
          )}
          {cost !== null && (
            <div className="step-info">
              <span className="step-label">Cost:</span>
              <code className="step-value">${cost.toFixed(4)}</code>
            </div>
          )}
          {tokens && Object.keys(tokens).length > 0 && (
            <div className="step-info">
              <span className="step-label">Tokens:</span>
              <div className="step-token-grid">
                {Object.entries(tokens).map(([key, val]) => (
                  <div key={key} className="step-token-item">
                    <span className="step-token-key">{key}:</span>
                    <span className="step-token-val">{typeof val === "number" ? val.toLocaleString() : String(val)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
      {partType === "step-start" && !snapshot && (
        <p className="step-placeholder">Step started</p>
      )}
      {partType === "step-finish" && !reason && !cost && !tokens && (
        <p className="step-placeholder">Step finished</p>
      )}
    </div>
  );
}

function FallbackCard({ part, label }: { part: Record<string, unknown>; label: string }) {
  const keys = Object.keys(part).filter((k) => k !== "type" && k !== "id" && k !== "sessionID" && k !== "messageID");
  if (keys.length <= 2) {
    return (
      <div className="step-card">
        {keys.map((k) => (
          <div key={k} className="step-info">
            <span className="step-label">{k}:</span>
            <code className="step-value">{formatValue(part[k])}</code>
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="fallback-card">
      <div className="fallback-card-header">{label}</div>
      <pre className="fallback-card-content">{JSON.stringify(part, null, 2)}</pre>
    </div>
  );
}

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

  let body: React.ReactNode = null;
  if (label === "Thinking") {
    body = reasoningText ? (
      <div className="message-rich-text">
        <p>{reasoningText}</p>
      </div>
    ) : (
      <p>Reasoning in progress</p>
    );
  } else if (partType === "tool") {
    body = <ToolCallCard part={part as unknown as ToolPart} />;
  } else if (partType === "patch") {
    body = <PatchCard part={part as unknown as PatchPart} />;
  } else if (partType === "file") {
    body = <FileCard part={part as unknown as FilePart} />;
  } else if (partType === "step-start" || partType === "step-finish") {
    body = <StepCard part={part} />;
  } else {
    body = <FallbackCard part={part} label={label} />;
  }

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
      {open ? body : null}
    </div>
  );
}
