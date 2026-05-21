# ruff: noqa: F405
from flask import jsonify, request

from ..auth import auth_required
from ..db import db
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


@api_bp.get("/notifications/settings")
@auth_required
def get_notification_settings():
    current = _get_notification_settings()
    if not current["ntfyTopicUrl"] and settings.notification_ntfy_topic_url.strip():
        current["ntfyTopicUrl"] = settings.notification_ntfy_topic_url.strip()
    return jsonify(current)


@api_bp.put("/notifications/settings")
@auth_required
def update_notification_settings():
    body = request.get_json(silent=True) or {}
    channel = str(body.get("channel") or "browser").strip().lower()
    if channel not in {"browser", "ntfy", "both", "off"}:
        return jsonify({"error": "channel must be browser, ntfy, both, or off"}), 400
    ntfy_topic_url = str(body.get("ntfyTopicUrl") or "").strip()
    try:
        _set_notification_settings(channel, ntfy_topic_url)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    db.session.commit()
    return jsonify({"ok": True, "channel": channel, "ntfyTopicUrl": _validate_ntfy_topic_url(ntfy_topic_url)})


@api_bp.post("/notifications/ntfy/test")
@auth_required
def test_ntfy_notification():
    body = request.get_json(silent=True) or {}
    title = str(body.get("title") or "OpenCode Controller").strip() or "OpenCode Controller"
    message = (
        str(body.get("message") or "Test notification from mobile-opencode-control").strip()
        or "Test notification from mobile-opencode-control"
    )
    topic_url = str(body.get("ntfyTopicUrl") or "").strip()
    if not topic_url:
        current = _get_notification_settings()
        topic_url = current["ntfyTopicUrl"] or settings.notification_ntfy_topic_url.strip()
    if not topic_url:
        return jsonify({"error": "ntfy topic URL is not configured"}), 400

    try:
        _send_ntfy_notification(topic_url, title, message)
        return jsonify({"ok": True})
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except Exception as exc:
        return _bad_gateway("Failed to send ntfy notification", exc)


@api_bp.post("/notifications/ntfy/send")
@auth_required
def send_ntfy_notification():
    body = request.get_json(silent=True) or {}
    title = str(body.get("title") or "OpenCode Controller").strip() or "OpenCode Controller"
    message = str(body.get("message") or "").strip()
    if not message:
        return jsonify({"error": "message is required"}), 400

    topic_url = str(body.get("ntfyTopicUrl") or "").strip()
    if not topic_url:
        current = _get_notification_settings()
        topic_url = current["ntfyTopicUrl"] or settings.notification_ntfy_topic_url.strip()
    if not topic_url:
        return jsonify({"error": "ntfy topic URL is not configured"}), 400

    try:
        _send_ntfy_notification(topic_url, title, message)
        return jsonify({"ok": True})
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except Exception as exc:
        return _bad_gateway("Failed to send ntfy notification", exc)
