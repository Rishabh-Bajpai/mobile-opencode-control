import atexit
from pathlib import Path

from dotenv import load_dotenv
from flask import Flask
from flask_cors import CORS
from sqlalchemy import inspect, text

from .auth import register_auth_routes
from .config import load_settings
from .db import db
from .models import AppSetting, Project, ScheduledTask, ScheduledTaskRun, TimelineEvent
from .opencode import OpenCodeClient
from .routes import register_api_routes
from .scheduler import TaskScheduler
from .voice import BuiltinVoiceRuntime


def _table_has_unique_project_constraint(inspector) -> bool:
    for index in inspector.get_indexes("scheduled_tasks"):
        if index.get("unique") and index.get("column_names") == ["project_id"]:
            return True

    for constraint in inspector.get_unique_constraints("scheduled_tasks"):
        if constraint.get("column_names") == ["project_id"]:
            return True

    return False


def _copy_legacy_rows(connection, source_table: str, target_table: str, column_map: dict[str, str]) -> None:
    source_columns = ", ".join(column_map.values())
    target_columns = ", ".join(column_map.keys())
    connection.execute(
        text(
            f"INSERT INTO {target_table} ({target_columns}) "
            f"SELECT {source_columns} FROM {source_table}"
        )
    )


def _migrate_legacy_scheduler_schema(app: Flask) -> None:
    inspector = inspect(db.engine)
    dialect = db.engine.dialect.name
    if dialect != "sqlite":
        raise RuntimeError(
            "Legacy scheduled task schema detected, but only SQLite migration is supported. "
            "Back up the database and migrate it before starting the app."
        )

    table_names = set(inspector.get_table_names())
    has_legacy_runs = "scheduled_task_runs" in table_names

    with db.engine.begin() as connection:
        connection.execute(text("ALTER TABLE scheduled_tasks RENAME TO scheduled_tasks_legacy"))
        if has_legacy_runs:
            connection.execute(
                text("ALTER TABLE scheduled_task_runs RENAME TO scheduled_task_runs_legacy")
            )

    db.create_all()

    legacy_task_columns = {
        column["name"]
        for column in inspect(db.engine).get_columns("scheduled_tasks_legacy")
    }
    task_column_map = {
        "id": "id",
        "project_id": "project_id",
        "name": "'Scheduled task'" if "name" not in legacy_task_columns else "name",
        "description": "description" if "description" in legacy_task_columns else "NULL",
        "instruction": "instruction",
        "task_type": "task_type" if "task_type" in legacy_task_columns else "'interval'",
        "cron_expression": (
            "cron_expression" if "cron_expression" in legacy_task_columns else "NULL"
        ),
        "once_run_at": "once_run_at" if "once_run_at" in legacy_task_columns else "NULL",
        "interval_minutes": (
            "interval_minutes" if "interval_minutes" in legacy_task_columns else "15"
        ),
        "timezone": "timezone" if "timezone" in legacy_task_columns else "'UTC'",
        "model": "model" if "model" in legacy_task_columns else "NULL",
        "agent": "agent" if "agent" in legacy_task_columns else "NULL",
        "enabled": "enabled" if "enabled" in legacy_task_columns else "1",
        "starts_at": "starts_at" if "starts_at" in legacy_task_columns else "NULL",
        "ends_at": "ends_at" if "ends_at" in legacy_task_columns else "NULL",
        "max_runs": "max_runs" if "max_runs" in legacy_task_columns else "NULL",
        "run_timeout_minutes": (
            "run_timeout_minutes"
            if "run_timeout_minutes" in legacy_task_columns
            else "NULL"
        ),
        "heartbeat_enabled": (
            "heartbeat_enabled" if "heartbeat_enabled" in legacy_task_columns else "1"
        ),
        "goal_definition": (
            "goal_definition" if "goal_definition" in legacy_task_columns else "NULL"
        ),
        "auto_disable_on_goal_met": (
            "auto_disable_on_goal_met"
            if "auto_disable_on_goal_met" in legacy_task_columns
            else "1"
        ),
        "retry_count": "retry_count" if "retry_count" in legacy_task_columns else "0",
        "retry_backoff_minutes": (
            "retry_backoff_minutes"
            if "retry_backoff_minutes" in legacy_task_columns
            else "5"
        ),
        "notification_url": (
            "notification_url" if "notification_url" in legacy_task_columns else "NULL"
        ),
        "persistent_session_id": (
            "persistent_session_id"
            if "persistent_session_id" in legacy_task_columns
            else "NULL"
        ),
        "total_runs": "total_runs" if "total_runs" in legacy_task_columns else "0",
        "next_run_at": "next_run_at" if "next_run_at" in legacy_task_columns else "NULL",
        "last_run_at": "last_run_at" if "last_run_at" in legacy_task_columns else "NULL",
        "last_status": "last_status" if "last_status" in legacy_task_columns else "'idle'",
        "last_error": "last_error" if "last_error" in legacy_task_columns else "NULL",
        "created_at": "created_at" if "created_at" in legacy_task_columns else "CURRENT_TIMESTAMP",
        "updated_at": "updated_at" if "updated_at" in legacy_task_columns else "CURRENT_TIMESTAMP",
    }

    with db.engine.begin() as connection:
        _copy_legacy_rows(
            connection,
            source_table="scheduled_tasks_legacy",
            target_table="scheduled_tasks",
            column_map=task_column_map,
        )

        if has_legacy_runs:
            legacy_run_columns = {
                column["name"]
                for column in inspect(db.engine).get_columns("scheduled_task_runs_legacy")
            }
            run_column_map = {
                "id": "id",
                "task_id": "task_id",
                "project_id": "project_id",
                "status": "status" if "status" in legacy_run_columns else "'running'",
                "session_id": "session_id" if "session_id" in legacy_run_columns else "NULL",
                "trigger": "trigger" if "trigger" in legacy_run_columns else "'schedule'",
                "started_at": (
                    "started_at" if "started_at" in legacy_run_columns else "CURRENT_TIMESTAMP"
                ),
                "finished_at": (
                    "finished_at" if "finished_at" in legacy_run_columns else "NULL"
                ),
                "heartbeat_loaded": (
                    "heartbeat_loaded" if "heartbeat_loaded" in legacy_run_columns else "0"
                ),
                "run_number": "run_number" if "run_number" in legacy_run_columns else "1",
                "model_used": "model_used" if "model_used" in legacy_run_columns else "NULL",
                "agent_used": "agent_used" if "agent_used" in legacy_run_columns else "NULL",
                "timeout_used": "timeout_used" if "timeout_used" in legacy_run_columns else "NULL",
                "goal_attempted": (
                    "goal_attempted" if "goal_attempted" in legacy_run_columns else "0"
                ),
                "goal_met": "goal_met" if "goal_met" in legacy_run_columns else "NULL",
                "goal_output": "goal_output" if "goal_output" in legacy_run_columns else "NULL",
                "retry_attempt": (
                    "retry_attempt" if "retry_attempt" in legacy_run_columns else "0"
                ),
                "output_preview": (
                    "output_preview" if "output_preview" in legacy_run_columns else "NULL"
                ),
                "error": "error" if "error" in legacy_run_columns else "NULL",
            }
            _copy_legacy_rows(
                connection,
                source_table="scheduled_task_runs_legacy",
                target_table="scheduled_task_runs",
                column_map=run_column_map,
            )

    with db.engine.begin() as connection:
        connection.execute(text("DROP TABLE IF EXISTS scheduled_task_runs_legacy"))
        connection.execute(text("DROP TABLE IF EXISTS scheduled_tasks_legacy"))


def _ensure_scheduler_schema(app: Flask) -> None:
    inspector = inspect(db.engine)
    table_names = set(inspector.get_table_names())
    if "scheduled_tasks" not in table_names:
        db.create_all()
        return

    columns = {column["name"] for column in inspector.get_columns("scheduled_tasks")}
    needs_rebuild = "name" not in columns
    needs_rebuild = needs_rebuild or _table_has_unique_project_constraint(inspector)
    if not needs_rebuild:
        return

    _migrate_legacy_scheduler_schema(app)


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
        _ensure_scheduler_schema(app)
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
        max_concurrent_runs=settings.task_max_concurrent_runs,
        notification_url=settings.task_notification_url,
    )
    scheduler.start()

    atexit.register(scheduler.stop)

    register_auth_routes(app, settings)
    voice_runtime = BuiltinVoiceRuntime(settings)
    register_api_routes(app, settings, opencode_client, scheduler, voice_runtime)

    return app
