from datetime import timezone
from pathlib import Path

from flask import Blueprint, jsonify, request
from git import Repo, exc

from .auth import auth_required
from .models import Project

git_bp = Blueprint("git_bp", __name__)
MAX_UNTRACKED_DIFF_BYTES = 1024 * 1024


def _get_request_data():
    data = request.get_json(silent=True)
    if data is None:
        if request.content_length:
            return None, (jsonify({"error": "Request body must be valid JSON"}), 400)
        return {}, None
    if not isinstance(data, dict):
        return None, (jsonify({"error": "Request body must be a JSON object"}), 400)
    return data, None


def _current_branch_name(repo: Repo) -> str:
    if not repo.head.is_valid():
        try:
            return repo.active_branch.name
        except Exception:
            return ""
    if repo.head.is_detached:
        return f"Detached HEAD @ {repo.head.commit.hexsha[:7]}"
    return repo.active_branch.name


def _split_lines(value: str) -> list[str]:
    return [line.strip() for line in value.splitlines() if line.strip()]


def _diff_name_only(repo: Repo, *args: str) -> list[str]:
    try:
        output = repo.git.diff(*args, "--name-only", "--diff-filter=ACDMRTUXB")
    except exc.GitCommandError:
        return []
    return _split_lines(output)


def _build_untracked_patch(repo: Repo, relative_path: str) -> str | None:
    """Build a preview patch for an untracked file.

    Returns a unified-diff-style string for text files within the preview size
    limit, a human-readable message when the file exceeds that limit, or None if
    the file cannot be read from disk.
    """
    path = Path(repo.working_dir, relative_path)
    try:
        file_size = path.stat().st_size
        if file_size > MAX_UNTRACKED_DIFF_BYTES:
            return (
                f"File too large to preview ({file_size} bytes). "
                f"Diff previews are limited to files up to {MAX_UNTRACKED_DIFF_BYTES} bytes."
            )

        content = path.read_text(errors="replace")
    except OSError:
        return None

    lines = content.splitlines()
    line_count = len(lines)
    patch_lines = ["--- /dev/null", f"+++ b/{relative_path}", f"@@ -0,0 +1,{line_count} @@"]
    for line in lines:
        patch_lines.append(f"+{line}")
    return "\n".join(patch_lines)


def _staged_paths(repo: Repo) -> list[str]:
    return _diff_name_only(repo, "--cached")


def _changed_paths(repo: Repo) -> list[str]:
    return _diff_name_only(repo)


def _has_staged_changes(repo: Repo) -> bool:
    return len(_staged_paths(repo)) > 0


def _serialize_commit(commit, refs: list[str] | None = None):
    total = {}
    try:
        total = commit.stats.total or {}
    except Exception:
        total = {}

    committed_at = None
    committed_datetime = getattr(commit, "committed_datetime", None)
    if committed_datetime is not None:
        try:
            committed_at = committed_datetime.astimezone(timezone.utc).isoformat()
        except Exception:
            committed_at = committed_datetime.isoformat()

    return {
        "sha": commit.hexsha,
        "shortSha": commit.hexsha[:7],
        "message": commit.summary,
        "authorName": getattr(commit.author, "name", None) or "Unknown author",
        "authorEmail": getattr(commit.author, "email", None) or "",
        "authoredAt": committed_at,
        "parents": len(commit.parents),
        "filesChanged": int(total.get("files", 0)),
        "insertions": int(total.get("insertions", 0)),
        "deletions": int(total.get("deletions", 0)),
        "refs": refs or [],
    }


def _serialize_last_commit(repo: Repo):
    if not repo.head.is_valid():
        return None
    commit = repo.head.commit
    return {
        "shortSha": commit.hexsha[:7],
        "message": commit.summary,
    }


def _serialize_remotes(repo: Repo):
    remotes = []
    for remote in repo.remotes:
        urls = list(remote.urls)
        remotes.append(
            {
                "name": remote.name,
                "url": urls[0] if urls else None,
            }
        )
    return remotes


def _tracking_details(repo: Repo):
    if not repo.head.is_valid() or repo.head.is_detached:
        return None, 0, 0

    tracking_branch = repo.active_branch.tracking_branch()
    if tracking_branch is None:
        return None, 0, 0

    counts = repo.git.rev_list(
        "--left-right", "--count", f"{repo.active_branch.path}...{tracking_branch.path}"
    ).strip().split()
    if len(counts) != 2:
        return tracking_branch.name, 0, 0
    ahead_str, behind_str = counts
    try:
        return tracking_branch.name, int(ahead_str), int(behind_str)
    except ValueError:
        return tracking_branch.name, 0, 0


def _get_named_remote(repo: Repo, remote_name: str):
    for remote in repo.remotes:
        if remote.name == remote_name:
            return remote
    return None


def _get_named_head(repo: Repo, branch_name: str):
    for head in repo.heads:
        if head.name == branch_name:
            return head
    return None


def _get_named_remote_ref(remote, branch_name: str):
    for ref in remote.refs:
        remote_head = getattr(ref, "remote_head", None)
        if remote_head == "HEAD":
            continue
        if remote_head == branch_name or ref.name == f"{remote.name}/{branch_name}":
            return ref
    return None


def _serialize_local_branches(repo: Repo):
    current_branch = None
    if not repo.head.is_detached:
        try:
            current_branch = repo.active_branch.name
        except Exception:
            current_branch = None

    serialized = []
    for branch in sorted(repo.heads, key=lambda item: item.name.lower()):
        tracking_branch = None
        last_commit = None
        try:
            tracking_ref = branch.tracking_branch()
            tracking_branch = tracking_ref.name if tracking_ref is not None else None
        except Exception:
            tracking_branch = None

        try:
            last_commit = _serialize_commit(branch.commit)
        except Exception:
            last_commit = None

        serialized.append(
            {
                "name": branch.name,
                "isCurrent": branch.name == current_branch,
                "upstream": tracking_branch,
                "lastCommit": last_commit,
            }
        )
    return serialized


def _serialize_remote_branches(repo: Repo):
    tracked_paths = {}
    for branch in repo.heads:
        try:
            tracking_branch = branch.tracking_branch()
        except Exception:
            tracking_branch = None
        if tracking_branch is not None:
            tracked_paths[tracking_branch.path] = branch.name

    serialized = []
    for remote in sorted(repo.remotes, key=lambda item: item.name.lower()):
        refs = sorted(
            [ref for ref in remote.refs if getattr(ref, "remote_head", None) != "HEAD"],
            key=lambda item: item.remote_head.lower(),
        )
        for ref in refs:
            serialized.append(
                {
                    "name": ref.name,
                    "remoteName": remote.name,
                    "branchName": ref.remote_head,
                    "trackedBy": tracked_paths.get(ref.path),
                    "lastCommit": _serialize_commit(ref.commit),
                }
            )
    return serialized


def _history_refs_map(repo: Repo):
    refs_by_sha = {}
    for ref in repo.refs:
        try:
            commit = ref.commit
        except Exception:
            continue
        refs_by_sha.setdefault(commit.hexsha, []).append(ref.name)

    for ref_names in refs_by_sha.values():
        ref_names.sort(key=lambda item: ("origin/" in item, item.lower()))
    return refs_by_sha


def get_repo(project_id: int):
    project = Project.query.get(project_id)
    if project is None:
        return None, jsonify({"error": "Project not found"}), 404
    try:
        repo = Repo(project.path)
        return repo, None, None
    except exc.InvalidGitRepositoryError:
        return None, jsonify({"error": "Not a git repository", "notGit": True}), 400


@git_bp.post("/api/projects/<int:project_id>/git/init")
@auth_required
def git_init(project_id: int):
    project = Project.query.get(project_id)
    if project is None:
        return jsonify({"error": "Project not found"}), 404
    try:
        Repo.init(project.path)
        return jsonify({"success": True})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@git_bp.get("/api/projects/<int:project_id>/git/status")
@auth_required
def git_status(project_id: int):
    repo, err_resp, err_code = get_repo(project_id)
    if err_resp:
        return err_resp, err_code

    try:
        untracked = repo.untracked_files
        changed = _changed_paths(repo)
        staged = _staged_paths(repo)
        remote_details = _serialize_remotes(repo)
        upstream, ahead, behind = _tracking_details(repo)

        return jsonify({
            "untracked": untracked,
            "changed": changed,
            "staged": staged,
            "isClean": not repo.is_dirty(untracked_files=True),
            "branch": _current_branch_name(repo),
            "remotes": [remote["name"] for remote in remote_details],
            "remoteDetails": remote_details,
            "upstream": upstream,
            "ahead": ahead,
            "behind": behind,
            "hasCommits": repo.head.is_valid(),
            "lastCommit": _serialize_last_commit(repo),
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@git_bp.get("/api/projects/<int:project_id>/git/branches")
@auth_required
def git_branches(project_id: int):
    repo, err_resp, err_code = get_repo(project_id)
    if err_resp:
        return err_resp, err_code

    try:
        return jsonify({
            "currentBranch": _current_branch_name(repo),
            "detached": bool(repo.head.is_detached),
            "local": _serialize_local_branches(repo),
            "remote": _serialize_remote_branches(repo),
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@git_bp.post("/api/projects/<int:project_id>/git/branches/checkout")
@auth_required
def git_checkout_branch(project_id: int):
    repo, err_resp, err_code = get_repo(project_id)
    if err_resp:
        return err_resp, err_code

    data, error_response = _get_request_data()
    if error_response:
        return error_response
    branch_name = (data.get("name") or "").strip()
    if not branch_name:
        return jsonify({"error": "Branch name is required"}), 400

    branch = _get_named_head(repo, branch_name)
    if branch is None:
        return jsonify({"error": f"Branch '{branch_name}' was not found"}), 404

    try:
        branch.checkout()
        return jsonify({"success": True, "currentBranch": branch.name})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@git_bp.post("/api/projects/<int:project_id>/git/branches/create")
@auth_required
def git_create_branch(project_id: int):
    repo, err_resp, err_code = get_repo(project_id)
    if err_resp:
        return err_resp, err_code

    data, error_response = _get_request_data()
    if error_response:
        return error_response
    branch_name = (data.get("name") or "").strip()
    start_point = (data.get("startPoint") or "HEAD").strip() or "HEAD"
    checkout = data.get("checkout", True)
    if not isinstance(checkout, bool):
        return jsonify({"error": "checkout must be a boolean"}), 400
    if not branch_name:
        return jsonify({"error": "Branch name is required"}), 400
    if _get_named_head(repo, branch_name) is not None:
        return jsonify({"error": f"Branch '{branch_name}' already exists"}), 400

    try:
        if not repo.head.is_valid():
            if not checkout:
                return jsonify({"error": "Create the first commit before creating additional branches"}), 400
            repo.git.checkout("--orphan", branch_name)
        else:
            branch = repo.create_head(branch_name, start_point)
            if checkout:
                branch.checkout()
        return jsonify({"success": True, "branch": branch_name})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@git_bp.post("/api/projects/<int:project_id>/git/branches/track")
@auth_required
def git_track_remote_branch(project_id: int):
    repo, err_resp, err_code = get_repo(project_id)
    if err_resp:
        return err_resp, err_code

    data, error_response = _get_request_data()
    if error_response:
        return error_response
    remote_name = (data.get("remote") or "origin").strip()
    branch_name = (data.get("name") or "").strip()
    local_name = (data.get("localName") or branch_name).strip()

    if not branch_name:
        return jsonify({"error": "Remote branch name is required"}), 400
    if not local_name:
        return jsonify({"error": "Local branch name is required"}), 400

    try:
        remote = _get_named_remote(repo, remote_name)
        if remote is None:
            return jsonify({"error": f"Remote '{remote_name}' is not configured"}), 400

        remote_ref = _get_named_remote_ref(remote, branch_name)
        if remote_ref is None:
            return jsonify({"error": f"Remote branch '{remote_name}/{branch_name}' was not found"}), 404

        local_branch = _get_named_head(repo, local_name)
        if local_branch is None:
            local_branch = repo.create_head(local_name, remote_ref)
        local_branch.set_tracking_branch(remote_ref)
        local_branch.checkout()
        return jsonify({"success": True, "branch": local_name, "upstream": remote_ref.name})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@git_bp.get("/api/projects/<int:project_id>/git/history")
@auth_required
def git_history(project_id: int):
    repo, err_resp, err_code = get_repo(project_id)
    if err_resp:
        return err_resp, err_code

    if not repo.head.is_valid():
        return jsonify({"commits": [], "hasMore": False})

    limit = request.args.get("limit", default=25, type=int) or 25
    skip = request.args.get("skip", default=0, type=int) or 0
    limit = max(1, min(limit, 100))
    skip = max(0, skip)

    try:
        refs_by_sha = _history_refs_map(repo)
        commits = list(repo.iter_commits("--all", max_count=limit + 1, skip=skip))
        has_more = len(commits) > limit
        visible_commits = commits[:limit]
        return jsonify({
            "commits": [
                _serialize_commit(commit, refs=refs_by_sha.get(commit.hexsha, []))
                for commit in visible_commits
            ],
            "hasMore": has_more,
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@git_bp.post("/api/projects/<int:project_id>/git/stage")
@auth_required
def git_stage_all(project_id: int):
    repo, err_resp, err_code = get_repo(project_id)
    if err_resp:
        return err_resp, err_code

    if not repo.is_dirty(untracked_files=True):
        return jsonify({"error": "No changes to track"}), 400

    try:
        repo.git.add("--all")
        return jsonify({"success": True})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@git_bp.post("/api/projects/<int:project_id>/git/commit")
@auth_required
def git_commit(project_id: int):
    repo, err_resp, err_code = get_repo(project_id)
    if err_resp:
        return err_resp, err_code

    data, error_response = _get_request_data()
    if error_response:
        return error_response
    message = (data.get("message") or "").strip()
    stage_all = data.get("stageAll", True)
    if not message:
        return jsonify({"error": "Commit message is required"}), 400
    if not isinstance(stage_all, bool):
        return jsonify({"error": "stageAll must be a boolean"}), 400

    try:
        if stage_all:
            repo.git.add("--all")
        if not _has_staged_changes(repo):
            return jsonify({"error": "No staged changes to commit"}), 400
        repo.index.commit(message)
        return jsonify({"success": True, "commit": _serialize_last_commit(repo)})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@git_bp.post("/api/projects/<int:project_id>/git/push")
@auth_required
def git_push(project_id: int):
    repo, err_resp, err_code = get_repo(project_id)
    if err_resp:
        return err_resp, err_code

    data, error_response = _get_request_data()
    if error_response:
        return error_response
    remote_name = (data.get("remote") or "origin").strip()

    try:
        remote = _get_named_remote(repo, remote_name)
        if remote is None:
            return jsonify({"error": f"Remote '{remote_name}' is not configured. Use the remote endpoint to add it."}), 400
        if not repo.head.is_valid():
            return jsonify({"error": "Create at least one commit before pushing"}), 400
        if repo.head.is_detached:
            return jsonify({"error": "Switch to a branch before pushing"}), 400

        tracking_branch = repo.active_branch.tracking_branch()
        if tracking_branch is not None and tracking_branch.remote_name == remote_name:
            repo.git.push(remote_name, f"{repo.active_branch.name}:{tracking_branch.remote_head}")
        else:
            repo.git.push("--set-upstream", remote_name, repo.active_branch.name)
        return jsonify({"success": True})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@git_bp.post("/api/projects/<int:project_id>/git/pull")
@auth_required
def git_pull(project_id: int):
    repo, err_resp, err_code = get_repo(project_id)
    if err_resp:
        return err_resp, err_code

    data, error_response = _get_request_data()
    if error_response:
        return error_response
    remote_name = (data.get("remote") or "origin").strip()

    try:
        remote = _get_named_remote(repo, remote_name)
        if remote is None:
            return jsonify({"error": f"Remote '{remote_name}' is not configured"}), 400
        if not repo.head.is_valid():
            return jsonify({"error": "Create the first commit before pulling from a remote"}), 400
        if repo.head.is_detached:
            return jsonify({"error": "Switch to a branch before pulling"}), 400

        tracking_branch = repo.active_branch.tracking_branch()
        branch_spec = repo.active_branch.name
        if tracking_branch is not None and tracking_branch.remote_name == remote_name:
            branch_spec = tracking_branch.remote_head
        remote.pull(branch_spec)
        return jsonify({"success": True})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@git_bp.get("/api/projects/<int:project_id>/git/diff")
@auth_required
def git_diff(project_id: int):
    repo, err_resp, err_code = get_repo(project_id)
    if err_resp:
        return err_resp, err_code

    try:
        entries = []

        if repo.head.is_valid():
            try:
                staged_output = repo.git.diff("--cached", unified=5)
                if staged_output.strip():
                    staged_paths = _staged_paths(repo)
                    for p in staged_paths:
                        patch = repo.git.diff("--cached", "--", p, unified=5)
                        entries.append({
                            "path": p,
                            "changeType": "M",
                            "patch": patch,
                        })
            except exc.GitCommandError:
                pass

            try:
                changed_paths = _changed_paths(repo)
                for p in changed_paths:
                    patch = repo.git.diff("--", p, unified=5)
                    entries.append({
                        "path": p,
                        "changeType": "M",
                        "patch": patch,
                    })
            except exc.GitCommandError:
                pass

        for u in repo.untracked_files:
            try:
                patch = _build_untracked_patch(repo, u)
                if patch is None:
                    continue
                entries.append({
                    "path": u,
                    "changeType": "?",
                    "patch": patch,
                })
            except OSError:
                pass

        return jsonify({"diff": entries})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@git_bp.post("/api/projects/<int:project_id>/git/remote")
@auth_required
def git_remote(project_id: int):
    repo, err_resp, err_code = get_repo(project_id)
    if err_resp:
        return err_resp, err_code

    data, error_response = _get_request_data()
    if error_response:
        return error_response
    name = (data.get("name") or "origin").strip()
    url = (data.get("url") or "").strip()
    if not url:
        return jsonify({"error": "URL is required"}), 400

    try:
        existing_remote = _get_named_remote(repo, name)
        if existing_remote is not None:
            existing_remote.set_url(url)
        else:
            repo.create_remote(name, url)
        return jsonify({"success": True, "remote": {"name": name, "url": url}})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


def register_git_routes(app):
    app.register_blueprint(git_bp)
