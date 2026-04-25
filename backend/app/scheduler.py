from __future__ import annotations

import json
import re
import threading
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import requests

from .db import db
from .models import Project, ScheduledTask, ScheduledTaskRun, TimelineEvent


TASK_TYPES = {"interval", "cron", "once", "goal"}


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _ensure_utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _task_timezone(task: ScheduledTask) -> ZoneInfo:
    try:
        return ZoneInfo(task.timezone or "UTC")
    except ZoneInfoNotFoundError:
        return ZoneInfo("UTC")


def _create_timeline_event(project_id: int, event_type: str, payload: dict) -> TimelineEvent:
    event = TimelineEvent(
        project_id=project_id,
        event_type=event_type,
        payload_json=json.dumps(payload, ensure_ascii=True),
        created_at=_utc_now(),
    )
    db.session.add(event)
    return event


def _parse_cron_field(value: str, minimum: int, maximum: int) -> set[int]:
    allowed: set[int] = set()
    for raw_part in value.split(","):
        part = raw_part.strip()
        if not part:
            raise ValueError("Empty cron field")

        step = 1
        if "/" in part:
            part, raw_step = part.split("/", 1)
            step = int(raw_step)
            if step <= 0:
                raise ValueError("Cron step must be positive")

        if part == "*":
            start, end = minimum, maximum
        elif "-" in part:
            raw_start, raw_end = part.split("-", 1)
            start, end = int(raw_start), int(raw_end)
        else:
            start = end = int(part)

        if start < minimum or end > maximum or start > end:
            raise ValueError("Cron field value out of range")
        allowed.update(range(start, end + 1, step))

    return allowed


def parse_cron_expression(expression: str) -> tuple[set[int], set[int], set[int], set[int], set[int]]:
    fields = expression.split()
    if len(fields) != 5:
        raise ValueError("Cron expression must have 5 fields")
    minute = _parse_cron_field(fields[0], 0, 59)
    hour = _parse_cron_field(fields[1], 0, 23)
    day = _parse_cron_field(fields[2], 1, 31)
    month = _parse_cron_field(fields[3], 1, 12)
    weekday = _parse_cron_field(fields[4], 0, 7)
    if 7 in weekday:
        weekday.add(0)
        weekday.discard(7)
    return minute, hour, day, month, weekday


def next_cron_runs(
    expression: str,
    timezone_name: str = "UTC",
    start: datetime | None = None,
    count: int = 5,
) -> list[datetime]:
    minute, hour, day, month, weekday = parse_cron_expression(expression)
    tz = ZoneInfo(timezone_name or "UTC")
    cursor = (start or _utc_now()).astimezone(tz).replace(second=0, microsecond=0) + timedelta(minutes=1)
    runs: list[datetime] = []
    max_checks = 366 * 24 * 60
    for _ in range(max_checks):
        cron_weekday = (cursor.weekday() + 1) % 7
        if (
            cursor.minute in minute
            and cursor.hour in hour
            and cursor.day in day
            and cursor.month in month
            and cron_weekday in weekday
        ):
            runs.append(cursor.astimezone(timezone.utc))
            if len(runs) >= count:
                return runs
        cursor += timedelta(minutes=1)
    raise ValueError("Cron expression did not produce a run time within one year")


def calculate_next_run(task: ScheduledTask, now: datetime | None = None) -> datetime | None:
    current = now or _utc_now()
    starts_at = _ensure_utc(task.starts_at)
    if starts_at and current < starts_at:
        current = starts_at

    ends_at = _ensure_utc(task.ends_at)
    if ends_at and current > ends_at:
        return None

    if task.max_runs is not None and task.max_runs > 0 and task.total_runs >= task.max_runs:
        return None

    if task.task_type == "once":
        once_run_at = _ensure_utc(task.once_run_at)
        if once_run_at and task.total_runs == 0 and (not ends_at or once_run_at <= ends_at):
            return max(once_run_at, starts_at or once_run_at)
        return None

    if task.task_type == "cron":
        if not task.cron_expression:
            return None
        next_run = next_cron_runs(task.cron_expression, task.timezone or "UTC", current, 1)[0]
        return next_run if not ends_at or next_run <= ends_at else None

    interval = max(int(task.interval_minutes or 15), 1)
    return current + timedelta(minutes=interval)


def _extract_text(response: dict) -> str:
    parts = response.get("parts") if isinstance(response, dict) else []
    chunks: list[str] = []
    if isinstance(parts, list):
        for part in parts:
            if isinstance(part, dict) and part.get("type") == "text":
                text_value = part.get("text")
                if isinstance(text_value, str):
                    chunks.append(text_value)
    return "\n".join(chunks).strip()


def _goal_met_from_text(text: str) -> bool | None:
    match = re.search(r"GOAL_MET\s*:\s*(yes|no|true|false)", text, re.IGNORECASE)
    if not match:
        return None
    return match.group(1).lower() in {"yes", "true"}


class TaskScheduler:
    def __init__(
        self,
        app,
        opencode_client,
        poll_interval_seconds: int = 20,
        task_run_retention_days: int = 30,
        max_concurrent_runs: int = 2,
        notification_url: str = "",
    ):
        self._app = app
        self._opencode_client = opencode_client
        self._poll_interval_seconds = max(5, poll_interval_seconds)
        self._task_run_retention_days = max(1, task_run_retention_days)
        self._max_concurrent_runs = max(1, max_concurrent_runs)
        self._notification_url = notification_url.strip()
        self._thread: threading.Thread | None = None
        self._stop_event = threading.Event()
        self._last_prune_at: datetime | None = None
        self._last_pruned_count = 0
        self._last_loop_at: datetime | None = None
        self._last_loop_error: str | None = None
        self._active_runs = 0
        self._status_lock = threading.Lock()
        self._dispatch_lock = threading.Lock()

    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._stop_event.clear()
        self._recover_interrupted_runs()
        self._thread = threading.Thread(target=self._loop, name="task-scheduler", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop_event.set()
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=3)

    def trigger_task_now(self, task_id: int) -> int:
        with self._app.app_context():
            task = ScheduledTask.query.get(task_id)
            if task is None:
                raise ValueError("Scheduled task not found")
            run = self._create_run(task, trigger="manual", status="queued")
            db.session.commit()
            run_id = run.id
        self._dispatch_queued_runs()
        return run_id

    def get_status(self) -> dict:
        with self._status_lock:
            return {
                "running": bool(self._thread and self._thread.is_alive()),
                "pollIntervalSeconds": self._poll_interval_seconds,
                "taskRunRetentionDays": self._task_run_retention_days,
                "maxConcurrentRuns": self._max_concurrent_runs,
                "activeRuns": self._active_runs,
                "lastLoopAt": self._last_loop_at.isoformat() if self._last_loop_at else None,
                "lastLoopError": self._last_loop_error,
                "lastPruneAt": self._last_prune_at.isoformat() if self._last_prune_at else None,
                "lastPrunedCount": self._last_pruned_count,
            }

    def _loop(self) -> None:
        while not self._stop_event.is_set():
            try:
                self._enqueue_due_tasks_once()
                self._dispatch_queued_runs()
                self._prune_old_task_runs_if_due()
                with self._status_lock:
                    self._last_loop_at = _utc_now()
                    self._last_loop_error = None
            except Exception as exc:
                with self._status_lock:
                    self._last_loop_at = _utc_now()
                    self._last_loop_error = str(exc)[:240]
            self._stop_event.wait(self._poll_interval_seconds)

    def _create_run(
        self,
        task: ScheduledTask,
        trigger: str,
        *,
        status: str = "queued",
    ) -> ScheduledTaskRun:
        next_run_number = int(task.total_runs or 0) + 1
        run = ScheduledTaskRun(
            task_id=task.id,
            project_id=task.project_id,
            status=status,
            trigger=trigger,
            started_at=_utc_now(),
            run_number=next_run_number,
            model_used=task.model,
            agent_used=task.agent,
            timeout_used=task.run_timeout_minutes,
            retry_attempt=0,
        )
        task.last_status = status
        task.last_error = None
        db.session.add(run)
        db.session.flush()
        return run

    def _get_incomplete_run(self, task_id: int) -> ScheduledTaskRun | None:
        return (
            ScheduledTaskRun.query.filter(
                ScheduledTaskRun.task_id == task_id,
                ScheduledTaskRun.status.in_(("queued", "running")),
            )
            .order_by(ScheduledTaskRun.id.desc())
            .first()
        )

    def _enqueue_due_tasks_once(self) -> None:
        with self._app.app_context():
            now = _utc_now()
            due_tasks = (
                ScheduledTask.query.filter(
                    ScheduledTask.enabled.is_(True),
                    ScheduledTask.next_run_at.isnot(None),
                    ScheduledTask.next_run_at <= now,
                )
                .order_by(ScheduledTask.next_run_at.asc())
                .limit(self._max_concurrent_runs)
                .all()
            )
            for task in due_tasks:
                if not self._task_can_run(task, now):
                    task.next_run_at = calculate_next_run(task, now)
                    if task.next_run_at is None:
                        task.enabled = False
                        task.last_status = "disabled"
                    continue
                run = self._get_incomplete_run(task.id)
                if run is None:
                    run = self._create_run(task, trigger="schedule", status="queued")
                task.next_run_at = calculate_next_run(task, now)
            db.session.commit()

    def _start_run_worker(self, task_id: int, run_id: int) -> None:
        worker = threading.Thread(
            target=self._execute_run_worker,
            args=(task_id, run_id),
            name=f"task-run-{run_id}",
            daemon=True,
        )
        worker.start()

    def _select_ready_queued_run(self) -> tuple[ScheduledTask | None, ScheduledTaskRun | None]:
        now = _utc_now()
        queued_runs = (
            ScheduledTaskRun.query.filter_by(status="queued")
            .order_by(
                ScheduledTaskRun.started_at.asc(),
                ScheduledTaskRun.id.asc(),
            )
            .all()
        )
        for run in queued_runs:
            task = ScheduledTask.query.get(run.task_id)
            if task is None:
                return None, run
            if run.retry_attempt and task.next_run_at and task.next_run_at > now:
                continue
            return task, run
        return None, None

    def _dispatch_queued_runs(self) -> None:
        workers_to_start: list[tuple[int, int]] = []

        with self._dispatch_lock:
            with self._app.app_context():
                while True:
                    with self._status_lock:
                        if self._active_runs >= self._max_concurrent_runs:
                            break
                        self._active_runs += 1

                    task, run = self._select_ready_queued_run()
                    if run is None:
                        with self._status_lock:
                            self._active_runs = max(0, self._active_runs - 1)
                        break

                    if task is None:
                        run.status = "failed"
                        run.finished_at = _utc_now()
                        run.error = "Scheduled task not found"
                        db.session.commit()
                        with self._status_lock:
                            self._active_runs = max(0, self._active_runs - 1)
                        continue

                    run.status = "running"
                    run.started_at = _utc_now()
                    task.last_status = "running"
                    task.last_error = None
                    db.session.commit()
                    workers_to_start.append((task.id, run.id))

        for task_id, run_id in workers_to_start:
            self._start_run_worker(task_id=task_id, run_id=run_id)

    def _task_can_run(self, task: ScheduledTask, now: datetime) -> bool:
        starts_at = _ensure_utc(task.starts_at)
        ends_at = _ensure_utc(task.ends_at)
        if starts_at and now < starts_at:
            return False
        if ends_at and now > ends_at:
            return False
        if task.max_runs is not None and task.max_runs > 0 and task.total_runs >= task.max_runs:
            return False
        return True

    def _execute_run_worker(self, task_id: int, run_id: int) -> None:
        try:
            self._execute_run_inner(task_id, run_id)
        finally:
            with self._status_lock:
                self._active_runs = max(0, self._active_runs - 1)
            self._dispatch_queued_runs()

    def _execute_run_inner(self, task_id: int, run_id: int) -> None:
        with self._app.app_context():
            task = ScheduledTask.query.get(task_id)
            run = ScheduledTaskRun.query.get(run_id)
            if task is None or run is None:
                return
            project = Project.query.get(task.project_id)
            if project is None:
                self._finish_run(task, run, "failed", error="Project not found")
                db.session.commit()
                return
            task_type = task.task_type
            persistent_session_id = task.persistent_session_id
            heartbeat_enabled = bool(task.heartbeat_enabled)
            instruction = task.instruction
            goal_definition = task.goal_definition
            task_model = task.model
            task_agent = task.agent
            task_name = task.name or "scheduled task"
            project_name = project.name
            project_path = project.path
            task.last_run_at = _utc_now()
            db.session.commit()

        task_session_id = persistent_session_id if task_type == "goal" else None
        heartbeat_loaded = False
        try:
            if not task_session_id:
                session = self._opencode_client.create_session(
                    directory=project_path,
                    title=f"{project_name} task: {task_name}",
                )
                task_session_id = str(session.get("id") or "")
                if not task_session_id:
                    raise ValueError("Could not create task session")

            if heartbeat_enabled:
                heartbeat_path = Path(project_path) / "heartbeat_instruction.md"
                if heartbeat_path.exists():
                    heartbeat_text = heartbeat_path.read_text(encoding="utf-8").strip()
                    if heartbeat_text:
                        self._opencode_client.send_message(
                            session_id=task_session_id,
                            directory=project_path,
                            text="Read and apply this heartbeat instruction before continuing:\n\n" + heartbeat_text,
                            model=task_model,
                            agent=task_agent,
                        )
                        heartbeat_loaded = True

            prompt = instruction
            if task_type == "goal" and goal_definition:
                prompt = (
                    f"Goal: {goal_definition}\n\n"
                    f"Run instruction: {instruction}\n\n"
                    "At the end of your response, include a final line exactly like `GOAL_MET: yes` "
                    "or `GOAL_MET: no` based on whether the goal is complete."
                )

            response = self._opencode_client.send_message(
                session_id=task_session_id,
                directory=project_path,
                text=prompt,
                model=task_model,
                agent=task_agent,
            )
            output = _extract_text(response)
            goal_met = _goal_met_from_text(output) if task_type == "goal" else None

            with self._app.app_context():
                task = ScheduledTask.query.get(task_id)
                run = ScheduledTaskRun.query.get(run_id)
                if task is None or run is None:
                    return
                if task.task_type == "goal" and task_session_id:
                    task.persistent_session_id = task_session_id
                run.goal_attempted = task.task_type == "goal"
                run.goal_met = goal_met
                run.goal_output = output[:4000] if task.task_type == "goal" else None
                run.session_id = task_session_id
                run.heartbeat_loaded = heartbeat_loaded
                run.output_preview = output[:4000]
                status = "completed"
                if task.task_type == "goal" and goal_met and task.auto_disable_on_goal_met:
                    task.enabled = False
                    task.next_run_at = None
                    task.last_status = "goal_met"
                    status = "goal_met"
                elif task.task_type == "once":
                    task.enabled = False
                    task.next_run_at = None
                self._finish_run(task, run, status)
                db.session.commit()
                self._notify(task, run, project_name)
        except Exception as exc:
            with self._app.app_context():
                task = ScheduledTask.query.get(task_id)
                run = ScheduledTaskRun.query.get(run_id)
                if task is None or run is None:
                    return
                run.session_id = task_session_id
                run.error = str(exc)
                if task.retry_count > run.retry_attempt:
                    run.retry_attempt = int(run.retry_attempt or 0) + 1
                    run.status = "queued"
                    run.finished_at = None
                    task.last_status = "retrying"
                    task.last_error = str(exc)
                    task.next_run_at = _utc_now() + timedelta(
                        minutes=max(1, task.retry_backoff_minutes) * run.retry_attempt
                    )
                else:
                    self._finish_run(task, run, "failed", error=str(exc))
                db.session.commit()
                self._notify(task, run, project_name)
        finally:
            if task_session_id and task_type != "goal":
                try:
                    self._opencode_client.delete_session(task_session_id)
                except Exception:
                    pass

    def _finish_run(self, task: ScheduledTask, run: ScheduledTaskRun, status: str, error: str | None = None) -> None:
        run.status = status
        run.finished_at = _utc_now()
        if error:
            run.error = error
        task.total_runs = int(task.total_runs or 0) + 1
        task.last_status = status
        task.last_error = error
        if task.enabled and task.next_run_at is None and task.task_type not in {"once"}:
            task.next_run_at = calculate_next_run(task, _utc_now())
        _create_timeline_event(
            project_id=task.project_id,
            event_type="scheduled_task_run",
            payload={
                "taskRunId": run.id,
                "taskId": task.id,
                "taskName": task.name,
                "runNumber": run.run_number,
                "status": run.status,
                "trigger": run.trigger,
                "sessionId": run.session_id,
                "heartbeatLoaded": bool(run.heartbeat_loaded),
                "goalAttempted": bool(run.goal_attempted),
                "goalMet": run.goal_met,
                "startedAt": run.started_at.isoformat() if run.started_at else None,
                "finishedAt": run.finished_at.isoformat() if run.finished_at else None,
                "error": run.error,
                "outputPreview": run.output_preview,
            },
        )

    def _notify(self, task: ScheduledTask, run: ScheduledTaskRun, project_name: str) -> None:
        target_url = (task.notification_url or self._notification_url).strip()
        if not target_url or run.status in {"running", "queued"}:
            return
        try:
            message = f"OpenCode task '{task.name}' for {project_name}: {run.status}"
            if run.error:
                message += f"\n{run.error[:500]}"
            requests.post(target_url, data=message.encode("utf-8"), timeout=8)
        except Exception:
            pass

    def _recover_interrupted_runs(self) -> None:
        with self._app.app_context():
            interrupted = ScheduledTaskRun.query.filter_by(status="running").all()
            now = _utc_now()
            for run in interrupted:
                task = ScheduledTask.query.get(run.task_id)
                if task is None:
                    continue
                run.status = "interrupted"
                run.finished_at = now
                run.error = "Scheduler restart detected before task run finished"
                task.last_status = "interrupted"
                task.last_error = run.error
                task.next_run_at = calculate_next_run(task, now)
                _create_timeline_event(
                    project_id=run.project_id,
                    event_type="scheduled_task_run",
                    payload={"taskRunId": run.id, "taskId": task.id, "status": "interrupted", "error": run.error},
                )
            db.session.commit()

    def _prune_old_task_runs_if_due(self) -> None:
        now = _utc_now()
        if self._last_prune_at is not None:
            last = _ensure_utc(self._last_prune_at) or now
            if (now - last) < timedelta(hours=1):
                return
        cutoff = now - timedelta(days=self._task_run_retention_days)
        with self._app.app_context():
            deleted_count = ScheduledTaskRun.query.filter(
                ScheduledTaskRun.finished_at.isnot(None),
                ScheduledTaskRun.finished_at < cutoff,
            ).delete(synchronize_session=False)
            db.session.commit()
        with self._status_lock:
            self._last_prune_at = now
            self._last_pruned_count = int(deleted_count or 0)
