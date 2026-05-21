# ruff: noqa: F405
import requests
from flask import Response, jsonify, request

from ..auth import auth_required
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


@api_bp.get("/voice/health")
@auth_required
def voice_health():
    mode = settings.voice_provider_mode
    external_stt = _has_external_stt_provider(settings)
    external_tts = _has_external_tts_provider(settings)

    return jsonify(
        {
            "mode": mode,
            "resolved": {
                "stt": "external"
                if mode == "external" or (mode == "auto" and external_stt)
                else "builtin",
                "tts": "external"
                if mode == "external" or (mode == "auto" and external_tts)
                else "builtin",
            },
            "externalConfigured": {
                "stt": external_stt,
                "tts": external_tts,
            },
            "builtin": {
                "sttModel": settings.builtin_stt_model,
                "ttsModel": settings.builtin_tts_model,
                "device": settings.builtin_stt_device,
                "computeType": settings.builtin_stt_compute_type,
            },
        }
    )


@api_bp.post("/stt/transcribe")
@auth_required
def transcribe_audio():
    upload = request.files.get("audio")
    if upload is None:
        return jsonify({"error": "Missing audio file field 'audio'"}), 400

    filename = upload.filename or "recording.webm"
    content_type = upload.mimetype or "application/octet-stream"
    audio_bytes = upload.read()
    if not audio_bytes:
        return jsonify({"error": "Uploaded audio is empty"}), 400

    model = str(request.form.get("model") or settings.stt_model).strip()
    language = str(request.form.get("language") or "").strip()

    mode = settings.voice_provider_mode
    external_configured = _has_external_stt_provider(settings)
    use_external = mode == "external" or (mode == "auto" and external_configured)

    if not use_external:
        try:
            transcript, used_model = voice_runtime.transcribe(
                audio_bytes=audio_bytes,
                filename=filename,
                language=language or None,
            )
            return jsonify(
                {
                    "text": transcript,
                    "model": used_model,
                    "raw": {"provider": "builtin", "mode": mode},
                }
            )
        except VoiceError as exc:
            return jsonify({"error": f"STT transcription failed: {exc}"}), 502

    files = {
        "file": (filename, audio_bytes, content_type),
    }
    data = {
        "model": model,
    }
    if language:
        data["language"] = language

    try:
        response = requests.post(
            f"{settings.stt_base_url}/audio/transcriptions",
            headers=_provider_headers(settings.stt_api_key),
            files=files,
            data=data,
            timeout=120,
        )
        response.raise_for_status()
        payload = response.json()
        transcript = payload.get("text") if isinstance(payload, dict) else ""
        if not isinstance(transcript, str):
            transcript = ""
        return jsonify(
            {
                "text": transcript,
                "model": model,
                "raw": payload,
            }
        )
    except Exception as exc:
        return jsonify({"error": f"STT transcription failed: {exc}"}), 502


@api_bp.post("/tts/speak")
@auth_required
def speak_text():
    body = request.get_json(silent=True) or {}
    text = str(body.get("text") or "").strip()
    if not text:
        return jsonify({"error": "Text is required"}), 400

    model = str(body.get("model") or settings.tts_model).strip()
    voice = str(body.get("voice") or settings.tts_voice).strip()
    response_format = str(body.get("format") or "mp3").strip()

    mode = settings.voice_provider_mode
    external_configured = _has_external_tts_provider(settings)
    use_external = mode == "external" or (mode == "auto" and external_configured)

    if not use_external:
        try:
            synthesized = voice_runtime.synthesize(text=text, voice=voice)
            return Response(
                synthesized.audio_bytes,
                status=200,
                mimetype=synthesized.mimetype,
            )
        except VoiceError as exc:
            return jsonify({"error": f"TTS synthesis failed: {exc}"}), 502

    payload = {
        "model": model,
        "input": text,
        "voice": voice,
        "response_format": response_format,
    }

    try:
        response = requests.post(
            f"{settings.tts_base_url}/audio/speech",
            headers=_provider_headers(settings.tts_api_key),
            json=payload,
            timeout=120,
        )
        response.raise_for_status()
        content_type = response.headers.get("Content-Type", "audio/mpeg")
        return Response(response.content, status=200, mimetype=content_type)
    except Exception as exc:
        return jsonify({"error": f"TTS synthesis failed: {exc}"}), 502
