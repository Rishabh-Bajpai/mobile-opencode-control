import json
import os
import mimetypes
import socket
import tempfile
import zipfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests
from flask import (
    Response,
    after_this_request,
    jsonify,
    request,
    send_file,
    stream_with_context,
)
from sqlalchemy import or_

from ..auth import auth_required
from ..db import db
from ..models import AppSetting, Project, ScheduledTask, ScheduledTaskRun, TimelineEvent
from ..scheduler import TASK_TYPES, calculate_next_run, next_cron_runs, parse_cron_expression
from ..voice import VoiceError
from . import api_bp
from .helpers import *  # noqa: F401,F403




app = None
settings = None
opencode_client = None
scheduler = None
voice_runtime = None


def configure(app_instance, settings_instance, opencode_client_instance, scheduler_instance, voice_runtime_instance):
    global app, settings, opencode_client, scheduler, voice_runtime
    app = app_instance
    settings = settings_instance
    opencode_client = opencode_client_instance
    scheduler = scheduler_instance
    voice_runtime = voice_runtime_instance


@api_bp.get("/projects/<int:project_id>/files/tree")
@auth_required
def list_project_files(project_id: int):
    project = Project.query.get(project_id)
    if project is None:
        return jsonify({"error": "Project not found"}), 404

    try:
        root = _resolve_project_relative_path(project, "", allow_root=True)
        entries, truncated = _collect_project_tree_entries(project)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except Exception as exc:
        return jsonify({"error": f"Failed to list project files: {exc}"}), 500

    return jsonify(
        {
            "rootPath": root.as_posix(),
            "entries": entries,
            "truncated": truncated,
        }
    )


@api_bp.get("/projects/<int:project_id>/files/list")
@auth_required
def list_project_directory(project_id: int):
    project = Project.query.get(project_id)
    if project is None:
        return jsonify({"error": "Project not found"}), 404

    requested_directory = str(request.args.get("dir") or "").strip()
    try:
        target_dir, entries, truncated = _list_project_directory_entries(
            project,
            requested_directory,
        )
        root = _resolve_project_relative_path(project, "", allow_root=True)
        directory_relative = (
            "" if target_dir == root else target_dir.relative_to(root).as_posix()
        )
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except Exception as exc:
        return jsonify({"error": f"Failed to list directory: {exc}"}), 500

    return jsonify(
        {
            "rootPath": root.as_posix(),
            "directory": directory_relative,
            "entries": entries,
            "truncated": truncated,
        }
    )


@api_bp.get("/projects/<int:project_id>/files/content")
@auth_required
def read_project_file(project_id: int):
    project = Project.query.get(project_id)
    if project is None:
        return jsonify({"error": "Project not found"}), 404

    requested_path = str(request.args.get("path") or "").strip()
    if not requested_path:
        return jsonify({"error": "path query parameter is required"}), 400

    try:
        target = _resolve_project_relative_path(project, requested_path)
        if not target.exists() or not target.is_file():
            return jsonify({"error": "File not found"}), 404

        stats = target.stat()
        max_preview_bytes = 512 * 1024
        with target.open("rb") as handle:
            preview = handle.read(max_preview_bytes)
        is_binary = b"\x00" in preview
        mime_type = (
            mimetypes.guess_type(target.name)[0] or "application/octet-stream"
        )
        truncated = stats.st_size > max_preview_bytes
        text = ""
        encoding = None
        if not is_binary:
            text = preview.decode("utf-8", errors="replace")
            encoding = "utf-8"

        modified_at = datetime.fromtimestamp(
            stats.st_mtime, tz=timezone.utc
        ).isoformat()
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except OSError as exc:
        return jsonify({"error": f"Unable to read file: {exc}"}), 500

    return jsonify(
        {
            "path": requested_path,
            "size": stats.st_size,
            "modifiedAt": modified_at,
            "mimeType": mime_type,
            "isBinary": is_binary,
            "encoding": encoding,
            "truncated": truncated,
            "text": text,
        }
    )


@api_bp.get("/projects/<int:project_id>/files/download")
@auth_required
def download_project_file(project_id: int):
    project = Project.query.get(project_id)
    if project is None:
        return jsonify({"error": "Project not found"}), 404

    requested_path = str(request.args.get("path") or "").strip()
    if not requested_path:
        return jsonify({"error": "path query parameter is required"}), 400

    try:
        target = _resolve_project_relative_path(project, requested_path)
        if not target.exists() or not target.is_file():
            return jsonify({"error": "File not found"}), 404
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400

    return send_file(
        target,
        as_attachment=True,
        download_name=target.name,
    )


@api_bp.get("/projects/<int:project_id>/files/archive")
@auth_required
def download_project_archive(project_id: int):
    project = Project.query.get(project_id)
    if project is None:
        return jsonify({"error": "Project not found"}), 404

    archive_path = None
    try:
        root = _resolve_project_relative_path(project, "", allow_root=True)
        temp_archive = tempfile.NamedTemporaryFile(
            prefix="project-archive-",
            suffix=".zip",
            delete=False,
        )
        archive_path = Path(temp_archive.name)
        temp_archive.close()

        @after_this_request
        def cleanup_archive(response):
            if archive_path is not None:
                try:
                    archive_path.unlink(missing_ok=True)
                except OSError:
                    pass
            return response

        with zipfile.ZipFile(
            archive_path, mode="w", compression=zipfile.ZIP_DEFLATED
        ) as archive:
            for current_root, _, files in os.walk(root):
                current_path = Path(current_root)
                for file_name in files:
                    absolute = (current_path / file_name).resolve()
                    if absolute != root and root not in absolute.parents:
                        continue
                    arcname = absolute.relative_to(root).as_posix()
                    archive.write(absolute, arcname=arcname)
    except ValueError as exc:
        if archive_path is not None:
            try:
                archive_path.unlink(missing_ok=True)
            except OSError:
                pass
        return jsonify({"error": str(exc)}), 400
    except OSError as exc:
        if archive_path is not None:
            try:
                archive_path.unlink(missing_ok=True)
            except OSError:
                pass
        return jsonify({"error": f"Failed to build archive: {exc}"}), 500

    archive_name = f"{project.name.replace(' ', '_')}-files.zip"
    return send_file(
        archive_path,
        mimetype="application/zip",
        as_attachment=True,
        download_name=archive_name,
    )
