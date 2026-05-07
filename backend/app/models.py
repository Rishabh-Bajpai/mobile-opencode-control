from datetime import datetime, timezone

from .db import db


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


class Project(db.Model):
    __tablename__ = "projects"

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(180), nullable=False)
    path = db.Column(db.String(1024), nullable=False, unique=True)
    last_session_id = db.Column(db.String(128), nullable=True)
    last_message_preview = db.Column(db.String(500), nullable=True)
    session_status = db.Column(db.String(32), nullable=False, default="idle")
    has_scheduled_task = db.Column(db.Boolean, nullable=False, default=False)
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, default=_utc_now)
    updated_at = db.Column(
        db.DateTime(timezone=True), nullable=False, default=_utc_now, onupdate=_utc_now
    )
    last_activity_at = db.Column(
        db.DateTime(timezone=True), nullable=False, default=_utc_now
    )


class AppSetting(db.Model):
    __tablename__ = "app_settings"

    key = db.Column(db.String(120), primary_key=True)
    value = db.Column(db.Text, nullable=False)
    updated_at = db.Column(
        db.DateTime(timezone=True), nullable=False, default=_utc_now, onupdate=_utc_now
    )


class ScheduledTask(db.Model):
    __tablename__ = "scheduled_tasks"

    id = db.Column(db.Integer, primary_key=True)
    project_id = db.Column(
        db.Integer,
        db.ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
    )
    name = db.Column(db.String(180), nullable=False, default="Scheduled task")
    description = db.Column(db.Text, nullable=True)
    instruction = db.Column(db.Text, nullable=False)
    task_type = db.Column(db.String(24), nullable=False, default="interval")
    cron_expression = db.Column(db.String(120), nullable=True)
    once_run_at = db.Column(db.DateTime(timezone=True), nullable=True)
    interval_minutes = db.Column(db.Integer, nullable=False, default=15)
    timezone = db.Column(db.String(80), nullable=False, default="UTC")
    model = db.Column(db.String(240), nullable=True)
    agent = db.Column(db.String(120), nullable=True)
    enabled = db.Column(db.Boolean, nullable=False, default=True)
    starts_at = db.Column(db.DateTime(timezone=True), nullable=True)
    ends_at = db.Column(db.DateTime(timezone=True), nullable=True)
    max_runs = db.Column(db.Integer, nullable=True)
    run_timeout_minutes = db.Column(db.Integer, nullable=True)
    heartbeat_enabled = db.Column(db.Boolean, nullable=False, default=True)
    goal_definition = db.Column(db.Text, nullable=True)
    auto_disable_on_goal_met = db.Column(db.Boolean, nullable=False, default=True)
    retry_count = db.Column(db.Integer, nullable=False, default=0)
    retry_backoff_minutes = db.Column(db.Integer, nullable=False, default=5)
    notification_url = db.Column(db.String(1024), nullable=True)
    persistent_session_id = db.Column(db.String(128), nullable=True)
    total_runs = db.Column(db.Integer, nullable=False, default=0)
    next_run_at = db.Column(db.DateTime(timezone=True), nullable=True)
    last_run_at = db.Column(db.DateTime(timezone=True), nullable=True)
    last_status = db.Column(db.String(32), nullable=False, default="idle")
    last_error = db.Column(db.Text, nullable=True)
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, default=_utc_now)
    updated_at = db.Column(
        db.DateTime(timezone=True), nullable=False, default=_utc_now, onupdate=_utc_now
    )


class ScheduledTaskRun(db.Model):
    __tablename__ = "scheduled_task_runs"

    id = db.Column(db.Integer, primary_key=True)
    task_id = db.Column(
        db.Integer,
        db.ForeignKey("scheduled_tasks.id", ondelete="CASCADE"),
        nullable=False,
    )
    project_id = db.Column(
        db.Integer,
        db.ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
    )
    status = db.Column(db.String(32), nullable=False, default="running")
    session_id = db.Column(db.String(128), nullable=True)
    trigger = db.Column(db.String(24), nullable=False, default="schedule")
    started_at = db.Column(db.DateTime(timezone=True), nullable=False, default=_utc_now)
    finished_at = db.Column(db.DateTime(timezone=True), nullable=True)
    heartbeat_loaded = db.Column(db.Boolean, nullable=False, default=False)
    run_number = db.Column(db.Integer, nullable=False, default=1)
    model_used = db.Column(db.String(240), nullable=True)
    agent_used = db.Column(db.String(120), nullable=True)
    timeout_used = db.Column(db.Integer, nullable=True)
    goal_attempted = db.Column(db.Boolean, nullable=False, default=False)
    goal_met = db.Column(db.Boolean, nullable=True)
    goal_output = db.Column(db.Text, nullable=True)
    retry_attempt = db.Column(db.Integer, nullable=False, default=0)
    output_preview = db.Column(db.Text, nullable=True)
    error = db.Column(db.Text, nullable=True)


class TimelineEvent(db.Model):
    __tablename__ = "timeline_events"

    id = db.Column(db.Integer, primary_key=True)
    project_id = db.Column(
        db.Integer,
        db.ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
    )
    event_type = db.Column(db.String(64), nullable=False)
    payload_json = db.Column(db.Text, nullable=False)
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, default=_utc_now)
