import React from "react";
import type { Project } from "../../types";
import { formatProjectPreview } from "../../utils/formatting";
import { projectInitials } from "../../utils/projectUtils";

export function ProjectItem({
  project,
  active,
  highlighted,
  onSelect,
}: {
  project: Project;
  active: boolean;
  highlighted: boolean;
  onSelect: (projectId: string) => void;
}) {
  const time = new Date(project.lastActivityAt).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  const preview = formatProjectPreview(project.lastMessagePreview);

  return (
    <button
      className={`project-item ${active ? "active" : ""} ${highlighted ? "highlighted" : ""}`}
      onClick={() => onSelect(project.id)}
      type="button"
      title={project.path}
    >
      <div className="project-avatar" aria-hidden="true">
        {projectInitials(project.name)}
      </div>
      <div className="project-main">
        <div className="project-row">
          <strong>{project.name}</strong>
          <span>{time}</span>
        </div>
        <div className="project-row secondary">
          <small>{preview}</small>
          <small>{project.sessionStatus}</small>
        </div>
      </div>
    </button>
  );
}
