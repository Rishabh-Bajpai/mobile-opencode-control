import atexit
from pathlib import Path

from dotenv import load_dotenv
from flask import Flask
from flask_cors import CORS

from .auth import register_auth_routes
from .config import load_settings
from .db import db
from .models import AppSetting, Project, ScheduledTask, ScheduledTaskRun, TimelineEvent
from .opencode import OpenCodeClient
from .routes import register_api_routes
from .scheduler import TaskScheduler
from .voice import BuiltinVoiceRuntime


def create_app() -> Flask:
    load_dotenv()
    settings = load_settings()

    app = Flask(__name__)
    root_dir = Path(__file__).resolve().parents[2]

    database_uri = settings.database_url
    if database_uri.startswith("sqlite:///") and not database_uri.startswith(
        "sqlite:////"
    ):
        sqlite_rel_path = database_uri.replace("sqlite:///", "", 1)
        sqlite_abs_path = (root_dir / sqlite_rel_path).resolve()
        sqlite_abs_path.parent.mkdir(parents=True, exist_ok=True)
        database_uri = f"sqlite:///{sqlite_abs_path}"

    app.config["SECRET_KEY"] = settings.secret_key
    app.config["SQLALCHEMY_DATABASE_URI"] = database_uri
    app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
    app.config["SESSION_COOKIE_HTTPONLY"] = True
    app.config["SESSION_COOKIE_SAMESITE"] = "Lax"
    app.config["SESSION_COOKIE_SECURE"] = settings.app_env == "production"

    if settings.cors_enabled:
        CORS(app, supports_credentials=True, origins=list(settings.frontend_origins))

    db.init_app(app)

    @app.teardown_appcontext
    def shutdown_session(exception=None):
        db.session.remove()

    with app.app_context():
        backend_data_dir = root_dir / "backend" / "data"
        backend_data_dir.mkdir(parents=True, exist_ok=True)
        db.create_all()
        _ = Project
        _ = AppSetting
        _ = ScheduledTask
        _ = ScheduledTaskRun
        _ = TimelineEvent

    opencode_client = OpenCodeClient(
        base_url=settings.opencode_base_url,
        username=settings.opencode_username,
        password=settings.opencode_password,
    )

    scheduler = TaskScheduler(
        app=app,
        opencode_client=opencode_client,
        poll_interval_seconds=settings.scheduler_poll_interval_seconds,
        task_run_retention_days=settings.task_run_retention_days,
    )
    scheduler.start()

    atexit.register(scheduler.stop)

    register_auth_routes(app, settings)
    voice_runtime = BuiltinVoiceRuntime(settings)
    register_api_routes(app, settings, opencode_client, scheduler, voice_runtime)

    return app
