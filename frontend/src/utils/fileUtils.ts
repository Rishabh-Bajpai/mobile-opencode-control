import type { ProjectFileEntry } from "../types";
import type { FileTreeNode, FlattenedFileRow } from "../types/internal";

export function detectLanguageFromPath(path: string) {
  const extension = path.toLowerCase().split(".").pop() || "";
  switch (extension) {
    case "ts":
    case "tsx":
      return "TypeScript";
    case "js":
    case "jsx":
      return "JavaScript";
    case "py":
      return "Python";
    case "json":
      return "JSON";
    case "md":
      return "Markdown";
    case "css":
      return "CSS";
    case "html":
      return "HTML";
    case "yml":
    case "yaml":
      return "YAML";
    case "sh":
      return "Shell";
    default:
      return "Text";
  }
}

export function compactPathLabel(value: string) {
  const normalized = value.replace(/\\/g, "/").trim();
  if (!normalized) {
    return "";
  }
  const segments = normalized.split("/").filter(Boolean);
  return segments[segments.length - 1] ?? normalized;
}

export function buildFileTree(entries: ProjectFileEntry[]): FileTreeNode[] {
  const sorted = [...entries].sort((left, right) => {
    const leftParent = left.path.includes("/") ? left.path.slice(0, left.path.lastIndexOf("/")) : "";
    const rightParent = right.path.includes("/") ? right.path.slice(0, right.path.lastIndexOf("/")) : "";

    if (leftParent === rightParent) {
      if (left.isDir !== right.isDir) {
        return left.isDir ? -1 : 1;
      }

      return left.name.localeCompare(right.name, undefined, {
        numeric: true,
        sensitivity: "base",
      });
    }

    return left.path.localeCompare(right.path, undefined, {
      numeric: true,
      sensitivity: "base",
    });
  });

  const roots: FileTreeNode[] = [];
  const nodeByPath = new Map<string, FileTreeNode>();

  for (const entry of sorted) {
    const node: FileTreeNode = { entry, children: [] };
    nodeByPath.set(entry.path, node);
    const parentPath = entry.path.includes("/") ? entry.path.slice(0, entry.path.lastIndexOf("/")) : "";
    const parentNode = parentPath ? nodeByPath.get(parentPath) ?? null : null;
    if (parentNode) {
      parentNode.children.push(node);
    } else {
      roots.push(node);
    }
  }

  return roots;
}

export function flattenFileTree(nodes: FileTreeNode[], collapsedDirectories: Set<string>, depth = 0): FlattenedFileRow[] {
  const rows: FlattenedFileRow[] = [];
  for (const node of nodes) {
    rows.push({ entry: node.entry, depth });
    if (node.entry.isDir && !collapsedDirectories.has(node.entry.path)) {
      rows.push(...flattenFileTree(node.children, collapsedDirectories, depth + 1));
    }
  }
  return rows;
}
