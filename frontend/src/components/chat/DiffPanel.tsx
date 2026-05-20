import React, { useState } from "react";
import type { SessionDiffEntry, GitDiffEntry } from "../../types";

function DiffLine({ line }: { line: string }) {
  const cls = line.startsWith("+")
    ? "diff-line-add"
    : line.startsWith("-")
      ? "diff-line-del"
      : line.startsWith("@@")
        ? "diff-line-hunk"
        : "";
  return (
    <div className={`diff-line ${cls}`}>
      <span className="diff-line-no" />
      <span className="diff-line-content">{line}</span>
    </div>
  );
}

function renderPatch(patch: string) {
  return (
    <div className="diff-patch">
      {patch.split("\n").map((line, i) => (
        <DiffLine key={i} line={line} />
      ))}
    </div>
  );
}

function displaySessionPath(entry: SessionDiffEntry): string {
  const record = entry as Record<string, unknown>;
  const candidates = ["path", "filePath", "relativePath", "file", "name", "filename"];
  for (const key of candidates) {
    const val = record[key];
    if (typeof val === "string" && val.length > 0) return val;
  }
  const keys = Object.keys(record).filter((k) => typeof record[k] === "string");
  if (keys.length > 0) {
    const val = String(record[keys[0]]);
    return val.length > 80 ? val.slice(0, 80) + "…" : val;
  }
  const summaryParts: string[] = [];
  for (const [key, val] of Object.entries(record)) {
    if (typeof val === "number") {
      summaryParts.push(`${key}: ${val}`);
    }
  }
  return summaryParts.length > 0 ? summaryParts.join(" · ") : "Unknown entry";
}

export function DiffPanel({
  sessionDiff,
  gitDiff,
}: {
  sessionDiff: SessionDiffEntry[];
  gitDiff: GitDiffEntry[];
}) {
  const [tab, setTab] = useState<"session" | "git">("session");
  const sessionCount = sessionDiff.length;
  const gitCount = gitDiff.length;
  if (sessionCount === 0 && gitCount === 0) return null;

  return (
    <details className="diff-panel">
      <summary>File changes (session: {sessionCount} · git: {gitCount})</summary>
      <div className="diff-tabs">
        <button
          type="button"
          className={`diff-tab ${tab === "session" ? "active" : ""}`}
          onClick={() => setTab("session")}
        >
          Session Changes ({sessionCount})
        </button>
        <button
          type="button"
          className={`diff-tab ${tab === "git" ? "active" : ""}`}
          onClick={() => setTab("git")}
        >
          Git Uncommitted ({gitCount})
        </button>
      </div>
      <div className="diff-tab-content">
        {tab === "session" ? (
          sessionCount === 0 ? (
            <p className="diff-empty">No session changes</p>
          ) : (
            <div className="diff-file-list">
              {sessionDiff.map((entry, i) => (
                <div key={i} className="diff-file-entry">
                  <div className="diff-file-header">
                    <span className="diff-file-path">
                      {displaySessionPath(entry)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )
        ) : gitCount === 0 ? (
          <p className="diff-empty">No uncommitted changes</p>
        ) : (
          <div className="diff-file-list">
            {gitDiff.map((entry) => (
              <details key={entry.path} className="diff-file-entry">
                <summary className="diff-file-header">
                  <span className="diff-file-path">{entry.path}</span>
                  <span className={`diff-change-type diff-change-type-${entry.changeType}`}>
                    {entry.changeType}
                  </span>
                </summary>
                {entry.patch ? renderPatch(entry.patch) : <p className="diff-empty">No patch available</p>}
              </details>
            ))}
          </div>
        )}
      </div>
    </details>
  );
}
