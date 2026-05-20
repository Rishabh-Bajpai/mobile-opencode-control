from flask import Blueprint, jsonify, request
from git import Repo, exc

from .auth import auth_required
from .models import Project

git_bp = Blueprint('git_bp', __name__)


def _current_branch_name(repo: Repo) -> str:
    if not repo.head.is_valid():
        return "No commits yet"
    if repo.head.is_detached:
        return f"Detached HEAD @ {repo.head.commit.hexsha[:7]}"
    return repo.active_branch.name


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

    try:
        ahead_str, behind_str = repo.git.rev_list(
            "--left-right", "--count", f"{repo.active_branch.path}...{tracking_branch.path}"
        ).strip().split()
        return tracking_branch.name, int(ahead_str), int(behind_str)
    except Exception:
        return tracking_branch.name, 0, 0


def _get_named_remote(repo: Repo, remote_name: str):
    for remote in repo.remotes:
        if remote.name == remote_name:
            return remote
    return None


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
        changed = [item.a_path for item in repo.index.diff(None)]
        staged = [item.a_path for item in repo.index.diff("HEAD")] if repo.head.is_valid() else []
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

@git_bp.post("/api/projects/<int:project_id>/git/commit")
@auth_required
def git_commit(project_id: int):
    repo, err_resp, err_code = get_repo(project_id)
    if err_resp:
        return err_resp, err_code

    data = request.get_json(silent=True) or {}
    message = (data.get("message") or "").strip()
    if not message:
        return jsonify({"error": "Commit message is required"}), 400

    if not repo.is_dirty(untracked_files=True):
        return jsonify({"error": "No changes to commit"}), 400

    try:
        repo.git.add(all=True)
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

    data = request.get_json(silent=True) or {}
    remote_name = (data.get("remote") or "origin").strip()

    try:
        remote = _get_named_remote(repo, remote_name)
        if remote is None:
            return jsonify({"error": f"Remote '{remote_name}' is not configured"}), 400
        if not repo.head.is_valid():
            return jsonify({"error": "Create at least one commit before pushing"}), 400
        if repo.head.is_detached:
            return jsonify({"error": "Switch to a branch before pushing"}), 400

        tracking_branch = repo.active_branch.tracking_branch()
        if tracking_branch is not None and tracking_branch.remote_name == remote_name:
            repo.git.push(remote_name, repo.active_branch.name)
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

    data = request.get_json(silent=True) or {}
    remote_name = (data.get("remote") or "origin").strip()

    try:
        remote = _get_named_remote(repo, remote_name)
        if remote is None:
            return jsonify({"error": f"Remote '{remote_name}' is not configured"}), 400
        if not repo.head.is_valid():
            return jsonify({"error": "Create the first commit before pulling from a remote"}), 400
        if repo.head.is_detached:
            return jsonify({"error": "Switch to a branch before pulling"}), 400

        remote.pull(repo.active_branch.name)
        return jsonify({"success": True})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@git_bp.post("/api/projects/<int:project_id>/git/remote")
@auth_required
def git_remote(project_id: int):
    repo, err_resp, err_code = get_repo(project_id)
    if err_resp:
        return err_resp, err_code

    data = request.get_json(silent=True) or {}
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
