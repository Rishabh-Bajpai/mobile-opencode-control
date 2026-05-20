import React, { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent, useEffect, useMemo, useRef, useState } from "react";
import { projectArchiveDownloadUrl, projectFileDownloadUrl } from "../../api";
import type { ProjectFileContent, ProjectFileEntry } from "../../types";
import { buildFileTree, detectLanguageFromPath, flattenFileTree } from "../../utils/fileUtils";
import { formatFileSize } from "../../utils/formatting";

export function ProjectFilesPanel({
  projectId,
  entries,
  truncated,
  loading,
  loadedDirectories,
  loadingDirectories,
  loadError,
  query,
  onQueryChange,
  selectedFilePath,
  onSelectFile,
  onExpandDirectory,
  content,
  contentLoading,
  contentError,
  mobile,
}: {
  projectId: string;
  entries: ProjectFileEntry[];
  truncated: boolean;
  loading: boolean;
  loadedDirectories: string[];
  loadingDirectories: string[];
  loadError: string | null;
  query: string;
  onQueryChange: (value: string) => void;
  selectedFilePath: string | null;
  onSelectFile: (path: string) => void;
  onExpandDirectory: (path: string) => Promise<void>;
  content: ProjectFileContent | null;
  contentLoading: boolean;
  contentError: string | null;
  mobile: boolean;
}) {
  const [collapsedDirectories, setCollapsedDirectories] = useState<Set<string>>(new Set());
  const [listScrollTop, setListScrollTop] = useState(0);
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [treePaneWidth, setTreePaneWidth] = useState(34);
  const [mobileTreePaneHeight, setMobileTreePaneHeight] = useState(38);
  const [downloadingArchive, setDownloadingArchive] = useState(false);
  const [downloadingFilePath, setDownloadingFilePath] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const resizingSplitterRef = useRef(false);

  useEffect(() => {
    setCollapsedDirectories(new Set());
    setListScrollTop(0);
    setFocusedIndex(0);
    setTreePaneWidth(34);
    setMobileTreePaneHeight(38);
  }, [projectId]);

  const normalizedQuery = query.trim().toLowerCase();
  const dedupedEntries = useMemo(() => {
    const seen = new Set<string>();
    const unique: ProjectFileEntry[] = [];
    for (const entry of entries) {
      const key = `${entry.path}:${entry.isDir ? "d" : "f"}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      unique.push(entry);
    }
    return unique;
  }, [entries]);

  const fileTree = useMemo(() => buildFileTree(dedupedEntries), [dedupedEntries]);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      if (!resizingSplitterRef.current || !panelRef.current) {
        return;
      }
      const rect = panelRef.current.getBoundingClientRect();
      if (mobile) {
        const relativeY = event.clientY - rect.top;
        const nextHeightPercent = (relativeY / rect.height) * 100;
        const clamped = Math.min(70, Math.max(22, nextHeightPercent));
        setMobileTreePaneHeight(clamped);
      } else {
        const relativeX = event.clientX - rect.left;
        const nextWidthPercent = (relativeX / rect.width) * 100;
        const clamped = Math.min(70, Math.max(20, nextWidthPercent));
        setTreePaneWidth(clamped);
      }
    };

    const handlePointerUp = () => {
      resizingSplitterRef.current = false;
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [mobile]);

  useEffect(() => {
    if (dedupedEntries.length === 0) {
      setCollapsedDirectories(new Set());
      return;
    }
    setCollapsedDirectories((current) => {
      if (current.size > 0) {
        return current;
      }
      const next = new Set<string>();
      for (const entry of dedupedEntries) {
        if (entry.isDir && !loadedDirectories.includes(entry.path)) {
          next.add(entry.path);
        }
      }
      return next;
    });
  }, [dedupedEntries, loadedDirectories]);

  const visibleEntries = useMemo(() => {
    if (!normalizedQuery) {
      return dedupedEntries;
    }
    return dedupedEntries.filter((entry) => entry.path.toLowerCase().includes(normalizedQuery));
  }, [dedupedEntries, normalizedQuery]);

  const visibleTree = useMemo(() => buildFileTree(visibleEntries), [visibleEntries]);

  const flattenedEntries = useMemo(() => {
    return flattenFileTree(visibleTree, collapsedDirectories);
  }, [visibleTree, collapsedDirectories]);

  const rowHeight = 34;
  const visibleWindow = mobile ? 10 : 18;
  const startIndex = Math.max(0, Math.floor(listScrollTop / rowHeight) - 8);
  const endIndex = Math.min(
    flattenedEntries.length,
    startIndex + visibleWindow + 16
  );
  const virtualRows = flattenedEntries.slice(startIndex, endIndex);
  const totalHeight = flattenedEntries.length * rowHeight;

  const fileEntries = visibleEntries.filter((entry) => !entry.isDir);
  const selectedFileDownloadUrl = selectedFilePath
    ? projectFileDownloadUrl(projectId, selectedFilePath)
    : null;
  const archiveDownloadUrl = projectArchiveDownloadUrl(projectId);
  const textLines = content?.text ? content.text.split("\n") : [];

  useEffect(() => {
    if (flattenedEntries.length === 0) {
      setFocusedIndex(0);
      return;
    }
    if (focusedIndex >= flattenedEntries.length) {
      setFocusedIndex(flattenedEntries.length - 1);
    }
  }, [flattenedEntries.length, focusedIndex]);

  useEffect(() => {
    const list = listRef.current;
    if (!list || flattenedEntries.length === 0) {
      return;
    }
    const rowTop = focusedIndex * rowHeight;
    const rowBottom = rowTop + rowHeight;
    const viewTop = list.scrollTop;
    const viewBottom = viewTop + list.clientHeight;
    if (rowTop < viewTop) {
      list.scrollTop = rowTop;
      return;
    }
    if (rowBottom > viewBottom) {
      list.scrollTop = rowBottom - list.clientHeight;
    }
  }, [focusedIndex, flattenedEntries.length]);

  function findParentDirectoryPath(path: string): string | null {
    const segments = path.split("/");
    if (segments.length < 2) {
      return null;
    }
    return segments.slice(0, -1).join("/");
  }

  function handleTreeKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (flattenedEntries.length === 0) {
      return;
    }

    const focusedEntry = flattenedEntries[focusedIndex] ?? null;
    if (!focusedEntry) {
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setFocusedIndex((current) => Math.min(flattenedEntries.length - 1, current + 1));
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setFocusedIndex((current) => Math.max(0, current - 1));
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      if (focusedEntry.entry.isDir) {
        toggleDirectory(focusedEntry.entry.path);
      } else {
        onSelectFile(focusedEntry.entry.path);
      }
      return;
    }

    if (event.key === "ArrowRight" && focusedEntry.entry.isDir) {
      event.preventDefault();
      if (collapsedDirectories.has(focusedEntry.entry.path)) {
        toggleDirectory(focusedEntry.entry.path);
      } else if (!loadedDirectories.includes(focusedEntry.entry.path)) {
        void onExpandDirectory(focusedEntry.entry.path);
      }
      return;
    }

    if (event.key === "ArrowLeft") {
      event.preventDefault();
      if (focusedEntry.entry.isDir && !collapsedDirectories.has(focusedEntry.entry.path)) {
        toggleDirectory(focusedEntry.entry.path);
        return;
      }
      const parentPath = findParentDirectoryPath(focusedEntry.entry.path);
      if (!parentPath) {
        return;
      }
      const parentIndex = flattenedEntries.findIndex(
        (entry) => entry.entry.isDir && entry.entry.path === parentPath
      );
      if (parentIndex >= 0) {
        setFocusedIndex(parentIndex);
      }
    }
  }

  function toggleDirectory(path: string) {
    const willExpand = collapsedDirectories.has(path);
    setCollapsedDirectories((current) => {
      const next = new Set(current);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
    if (willExpand && !loadedDirectories.includes(path) && !loadingDirectories.includes(path)) {
      void onExpandDirectory(path);
    }
  }

  function handleSplitterPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault();
    resizingSplitterRef.current = true;
  }

  async function downloadFromUrl(url: string, fallbackName: string) {
    const response = await fetch(url, {
      credentials: "include",
    });
    if (!response.ok) {
      let message = `Download failed (${response.status})`;
      try {
        const body = (await response.json()) as { error?: string };
        if (body.error) {
          message = body.error;
        }
      } catch {
        // ignore parse failure
      }
      throw new Error(message);
    }

    const blob = await response.blob();
    const disposition = response.headers.get("content-disposition") || "";
    const match = disposition.match(/filename\*?=(?:UTF-8''|"?)([^";]+)/i);
    const suggestedName = match ? decodeURIComponent(match[1].replace(/"/g, "")) : fallbackName;

    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = suggestedName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => {
      URL.revokeObjectURL(objectUrl);
    }, 1000);
  }

  async function handleDownloadArchive() {
    setDownloadError(null);
    setDownloadingArchive(true);
    try {
      await downloadFromUrl(archiveDownloadUrl, "project-files.zip");
    } catch (error) {
      setDownloadError(error instanceof Error ? error.message : "Failed to download archive");
    } finally {
      setDownloadingArchive(false);
    }
  }

  async function handleDownloadFile() {
    if (!selectedFilePath || !selectedFileDownloadUrl) {
      return;
    }
    setDownloadError(null);
    setDownloadingFilePath(selectedFilePath);
    try {
      const fallbackName = selectedFilePath.split("/").pop() || "file";
      await downloadFromUrl(selectedFileDownloadUrl, fallbackName);
    } catch (error) {
      setDownloadError(error instanceof Error ? error.message : "Failed to download file");
    } finally {
      setDownloadingFilePath((current) => (current === selectedFilePath ? null : current));
    }
  }

  return (
    <div className={`project-files-panel ${mobile ? "mobile" : ""}`}>
      <div className="project-files-toolbar">
        <input
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Filter files by path"
        />
        <button
          type="button"
          className={`ghost-button download-button ${downloadingArchive ? "downloading" : ""}`}
          onClick={() => {
            void handleDownloadArchive();
          }}
          disabled={downloadingArchive}
        >
          {downloadingArchive ? "Downloading zip..." : "Download zip"}
        </button>
      </div>
      {downloadError ? <div className="project-files-error">{downloadError}</div> : null}
      <div
        className="project-files-content"
        ref={panelRef}
        style={
          mobile
            ? {
                gridTemplateColumns: "1fr",
                gridTemplateRows: `minmax(160px, ${mobileTreePaneHeight}%) 8px minmax(220px, ${
                  100 - mobileTreePaneHeight
                }%)`,
              }
            : {
                gridTemplateColumns: `minmax(240px, ${treePaneWidth}%) 8px minmax(320px, ${
                  100 - treePaneWidth
                }%)`,
              }
        }
      >
        <div
          className="project-files-list"
          aria-label="Project files"
          tabIndex={0}
          ref={listRef}
          onScroll={(event) => setListScrollTop(event.currentTarget.scrollTop)}
          onKeyDown={handleTreeKeyDown}
        >
          {loading ? <div className="project-files-muted">Loading files...</div> : null}
          {loadError ? <div className="project-files-error">{loadError}</div> : null}
          {!loading && !loadError && visibleEntries.length === 0 ? (
            <div className="project-files-muted">No files match this filter.</div>
          ) : null}
          {!loading && !loadError ? (
            <div className="project-files-canvas" style={{ height: `${totalHeight}px` }}>
              {virtualRows.map((entry, index) => {
                const absoluteIndex = startIndex + index;
                const isSelected = entry.entry.path === selectedFilePath;
                if (entry.entry.isDir) {
                  const collapsed = collapsedDirectories.has(entry.entry.path);
                  const directoryLoading = loadingDirectories.includes(entry.entry.path);
                  const directoryLoaded = loadedDirectories.includes(entry.entry.path);
                  return (
                    <button
                      type="button"
                      key={`${entry.entry.path}:d:${absoluteIndex}`}
                      className={`project-file-row dir ${absoluteIndex === focusedIndex ? "focused" : ""}`}
                      style={{
                        top: `${absoluteIndex * rowHeight}px`,
                        paddingLeft: `${0.6 + entry.depth * 0.85}rem`,
                      }}
                      onClick={() => {
                        setFocusedIndex(absoluteIndex);
                        toggleDirectory(entry.entry.path);
                      }}
                    >
                      <span>{collapsed ? "▸" : "▾"}</span>
                      <strong>{entry.entry.name}</strong>
                      <small>{directoryLoading ? "loading" : directoryLoaded ? "folder" : "expand"}</small>
                    </button>
                  );
                }

                return (
                  <button
                    type="button"
                    key={`${entry.entry.path}:f:${absoluteIndex}`}
                    className={`project-file-row file ${isSelected ? "active" : ""} ${absoluteIndex === focusedIndex ? "focused" : ""}`}
                    style={{
                      top: `${absoluteIndex * rowHeight}px`,
                      paddingLeft: `${0.6 + entry.depth * 0.85}rem`,
                    }}
                    onClick={() => {
                      setFocusedIndex(absoluteIndex);
                      onSelectFile(entry.entry.path);
                    }}
                  >
                    <span>📄</span>
                    <strong>{entry.entry.name}</strong>
                    <small>{formatFileSize(entry.entry.size)}</small>
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
        <div
          className={`project-files-splitter ${mobile ? "mobile" : ""}`}
          role="separator"
          aria-label="Resize file tree and preview"
          aria-orientation={mobile ? "horizontal" : "vertical"}
          onPointerDown={handleSplitterPointerDown}
        />
        <div className="project-file-preview">
          <div className="project-file-preview-head">
            <strong>{selectedFilePath || "Select a file"}</strong>
            {selectedFileDownloadUrl ? (
              <button
                type="button"
                className={`ghost-button download-button ${
                  downloadingFilePath === selectedFilePath ? "downloading" : ""
                }`}
                onClick={() => {
                  void handleDownloadFile();
                }}
                disabled={downloadingFilePath === selectedFilePath}
              >
                {downloadingFilePath === selectedFilePath ? "Downloading..." : "Download"}
              </button>
            ) : null}
          </div>
          {contentLoading ? <div className="project-files-muted">Loading preview...</div> : null}
          {contentError ? <div className="project-files-error">{contentError}</div> : null}
          {!selectedFilePath && !contentLoading ? (
            <div className="project-files-muted">Choose a file to preview it.</div>
          ) : null}
          {content && !contentLoading && !contentError ? (
            <div className="project-file-preview-body">
              <div className="project-file-meta">
                <span>{detectLanguageFromPath(content.path)}</span>
                <span>{formatFileSize(content.size)}</span>
                {content.modifiedAt ? <span>{new Date(content.modifiedAt).toLocaleString()}</span> : null}
                {content.truncated ? <span>Preview truncated</span> : null}
              </div>
              {content.mimeType.startsWith("image/") ? (
                <img src={selectedFileDownloadUrl || ""} alt={content.path} className="project-file-image-preview" />
              ) : null}
              {content.mimeType === "application/pdf" ? (
                <iframe src={selectedFileDownloadUrl || ""} title={content.path} className="project-file-pdf-preview" />
              ) : null}
              {!content.mimeType.startsWith("image/") && content.mimeType !== "application/pdf" && content.isBinary ? (
                <div className="project-files-muted">Binary file preview is not available. Use Download.</div>
              ) : null}
              {!content.isBinary && !content.mimeType.startsWith("image/") && content.mimeType !== "application/pdf" ? (
                <div className="project-file-code">
                  {textLines.map((line, index) => (
                    <div key={`${content.path}-${index}`} className="project-file-code-line">
                      <span className="project-file-line-number">{index + 1}</span>
                      <code>{line || " "}</code>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
          {!loading && !loadError && fileEntries.length === 0 ? (
            <div className="project-files-muted">No files available in this project yet.</div>
          ) : null}
        </div>
      </div>
      {truncated ? <div className="project-files-muted">File list is truncated for performance.</div> : null}
    </div>
  );
}
