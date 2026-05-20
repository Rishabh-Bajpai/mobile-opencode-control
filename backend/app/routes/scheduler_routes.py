from flask import jsonify

from ..auth import auth_required
from . import api_bp




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


@api_bp.get("/scheduler/status")
@auth_required
def scheduler_status():
    return jsonify({"scheduler": scheduler.get_status()})
