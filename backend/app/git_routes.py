import os
from flask import Blueprint, jsonify, request
from git import Repo, exc

from .auth import auth_required
from .models import Project

git_bp = Blueprint('git_bp', __name__)

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

        return jsonify({
            "untracked": untracked,
            "changed": changed,
            "staged": staged,
            "isClean": not repo.is_dirty(untracked_files=True),
            "branch": repo.active_branch.name if repo.head.is_valid() else "main (no commits)",
            "remotes": [r.name for r in repo.remotes]
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@git_bp.post("/api/projects/<int:project_id>/git/commit")
@auth_required
def git_commit(project_id: int):
    repo, err_resp, err_code = get_repo(project_id)
    if err_resp:
        return err_resp, err_code

    data = request.json
    message = data.get("message", "Update from OpenCode Web")

    try:
        repo.git.add(all=True)
        repo.index.commit(message)
        return jsonify({"success": True})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@git_bp.post("/api/projects/<int:project_id>/git/push")
@auth_required
def git_push(project_id: int):
    repo, err_resp, err_code = get_repo(project_id)
    if err_resp:
        return err_resp, err_code

    data = request.json or {}
    remote_name = data.get("remote", "origin")

    try:
        remote = repo.remotes[remote_name]
        if repo.active_branch.is_valid():
            repo.git.push("--set-upstream", remote_name, repo.active_branch.name)
        else:
            remote.push()
        return jsonify({"success": True})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@git_bp.post("/api/projects/<int:project_id>/git/pull")
@auth_required
def git_pull(project_id: int):
    repo, err_resp, err_code = get_repo(project_id)
    if err_resp:
        return err_resp, err_code

    data = request.json or {}
    remote_name = data.get("remote", "origin")

    try:
        remote = repo.remotes[remote_name]
        remote.pull()
        return jsonify({"success": True})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@git_bp.post("/api/projects/<int:project_id>/git/remote")
@auth_required
def git_remote(project_id: int):
    repo, err_resp, err_code = get_repo(project_id)
    if err_resp:
        return err_resp, err_code

    data = request.json
    name = data.get("name", "origin")
    url = data.get("url")
    if not url:
        return jsonify({"error": "URL is required"}), 400

    try:
        if name in [r.name for r in repo.remotes]:
            repo.delete_remote(name)
        repo.create_remote(name, url)
        return jsonify({"success": True})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

def register_git_routes(app):
    app.register_blueprint(git_bp)
