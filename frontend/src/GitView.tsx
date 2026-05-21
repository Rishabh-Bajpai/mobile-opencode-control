import { FormEvent, useEffect, useMemo, useState } from "react";

import {
  GitBranchSummary,
  GitBranchesResponse,
  GitCommitEntry,
  GitHistoryResponse,
  GitStatusResponse,
  apiGitBranches,
  apiGitCheckoutBranch,
  apiGitCommitWithOptions,
  apiGitCreateBranch,
  apiGitHistory,
  apiGitInit,
  apiGitPull,
  apiGitPush,
  apiGitRemote,
  apiGitStageAll,
  apiGitStatus,
  apiGitTrackRemoteBranch,
} from "./api";

interface GitViewProps {
  projectId: string;
  mobile?: boolean;
}

type ChangeGroup = {
  key: "staged" | "changed" | "untracked";
  title: string;
  description: string;
  files: string[];
};

type GitSection = "overview" | "changes" | "branches" | "history";

const HISTORY_PAGE_SIZE = 25;

function formatSyncLabel(status: GitStatusResponse): string {
  if (!status.upstream) {
    return status.remotes.length > 0 ? "Not tracking remote" : "No upstream";
  }

  if (status.ahead === 0 && status.behind === 0) {
    return "Up to date";
  }

  const parts: string[] = [];
  if (status.ahead > 0) {
    parts.push(`${status.ahead} ahead`);
  }
  if (status.behind > 0) {
    parts.push(`${status.behind} behind`);
  }
  return parts.join(" · ");
}

function getSyncTone(status: GitStatusResponse): "warn" | "info" | "neutral" {
  if (status.behind > 0) {
    return "warn";
  }
  if (status.ahead > 0) {
    return "info";
  }
  return "neutral";
}

function formatCommitTime(value: string | null): string {
  if (!value) {
    return "Unknown time";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Unknown time";
  }

  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatChangeSummary(entry: GitCommitEntry): string {
  const parts = [`${entry.filesChanged} files`];
  if (entry.insertions > 0) {
    parts.push(`+${entry.insertions}`);
  }
  if (entry.deletions > 0) {
    parts.push(`-${entry.deletions}`);
  }
  return parts.join(" · ");
}

function getOperationLabel(operation: string | null, name: string, idleLabel: string, activeLabel: string) {
  return operation === name ? activeLabel : idleLabel;
}

function GitEmptyState({
  onInit,
  busy,
}: {
  onInit: () => Promise<void>;
  busy: boolean;
}) {
  return (
    <div className="git-view-shell">
      <section className="git-hero-card git-surface-card git-empty-panel">
        <div className="git-hero-copy">
          <p className="git-kicker">Source Control</p>
          <h2>Turn this project into a repository.</h2>
          <p>
            Initialize Git to unlock commit history, branch switching, mobile-safe change review, and remote sync.
          </p>
        </div>
        <div className="git-hero-actions">
          <button
            type="button"
            className="secondary-button git-primary-action"
            onClick={() => {
              void onInit();
            }}
            disabled={busy}
          >
            {busy ? "Initializing..." : "Initialize repository"}
          </button>
        </div>
      </section>
    </div>
  );
}

function GitCommitBadge({ label }: { label: string }) {
  return <span className="git-commit-chip">{label}</span>;
}

function GitSectionTabs({
  value,
  onChange,
}: {
  value: GitSection;
  onChange: (next: GitSection) => void;
}) {
  const tabs: Array<{ key: GitSection; label: string }> = [
    { key: "overview", label: "Overview" },
    { key: "changes", label: "Changes" },
    { key: "branches", label: "Branches" },
    { key: "history", label: "History" },
  ];

  return (
    <div className="git-section-tabs" role="tablist" aria-label="Git sections">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          type="button"
          role="tab"
          aria-selected={value === tab.key}
          className={value === tab.key ? "active" : ""}
          onClick={() => onChange(tab.key)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

function GitCommitRow({ entry }: { entry: GitCommitEntry }) {
  return (
    <article className="git-history-item">
      <div className="git-history-item-top">
        <div>
          <strong>{entry.message}</strong>
          <small>
            {entry.authorName} · {formatCommitTime(entry.authoredAt)}
          </small>
        </div>
        <div className="git-history-item-meta">
          <GitCommitBadge label={entry.shortSha} />
          {entry.parents > 1 ? <GitCommitBadge label="merge" /> : null}
        </div>
      </div>
      <div className="git-history-item-bottom">
        <span>{formatChangeSummary(entry)}</span>
        {entry.refs.length > 0 ? (
          <div className="git-history-ref-list">
            {entry.refs.slice(0, 4).map((ref) => (
              <GitCommitBadge key={ref} label={ref} />
            ))}
          </div>
        ) : null}
      </div>
    </article>
  );
}

function GitBranchRow({
  branch,
  action,
  actionLabel,
  actionBusy,
  actionDisabled,
}: {
  branch: GitBranchSummary;
  action: () => void;
  actionLabel: string;
  actionBusy: boolean;
  actionDisabled?: boolean;
}) {
  return (
    <article className="git-branch-item">
      <div className="git-branch-item-top">
        <div>
          <strong>{branch.name}</strong>
          <small>
            {branch.upstream
              ? `Tracking ${branch.upstream}`
              : branch.trackedBy
              ? `Tracked by ${branch.trackedBy}`
              : "No upstream configured"}
          </small>
        </div>
        <div className="git-branch-item-badges">
          {branch.isCurrent ? <GitCommitBadge label="current" /> : null}
          {branch.remoteName ? <GitCommitBadge label={branch.remoteName} /> : null}
        </div>
      </div>
      <div className="git-branch-item-bottom">
        <span>
          {branch.lastCommit ? `${branch.lastCommit.shortSha} · ${branch.lastCommit.message}` : "No commits yet"}
        </span>
        <button
          type="button"
          className="secondary-button git-inline-action"
          onClick={action}
          disabled={actionDisabled || actionBusy}
        >
          {actionBusy ? "Working..." : actionLabel}
        </button>
      </div>
    </article>
  );
}

export default function GitView({ projectId, mobile = false }: GitViewProps) {
  const [status, setStatus] = useState<GitStatusResponse | null>(null);
  const [branches, setBranches] = useState<GitBranchesResponse | null>(null);
  const [history, setHistory] = useState<GitCommitEntry[]>([]);
  const [historyHasMore, setHistoryHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [operation, setOperation] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<GitSection>("overview");
  const [commitMessage, setCommitMessage] = useState("");
  const [remoteUrl, setRemoteUrl] = useState("");
  const [newBranchName, setNewBranchName] = useState("");
  const [trackLocalName, setTrackLocalName] = useState("");

  const loadHistory = async (skip = 0, append = false) => {
    setHistoryLoading(true);
    try {
      const data: GitHistoryResponse = await apiGitHistory(projectId, {
        limit: HISTORY_PAGE_SIZE,
        skip,
      });
      setHistory((current) => (append ? [...current, ...data.commits] : data.commits));
      setHistoryHasMore(data.hasMore);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load commit history";
      setError(message);
    } finally {
      setHistoryLoading(false);
    }
  };

  const loadGitData = async (background = false) => {
    if (background) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setError(null);

    try {
      const [statusData, branchData] = await Promise.all([apiGitStatus(projectId), apiGitBranches(projectId)]);
      setStatus(statusData);
      setBranches(branchData);

      const primaryRemote = statusData.remoteDetails.find((remote) => remote.name === "origin") ?? statusData.remoteDetails[0];
      setRemoteUrl((currentRemoteUrl) => {
        if (!primaryRemote) {
          return "";
        }
        return primaryRemote.url ?? currentRemoteUrl;
      });

      if (statusData.hasCommits) {
        await loadHistory(0, false);
      } else {
        setHistory([]);
        setHistoryHasMore(false);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load git workspace";
      setError(message);
      setStatus(null);
      setBranches(null);
      setHistory([]);
      setHistoryHasMore(false);
    } finally {
      if (background) {
        setRefreshing(false);
      } else {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    if (!projectId) {
      return;
    }
    void loadGitData();
    setActiveSection("overview");
    setCommitMessage("");
    setNewBranchName("");
    setTrackLocalName("");
    setNotice(null);
  }, [projectId]);

  const runOperation = async (name: string, action: () => Promise<unknown>, successMessage: string) => {
    setOperation(name);
    setError(null);
    setNotice(null);

    try {
      await action();
      await loadGitData(true);
      setNotice(successMessage);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Git action failed";
      setError(message);
    } finally {
      setOperation(null);
    }
  };

  const changeGroups = useMemo<ChangeGroup[]>(
    () =>
      status
        ? [
            {
              key: "staged",
              title: "Staged",
              description: "Ready for the next commit.",
              files: status.staged,
            },
            {
              key: "changed",
              title: "Modified",
              description: "Tracked files changed in the working tree.",
              files: status.changed,
            },
            {
              key: "untracked",
              title: "Untracked",
              description: "Files not yet added to git.",
              files: status.untracked,
            },
          ]
        : [],
    [status]
  );

  const hasRemote = (status?.remoteDetails.length ?? 0) > 0;
  const canSync = Boolean(status?.hasCommits && hasRemote);
  const canCommit = Boolean(commitMessage.trim()) && Boolean(status && status.staged.length > 0);
  const syncLabel = status ? formatSyncLabel(status) : "";
  const syncTone = status ? getSyncTone(status) : "neutral";
  const primaryRemote = status
    ? status.remoteDetails.find((remote) => remote.name === "origin") ?? status.remoteDetails[0]
    : null;
  const primaryRemoteDetail = !status
    ? ""
    : primaryRemote
    ? primaryRemote.url ?? "Remote is configured, but no URL is currently set."
    : "Add an origin URL to enable pull and push.";
  const totalChangeCount = (status?.staged.length ?? 0) + (status?.changed.length ?? 0) + (status?.untracked.length ?? 0);
  const localBranches = branches?.local ?? [];
  const remoteBranches = branches?.remote ?? [];

  const handleInit = async () => {
    await runOperation("init", () => apiGitInit(projectId), "Repository initialized.");
  };

  const handleRefresh = async () => {
    setNotice(null);
    await loadGitData(true);
  };

  const handleStageAll = async () => {
    await runOperation("stage", () => apiGitStageAll(projectId), "All changes are now tracked and staged.");
  };

  const handleCommit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canCommit) {
      return;
    }

    const message = commitMessage.trim();
    await runOperation(
      "commit",
      async () => {
        await apiGitCommitWithOptions(projectId, { message, stageAll: false });
        setCommitMessage("");
      },
      "Commit saved."
    );
  };

  const handlePush = async () => {
    await runOperation("push", () => apiGitPush(projectId, "origin"), "Pushed to origin.");
  };

  const handlePull = async () => {
    await runOperation("pull", () => apiGitPull(projectId, "origin"), "Pulled from origin.");
  };

  const handleSetRemote = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const url = remoteUrl.trim();
    if (!url) {
      return;
    }

    await runOperation("remote", () => apiGitRemote(projectId, "origin", url), "Origin updated.");
  };

  const handleCreateBranch = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = newBranchName.trim();
    if (!name) {
      return;
    }

    await runOperation(
      "create-branch",
      async () => {
        await apiGitCreateBranch(projectId, { name, checkout: true });
        setNewBranchName("");
      },
      `Switched to ${name}.`
    );
  };

  const handleCheckoutLocalBranch = async (name: string) => {
    await runOperation("checkout", () => apiGitCheckoutBranch(projectId, name), `Switched to ${name}.`);
  };

  const handleTrackRemoteBranch = async (branch: GitBranchSummary) => {
    const localName = trackLocalName.trim() || branch.branchName || branch.name.replace(`${branch.remoteName}/`, "");
    await runOperation(
      "track",
      async () => {
        await apiGitTrackRemoteBranch(projectId, {
          remote: branch.remoteName || "origin",
          name: branch.branchName || branch.name,
          localName,
        });
        setTrackLocalName("");
      },
      `Tracking ${branch.name} from ${localName}.`
    );
  };

  const handleLoadMoreHistory = async () => {
    if (historyLoading || !historyHasMore) {
      return;
    }
    await loadHistory(history.length, true);
  };

  if (loading) {
    return (
      <div className="git-view-shell">
        <section className="git-hero-card git-surface-card">
          <div className="toolbar-card-head">
            <strong>Git workspace</strong>
            <span>Loading repository status…</span>
          </div>
        </section>
      </div>
    );
  }

  if (status?.notGit || error?.toLowerCase().includes("not a git repository") || error?.toLowerCase().includes("notgit")) {
    return <GitEmptyState onInit={handleInit} busy={operation === "init"} />;
  }

  if (!status) {
    return (
      <div className="git-view-shell">
        <section className="git-hero-card git-surface-card">
          <div className="toolbar-card-head">
            <strong>Git workspace</strong>
            <span>Unable to load repository status.</span>
          </div>
          {error ? <div className="error">{error}</div> : null}
          <div className="notification-actions">
            <button type="button" className="secondary-button" onClick={() => void loadGitData()}>
              Retry
            </button>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className={`git-view-shell ${mobile ? "mobile" : ""}`}>
      <section className="git-hero-card git-surface-card">
        <div className="git-hero-top">
          <div className="git-hero-copy">
            <p className="git-kicker">Source Control</p>
            <h2>{status.branch || "Git workspace"}</h2>
            <p>
              {status.hasCommits
                ? status.upstream
                  ? `Tracking ${status.upstream} with a dedicated history and branch workspace.`
                  : "Manage changes, branches, and remote sync from one place."
                : "Create your first commit to unlock full history and sync controls."}
            </p>
          </div>
          <div className="git-hero-actions">
            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                void handleRefresh();
              }}
              disabled={refreshing || operation !== null}
            >
              {refreshing ? "Refreshing..." : "Refresh"}
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                void handlePull();
              }}
              disabled={!canSync || operation !== null}
            >
              {getOperationLabel(operation, "pull", "Pull", "Pulling...")}
            </button>
            <button
              type="button"
              className="secondary-button git-primary-action"
              onClick={() => {
                void handlePush();
              }}
              disabled={!canSync || operation !== null}
            >
              {getOperationLabel(operation, "push", "Push", "Pushing...")}
            </button>
          </div>
        </div>

        {notice ? <div className="git-feedback git-feedback-success">{notice}</div> : null}
        {error ? <div className="error">{error}</div> : null}

      </section>

      <GitSectionTabs value={activeSection} onChange={setActiveSection} />

      <section className={`git-panel-grid git-section-${activeSection}`}>
        {activeSection === "overview" && (
          <section className="git-surface-card git-panel-card">
            <div className="git-summary-grid">
              <article className="git-surface-card git-summary-card git-summary-accent">
                <div className="toolbar-card-head">
                  <strong>Working tree</strong>
                  <span>{status.isClean ? "Everything is committed." : `${totalChangeCount} local items need attention.`}</span>
                </div>
                <div className="git-summary-metric-row">
                  <span className={`git-status-pill ${status.isClean ? "success" : "warn"}`}>
                    {status.isClean ? "Clean" : "Changes pending"}
                  </span>
                  <span className="git-summary-value">{totalChangeCount}</span>
                </div>
              </article>

              <article className="git-surface-card git-summary-card">
                <div className="toolbar-card-head">
                  <strong>Remote</strong>
                  <span>{hasRemote ? status.remoteDetails.map((remote) => remote.name).join(", ") : "No remote configured"}</span>
                </div>
                <small className="git-summary-detail">{primaryRemoteDetail}</small>
              </article>

              <article className="git-surface-card git-summary-card">
                <div className="toolbar-card-head">
                  <strong>Sync status</strong>
                  <span>{status.upstream ?? "No upstream branch"}</span>
                </div>
                <div className="git-summary-metric-row">
                  <span className={`git-status-pill ${syncTone}`}>{syncLabel}</span>
                  <div className="git-sync-counts">
                    <span>↑ {status.ahead}</span>
                    <span>↓ {status.behind}</span>
                  </div>
                </div>
              </article>

              <article className="git-surface-card git-summary-card">
                <div className="toolbar-card-head">
                  <strong>Last commit</strong>
                  <span>{status.lastCommit ? status.lastCommit.shortSha : "No commits yet"}</span>
                </div>
                <small className="git-summary-detail">
                  {status.lastCommit?.message ?? "Stage files, write a message, and save your first checkpoint."}
                </small>
              </article>
            </div>
          </section>
        )}
        {(activeSection === "changes") && (
          <section className="git-surface-card git-panel-card">
            <div className="git-panel-head">
              <div>
                <p className="git-panel-kicker">Change Deck</p>
                <h3>Track and review files</h3>
              </div>
              <button
                type="button"
                className="secondary-button"
                onClick={() => {
                  void handleStageAll();
                }}
                disabled={status.isClean || operation !== null}
              >
                {getOperationLabel(operation, "stage", "Track all files", "Tracking...")}
              </button>
            </div>

            {status.isClean ? (
              <div className="empty-pill git-empty-pill">
                <p>Working tree is clean.</p>
                <small>Pull remote updates or make local edits to see them here.</small>
              </div>
            ) : (
              <div className="git-change-grid">
                {changeGroups
                  .filter((group) => group.files.length > 0)
                  .map((group) => (
                    <article className="git-surface-card git-change-card" key={group.key}>
                      <div className="toolbar-card-head">
                        <strong>
                          {group.title} <span className="git-inline-count">({group.files.length})</span>
                        </strong>
                        <span>{group.description}</span>
                      </div>
                      <ul className="git-change-list">
                        {group.files.map((file) => (
                          <li key={`${group.key}:${file}`}>{file}</li>
                        ))}
                      </ul>
                    </article>
                  ))}
              </div>
            )}
          </section>
        )}

        {activeSection === "branches" && (
          <section className="git-surface-card git-panel-card">
            <div className="git-panel-head">
              <div>
                <p className="git-panel-kicker">Branch Deck</p>
                <h3>Switch or create branches</h3>
              </div>
            </div>

            <form className="git-form git-branch-create-form" onSubmit={handleCreateBranch}>
              <label>
                New branch
                <input
                  type="text"
                  value={newBranchName}
                  onChange={(event) => setNewBranchName(event.target.value)}
                  placeholder="feature/mobile-git"
                  disabled={operation !== null}
                />
              </label>
              <button type="submit" className="secondary-button" disabled={!newBranchName.trim() || operation !== null}>
                {getOperationLabel(operation, "create-branch", "Create and switch", "Creating...")}
              </button>
            </form>

            <div className="git-branch-columns">
              <div className="git-branch-column">
                <div className="toolbar-card-head">
                  <strong>Local branches</strong>
                  <span>{localBranches.length} available locally</span>
                </div>
                <div className="git-branch-list">
                  {localBranches.length === 0 ? (
                    <div className="git-empty-inline">No local branches yet.</div>
                  ) : (
                    localBranches.map((branch) => (
                      <GitBranchRow
                        key={branch.name}
                        branch={branch}
                        action={() => {
                          void handleCheckoutLocalBranch(branch.name);
                        }}
                        actionLabel={branch.isCurrent ? "Current" : "Switch"}
                        actionBusy={operation === "checkout"}
                        actionDisabled={branch.isCurrent || operation !== null}
                      />
                    ))
                  )}
                </div>
              </div>

              <div className="git-branch-column">
                <div className="toolbar-card-head">
                  <strong>Remote branches</strong>
                  <span>Track remote work locally</span>
                </div>
                <label className="git-branch-track-label">
                  Local name override
                  <input
                    type="text"
                    value={trackLocalName}
                    onChange={(event) => setTrackLocalName(event.target.value)}
                    placeholder="Leave blank to reuse remote branch name"
                    disabled={operation !== null}
                  />
                </label>
                <div className="git-branch-list">
                  {remoteBranches.length === 0 ? (
                    <div className="git-empty-inline">Fetch or configure a remote to see remote branches.</div>
                  ) : (
                    remoteBranches.map((branch) => (
                      <GitBranchRow
                        key={branch.name}
                        branch={branch}
                        action={() => {
                          void handleTrackRemoteBranch(branch);
                        }}
                        actionLabel={branch.trackedBy ? `Open ${branch.trackedBy}` : "Track branch"}
                        actionBusy={operation === "track"}
                        actionDisabled={operation !== null}
                      />
                    ))
                  )}
                </div>
              </div>
            </div>
          </section>
        )}

        {activeSection === "history" && (
          <section className="git-surface-card git-panel-card">
            <div className="git-panel-head">
              <div>
                <p className="git-panel-kicker">Timeline</p>
                <h3>Full git history</h3>
              </div>
              <span className="git-history-summary">{history.length} commits loaded</span>
            </div>

            {history.length === 0 ? (
              <div className="empty-pill git-empty-pill">
                <p>No commit history yet.</p>
                <small>Make the first commit to populate the project timeline.</small>
              </div>
            ) : (
              <div className="git-history-list">
                {history.map((entry) => (
                  <GitCommitRow key={entry.sha} entry={entry} />
                ))}
              </div>
            )}

            {historyHasMore ? (
              <div className="notification-actions">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => {
                    void handleLoadMoreHistory();
                  }}
                  disabled={historyLoading}
                >
                  {historyLoading ? "Loading..." : "Load more history"}
                </button>
              </div>
            ) : null}
          </section>
        )}

        {activeSection === "changes" && (
          <section className="git-surface-card git-panel-card">
            <div className="git-panel-head">
              <div>
                <p className="git-panel-kicker">Checkpoint</p>
                <h3>Commit staged work</h3>
              </div>
            </div>

            <form className="git-form" onSubmit={handleCommit}>
              <label>
                Commit message
                <textarea
                  value={commitMessage}
                  onChange={(event) => setCommitMessage(event.target.value)}
                  placeholder="Describe what changed"
                  disabled={operation !== null}
                />
              </label>
              <div className="git-commit-hint-row">
                <small>
                  {status.staged.length > 0
                    ? `${status.staged.length} staged file${status.staged.length === 1 ? "" : "s"} ready to commit.`
                    : "Stage files first. The commit action now respects the staged set instead of auto-adding everything."}
                </small>
              </div>
              <div className="notification-actions">
                <button type="submit" className="secondary-button git-primary-action" disabled={!canCommit || operation !== null}>
                  {getOperationLabel(operation, "commit", "Commit staged changes", "Committing...")}
                </button>
              </div>
            </form>
          </section>
        )}

        {activeSection === "branches" && (
          <section className="git-surface-card git-panel-card">
            <div className="git-panel-head">
              <div>
                <p className="git-panel-kicker">Remote</p>
                <h3>Configure origin</h3>
              </div>
            </div>

            <form className="git-form" onSubmit={handleSetRemote}>
              <label>
                Origin URL
                <input
                  type="text"
                  value={remoteUrl}
                  onChange={(event) => setRemoteUrl(event.target.value)}
                  placeholder="https://github.com/owner/repo.git"
                  disabled={operation !== null}
                />
              </label>
              <div className="notification-actions">
                <button type="submit" className="secondary-button" disabled={!remoteUrl.trim() || operation !== null}>
                  {getOperationLabel(operation, "remote", hasRemote ? "Update origin" : "Set origin", "Saving...")}
                </button>
              </div>
            </form>
          </section>
        )}
      </section>
    </div>
  );
}
