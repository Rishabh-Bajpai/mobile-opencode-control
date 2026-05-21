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
from app.git_routes import _validate_git_remote_url
from app.models import Project
from app.routes.helpers import _resolve_project_relative_path, _validate_ntfy_topic_url


class ReviewFixesTestCase(unittest.TestCase):
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

    def create_git_project(self) -> tuple[Project, Repo]:
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
        return project, repo

    def test_git_pull_uses_repo_git_pull(self):
        self.login()
        project, _repo = self.create_git_project()
        branch_name = "feature/test"
        active_branch = mock.Mock()
        active_branch.name = branch_name
        active_branch.tracking_branch.return_value = None
        remote = mock.Mock()
        remote.name = "origin"
        repo = mock.Mock()
        repo.remotes = [remote]
        repo.head.is_valid.return_value = True
        repo.head.is_detached = False
        repo.active_branch = active_branch
        repo.git = mock.Mock()
        repo.git.pull = mock.Mock(return_value="Already up to date")

        with mock.patch("app.git_routes.get_repo", return_value=(repo, None, None)):
            response = self.client.post(
                f"/api/projects/{project.id}/git/pull",
                json={"remote": "origin"},
            )

        self.assertEqual(response.status_code, 200)
        repo.git.pull.assert_called_once_with("origin", branch_name)

    def test_git_remote_rejects_file_scheme(self):
        self.assertEqual(
            _validate_git_remote_url("https://github.com/example/mobile-opencode-control.git"),
            "https://github.com/example/mobile-opencode-control.git",
        )
        with self.assertRaisesRegex(ValueError, "file://"):
            _validate_git_remote_url("file:///tmp/repo.git")

    def test_notification_settings_reject_private_ntfy_topic_url(self):
        self.assertEqual(
            _validate_ntfy_topic_url("https://ntfy.sh/mobile-opencode-control"),
            "https://ntfy.sh/mobile-opencode-control",
        )
        with self.assertRaisesRegex(ValueError, "public host"):
            _validate_ntfy_topic_url("https://127.0.0.1/topic")
        with self.assertRaisesRegex(ValueError, "approved host"):
            _validate_ntfy_topic_url("https://example.com/topic")

    def test_resolve_project_relative_path_rejects_symlink_escape(self):
        project_root = Path(self.temp_dir.name) / "project"
        outside_root = Path(self.temp_dir.name) / "outside"
        project_root.mkdir()
        outside_root.mkdir()
        (outside_root / "secret.txt").write_text("secret", encoding="utf-8")
        (project_root / "linked").symlink_to(outside_root, target_is_directory=True)

        project = Project(name="Files", path=str(project_root))

        with self.assertRaisesRegex(ValueError, "symbolic link"):
            _resolve_project_relative_path(project, "linked/secret.txt")


if __name__ == "__main__":
    unittest.main()
