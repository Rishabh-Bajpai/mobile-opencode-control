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



