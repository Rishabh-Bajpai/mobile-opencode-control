import React, { useEffect, useRef, useState } from "react";
import type { Project } from "../../types";
import { ProjectItem } from "./ProjectItem";

export function VirtualizedProjectList({
  projects,
  activeProjectId,
  highlightedProjectId,
  onSelect,
  emptyLabel,
  searchQuery,
  totalLabel,
  hasMore,
  isLoadingMore,
  onReachEnd,
  rowHeight = 84,
}: {
  projects: Project[];
  activeProjectId: string | null;
  highlightedProjectId: string | null;
  onSelect: (projectId: string) => void;
  emptyLabel: string;
  searchQuery: string;
  totalLabel: string;
  hasMore: boolean;
  isLoadingMore: boolean;
  onReachEnd: () => void;
  rowHeight?: number;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const overscan = 6;

  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(560);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const updateSize = () => {
      setViewportHeight(container.clientHeight || 560);
    };

    updateSize();

    const observer = new ResizeObserver(() => {
      updateSize();
    });
    observer.observe(container);

    return () => {
      observer.disconnect();
    };
  }, []);

  const totalHeight = projects.length * rowHeight;
  const highlightedIndex = highlightedProjectId
    ? projects.findIndex((project) => project.id === highlightedProjectId)
    : -1;
  const startIndex = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const endIndex = Math.min(
    projects.length,
    Math.ceil((scrollTop + viewportHeight) / rowHeight) + overscan
  );
  const visible = projects.slice(startIndex, endIndex);

  useEffect(() => {
    if (highlightedIndex < 0) {
      return;
    }

    const container = containerRef.current;
    if (!container) {
      return;
    }

    const rowTop = highlightedIndex * rowHeight;
    const rowBottom = rowTop + rowHeight;
    const viewTop = container.scrollTop;
    const viewBottom = viewTop + container.clientHeight;

    if (rowTop < viewTop) {
      container.scrollTop = rowTop;
      return;
    }
    if (rowBottom > viewBottom) {
      container.scrollTop = Math.max(0, rowBottom - container.clientHeight);
    }
  }, [highlightedIndex]);

  return (
    <div
      className="project-list project-list-virtualized"
      ref={containerRef}
      onScroll={(event) => {
        const nextScrollTop = event.currentTarget.scrollTop;
        setScrollTop(nextScrollTop);

        if (!hasMore || isLoadingMore) {
          return;
        }

        const visibleBottom = nextScrollTop + event.currentTarget.clientHeight;
        const threshold = Math.max(220, rowHeight * 3);
        if (visibleBottom >= event.currentTarget.scrollHeight - threshold) {
          onReachEnd();
        }
      }}
    >
      {projects.length === 0 ? (
        <div className="project-list-empty-card">
          <strong>{emptyLabel}</strong>
          <small>
            {isLoadingMore
              ? "Loading chats..."
              : searchQuery
                ? `No chats matched "${searchQuery}".`
                : "Create a project to start a local OpenCode chat."}
          </small>
        </div>
      ) : null}
      <div className="project-virtual-canvas" style={{ height: totalHeight }}>
        {visible.map((project, offset) => {
          const index = startIndex + offset;
          return (
            <div
              className="project-virtual-row"
              key={project.id}
              style={{ transform: `translateY(${index * rowHeight}px)` }}
            >
              <ProjectItem
                project={project}
                active={project.id === activeProjectId}
                highlighted={project.id === highlightedProjectId}
                onSelect={onSelect}
              />
            </div>
          );
        })}
      </div>
      {projects.length > 0 || isLoadingMore ? (
        <div className="project-list-footer">
          <span>{isLoadingMore ? "Loading more chats..." : totalLabel}</span>
          {hasMore && !isLoadingMore ? <small>Scroll for more</small> : null}
        </div>
      ) : null}
    </div>
  );
}
