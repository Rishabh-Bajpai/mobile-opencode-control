import type { Project, ProjectSession } from "../types";

export function getSuggestedProjectRoot(projects: Project[], activeProjectId: string | null) {
  const activeProject = projects.find((project) => project.id === activeProjectId) ?? null;
  const sourcePath = activeProject?.path || projects[0]?.path || "";
  const slashIndex = sourcePath.lastIndexOf("/");
  if (slashIndex <= 0) {
    return sourcePath ? `${sourcePath}/` : "";
  }
  return `${sourcePath.slice(0, slashIndex + 1)}`;
}

export function normalizeProjectRootPath(path: string) {
  const trimmed = path.trim();
  if (!trimmed || trimmed === "/") {
    return trimmed;
  }
  return trimmed.replace(/\/+$/, "");
}

export function buildProjectPathFromRoot(rootPath: string, projectName: string) {
  const normalizedName = projectName.trim();
  const normalizedRoot = normalizeProjectRootPath(rootPath);
  if (!normalizedName) {
    return normalizedRoot;
  }
  if (!normalizedRoot) {
    return normalizedName;
  }
  if (normalizedRoot === "/") {
    return `/${normalizedName}`;
  }
  return `${normalizedRoot}/${normalizedName}`;
}

export function extractRootFromProjectPath(pathValue: string, projectName: string) {
  const normalizedPath = pathValue.trim();
  const normalizedName = projectName.trim();
  if (!normalizedName) {
    return normalizeProjectRootPath(normalizedPath);
  }
  const suffix = `/${normalizedName}`;
  if (normalizedPath.endsWith(suffix)) {
    return normalizeProjectRootPath(normalizedPath.slice(0, normalizedPath.length - suffix.length));
  }
  return normalizeProjectRootPath(normalizedPath);
}

export function projectInitials(name: string): string {
  const tokens = name
    .split(/[^A-Za-z0-9]+/)
    .map((token) => token.trim())
    .filter(Boolean);

  if (tokens.length === 0) {
    return "OC";
  }

  const initials = tokens.slice(0, 2).map((token) => token[0]?.toUpperCase() ?? "");
  return initials.join("") || name.slice(0, 2).toUpperCase();
}

export function sortSessionsForDisplay(sessions: ProjectSession[], activeSessionId: string | null) {
  return [...sessions].sort((left, right) => {
    if (left.id === activeSessionId) {
      return -1;
    }
    if (right.id === activeSessionId) {
      return 1;
    }

    const leftTime = new Date(left.updatedAt ?? left.createdAt ?? 0).getTime();
    const rightTime = new Date(right.updatedAt ?? right.createdAt ?? 0).getTime();
    return rightTime - leftTime;
  });
}
