import json
import os
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

from ..auth import auth_required
from ..db import db
from ..models import AppSetting, Project, ScheduledTask, ScheduledTaskRun, TimelineEvent
from ..scheduler import TASK_TYPES, calculate_next_run, next_cron_runs, parse_cron_expression
from ..voice import VoiceError
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


@api_bp.get("/health")
def app_health():
    return jsonify(
        {
            "healthy": True,
            "service": "mobile-opencode-control-backend",
            "env": settings.app_env,
        }
    )


@api_bp.get("/lan-url")
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


@api_bp.get("/projects/<int:project_id>/runtime")
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


@api_bp.put("/projects/<int:project_id>/runtime")
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
