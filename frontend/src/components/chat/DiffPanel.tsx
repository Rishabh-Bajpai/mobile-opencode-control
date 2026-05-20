import React from "react";
import type { SessionDiffEntry } from "../../types";

export function DiffPanel({ diff }: { diff: SessionDiffEntry[] }) {
  if (diff.length === 0) {
    return null;
  }

  return (
    <details className="diff-panel">
      <summary>Session file changes ({diff.length})</summary>
      <pre>{JSON.stringify(diff, null, 2)}</pre>
    </details>
  );
}
