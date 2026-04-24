import os
import json
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

from .auth import auth_required
from .db import db
from .models import AppSetting, Project, ScheduledTask, ScheduledTaskRun, TimelineEvent
from .scheduler import TASK_TYPES, calculate_next_run, next_cron_runs, parse_cron_expression
from .voice import VoiceError


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _project_to_dict(project: Project) -> dict:
    return {
        "id": str(project.id),
        "name": project.name,
        "path": project.path,
        "lastSessionId": project.last_session_id,
        "lastMessagePreview": project.last_message_preview,
        "sessionStatus": project.session_status,
        "hasScheduledTask": bool(project.has_scheduled_task),
        "createdAt": project.created_at.isoformat(),
        "updatedAt": project.updated_at.isoformat(),
        "lastActivityAt": project.last_activity_at.isoformat(),
    }


def _query_projects_with_sessions(query):
    return query.filter(
        Project.last_session_id.isnot(None),
        Project.last_session_id != "",
    )


def _resolve_visible_active_project_id(projects: list[Project]) -> str | None:
    active_project_id = _get_setting("active_project_id")
    visible_project_ids = {str(project.id) for project in projects}
    if active_project_id and active_project_id in visible_project_ids:
        return active_project_id
    if not projects:
        return None
    return str(projects[0].id)


def _task_to_dict(task: ScheduledTask) -> dict:
    return {
        "id": str(task.id),
        "projectId": str(task.project_id),
        "name": task.name,
        "description": task.description,
        "instruction": task.instruction,
        "taskType": task.task_type,
        "cronExpression": task.cron_expression,
        "onceRunAt": task.once_run_at.isoformat() if task.once_run_at else None,
        "intervalMinutes": task.interval_minutes,
        "timezone": task.timezone,
        "model": task.model,
        "agent": task.agent,
        "enabled": bool(task.enabled),
        "startsAt": task.starts_at.isoformat() if task.starts_at else None,
        "endsAt": task.ends_at.isoformat() if task.ends_at else None,
        "maxRuns": task.max_runs,
        "runTimeoutMinutes": task.run_timeout_minutes,
        "heartbeatEnabled": bool(task.heartbeat_enabled),
        "goalDefinition": task.goal_definition,
        "autoDisableOnGoalMet": bool(task.auto_disable_on_goal_met),
        "retryCount": task.retry_count,
        "retryBackoffMinutes": task.retry_backoff_minutes,
        "notificationUrl": task.notification_url,
        "persistentSessionId": task.persistent_session_id,
        "totalRuns": task.total_runs,
        "nextRunAt": task.next_run_at.isoformat() if task.next_run_at else None,
        "lastRunAt": task.last_run_at.isoformat() if task.last_run_at else None,
        "lastStatus": task.last_status,
        "lastError": task.last_error,
        "createdAt": task.created_at.isoformat(),
        "updatedAt": task.updated_at.isoformat(),
    }


def _task_run_to_dict(run: ScheduledTaskRun) -> dict:
    return {
        "id": str(run.id),
        "taskId": str(run.task_id),
        "projectId": str(run.project_id),
        "status": run.status,
        "sessionId": run.session_id,
        "trigger": run.trigger,
        "startedAt": run.started_at.isoformat() if run.started_at else None,
        "finishedAt": run.finished_at.isoformat() if run.finished_at else None,
        "heartbeatLoaded": bool(run.heartbeat_loaded),
        "runNumber": run.run_number,
        "modelUsed": run.model_used,
        "agentUsed": run.agent_used,
        "timeoutUsed": run.timeout_used,
        "goalAttempted": bool(run.goal_attempted),
        "goalMet": run.goal_met,
        "goalOutput": run.goal_output,
        "retryAttempt": run.retry_attempt,
        "outputPreview": run.output_preview,
        "error": run.error,
    }


def _parse_optional_datetime(value) -> datetime | None:
    if value in (None, ""):
        return None
    if not isinstance(value, str):
        raise ValueError("datetime value must be an ISO string")
    normalized = value.strip().replace("Z", "+00:00")
    parsed = datetime.fromisoformat(normalized)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _task_metrics(task: ScheduledTask) -> dict:
    runs = ScheduledTaskRun.query.filter_by(task_id=task.id).all()
    completed = [run for run in runs if run.status in {"completed", "goal_met"}]
    finished = [run for run in runs if run.finished_at and run.started_at]
    avg_runtime_seconds = None
    if finished:
        durations = [(_ensure_utc(run.finished_at) - _ensure_utc(run.started_at)).total_seconds() for run in finished]
        avg_runtime_seconds = sum(durations) / len(durations)
    return {
        "totalRuns": len(runs),
        "successRate": (len(completed) / len(runs)) if runs else None,
        "avgRuntimeSeconds": avg_runtime_seconds,
        "lastOutcomes": [run.status for run in sorted(runs, key=lambda item: item.started_at or _utc_now(), reverse=True)[:10]],
    }


LOCAL_SESSION_COMMANDS = {
    "stop": "Stop the current agent execution for this project session.",
    "abort": "Alias for /stop.",
}


def _timeline_event_to_dict(event: TimelineEvent) -> dict:
    payload = {}
    try:
        parsed = json.loads(event.payload_json)
        if isinstance(parsed, dict):
            payload = parsed
    except Exception:
        payload = {}

    return {
        "id": str(event.id),
        "projectId": str(event.project_id),
        "eventType": event.event_type,
        "createdAt": event.created_at.isoformat(),
        "payload": payload,
    }


def _datetime_from_epoch_ms(value: object) -> datetime | None:
    if not isinstance(value, (int, float)):
        return None
    if value <= 0:
        return None
    return datetime.fromtimestamp(value / 1000, tz=timezone.utc)


def _ensure_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _normalize_project_path(path: str) -> str:
    return os.path.realpath(os.path.abspath(path.strip()))


def _resolve_project_relative_path(
    project: Project,
    relative_path: str,
    *,
    allow_root: bool = False,
) -> Path:
    project_root = Path(_normalize_project_path(project.path)).resolve()
    normalized_relative = (relative_path or "").strip()
    candidate = (project_root / normalized_relative).resolve()

    if candidate != project_root and project_root not in candidate.parents:
        raise ValueError("Path is outside project root")

    if not allow_root and candidate == project_root:
        raise ValueError("A file path is required")

    return candidate


def _collect_project_tree_entries(
    project: Project, max_entries: int = 12000
) -> tuple[list[dict], bool]:
    root = _resolve_project_relative_path(project, "", allow_root=True)
    entries: list[dict] = []
    seen_paths: set[str] = set()
    truncated = False
    stack: list[tuple[str, int]] = [(root.as_posix(), 0)]

    while stack:
        current_dir_path, depth = stack.pop()
        try:
            with os.scandir(current_dir_path) as iterator:
                children = sorted(
                    [entry for entry in iterator],
                    key=lambda item: (
                        not item.is_dir(follow_symlinks=False),
                        item.name.lower(),
                    ),
                )
        except OSError:
            continue

        for child in children:
            try:
                child_path = Path(child.path)
                resolved = child_path.resolve()
            except OSError:
                continue

            if resolved != root and root not in resolved.parents:
                continue

            try:
                child_stat = resolved.stat()
            except OSError:
                continue

            relative = child_path.relative_to(root).as_posix()
            if relative in seen_paths:
                continue
            seen_paths.add(relative)

            is_dir = child.is_dir(follow_symlinks=False)
            entries.append(
                {
                    "path": relative,
                    "name": child.name,
                    "isDir": is_dir,
                    "size": 0 if is_dir else int(child_stat.st_size),
                    "modifiedAt": datetime.fromtimestamp(
                        child_stat.st_mtime, tz=timezone.utc
                    ).isoformat(),
                    "depth": depth,
                }
            )

            if len(entries) >= max_entries:
                truncated = True
                break

            if is_dir:
                stack.append((child.path, depth + 1))

        if truncated:
            break

    return entries, truncated


def _list_project_directory_entries(
    project: Project,
    directory: str,
    max_entries: int = 2500,
) -> tuple[Path, list[dict], bool]:
    root = _resolve_project_relative_path(project, "", allow_root=True)
    target_dir = _resolve_project_relative_path(project, directory, allow_root=True)
    if not target_dir.exists() or not target_dir.is_dir():
        raise ValueError("Directory not found")

    entries: list[dict] = []
    truncated = False
    base_depth = 0 if target_dir == root else len(target_dir.relative_to(root).parts)

    try:
        with os.scandir(target_dir) as iterator:
            children = sorted(
                [entry for entry in iterator],
                key=lambda item: (
                    not item.is_dir(follow_symlinks=False),
                    item.name.lower(),
                ),
            )
    except OSError as exc:
        raise ValueError(f"Unable to list directory: {exc}") from exc

    for child in children:
        child_path = Path(child.path)
        try:
            resolved = child_path.resolve()
            if resolved != root and root not in resolved.parents:
                continue
            child_stat = resolved.stat()
            is_dir = child.is_dir(follow_symlinks=False)
            relative = child_path.relative_to(root).as_posix()
        except OSError:
            continue

        entries.append(
            {
                "path": relative,
                "name": child.name,
                "isDir": is_dir,
                "size": 0 if is_dir else int(child_stat.st_size),
                "modifiedAt": datetime.fromtimestamp(
                    child_stat.st_mtime, tz=timezone.utc
                ).isoformat(),
                "depth": base_depth,
            }
        )

        if len(entries) >= max_entries:
            truncated = True
            break

    return target_dir, entries, truncated


def _get_setting(key: str, default: str | None = None) -> str | None:
    setting = AppSetting.query.filter_by(key=key).first()
    if setting is None:
        return default
    return setting.value


def _set_setting(key: str, value: str) -> None:
    setting = AppSetting.query.filter_by(key=key).first()
    if setting is None:
        setting = AppSetting(key=key, value=value)
        db.session.add(setting)
    else:
        setting.value = value


def _delete_setting(key: str) -> None:
    setting = AppSetting.query.filter_by(key=key).first()
    if setting is not None:
        db.session.delete(setting)


def _project_setting_key(project_id: int, suffix: str) -> str:
    return f"project:{project_id}:{suffix}"


def _get_project_pending_approvals(
    project_id: int, session_id: str | None = None
) -> list[dict]:
    raw = _get_setting(_project_setting_key(project_id, "pending_approvals"), "[]") or "[]"
    try:
        parsed = json.loads(raw)
    except Exception:
        return []
    if not isinstance(parsed, list):
        return []
    approvals: list[dict] = []
    for item in parsed:
        if not isinstance(item, dict):
            continue
        permission_id = str(item.get("permissionId") or "").strip()
        if not permission_id:
            continue
        approvals.append(
            {
                "permissionId": permission_id,
                "sessionId": str(item.get("sessionId") or "").strip() or None,
                "title": str(item.get("title") or "Permission requested").strip()
                or "Permission requested",
                "details": str(item.get("details") or "").strip(),
                "createdAt": str(item.get("createdAt") or _utc_now().isoformat()),
            }
        )
    if session_id is None:
        return approvals
    return [
        item
        for item in approvals
        if str(item.get("sessionId") or "").strip() == session_id
    ]


def _set_project_pending_approvals(project_id: int, approvals: list[dict]) -> None:
    _set_setting(
        _project_setting_key(project_id, "pending_approvals"),
        json.dumps(approvals),
    )


def _clear_project_pending_approvals(project_id: int) -> None:
    _delete_setting(_project_setting_key(project_id, "pending_approvals"))


def _get_project_runtime_selection(project_id: int) -> dict[str, str | None]:
    return {
        "model": _get_setting(_project_setting_key(project_id, "model")),
        "agent": _get_setting(_project_setting_key(project_id, "agent")),
    }


def _session_matches_project(
    project: Project,
    session: dict,
) -> bool:
    directory = session.get("directory")
    if not isinstance(directory, str) or not directory.strip():
        return False

    return _normalize_project_path(directory) == _normalize_project_path(project.path)


def _clear_project_session_cache(project_id: int) -> None:
    _delete_setting(_project_setting_key(project_id, "sessions"))


def _extract_text(parts: list[dict]) -> str:
    chunks: list[str] = []
    for part in parts:
        if not isinstance(part, dict):
            continue
        if part.get("type") == "text" and isinstance(part.get("text"), str):
            chunks.append(part["text"])
    return "\n".join(chunks).strip()


def _local_message(text: str, role: str = "assistant") -> dict:
    timestamp = _utc_now().isoformat()
    return {
        "id": f"local-{int(_utc_now().timestamp() * 1000)}",
        "role": role,
        "createdAt": timestamp,
        "text": text,
        "parts": [{"type": "text", "text": text}],
    }


def _message_to_dict(message: dict) -> dict:
    info = message.get("info") if isinstance(message, dict) else {}
    parts = message.get("parts") if isinstance(message, dict) else []
    if not isinstance(parts, list):
        parts = []

    time_info = info.get("time") if isinstance(info, dict) and isinstance(info.get("time"), dict) else {}
    message_time = message.get("time") if isinstance(message.get("time"), dict) else {}
    created_at = (
        _datetime_from_epoch_ms(time_info.get("created"))
        or _datetime_from_epoch_ms(message_time.get("created"))
    )
    text = _extract_text(parts)
    return {
        "id": str((info or {}).get("id") or ""),
        "role": (info or {}).get("role") or "assistant",
        "createdAt": (info or {}).get("createdAt")
        or (created_at.isoformat() if created_at else None)
        or _utc_now().isoformat(),
        "text": text,
        "parts": parts,
    }


def _session_to_dict(
    session: dict,
    active_session_id: str | None = None,
    ownership_source: str | None = None,
    effective_project_path: str | None = None,
) -> dict:
    time_info = session.get("time") if isinstance(session.get("time"), dict) else {}
    created_at = _datetime_from_epoch_ms(time_info.get("created"))
    updated_at = _datetime_from_epoch_ms(time_info.get("updated"))
    session_id = str(session.get("id") or "")
    title = str(session.get("title") or "").strip()
    slug = str(session.get("slug") or "").strip()
    summary = session.get("summary") if isinstance(session.get("summary"), dict) else {}

    return {
        "id": session_id,
        "title": title or slug or session_id,
        "slug": slug,
        "directory": str(session.get("directory") or ""),
        "version": str(session.get("version") or "").strip(),
        "createdAt": created_at.isoformat() if created_at else None,
        "updatedAt": updated_at.isoformat() if updated_at else None,
        "summary": {
            "files": int(summary.get("files") or 0),
            "additions": int(summary.get("additions") or 0),
            "deletions": int(summary.get("deletions") or 0),
        },
        "isActive": bool(active_session_id and session_id == active_session_id),
        "ownershipSource": ownership_source,
        "effectiveProjectPath": effective_project_path,
    }


def _list_project_sessions(
    project: Project, opencode_client, limit: int = 200
) -> list[dict]:
    sessions = opencode_client.list_sessions(limit=limit, directory=project.path)
    matching_sessions = [
        session for session in sessions if _session_matches_project(project, session)
    ]
    return _sort_sessions_desc(matching_sessions)


def _resolve_project_session(
    project: Project,
    opencode_client,
    session_id: str | None = None,
    create_if_missing: bool = True,
) -> str:
    project_path = _normalize_project_path(project.path)

    candidate_session_id = (
        str(session_id).strip()
        if isinstance(session_id, str) and session_id.strip()
        else None
    ) or project.last_session_id

    if candidate_session_id:
        try:
            session = opencode_client.get_session(candidate_session_id)
            if _session_matches_project(project, session):
                if project.last_session_id != candidate_session_id:
                    project.last_session_id = candidate_session_id
                    project.last_activity_at = _utc_now()
                    db.session.commit()
                return candidate_session_id
            project.last_session_id = None
        except requests.HTTPError:
            project.last_session_id = None

        if session_id:
            db.session.commit()
            raise ValueError("Selected session does not belong to this project")

        db.session.commit()

    existing_sessions = _list_project_sessions(project, opencode_client, limit=200)
    if existing_sessions:
        fallback_session_id = str(existing_sessions[0].get("id") or "").strip()
        if fallback_session_id:
            project.last_session_id = fallback_session_id
            project.last_activity_at = _utc_now()
            db.session.commit()
            return fallback_session_id

    if not create_if_missing:
        raise ValueError("No session selected for this project")

    session = opencode_client.create_session(directory=project_path, title=project.name)
    session_id = session.get("id")
    if not session_id:
        raise ValueError("Unable to create OpenCode session")

    project.last_session_id = str(session_id)
    project.session_status = "idle"
    project.last_activity_at = _utc_now()
    db.session.commit()
    return project.last_session_id


def _ensure_project_session(project: Project, opencode_client) -> str:
    return _resolve_project_session(project, opencode_client, create_if_missing=True)


def _sort_sessions_desc(sessions: list[dict]) -> list[dict]:
    def _session_sort_key(session: dict) -> tuple[float, str]:
        time_info = session.get("time") if isinstance(session.get("time"), dict) else {}
        updated = _datetime_from_epoch_ms(time_info.get("updated"))
        created = _datetime_from_epoch_ms(time_info.get("created"))
        timestamp = updated or created or datetime.fromtimestamp(0, tz=timezone.utc)
        return (timestamp.timestamp(), str(session.get("id") or ""))

    return sorted(sessions, key=_session_sort_key, reverse=True)


def _extract_data_payload(event_lines: list[str]) -> str:
    chunks: list[str] = []
    for line in event_lines:
        if line.startswith("data:"):
            chunks.append(line[5:].strip())
    return "\n".join(chunks).strip()


def _extract_json_event_payload(event_lines: list[str]) -> dict | None:
    payload = _extract_data_payload(event_lines)
    if not payload:
        return None
    try:
        parsed = json.loads(payload)
    except json.JSONDecodeError:
        return None
    if isinstance(parsed, dict):
        return parsed
    return None


def _find_permission_id(value) -> str | None:
    if isinstance(value, str):
        return None

    if isinstance(value, list):
        for item in value:
            found = _find_permission_id(item)
            if found:
                return found
        return None

    if isinstance(value, dict):
        for candidate in (
            value.get("permissionID"),
            value.get("permissionId"),
            value.get("permission_id"),
            value.get("id"),
        ):
            if isinstance(candidate, str) and candidate.strip():
                return candidate.strip()
        for item in value.values():
            found = _find_permission_id(item)
            if found:
                return found
    return None


def _is_permission_resolved(value) -> bool:
    if isinstance(value, str):
        lowered = value.lower()
        return (
            "allow" in lowered
            or "deny" in lowered
            or "reject" in lowered
            or "approve" in lowered
        )

    if isinstance(value, list):
        return any(_is_permission_resolved(item) for item in value)

    if isinstance(value, dict):
        response = value.get("response") or value.get("decision") or value.get("action")
        if isinstance(response, str):
            return True
        return any(_is_permission_resolved(item) for item in value.values())

    return False


def _parse_permission_event(event_lines: list[str]) -> tuple[dict | None, str | None]:
    payload = _extract_json_event_payload(event_lines)
    if not payload:
        return None, None

    event_type = str(payload.get("type") or "").lower()
    if "permission" not in event_type:
        return None, None

    properties = payload.get("properties") if isinstance(payload.get("properties"), dict) else payload
    permission_id = _find_permission_id(properties)
    if not permission_id:
        return None, None

    if _is_permission_resolved(properties):
        return None, permission_id

    details = json.dumps(properties)
    return {
        "permissionId": permission_id,
        "title": "Permission requested",
        "details": details,
        "createdAt": _utc_now().isoformat(),
    }, None


def _update_pending_approvals_from_event(
    project_id: int, session_id: str, event_lines: list[str]
) -> None:
    request_item, resolved_permission_id = _parse_permission_event(event_lines)
    if request_item is None and resolved_permission_id is None:
        return

    approvals = _get_project_pending_approvals(project_id)
    if resolved_permission_id:
        next_approvals = [
            item
            for item in approvals
            if str(item.get("permissionId") or "") != resolved_permission_id
        ]
    else:
        assert request_item is not None
        request_item["sessionId"] = session_id
        next_approvals = [
            item
            for item in approvals
            if not (
                str(item.get("permissionId") or "") == request_item["permissionId"]
                and str(item.get("sessionId") or "") == session_id
            )
        ]
        next_approvals.append(request_item)

    if next_approvals:
        _set_project_pending_approvals(project_id, next_approvals)
    else:
        _clear_project_pending_approvals(project_id)
    db.session.commit()


def _event_matches_session(event_lines: list[str], session_id: str) -> bool:
    payload = _extract_data_payload(event_lines)
    if not payload:
        return True

    if session_id in payload:
        return True

    try:
        parsed = json.loads(payload)
    except json.JSONDecodeError:
        return True

    keys = {"sessionID", "sessionId", "session_id", "session"}

    def _walk(value) -> bool:
        if isinstance(value, dict):
            for key, item in value.items():
                if key in keys and isinstance(item, str):
                    return item == session_id
                if _walk(item):
                    return True
        elif isinstance(value, list):
            for item in value:
                if _walk(item):
                    return True
        return False

    return _walk(parsed)


def _provider_headers(api_key: str) -> dict[str, str]:
    headers: dict[str, str] = {}
    if api_key and api_key.strip() and api_key.strip().lower() != "not-required":
        headers["Authorization"] = f"Bearer {api_key.strip()}"
    return headers


def _has_external_stt_provider(settings) -> bool:
    return bool(settings.stt_base_url.strip())


def _has_external_tts_provider(settings) -> bool:
    return bool(settings.tts_base_url.strip())


def register_api_routes(app, settings, opencode_client, scheduler, voice_runtime):
    @app.get("/api/health")
    def app_health():
        return jsonify(
            {
                "healthy": True,
                "service": "mobile-opencode-control-backend",
                "env": settings.app_env,
            }
        )

    @app.get("/api/lan-url")
    def app_lan_url():
        frontend_port = settings.frontend_port
        lan_ip: str | None = None
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
                sock.connect(("8.8.8.8", 80))
                lan_ip = sock.getsockname()[0]
        except OSError:
            lan_ip = None

        if lan_ip and lan_ip not in ("127.0.0.1", "::1"):
            url = f"http://{lan_ip}:{frontend_port}"
        else:
            url = None

        return jsonify({"url": url, "port": frontend_port, "ip": lan_ip})

    @app.get("/api/opencode/health")
    @auth_required
    def opencode_health():
        try:
            data = opencode_client.health()
            return jsonify({"healthy": True, "upstream": data})
        except Exception as exc:
            return (
                jsonify(
                    {
                        "healthy": False,
                        "error": str(exc),
                        "upstreamBaseUrl": settings.opencode_base_url,
                    }
                ),
                502,
            )

    @app.get("/api/opencode/commands")
    @auth_required
    def opencode_commands():
        try:
            commands = opencode_client.list_commands()
            normalized = []
            for item in commands:
                name = str(item.get("name") or "").strip()
                if not name:
                    continue
                if name in LOCAL_SESSION_COMMANDS:
                    continue
                normalized.append(
                    {
                        "name": name,
                        "description": str(item.get("description") or "").strip(),
                    }
                )
            return jsonify({"commands": normalized})
        except Exception as exc:
            return jsonify({"error": f"Failed to load commands: {exc}"}), 502

    @app.get("/api/projects/<int:project_id>/runtime")
    @auth_required
    def get_project_runtime(project_id: int):
        project = Project.query.get(project_id)
        if project is None:
            return jsonify({"error": "Project not found"}), 404

        try:
            config = opencode_client.get_config()
            provider_data = opencode_client.list_config_providers()
        except Exception as exc:
            return jsonify({"error": f"Failed to load runtime options: {exc}"}), 502

        selected = _get_project_runtime_selection(project_id)
        agent_map = config.get("agent") if isinstance(config.get("agent"), dict) else {}
        agents = []
        for name in sorted(agent_map.keys()):
            item = agent_map.get(name)
            description = ""
            if isinstance(item, dict):
                description = str(item.get("description") or "").strip()
            agents.append({"id": name, "description": description})

        models = []
        providers = (
            provider_data.get("providers")
            if isinstance(provider_data.get("providers"), list)
            else []
        )
        default_map = (
            provider_data.get("default")
            if isinstance(provider_data.get("default"), dict)
            else {}
        )
        for provider in providers:
            if not isinstance(provider, dict):
                continue
            provider_id = str(provider.get("id") or "").strip()
            provider_name = str(provider.get("name") or provider_id).strip()
            provider_models = (
                provider.get("models")
                if isinstance(provider.get("models"), dict)
                else {}
            )
            for model in provider_models.values():
                if not isinstance(model, dict):
                    continue
                model_id = str(model.get("id") or "").strip()
                if not provider_id or not model_id:
                    continue
                value = f"{provider_id}/{model_id}"
                models.append(
                    {
                        "id": value,
                        "providerId": provider_id,
                        "providerName": provider_name,
                        "modelId": model_id,
                        "name": str(model.get("name") or model_id).strip(),
                        "isDefault": default_map.get(provider_id) == model_id,
                    }
                )

        models.sort(key=lambda item: (item["providerName"], item["name"]))

        return jsonify(
            {
                "selectedModel": selected["model"],
                "selectedAgent": selected["agent"],
                "models": models,
                "agents": agents,
            }
        )

    @app.put("/api/projects/<int:project_id>/runtime")
    @auth_required
    def update_project_runtime(project_id: int):
        project = Project.query.get(project_id)
        if project is None:
            return jsonify({"error": "Project not found"}), 404

        body = request.get_json(silent=True) or {}
        model = body.get("model")
        agent = body.get("agent")

        model_value = (
            str(model).strip() if isinstance(model, str) and model.strip() else None
        )
        agent_value = (
            str(agent).strip() if isinstance(agent, str) and agent.strip() else None
        )

        try:
            config = opencode_client.get_config()
            provider_data = opencode_client.list_config_providers()
        except Exception as exc:
            return jsonify({"error": f"Failed to validate runtime options: {exc}"}), 502

        valid_agents = set()
        agent_map = config.get("agent") if isinstance(config.get("agent"), dict) else {}
        for key in agent_map.keys():
            if isinstance(key, str) and key.strip():
                valid_agents.add(key.strip())

        valid_models = set()
        providers = (
            provider_data.get("providers")
            if isinstance(provider_data.get("providers"), list)
            else []
        )
        for provider in providers:
            if not isinstance(provider, dict):
                continue
            provider_id = str(provider.get("id") or "").strip()
            provider_models = (
                provider.get("models")
                if isinstance(provider.get("models"), dict)
                else {}
            )
            for model_item in provider_models.values():
                if not isinstance(model_item, dict):
                    continue
                model_id = str(model_item.get("id") or "").strip()
                if provider_id and model_id:
                    valid_models.add(f"{provider_id}/{model_id}")

        if model_value and model_value not in valid_models:
            return jsonify({"error": f"Model '{model_value}' is not available"}), 400
        if agent_value and agent_value not in valid_agents:
            return jsonify({"error": f"Agent '{agent_value}' is not available"}), 400

        model_key = _project_setting_key(project_id, "model")
        agent_key = _project_setting_key(project_id, "agent")
        if model_value:
            _set_setting(model_key, model_value)
        else:
            _delete_setting(model_key)

        if agent_value:
            _set_setting(agent_key, agent_value)
        else:
            _delete_setting(agent_key)

        db.session.commit()
        return jsonify(
            {"ok": True, "selectedModel": model_value, "selectedAgent": agent_value}
        )

    @app.get("/api/projects/<int:project_id>/sessions")
    @auth_required
    def list_project_sessions(project_id: int):
        project = Project.query.get(project_id)
        if project is None:
            return jsonify({"error": "Project not found"}), 404

        try:
            _clear_project_session_cache(project.id)
            sessions = _list_project_sessions(project, opencode_client, limit=500)
        except Exception as exc:
            return jsonify({"error": f"Failed to load sessions: {exc}"}), 502

        active_session_id = project.last_session_id
        matching_session_ids = {
            str(session.get("id") or "").strip()
            for session in sessions
            if session.get("id")
        }
        if active_session_id and active_session_id not in matching_session_ids:
            active_session_id = None
            if project.last_session_id is not None:
                project.last_session_id = None
                db.session.commit()
        return jsonify(
            {
                "activeSessionId": active_session_id,
                "sessions": [
                    _session_to_dict(
                        session,
                        active_session_id=active_session_id,
                        ownership_source="directory",
                        effective_project_path=project.path,
                    )
                    for session in sessions
                ],
            }
        )

    @app.post("/api/projects/<int:project_id>/sessions")
    @auth_required
    def create_project_session(project_id: int):
        project = Project.query.get(project_id)
        if project is None:
            return jsonify({"error": "Project not found"}), 404

        try:
            session = opencode_client.create_session(
                directory=_normalize_project_path(project.path), title=project.name
            )
            session_id = str(session.get("id") or "").strip()
            if not session_id:
                raise ValueError("Unable to create OpenCode session")
            project.last_session_id = session_id
            project.session_status = "idle"
            project.last_activity_at = _utc_now()
            _clear_project_session_cache(project.id)
            db.session.commit()
        except Exception as exc:
            return jsonify({"error": f"Failed to create session: {exc}"}), 502

        return jsonify(
            {
                "ok": True,
                "activeSessionId": session_id,
                "session": _session_to_dict(
                    session,
                    active_session_id=session_id,
                    ownership_source="directory",
                    effective_project_path=project.path,
                ),
            }
        )

    @app.put("/api/projects/<int:project_id>/session")
    @auth_required
    def update_project_session(project_id: int):
        project = Project.query.get(project_id)
        if project is None:
            return jsonify({"error": "Project not found"}), 404

        body = request.get_json(silent=True) or {}
        requested_session_id = str(body.get("sessionId") or "").strip()
        if not requested_session_id:
            return jsonify({"error": "sessionId is required"}), 400

        try:
            session_id = _resolve_project_session(
                project,
                opencode_client,
                session_id=requested_session_id,
                create_if_missing=False,
            )
            session = opencode_client.get_session(session_id)
        except ValueError as exc:
            return jsonify({"error": str(exc)}), 400
        except Exception as exc:
            return jsonify({"error": f"Failed to switch session: {exc}"}), 502

        return jsonify(
            {
                "ok": True,
                "activeSessionId": session_id,
                "session": _session_to_dict(
                    session,
                    active_session_id=session_id,
                    ownership_source="directory",
                    effective_project_path=project.path,
                ),
            }
        )

    @app.delete("/api/projects/<int:project_id>/sessions/<session_id>")
    @auth_required
    def delete_project_session(project_id: int, session_id: str):
        project = Project.query.get(project_id)
        if project is None:
            return jsonify({"error": "Project not found"}), 404

        requested_session_id = str(session_id or "").strip()
        if not requested_session_id:
            return jsonify({"error": "sessionId is required"}), 400

        try:
            session = opencode_client.get_session(requested_session_id)
            if not _session_matches_project(project, session):
                return jsonify(
                    {"error": "Selected session does not belong to this project"}
                ), 400

            opencode_client.delete_session(requested_session_id)
            _clear_project_session_cache(project.id)

            remaining_sessions = _list_project_sessions(
                project, opencode_client, limit=500
            )
            deleted_project_id: str | None = None
            next_active_project_id: str | None = None
            next_active_session_id = project.last_session_id
            remaining_ids = {
                str(item.get("id") or "").strip()
                for item in remaining_sessions
                if item.get("id")
            }

            if (
                requested_session_id == project.last_session_id
                or project.last_session_id not in remaining_ids
            ):
                next_active_session_id = (
                    str(remaining_sessions[0].get("id") or "").strip()
                    if remaining_sessions
                    else None
                )
                project.last_session_id = next_active_session_id

            if not remaining_sessions:
                deleted_project_id = str(project.id)
                active_project_id = _get_setting("active_project_id")
                fallback_project = (
                    _query_projects_with_sessions(
                        Project.query.filter(Project.id != project.id)
                    )
                    .order_by(Project.last_activity_at.desc())
                    .first()
                )
                if active_project_id == deleted_project_id:
                    if fallback_project is None:
                        _delete_setting("active_project_id")
                    else:
                        next_active_project_id = str(fallback_project.id)
                        _set_setting("active_project_id", next_active_project_id)

                _clear_project_session_cache(project.id)
                _delete_setting(_project_setting_key(project.id, "model"))
                _delete_setting(_project_setting_key(project.id, "agent"))
                db.session.delete(project)
            else:
                project.last_activity_at = _utc_now()

            db.session.commit()
        except requests.HTTPError as exc:
            status_code = exc.response.status_code if exc.response is not None else 502
            if status_code == 404:
                return jsonify({"error": "Session not found"}), 404
            return jsonify({"error": f"Failed to delete session: {exc}"}), 502
        except Exception as exc:
            return jsonify({"error": f"Failed to delete session: {exc}"}), 502

        return jsonify(
            {
                "ok": True,
                "deletedSessionId": requested_session_id,
                "activeSessionId": None
                if deleted_project_id
                else project.last_session_id,
                "projectDeleted": bool(deleted_project_id),
                "deletedProjectId": deleted_project_id,
                "activeProjectId": next_active_project_id,
                "sessions": [
                    _session_to_dict(
                        item,
                        active_session_id=None
                        if deleted_project_id
                        else project.last_session_id,
                        ownership_source="directory",
                        effective_project_path=project.path,
                    )
                    for item in remaining_sessions
                ],
            }
        )

    @app.get("/api/scheduler/status")
    @auth_required
    def scheduler_status():
        return jsonify({"scheduler": scheduler.get_status()})

    @app.get("/api/voice/health")
    @auth_required
    def voice_health():
        mode = settings.voice_provider_mode
        external_stt = _has_external_stt_provider(settings)
        external_tts = _has_external_tts_provider(settings)

        return jsonify(
            {
                "mode": mode,
                "resolved": {
                    "stt": "external"
                    if mode == "external" or (mode == "auto" and external_stt)
                    else "builtin",
                    "tts": "external"
                    if mode == "external" or (mode == "auto" and external_tts)
                    else "builtin",
                },
                "externalConfigured": {
                    "stt": external_stt,
                    "tts": external_tts,
                },
                "builtin": {
                    "sttModel": settings.builtin_stt_model,
                    "ttsModel": settings.builtin_tts_model,
                    "device": settings.builtin_stt_device,
                    "computeType": settings.builtin_stt_compute_type,
                },
            }
        )

    @app.post("/api/stt/transcribe")
    @auth_required
    def transcribe_audio():
        upload = request.files.get("audio")
        if upload is None:
            return jsonify({"error": "Missing audio file field 'audio'"}), 400

        filename = upload.filename or "recording.webm"
        content_type = upload.mimetype or "application/octet-stream"
        audio_bytes = upload.read()
        if not audio_bytes:
            return jsonify({"error": "Uploaded audio is empty"}), 400

        model = str(request.form.get("model") or settings.stt_model).strip()
        language = str(request.form.get("language") or "").strip()

        mode = settings.voice_provider_mode
        external_configured = _has_external_stt_provider(settings)
        use_external = mode == "external" or (mode == "auto" and external_configured)

        if not use_external:
            try:
                transcript, used_model = voice_runtime.transcribe(
                    audio_bytes=audio_bytes,
                    filename=filename,
                    language=language or None,
                )
                return jsonify(
                    {
                        "text": transcript,
                        "model": used_model,
                        "raw": {"provider": "builtin", "mode": mode},
                    }
                )
            except VoiceError as exc:
                return jsonify({"error": f"STT transcription failed: {exc}"}), 502

        files = {
            "file": (filename, audio_bytes, content_type),
        }
        data = {
            "model": model,
        }
        if language:
            data["language"] = language

        try:
            response = requests.post(
                f"{settings.stt_base_url}/audio/transcriptions",
                headers=_provider_headers(settings.stt_api_key),
                files=files,
                data=data,
                timeout=120,
            )
            response.raise_for_status()
            payload = response.json()
            transcript = payload.get("text") if isinstance(payload, dict) else ""
            if not isinstance(transcript, str):
                transcript = ""
            return jsonify(
                {
                    "text": transcript,
                    "model": model,
                    "raw": payload,
                }
            )
        except Exception as exc:
            return jsonify({"error": f"STT transcription failed: {exc}"}), 502

    @app.post("/api/tts/speak")
    @auth_required
    def speak_text():
        body = request.get_json(silent=True) or {}
        text = str(body.get("text") or "").strip()
        if not text:
            return jsonify({"error": "Text is required"}), 400

        model = str(body.get("model") or settings.tts_model).strip()
        voice = str(body.get("voice") or settings.tts_voice).strip()
        response_format = str(body.get("format") or "mp3").strip()

        mode = settings.voice_provider_mode
        external_configured = _has_external_tts_provider(settings)
        use_external = mode == "external" or (mode == "auto" and external_configured)

        if not use_external:
            try:
                synthesized = voice_runtime.synthesize(text=text, voice=voice)
                return Response(
                    synthesized.audio_bytes,
                    status=200,
                    mimetype=synthesized.mimetype,
                )
            except VoiceError as exc:
                return jsonify({"error": f"TTS synthesis failed: {exc}"}), 502

        payload = {
            "model": model,
            "input": text,
            "voice": voice,
            "response_format": response_format,
        }

        try:
            response = requests.post(
                f"{settings.tts_base_url}/audio/speech",
                headers=_provider_headers(settings.tts_api_key),
                json=payload,
                timeout=120,
            )
            response.raise_for_status()
            content_type = response.headers.get("Content-Type", "audio/mpeg")
            return Response(response.content, status=200, mimetype=content_type)
        except Exception as exc:
            return jsonify({"error": f"TTS synthesis failed: {exc}"}), 502

    @app.get("/api/projects")
    @auth_required
    def list_projects():
        try:
            limit = min(max(int(request.args.get("limit", "100")), 1), 300)
            offset = max(int(request.args.get("offset", "0")), 0)
        except ValueError:
            return jsonify({"error": "Invalid pagination parameters"}), 400

        query = str(request.args.get("q", "")).strip()

        base_query = _query_projects_with_sessions(Project.query)
        if query:
            like_query = f"%{query}%"
            base_query = base_query.filter(
                or_(Project.name.ilike(like_query), Project.path.ilike(like_query))
            )

        base_query = base_query.order_by(Project.last_activity_at.desc())
        total = base_query.count()
        projects = base_query.offset(offset).limit(limit).all()
        active_project_id = _get_setting("active_project_id")
        next_offset = offset + len(projects)
        return jsonify(
            {
                "projects": [_project_to_dict(project) for project in projects],
                "activeProjectId": active_project_id,
                "limit": limit,
                "offset": offset,
                "total": total,
                "hasMore": next_offset < total,
            }
        )

    @app.post("/api/projects/sync")
    @auth_required
    def sync_projects_from_opencode():
        try:
            upstream_projects = opencode_client.list_projects()
        except Exception as exc:
            return jsonify({"error": f"Failed to sync projects: {exc}"}), 502

        imported = 0
        updated = 0
        skipped = 0

        for upstream_project in upstream_projects:
            worktree = upstream_project.get("worktree")
            if not isinstance(worktree, str) or not worktree:
                skipped += 1
                continue

            worktree = _normalize_project_path(worktree)

            if worktree == "/" or not os.path.isdir(worktree):
                skipped += 1
                continue

            raw_name = upstream_project.get("name")
            name = (
                raw_name.strip()
                if isinstance(raw_name, str) and raw_name.strip()
                else os.path.basename(worktree.rstrip("/")) or worktree
            )

            time_info = (
                upstream_project.get("time")
                if isinstance(upstream_project.get("time"), dict)
                else {}
            )
            updated_at = _datetime_from_epoch_ms(time_info.get("updated")) or _utc_now()
            created_at = _datetime_from_epoch_ms(time_info.get("created")) or updated_at

            project = Project.query.filter_by(path=worktree).first()
            if project is None:
                project = Project(
                    name=name,
                    path=worktree,
                    last_session_id=None,
                    created_at=created_at,
                    updated_at=updated_at,
                    last_activity_at=updated_at,
                )
                db.session.add(project)
                imported += 1
                continue

            changed = False
            if project.name != name:
                project.name = name
                changed = True
            project_last_activity = _ensure_utc(project.last_activity_at)
            if updated_at > project_last_activity:
                project.last_activity_at = updated_at
                changed = True

            if changed:
                updated += 1

        db.session.flush()

        for project in Project.query.order_by(Project.id.asc()).all():
            _clear_project_session_cache(project.id)
            sorted_sessions = _list_project_sessions(
                project, opencode_client, limit=500
            )
            latest_session_id = None
            if sorted_sessions:
                latest_session_id = (
                    str(sorted_sessions[0].get("id") or "").strip() or None
                )

            if project.last_session_id != latest_session_id:
                project.last_session_id = latest_session_id
                updated += 1

        db.session.commit()

        projects = _query_projects_with_sessions(
            Project.query.order_by(Project.last_activity_at.desc())
        ).all()
        active_project_id = _resolve_visible_active_project_id(projects)
        return jsonify(
            {
                "imported": imported,
                "updated": updated,
                "skipped": skipped,
                "projects": [_project_to_dict(project) for project in projects],
                "activeProjectId": active_project_id,
            }
        )

    @app.post("/api/projects")
    @auth_required
    def create_project():
        body = request.get_json(silent=True) or {}
        name = (body.get("name") or "").strip()
        path = (body.get("path") or "").strip()

        if not path:
            return jsonify({"error": "Project path is required"}), 400

        normalized_path = _normalize_project_path(path)

        if not os.path.isdir(normalized_path):
            try:
                os.makedirs(normalized_path, exist_ok=True)
            except OSError as exc:
                return jsonify(
                    {"error": f"Unable to create project folder: {exc}"}
                ), 400

        if not name:
            name = os.path.basename(normalized_path.rstrip("/")) or normalized_path

        existing = Project.query.filter_by(path=normalized_path).first()
        if existing is not None:
            return jsonify(
                {
                    "error": "Project already exists",
                    "project": _project_to_dict(existing),
                }
            ), 409

        project = Project(name=name, path=normalized_path, last_activity_at=_utc_now())
        db.session.add(project)
        db.session.commit()

        try:
            _ensure_project_session(project, opencode_client)
        except Exception as exc:
            db.session.delete(project)
            db.session.commit()
            return jsonify({"error": f"Failed to create initial session: {exc}"}), 502

        return jsonify({"project": _project_to_dict(project)}), 201

    @app.post("/api/projects/<int:project_id>/select")
    @auth_required
    def select_project(project_id: int):
        project = Project.query.get(project_id)
        if project is None:
            return jsonify({"error": "Project not found"}), 404

        _set_setting("active_project_id", str(project.id))
        project.last_activity_at = _utc_now()
        db.session.commit()
        return jsonify({"ok": True, "activeProjectId": str(project.id)})

    @app.get("/api/state")
    @auth_required
    def get_state():
        active_project_id = _get_setting("active_project_id")
        return jsonify(
            {
                "activeProjectId": active_project_id,
                "defaultProjectRoot": settings.default_project_root,
            }
        )

    @app.get("/api/projects/<int:project_id>/files/tree")
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

    @app.get("/api/projects/<int:project_id>/files/list")
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

    @app.get("/api/projects/<int:project_id>/files/content")
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

    @app.get("/api/projects/<int:project_id>/files/download")
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

    @app.get("/api/projects/<int:project_id>/files/archive")
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

    @app.get("/api/projects/<int:project_id>/task")
    @auth_required
    def get_project_task(project_id: int):
        project = Project.query.get(project_id)
        if project is None:
            return jsonify({"error": "Project not found"}), 404

        tasks = (
            ScheduledTask.query.filter_by(project_id=project_id)
            .order_by(ScheduledTask.created_at.asc())
            .all()
        )
        task = tasks[0] if tasks else None
        if task is None:
            return jsonify({"task": None, "tasks": [], "runs": []})

        runs = (
            ScheduledTaskRun.query.filter_by(task_id=task.id)
            .order_by(ScheduledTaskRun.started_at.desc())
            .limit(20)
            .all()
        )
        return jsonify(
            {
                "task": _task_to_dict(task),
                "tasks": [_task_to_dict(item) for item in tasks],
                "runs": [_task_run_to_dict(r) for r in runs],
                "metrics": _task_metrics(task),
            }
        )

    def _apply_task_payload(task: ScheduledTask, project_id: int, body: dict) -> None:
        instruction = str(body.get("instruction") or "").strip()
        if not instruction:
            raise ValueError("Task instruction is required")

        task_type = str(body.get("taskType") or body.get("task_type") or "interval").strip().lower()
        if task_type not in TASK_TYPES:
            raise ValueError("taskType must be interval, cron, once, or goal")

        try:
            interval_minutes = int(body.get("intervalMinutes") or 15)
            max_runs = body.get("maxRuns")
            run_timeout_minutes = body.get("runTimeoutMinutes")
            retry_count = int(body.get("retryCount") or 0)
            retry_backoff_minutes = int(body.get("retryBackoffMinutes") or 5)
        except (TypeError, ValueError):
            raise ValueError("Numeric task fields are invalid")

        if task_type in {"interval", "goal"} and interval_minutes < 5:
            raise ValueError("Minimum task interval is 5 minutes")

        cron_expression = str(body.get("cronExpression") or "").strip() or None
        if task_type == "cron":
            if not cron_expression:
                raise ValueError("cronExpression is required for cron tasks")
            parse_cron_expression(cron_expression)

        once_run_at = _parse_optional_datetime(body.get("onceRunAt"))
        if task_type == "once" and once_run_at is None:
            raise ValueError("onceRunAt is required for one-time tasks")

        timezone_name = str(body.get("timezone") or "UTC").strip() or "UTC"
        if task_type == "cron":
            next_cron_runs(cron_expression or "* * * * *", timezone_name, _utc_now(), 1)

        task.project_id = project_id
        task.name = str(body.get("name") or "Scheduled task").strip()[:180]
        task.description = str(body.get("description") or "").strip() or None
        task.instruction = instruction
        task.task_type = task_type
        task.cron_expression = cron_expression
        task.once_run_at = once_run_at
        task.interval_minutes = interval_minutes
        task.timezone = timezone_name
        task.model = str(body.get("model") or "").strip() or None
        task.agent = str(body.get("agent") or "").strip() or None
        task.enabled = bool(body.get("enabled", True))
        task.starts_at = _parse_optional_datetime(body.get("startsAt"))
        task.ends_at = _parse_optional_datetime(body.get("endsAt"))
        task.max_runs = int(max_runs) if max_runs not in (None, "") else None
        task.run_timeout_minutes = int(run_timeout_minutes) if run_timeout_minutes not in (None, "") else None
        task.heartbeat_enabled = bool(body.get("heartbeatEnabled", True))
        task.goal_definition = str(body.get("goalDefinition") or "").strip() or None
        task.auto_disable_on_goal_met = bool(body.get("autoDisableOnGoalMet", True))
        task.retry_count = max(retry_count, 0)
        task.retry_backoff_minutes = max(retry_backoff_minutes, 1)
        task.notification_url = str(body.get("notificationUrl") or "").strip() or None
        task.next_run_at = calculate_next_run(task, _utc_now()) if task.enabled else None
        task.last_status = "idle" if task.enabled else "disabled"
        task.last_error = None

    @app.put("/api/projects/<int:project_id>/task")
    @auth_required
    def upsert_project_task(project_id: int):
        project = Project.query.get(project_id)
        if project is None:
            return jsonify({"error": "Project not found"}), 404

        try:
            body = request.get_json(silent=True) or {}
            task_id = str(body.get("id") or body.get("taskId") or "").strip()
            task = ScheduledTask.query.filter_by(id=int(task_id), project_id=project_id).first() if task_id else None
        except (TypeError, ValueError):
            return jsonify({"error": "Invalid task id"}), 400

        now = _utc_now()
        if task is None:
            task = ScheduledTask(project_id=project_id, instruction="", interval_minutes=15)
            db.session.add(task)

        try:
            _apply_task_payload(task, project_id, body)
        except ValueError as exc:
            return jsonify({"error": str(exc)}), 400

        project.has_scheduled_task = True
        project.updated_at = now
        db.session.commit()
        tasks = ScheduledTask.query.filter_by(project_id=project_id).order_by(ScheduledTask.created_at.asc()).all()
        return jsonify({"task": _task_to_dict(task), "tasks": [_task_to_dict(item) for item in tasks]})

    @app.delete("/api/projects/<int:project_id>/task")
    @auth_required
    def delete_project_task(project_id: int):
        project = Project.query.get(project_id)
        if project is None:
            return jsonify({"error": "Project not found"}), 404

        task_id = str(request.args.get("taskId") or "").strip()
        try:
            task = (
                ScheduledTask.query.filter_by(id=int(task_id), project_id=project_id).first()
                if task_id
                else ScheduledTask.query.filter_by(project_id=project_id).first()
            )
        except ValueError:
            return jsonify({"error": "Invalid task id"}), 400
        if task is None:
            return jsonify({"ok": True, "deleted": False})

        db.session.delete(task)
        project.has_scheduled_task = ScheduledTask.query.filter(
            ScheduledTask.project_id == project_id,
            ScheduledTask.id != task.id,
        ).first() is not None
        db.session.commit()
        return jsonify({"ok": True, "deleted": True})

    @app.post("/api/projects/<int:project_id>/task/run")
    @auth_required
    def run_project_task_now(project_id: int):
        project = Project.query.get(project_id)
        if project is None:
            return jsonify({"error": "Project not found"}), 404

        body = request.get_json(silent=True) or {}
        task_id = str(body.get("taskId") or request.args.get("taskId") or "").strip()
        try:
            task = (
                ScheduledTask.query.filter_by(id=int(task_id), project_id=project_id).first()
                if task_id
                else ScheduledTask.query.filter_by(project_id=project_id).first()
            )
        except ValueError:
            return jsonify({"error": "Invalid task id"}), 400
        if task is None:
            return jsonify({"error": "Scheduled task not configured"}), 404

        try:
            run_id = scheduler.trigger_task_now(task.id)
            run = ScheduledTaskRun.query.get(run_id)
            db.session.refresh(task)
            if run is None:
                return jsonify({"error": "Task run not found after execution"}), 500
            return jsonify({"task": _task_to_dict(task), "run": _task_run_to_dict(run), "metrics": _task_metrics(task)})
        except Exception as exc:
            return jsonify({"error": f"Failed to run task: {exc}"}), 502

    @app.get("/api/projects/<int:project_id>/task/runs")
    @auth_required
    def list_project_task_runs(project_id: int):
        project = Project.query.get(project_id)
        if project is None:
            return jsonify({"error": "Project not found"}), 404

        try:
            limit = min(max(int(request.args.get("limit", "20")), 1), 100)
        except ValueError:
            return jsonify({"error": "Invalid limit"}), 400

        task_id = str(request.args.get("taskId") or "").strip()
        query = ScheduledTaskRun.query.filter_by(project_id=project_id)
        if task_id:
            try:
                query = query.filter_by(task_id=int(task_id))
            except ValueError:
                return jsonify({"error": "Invalid task id"}), 400
        runs = (
            query
            .order_by(ScheduledTaskRun.started_at.desc())
            .limit(limit)
            .all()
        )
        return jsonify({"runs": [_task_run_to_dict(run) for run in runs]})

    @app.get("/api/projects/<int:project_id>/tasks")
    @auth_required
    def list_project_tasks(project_id: int):
        project = Project.query.get(project_id)
        if project is None:
            return jsonify({"error": "Project not found"}), 404
        tasks = ScheduledTask.query.filter_by(project_id=project_id).order_by(ScheduledTask.created_at.asc()).all()
        return jsonify({"tasks": [_task_to_dict(task) for task in tasks]})

    @app.post("/api/projects/<int:project_id>/tasks/<int:task_id>/pause")
    @auth_required
    def pause_project_task(project_id: int, task_id: int):
        task = ScheduledTask.query.filter_by(project_id=project_id, id=task_id).first()
        if task is None:
            return jsonify({"error": "Scheduled task not found"}), 404
        task.enabled = False
        task.last_status = "paused"
        db.session.commit()
        return jsonify({"task": _task_to_dict(task)})

    @app.post("/api/projects/<int:project_id>/tasks/<int:task_id>/resume")
    @auth_required
    def resume_project_task(project_id: int, task_id: int):
        task = ScheduledTask.query.filter_by(project_id=project_id, id=task_id).first()
        if task is None:
            return jsonify({"error": "Scheduled task not found"}), 404
        task.enabled = True
        task.next_run_at = task.next_run_at or calculate_next_run(task, _utc_now())
        task.last_status = "idle"
        db.session.commit()
        return jsonify({"task": _task_to_dict(task)})

    @app.post("/api/projects/<int:project_id>/tasks/preview")
    @auth_required
    def preview_project_task_schedule(project_id: int):
        if Project.query.get(project_id) is None:
            return jsonify({"error": "Project not found"}), 404
        body = request.get_json(silent=True) or {}
        task_type = str(body.get("taskType") or "interval").strip().lower()
        timezone_name = str(body.get("timezone") or "UTC").strip() or "UTC"
        try:
            if task_type == "cron":
                runs = next_cron_runs(str(body.get("cronExpression") or ""), timezone_name, _utc_now(), 5)
            elif task_type == "once":
                run_at = _parse_optional_datetime(body.get("onceRunAt"))
                runs = [run_at] if run_at else []
            else:
                interval = max(int(body.get("intervalMinutes") or 15), 1)
                cursor = _utc_now()
                runs = []
                for _ in range(5):
                    cursor = cursor + timedelta(minutes=interval)
                    runs.append(cursor)
        except Exception as exc:
            return jsonify({"error": str(exc)}), 400
        return jsonify({"runs": [run.isoformat() for run in runs if run is not None]})

    @app.post("/api/projects/<int:project_id>/session/ensure")
    @auth_required
    def ensure_project_session(project_id: int):
        project = Project.query.get(project_id)
        if project is None:
            return jsonify({"error": "Project not found"}), 404

        try:
            session_id = _ensure_project_session(project, opencode_client)
        except Exception as exc:
            return jsonify({"error": f"Failed to ensure session: {exc}"}), 502

        return jsonify({"sessionId": session_id})

    @app.post("/api/projects/<int:project_id>/abort")
    @auth_required
    def abort_project_session(project_id: int):
        project = Project.query.get(project_id)
        if project is None:
            return jsonify({"error": "Project not found"}), 404

        try:
            session_id = _ensure_project_session(project, opencode_client)
            ok = opencode_client.abort_session(session_id, directory=project.path)
            project.session_status = "idle"
            project.last_activity_at = _utc_now()
            db.session.commit()
            return jsonify({"ok": ok, "sessionId": session_id})
        except Exception as exc:
            project.session_status = "error"
            db.session.commit()
            return jsonify({"error": f"Failed to abort session: {exc}"}), 502

    @app.get("/api/projects/<int:project_id>/messages")
    @auth_required
    def get_project_messages(project_id: int):
        project = Project.query.get(project_id)
        if project is None:
            return jsonify({"error": "Project not found"}), 404

        try:
            session_id = _ensure_project_session(project, opencode_client)
            limit = int(request.args.get("limit", "100"))
            limit = min(max(limit, 1), 200)
            messages = opencode_client.list_messages(
                session_id=session_id, limit=limit, directory=project.path
            )
            timeline_events = (
                TimelineEvent.query.filter_by(project_id=project_id)
                .order_by(TimelineEvent.created_at.asc())
                .limit(500)
                .all()
            )
        except Exception as exc:
            return jsonify({"error": f"Failed to load messages: {exc}"}), 502

        return jsonify(
            {
                "sessionId": session_id,
                "messages": [_message_to_dict(message) for message in messages],
                "timelineEvents": [
                    _timeline_event_to_dict(event) for event in timeline_events
                ],
            }
        )

    @app.post("/api/projects/<int:project_id>/messages")
    @auth_required
    def send_project_message(project_id: int):
        project = Project.query.get(project_id)
        if project is None:
            return jsonify({"error": "Project not found"}), 404

        body = request.get_json(silent=True) or {}
        text = str(body.get("text") or "").strip()
        if not text:
            return jsonify({"error": "Message text is required"}), 400

        try:
            session_id = _ensure_project_session(project, opencode_client)
            runtime_selection = _get_project_runtime_selection(project.id)
            project.session_status = "running"
            db.session.commit()

            response_message = opencode_client.send_message(
                session_id=session_id,
                directory=project.path,
                text=text,
                model=runtime_selection["model"],
                agent=runtime_selection["agent"],
            )

            normalized = _message_to_dict(response_message)
            project.last_message_preview = normalized.get("text") or text[:180]
            project.last_activity_at = _utc_now()
            project.session_status = "idle"
            db.session.commit()
        except Exception as exc:
            project.session_status = "error"
            db.session.commit()
            return jsonify({"error": f"Failed to send message: {exc}"}), 502

        return jsonify(
            {
                "sessionId": session_id,
                "message": normalized,
            }
        )

    @app.post("/api/projects/<int:project_id>/commands")
    @auth_required
    def run_project_command(project_id: int):
        project = Project.query.get(project_id)
        if project is None:
            return jsonify({"error": "Project not found"}), 404

        body = request.get_json(silent=True) or {}
        command = str(body.get("command") or "").strip().lstrip("/")
        arguments = body.get("arguments") or []

        if not command:
            return jsonify({"error": "Command is required"}), 400
        if not isinstance(arguments, list):
            return jsonify({"error": "Command arguments must be a list"}), 400

        safe_args = [str(arg) for arg in arguments]

        try:
            session_id = _ensure_project_session(project, opencode_client)

            if command in LOCAL_SESSION_COMMANDS:
                opencode_client.abort_session(session_id, directory=project.path)
                normalized = _local_message(
                    "Stopped current agent execution for this session."
                )
                project.last_message_preview = normalized.get("text") or "/stop"
                project.last_activity_at = _utc_now()
                project.session_status = "idle"
                db.session.commit()
                return jsonify(
                    {"sessionId": session_id, "message": normalized, "localOnly": True}
                )

            available_commands = {
                str(item.get("name")): item
                for item in opencode_client.list_commands()
                if item.get("name")
            }
            if command not in available_commands:
                names = sorted(available_commands.keys())
                preview = ", ".join(names[:8])
                more = "" if len(names) <= 8 else ", ..."
                return (
                    jsonify(
                        {
                            "error": (
                                f"Command '/{command}' is not available on this OpenCode server. "
                                f"Available commands: {preview}{more}"
                            ),
                            "availableCommands": names,
                        }
                    ),
                    400,
                )

            response_message = opencode_client.run_command(
                session_id=session_id,
                command=command,
                arguments=safe_args,
                directory=project.path,
            )

            normalized = _message_to_dict(response_message)
            project.last_message_preview = normalized.get("text") or f"/{command}"
            project.last_activity_at = _utc_now()
            project.session_status = "idle"
            db.session.commit()
        except Exception as exc:
            project.session_status = "error"
            db.session.commit()
            return jsonify({"error": f"Failed to run command: {exc}"}), 502

        return jsonify({"sessionId": session_id, "message": normalized})

    @app.get("/api/projects/<int:project_id>/diff")
    @auth_required
    def get_project_diff(project_id: int):
        project = Project.query.get(project_id)
        if project is None:
            return jsonify({"error": "Project not found"}), 404

        try:
            session_id = _ensure_project_session(project, opencode_client)
            diff = opencode_client.get_diff(
                session_id=session_id, directory=project.path
            )
            return jsonify({"sessionId": session_id, "diff": diff})
        except Exception as exc:
            return jsonify({"error": f"Failed to load diff: {exc}"}), 502

    @app.get("/api/projects/<int:project_id>/approvals")
    @auth_required
    def get_project_approvals(project_id: int):
        project = Project.query.get(project_id)
        if project is None:
            return jsonify({"error": "Project not found"}), 404

        session_id = project.last_session_id
        if session_id:
            try:
                session_id = _resolve_project_session(
                    project,
                    opencode_client,
                    session_id=session_id,
                    create_if_missing=False,
                )
            except Exception:
                session_id = project.last_session_id

        return jsonify(
            {"approvals": _get_project_pending_approvals(project.id, session_id)}
        )

    @app.get("/api/projects/<int:project_id>/stream")
    @auth_required
    def stream_project_events(project_id: int):
        project = Project.query.get(project_id)
        if project is None:
            return jsonify({"error": "Project not found"}), 404

        try:
            session_id = _ensure_project_session(project, opencode_client)
        except Exception as exc:
            return jsonify({"error": f"Failed to ensure session: {exc}"}), 502

        db.session.remove()

        def _stream():
            try:
                with requests.get(
                    f"{opencode_client.base_url}/global/event",
                    params={"directory": project.path},
                    headers=opencode_client.event_headers,
                    stream=True,
                    timeout=600,
                ) as upstream:
                    upstream.raise_for_status()
                    event_lines: list[str] = []

                    for line in upstream.iter_lines(decode_unicode=True):
                        if line is None:
                            continue

                        normalized_line = line.rstrip("\n")
                        if not normalized_line:
                            if event_lines and _event_matches_session(
                                event_lines, session_id
                            ):
                                _update_pending_approvals_from_event(
                                    project.id, session_id, event_lines
                                )
                                data = json.dumps(
                                    {"sessionId": session_id, "event": event_lines}
                                )
                                yield f"data: {data}\n\n"
                            event_lines = []
                            continue

                        if normalized_line.startswith(":"):
                            continue
                        event_lines.append(normalized_line)
            except Exception as exc:
                error_payload = json.dumps({"sessionId": session_id, "error": str(exc)})
                yield f"event: error\ndata: {error_payload}\n\n"

        return Response(
            stream_with_context(_stream()),
            mimetype="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
            },
        )

    @app.get("/api/projects/events")
    @auth_required
    def stream_global_project_events():
        db.session.remove()

        def _stream():
            try:
                with requests.get(
                    f"{opencode_client.base_url}/global/sync-event",
                    headers=opencode_client.event_headers,
                    stream=True,
                    timeout=600,
                ) as upstream:
                    upstream.raise_for_status()
                    event_lines: list[str] = []

                    for line in upstream.iter_lines(decode_unicode=True):
                        if line is None:
                            continue

                        normalized_line = line.rstrip("\n")
                        if not normalized_line:
                            if event_lines:
                                data = json.dumps({"event": event_lines})
                                yield f"data: {data}\n\n"
                            event_lines = []
                            continue

                        if normalized_line.startswith(":"):
                            continue
                        event_lines.append(normalized_line)
            except Exception as exc:
                error_payload = json.dumps({"error": str(exc)})
                yield f"event: error\ndata: {error_payload}\n\n"

        return Response(
            stream_with_context(_stream()),
            mimetype="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
            },
        )

    @app.post("/api/projects/<int:project_id>/permissions/<permission_id>")
    @auth_required
    def respond_project_permission(project_id: int, permission_id: str):
        project = Project.query.get(project_id)
        if project is None:
            return jsonify({"error": "Project not found"}), 404

        body = request.get_json(silent=True) or {}
        response_value = str(body.get("response") or "").strip().lower()
        remember = bool(body.get("remember", False))

        mapping = {
            "approve": "allow",
            "allow": "allow",
            "yes": "allow",
            "deny": "deny",
            "reject": "deny",
            "no": "deny",
        }
        normalized = mapping.get(response_value)
        if normalized is None:
            return jsonify({"error": "Response must be approve or deny"}), 400

        try:
            session_id = _ensure_project_session(project, opencode_client)
            ok = opencode_client.respond_permission(
                session_id=session_id,
                directory=project.path,
                permission_id=permission_id,
                response_value=normalized,
                remember=remember,
            )
            approvals = _get_project_pending_approvals(project.id)
            next_approvals = [
                item
                for item in approvals
                if not (
                    str(item.get("permissionId") or "") == permission_id
                    and str(item.get("sessionId") or "") == session_id
                )
            ]
            if next_approvals:
                _set_project_pending_approvals(project.id, next_approvals)
            else:
                _clear_project_pending_approvals(project.id)
            project.last_activity_at = _utc_now()
            project.session_status = "idle"
            db.session.commit()
            return jsonify(
                {
                    "ok": ok,
                    "sessionId": session_id,
                    "permissionId": permission_id,
                    "response": normalized,
                }
            )
        except Exception as exc:
            project.session_status = "error"
            db.session.commit()
            return jsonify({"error": f"Failed to respond to permission: {exc}"}), 502
