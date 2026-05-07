import os
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest import mock


BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

import app.routes as routes_module
from app import create_app
from app.db import db
from app.models import Project, ScheduledTask
from app.scheduler import next_cron_runs


class TaskSchedulerTestCase(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.database_path = Path(self.temp_dir.name) / "test.db"
        env = {
            "APP_ENV": "test",
            "APP_PASSWORD": "test-password",
            "APP_SECRET_KEY": "test-secret",
            "DATABASE_URL": f"sqlite:///{self.database_path}",
            "VOICE_PROVIDER_MODE": "external",
        }
        self.env_patch = mock.patch.dict(os.environ, env, clear=False)
        self.scheduler_start_patch = mock.patch("app.TaskScheduler.start", return_value=None)
        self.atexit_patch = mock.patch("app.atexit.register", return_value=None)
        self.env_patch.start()
        self.scheduler_start_patch.start()
        self.atexit_patch.start()
        self.app = create_app()
        self.app.config.update(TESTING=True)
        self.client = self.app.test_client()
        self.app_context = self.app.app_context()
        self.app_context.push()

    def tearDown(self):
        db.session.remove()
        self.app_context.pop()
        self.atexit_patch.stop()
        self.scheduler_start_patch.stop()
        self.env_patch.stop()
        self.temp_dir.cleanup()

    def login(self):
        response = self.client.post(
            "/api/auth/login",
            json={"password": "test-password"},
        )
        self.assertEqual(response.status_code, 200)

    def create_project(self) -> Project:
        project = Project(name="Test Project", path=self.temp_dir.name)
        db.session.add(project)
        db.session.commit()
        return project

    def parse_response_datetime(self, value: str) -> datetime:
        parsed = datetime.fromisoformat(value)
        if parsed.tzinfo is None:
            return parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc)

    def test_next_cron_runs_uses_standard_day_or_semantics(self):
        start = datetime(2026, 4, 13, 8, 0, tzinfo=timezone.utc)

        runs = next_cron_runs("0 9 15 * 1", "UTC", start, 1)

        self.assertEqual(runs[0], datetime(2026, 4, 13, 9, 0, tzinfo=timezone.utc))

    def test_save_task_rejects_start_after_end(self):
        self.login()
        project = self.create_project()

        response = self.client.put(
            f"/api/projects/{project.id}/task",
            json={
                "name": "Invalid window",
                "instruction": "Run checks",
                "taskType": "interval",
                "intervalMinutes": 15,
                "enabled": True,
                "startsAt": "2026-05-02T12:00:00Z",
                "endsAt": "2026-05-01T12:00:00Z",
            },
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.get_json()["error"], "startsAt must be before endsAt")

    def test_save_once_task_rejects_run_after_end(self):
        self.login()
        project = self.create_project()

        response = self.client.put(
            f"/api/projects/{project.id}/task",
            json={
                "name": "Invalid once task",
                "instruction": "Run once",
                "taskType": "once",
                "intervalMinutes": 15,
                "enabled": True,
                "onceRunAt": "2026-05-03T12:00:00Z",
                "endsAt": "2026-05-02T12:00:00Z",
            },
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.get_json()["error"], "onceRunAt must be on or before endsAt")

    def test_resume_task_recomputes_next_run_from_resume_time(self):
        self.login()
        project = self.create_project()

        save_response = self.client.put(
            f"/api/projects/{project.id}/task",
            json={
                "name": "Recurring task",
                "instruction": "Run checks",
                "taskType": "interval",
                "intervalMinutes": 15,
                "enabled": True,
            },
        )
        self.assertEqual(save_response.status_code, 200)
        task_id = int(save_response.get_json()["task"]["id"])

        pause_response = self.client.post(f"/api/projects/{project.id}/tasks/{task_id}/pause")
        self.assertEqual(pause_response.status_code, 200)
        paused_task = db.session.get(ScheduledTask, task_id)
        self.assertIsNotNone(paused_task)
        self.assertFalse(paused_task.enabled)
        self.assertIsNone(paused_task.next_run_at)

        fixed_now = datetime(2026, 5, 1, 10, 0, tzinfo=timezone.utc)
        with mock.patch.object(routes_module, "_utc_now", return_value=fixed_now):
            resume_response = self.client.post(f"/api/projects/{project.id}/tasks/{task_id}/resume")

        self.assertEqual(resume_response.status_code, 200)
        resumed_next_run = self.parse_response_datetime(resume_response.get_json()["task"]["nextRunAt"])
        self.assertEqual(resumed_next_run, fixed_now + timedelta(minutes=15))


if __name__ == "__main__":
    unittest.main()
