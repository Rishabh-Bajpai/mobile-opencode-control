import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from git import Actor, Repo


BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app import create_app
from app.db import db
from app.git_routes import MAX_UNTRACKED_DIFF_BYTES
from app.models import Project


class GitDiffRouteTestCase(unittest.TestCase):
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
        response = self.client.post("/api/auth/login", json={"password": "test-password"})
        self.assertEqual(response.status_code, 200)

    def create_git_project(self) -> tuple[Project, Path]:
        repo_path = Path(self.temp_dir.name) / "repo"
        repo_path.mkdir(parents=True, exist_ok=True)
        repo = Repo.init(repo_path)
        (repo_path / "tracked.txt").write_text("base\n", encoding="utf-8")
        repo.index.add(["tracked.txt"])
        actor = Actor("Test User", "test@example.com")
        repo.index.commit("Initial commit", author=actor, committer=actor)

        project = Project(name="Git Project", path=str(repo_path))
        db.session.add(project)
        db.session.commit()
        return project, repo_path

    def test_git_diff_returns_patch_for_untracked_file(self):
        self.login()
        project, repo_path = self.create_git_project()
        (repo_path / "notes.txt").write_text("hello\nworld\n", encoding="utf-8")

        response = self.client.get(f"/api/projects/{project.id}/git/diff")

        self.assertEqual(response.status_code, 200)
        entries = response.get_json()["diff"]
        entry = next(item for item in entries if item["path"] == "notes.txt")
        self.assertEqual(entry["changeType"], "?")
        self.assertIn("--- /dev/null", entry["patch"])
        self.assertIn("+++ b/notes.txt", entry["patch"])
        self.assertIn("+hello", entry["patch"])
        self.assertIn("+world", entry["patch"])

    def test_git_diff_limits_large_untracked_file_preview(self):
        self.login()
        project, repo_path = self.create_git_project()
        (repo_path / "large.txt").write_text(
            "a" * (MAX_UNTRACKED_DIFF_BYTES + 1),
            encoding="utf-8",
        )

        response = self.client.get(f"/api/projects/{project.id}/git/diff")

        self.assertEqual(response.status_code, 200)
        entries = response.get_json()["diff"]
        entry = next(item for item in entries if item["path"] == "large.txt")
        self.assertEqual(entry["changeType"], "?")
        self.assertIn("File too large to preview", entry["patch"])
        self.assertIn(str(MAX_UNTRACKED_DIFF_BYTES), entry["patch"])


if __name__ == "__main__":
    unittest.main()
