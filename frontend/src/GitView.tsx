import { useState, useEffect, FormEvent } from "react";
import { GitStatusResponse, apiGitInit, apiGitStatus, apiGitCommit, apiGitPush, apiGitPull, apiGitRemote } from "./api";

interface GitViewProps {
  projectId: string;
}

export default function GitView({ projectId }: GitViewProps) {
  const [status, setStatus] = useState<GitStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [commitMessage, setCommitMessage] = useState("");
  const [remoteUrl, setRemoteUrl] = useState("");

  const loadStatus = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiGitStatus(projectId);
      setStatus(data);
    } catch (err: any) {
      setError(err.message || "Failed to load git status");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (projectId) {
      void loadStatus();
    }
  }, [projectId]);

  const handleInit = async () => {
    try {
      await apiGitInit(projectId);
      await loadStatus();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleCommit = async (e: FormEvent) => {
    e.preventDefault();
    if (!commitMessage.trim()) return;
    try {
      await apiGitCommit(projectId, commitMessage);
      setCommitMessage("");
      await loadStatus();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handlePush = async () => {
    try {
      await apiGitPush(projectId, "origin");
      await loadStatus();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handlePull = async () => {
    try {
      await apiGitPull(projectId, "origin");
      await loadStatus();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleSetRemote = async (e: FormEvent) => {
    e.preventDefault();
    if (!remoteUrl.trim()) return;
    try {
      await apiGitRemote(projectId, "origin", remoteUrl);
      setRemoteUrl("");
      await loadStatus();
    } catch (err: any) {
      setError(err.message);
    }
  };

  if (loading) {
    return <div className="git-view p-4">Loading git status...</div>;
  }

  if (status?.notGit || error?.includes("not a git repository") || error?.toLowerCase().includes("notgit")) {
    return (
      <div className="git-view p-4">
        <h2>Git is not initialized for this project.</h2>
        <button className="primary-button mt-4" onClick={() => void handleInit()}>Initialize Git Repository</button>
      </div>
    );
  }

  if (error) {
    return (
      <div className="git-view p-4 error">
        <h2>Error</h2>
        <p>{error}</p>
        <button onClick={() => void loadStatus()}>Retry</button>
      </div>
    );
  }

  if (!status) return null;

  return (
    <div className="git-view" style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "16px" }}>
      <div className="git-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2>Git Status - {status.branch}</h2>
        <div>
            <button className="secondary-button" style={{ marginRight: '8px' }} onClick={() => void handlePull()}>Pull</button>
            <button className="secondary-button" onClick={() => void handlePush()}>Push</button>
        </div>
      </div>

      <div className="git-section card" style={{ padding: '16px', background: 'var(--bg-layer-1)', borderRadius: '8px' }}>
        <h3>Commit Changes</h3>
        <form onSubmit={handleCommit} style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
          <input
            type="text"
            className="text-input"
            value={commitMessage}
            onChange={(e) => setCommitMessage(e.target.value)}
            placeholder="Commit message (stages all changed files)"
            style={{ flex: 1 }}
          />
          <button type="submit" className="primary-button" disabled={!commitMessage.trim()}>Commit</button>
        </form>
      </div>

      <div className="git-section card" style={{ padding: '16px', background: 'var(--bg-layer-1)', borderRadius: '8px' }}>
         <h3>Changes</h3>
         {status.isClean ? (
             <p>Working tree is clean.</p>
         ) : (
             <>
                 {status.staged.length > 0 && (
                     <div>
                         <h4>Staged</h4>
                         <ul style={{ paddingLeft: '20px', fontSize: '14px' }}>
                             {status.staged.map(f => <li key={f} style={{ color: 'var(--accent-color)' }}>{f}</li>)}
                         </ul>
                     </div>
                 )}
                 {status.changed.length > 0 && (
                     <div style={{ marginTop: '8px' }}>
                         <h4>Changed</h4>
                         <ul style={{ paddingLeft: '20px', fontSize: '14px' }}>
                             {status.changed.map(f => <li key={f} style={{ color: 'var(--text-color)' }}>{f}</li>)}
                         </ul>
                     </div>
                 )}
                 {status.untracked.length > 0 && (
                     <div style={{ marginTop: '8px' }}>
                         <h4>Untracked</h4>
                         <ul style={{ paddingLeft: '20px', fontSize: '14px' }}>
                             {status.untracked.map(f => <li key={f} style={{ color: 'var(--text-color-muted)' }}>{f}</li>)}
                         </ul>
                     </div>
                 )}
             </>
         )}
      </div>

      <div className="git-section card" style={{ padding: '16px', background: 'var(--bg-layer-1)', borderRadius: '8px' }}>
        <h3>Remote</h3>
        {status.remotes.length > 0 ? (
          <p>Configured remotes: {status.remotes.join(", ")}</p>
        ) : (
          <p>No remote configured.</p>
        )}
        <form onSubmit={handleSetRemote} style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
          <input
            type="text"
            className="text-input"
            value={remoteUrl}
            onChange={(e) => setRemoteUrl(e.target.value)}
            placeholder="Remote URL"
            style={{ flex: 1 }}
          />
          <button type="submit" className="secondary-button" disabled={!remoteUrl.trim()}>Set Origin</button>
        </form>
      </div>
    </div>
  );
}
