import { FormEvent, useEffect, useMemo, useState } from "react";

import {
  GitStatusResponse,
  apiGitCommit,
  apiGitInit,
  apiGitPull,
  apiGitPush,
  apiGitRemote,
  apiGitStatus,
} from "./api";

interface GitViewProps {
  projectId: string;
}

type ChangeGroup = {
  key: "staged" | "changed" | "untracked";
  title: string;
  description: string;
  files: string[];
};

function formatSyncLabel(status: GitStatusResponse): string {
  if (!status.upstream) {
    return status.remotes.length > 0 ? "Remote configured" : "No upstream";
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

export default function GitView({ projectId }: GitViewProps) {
  const [status, setStatus] = useState<GitStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [operation, setOperation] = useState<string | null>(null);
  const [commitMessage, setCommitMessage] = useState("");
  const [remoteUrl, setRemoteUrl] = useState("");

  const loadStatus = async (background = false) => {
    if (background) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    setError(null);

    try {
      const data = await apiGitStatus(projectId);
      setStatus(data);

      const primaryRemote = data.remoteDetails.find((remote) => remote.name === "origin") ?? data.remoteDetails[0];
      setRemoteUrl((currentRemoteUrl) => {
        if (!primaryRemote) {
          return "";
        }
        return primaryRemote.url ?? currentRemoteUrl;
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load git status";
      setError(message);
      setStatus(null);
    } finally {
      if (background) {
        setRefreshing(false);
      } else {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    if (projectId) {
      void loadStatus();
    }
  }, [projectId]);

  const runOperation = async (name: string, action: () => Promise<unknown>, successMessage: string) => {
    setOperation(name);
    setError(null);
    setNotice(null);

    try {
      await action();
      await loadStatus(true);
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
              title: "Ready to commit",
              description: "These files are already staged and will be included in the next commit.",
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
              description: "New files not yet committed.",
              files: status.untracked,
            },
          ]
        : [],
    [status]
  );

  const hasRemote = (status?.remoteDetails.length ?? 0) > 0;
  const canSync = Boolean(status?.hasCommits && hasRemote);
  const canCommit = Boolean(commitMessage.trim()) && Boolean(status && !status.isClean);
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

  const handleInit = async () => {
    await runOperation("init", () => apiGitInit(projectId), "Repository initialized.");
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
        await apiGitCommit(projectId, message);
        setCommitMessage("");
      },
      "Changes committed."
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

  const handleRefresh = async () => {
    setNotice(null);
    await loadStatus(true);
  };

  if (loading) {
    return (
      <div className="git-view-shell">
        <div className="toolbar-card git-card">
          <div className="toolbar-card-head">
            <strong>Git</strong>
            <span>Loading repository status…</span>
          </div>
        </div>
      </div>
    );
  }

  if (status?.notGit || error?.toLowerCase().includes("not a git repository") || error?.toLowerCase().includes("notgit")) {
    return (
      <div className="git-view-shell">
        <div className="toolbar-card git-card git-empty-card">
          <div className="empty-pill">
            <p>Git is not initialized for this project.</p>
            <small>Create a local repository first, then add a remote when you are ready to sync.</small>
          </div>
          <div className="notification-actions">
            <button
              type="button"
              className="secondary-button"
              onClick={() => void handleInit()}
              disabled={operation === "init"}
            >
              {operation === "init" ? "Initializing..." : "Initialize repository"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!status) {
    return (
      <div className="git-view-shell">
        <div className="toolbar-card git-card">
          <div className="toolbar-card-head">
            <strong>Git</strong>
            <span>Unable to load repository status.</span>
          </div>
          {error ? <div className="error">{error}</div> : null}
          <div className="notification-actions">
            <button type="button" className="secondary-button" onClick={() => void loadStatus()}>
              Retry
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="git-view-shell">
      <section className="toolbar-card git-card">
        <div className="git-header">
          <div className="toolbar-card-head">
            <strong>Git workspace</strong>
            <span>
              {status.hasCommits
                ? `Branch ${status.branch}${status.upstream ? ` · tracking ${status.upstream}` : ""}`
                : "Create the first commit to start tracking history."}
            </span>
          </div>
          <div className="notification-actions">
            <button
              type="button"
              className="secondary-button"
              onClick={() => void handleRefresh()}
              disabled={refreshing || operation !== null}
            >
              {refreshing ? "Refreshing..." : "Refresh"}
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={() => void handlePull()}
              disabled={!canSync || operation !== null}
            >
              {operation === "pull" ? "Pulling..." : "Pull"}
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={() => void handlePush()}
              disabled={!canSync || operation !== null}
            >
              {operation === "push" ? "Pushing..." : "Push"}
            </button>
          </div>
        </div>

        {notice ? <div className="git-feedback git-feedback-success">{notice}</div> : null}
        {error ? <div className="error">{error}</div> : null}

        <div className="git-summary-grid">
          <article className="toolbar-card git-summary-card">
            <div className="toolbar-card-head">
              <strong>Working tree</strong>
              <span>{status.isClean ? "Everything is committed." : "There are local changes to review."}</span>
            </div>
            <span className={`git-status-pill ${status.isClean ? "success" : "warn"}`}>
              {status.isClean ? "Clean" : "Changes pending"}
            </span>
          </article>

          <article className="toolbar-card git-summary-card">
            <div className="toolbar-card-head">
              <strong>Remote</strong>
              <span>{hasRemote ? status.remoteDetails.map((remote) => remote.name).join(", ") : "No remote configured"}</span>
            </div>
            <small className="git-summary-detail">{primaryRemoteDetail}</small>
          </article>

          <article className="toolbar-card git-summary-card">
            <div className="toolbar-card-head">
              <strong>Sync status</strong>
              <span>{status.upstream ?? "No upstream branch"}</span>
            </div>
            <span className={`git-status-pill ${syncTone}`}>{syncLabel}</span>
          </article>

          <article className="toolbar-card git-summary-card">
            <div className="toolbar-card-head">
              <strong>Last commit</strong>
              <span>{status.lastCommit ? status.lastCommit.shortSha : "No commits yet"}</span>
            </div>
            <small className="git-summary-detail">{status.lastCommit?.message ?? "Commit your staged and modified files to start history."}</small>
          </article>
        </div>
      </section>

      <div className="git-content-grid">
        <section className="toolbar-card git-card">
          <div className="toolbar-card-head">
            <strong>Commit all changes</strong>
            <span>The commit action stages tracked, untracked, and deleted files before saving.</span>
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
            <div className="notification-actions">
              <button type="submit" className="secondary-button" disabled={!canCommit || operation !== null}>
                {operation === "commit" ? "Committing..." : "Commit"}
              </button>
            </div>
          </form>
        </section>

        <section className="toolbar-card git-card">
          <div className="toolbar-card-head">
            <strong>Origin remote</strong>
            <span>Set or update the repository URL used for pull and push.</span>
          </div>
          <form className="git-form" onSubmit={handleSetRemote}>
            <label>
              Remote URL
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
                {operation === "remote" ? "Saving..." : hasRemote ? "Update origin" : "Set origin"}
              </button>
            </div>
          </form>
        </section>
      </div>

      <section className="toolbar-card git-card">
        <div className="toolbar-card-head">
          <strong>File changes</strong>
          <span>Review what will be included in the next commit.</span>
        </div>

        {status.isClean ? (
          <div className="empty-pill git-empty-pill">
            <p>Working tree is clean.</p>
            <small>Pull for remote updates or make local edits to see them here.</small>
          </div>
        ) : (
          <div className="git-change-grid">
            {changeGroups
              .filter((group) => group.files.length > 0)
              .map((group) => (
                <article className="toolbar-card git-change-card" key={group.key}>
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
    </div>
  );
}
