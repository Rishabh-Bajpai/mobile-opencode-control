import React from "react";
import type { PrdData } from "../../types";

export const RALPH_TASK_INSTRUCTION = `Read prd.json in this project's root directory. If prd.json does not exist, reply with GOAL_MET: yes.

Find the highest priority user story where passes is false (lowest priority number). Implement that single story:
- Plan the approach before writing code
- Make the required changes following existing code patterns
- Run any available quality checks (tests, typecheck, lint)
- Commit all changes with message: feat: [story-id] - [story-title]
- Update prd.json to set passes: true for the completed story

At the end of your response include exactly one of:
GOAL_MET: yes   (if all stories now have passes: true)
GOAL_MET: no    (if there are still stories with passes: false)`;

export const RALPH_GOAL_DEFINITION = "All user stories in prd.json have passes: true";

export function RalphLoopPanel({
  prdData,
  prdLoading,
  prdError,
  prdInitializing,
  onInitPrd,
  onCreateRalphTask,
}: {
  prdData: PrdData | null;
  prdLoading: boolean;
  prdError: string | null;
  prdInitializing: boolean;
  onInitPrd: () => Promise<void>;
  onCreateRalphTask: () => void;
}) {
  const totalStories = prdData?.userStories?.length ?? 0;
  const passedStories = prdData?.userStories?.filter((s) => s.passes).length ?? 0;
  const allDone = totalStories > 0 && passedStories === totalStories;

  return (
    <div className="ralph-panel">
      <div className="ralph-panel-head">
        <p className="tasks-kicker">Ralph Loop</p>
        <div className="ralph-panel-title-row">
          <strong className="ralph-panel-title">PRD Tracker</strong>
          {prdData ? (
            <span className={`task-status-badge ${allDone ? "success" : "idle"}`}>
              {passedStories}/{totalStories}
            </span>
          ) : null}
        </div>
      </div>

      {prdLoading ? <p className="task-muted">Loading PRD…</p> : null}
      {prdError ? <p className="ralph-panel-error">{prdError}</p> : null}

      {!prdLoading && !prdData ? (
        <div className="ralph-empty">
          <p className="task-muted">No prd.json found in this project.</p>
          <button
            type="button"
            className="secondary-button"
            disabled={prdInitializing}
            onClick={() => void onInitPrd()}
          >
            {prdInitializing ? "Creating…" : "Init PRD"}
          </button>
        </div>
      ) : null}

      {prdData ? (
        <>
          <ul className="ralph-story-list">
            {prdData.userStories.map((story) => (
              <li
                key={story.id}
                className={`ralph-story-item${story.passes ? " done" : ""}`}
              >
                <span className={`task-status-badge ${story.passes ? "success" : "idle"}`}>
                  {story.passes ? "✓" : story.id}
                </span>
                <span className="ralph-story-title" title={story.title}>
                  {story.title}
                </span>
              </li>
            ))}
          </ul>
          {!allDone ? (
            <button
              type="button"
              className="secondary-button"
              onClick={onCreateRalphTask}
            >
              Create Ralph Task
            </button>
          ) : (
            <p className="task-muted ralph-done-note">All stories complete 🎉</p>
          )}
        </>
      ) : null}
    </div>
  );
}
