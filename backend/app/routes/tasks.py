# ruff: noqa: F405
import json
from datetime import timedelta

from flask import jsonify, request

from ..auth import auth_required
from ..db import db
from ..models import Project, ScheduledTask, ScheduledTaskRun
from ..scheduler import calculate_next_run, next_cron_runs
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


def _current_utc_now():
    return _utc_now()


_DEFAULT_PRD_TEMPLATE = {
    "project": "My Project",
    "branchName": "ralph/feature",
    "description": "Short description of what this PRD covers",
    "userStories": [
        {
            "id": "US-001",
            "title": "First user story",
            "description": "As a user I want ...",
            "acceptanceCriteria": ["Criterion 1", "Criterion 2"],
            "priority": 1,
            "passes": False,
            "notes": "",
        }
    ],
}


@api_bp.get("/projects/<int:project_id>/task")
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


@api_bp.put("/projects/<int:project_id>/task")
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

    now = _current_utc_now()
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


@api_bp.delete("/projects/<int:project_id>/task")
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


@api_bp.post("/projects/<int:project_id>/task/run")
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


@api_bp.get("/projects/<int:project_id>/task/runs")
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


@api_bp.get("/projects/<int:project_id>/tasks")
@auth_required
def list_project_tasks(project_id: int):
    project = Project.query.get(project_id)
    if project is None:
        return jsonify({"error": "Project not found"}), 404
    tasks = ScheduledTask.query.filter_by(project_id=project_id).order_by(ScheduledTask.created_at.asc()).all()
    return jsonify({"tasks": [_task_to_dict(task) for task in tasks]})


@api_bp.post("/projects/<int:project_id>/tasks/<int:task_id>/pause")
@auth_required
def pause_project_task(project_id: int, task_id: int):
    task = ScheduledTask.query.filter_by(project_id=project_id, id=task_id).first()
    if task is None:
        return jsonify({"error": "Scheduled task not found"}), 404
    task.enabled = False
    task.next_run_at = None
    task.last_status = "paused"
    db.session.commit()
    return jsonify({"task": _task_to_dict(task)})


@api_bp.post("/projects/<int:project_id>/tasks/<int:task_id>/resume")
@auth_required
def resume_project_task(project_id: int, task_id: int):
    task = ScheduledTask.query.filter_by(project_id=project_id, id=task_id).first()
    if task is None:
        return jsonify({"error": "Scheduled task not found"}), 404
    task.enabled = True
    task.next_run_at = calculate_next_run(task, _current_utc_now())
    task.last_status = "idle"
    db.session.commit()
    return jsonify({"task": _task_to_dict(task)})


@api_bp.post("/projects/<int:project_id>/tasks/preview")
@auth_required
def preview_project_task_schedule(project_id: int):
    if Project.query.get(project_id) is None:
        return jsonify({"error": "Project not found"}), 404
    body = request.get_json(silent=True) or {}
    task_type = str(body.get("taskType") or "interval").strip().lower()
    timezone_name = str(body.get("timezone") or "UTC").strip() or "UTC"
    try:
        if task_type == "cron":
            runs = next_cron_runs(str(body.get("cronExpression") or ""), timezone_name, _current_utc_now(), 5)
        elif task_type == "once":
            run_at = _parse_optional_datetime(body.get("onceRunAt"))
            runs = [run_at] if run_at else []
        else:
            interval = max(int(body.get("intervalMinutes") or 15), 1)
            cursor = _current_utc_now()
            runs = []
            for _ in range(5):
                cursor = cursor + timedelta(minutes=interval)
                runs.append(cursor)
    except Exception as exc:
        return jsonify({"error": str(exc)}), 400
    return jsonify({"runs": [run.isoformat() for run in runs if run is not None]})


@api_bp.get("/projects/<int:project_id>/prd")
@auth_required
def get_project_prd(project_id: int):
    project = Project.query.get(project_id)
    if project is None:
        return jsonify({"error": "Project not found"}), 404

    try:
        prd_path = _resolve_project_relative_path(project, "prd.json")
    except ValueError:
        return jsonify({"error": "Invalid project path"}), 400

    if not prd_path.exists():
        return jsonify({"prd": None})

    try:
        text = prd_path.read_text(encoding="utf-8")
    except OSError:
        return jsonify({"error": "Unable to read prd.json"}), 500

    try:
        prd_data = json.loads(text)
    except json.JSONDecodeError:
        return jsonify({"error": "prd.json contains invalid JSON"}), 500

    return jsonify({"prd": prd_data})


@api_bp.put("/projects/<int:project_id>/prd")
@auth_required
def upsert_project_prd(project_id: int):
    project = Project.query.get(project_id)
    if project is None:
        return jsonify({"error": "Project not found"}), 404

    body = request.get_json(silent=True) or {}
    prd_content = body.get("prd") if body.get("prd") is not None else _DEFAULT_PRD_TEMPLATE

    if not isinstance(prd_content, dict):
        return jsonify({"error": "prd must be a JSON object"}), 400

    try:
        prd_path = _resolve_project_relative_path(project, "prd.json")
    except ValueError:
        return jsonify({"error": "Invalid project path"}), 400

    try:
        prd_path.write_text(json.dumps(prd_content, indent=2), encoding="utf-8")
    except OSError:
        return jsonify({"error": "Unable to write prd.json"}), 500

    return jsonify({"prd": prd_content})
