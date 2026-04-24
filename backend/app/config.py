import os
from dataclasses import dataclass
from urllib.parse import urlparse


def _as_bool(value: str, default: bool = False) -> bool:
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _split_csv(value: str | None) -> tuple[str, ...]:
    if value is None:
        return tuple()
    return tuple(item.strip() for item in value.split(",") if item.strip())


@dataclass(frozen=True)
class Settings:
    app_env: str
    secret_key: str
    app_password: str
    database_url: str
    frontend_origin: str
    frontend_origins: tuple[str, ...]
    opencode_base_url: str
    opencode_username: str
    opencode_password: str
    cors_enabled: bool
    scheduler_poll_interval_seconds: int
    task_run_retention_days: int
    stt_base_url: str
    stt_model: str
    stt_api_key: str
    tts_base_url: str
    tts_model: str
    tts_voice: str
    tts_api_key: str
    voice_provider_mode: str
    builtin_stt_model: str
    builtin_stt_compute_type: str
    builtin_stt_device: str
    builtin_tts_model: str
    builtin_tts_speaker: str
    builtin_tts_language: str
    default_project_root: str
    frontend_port: int


def load_settings() -> Settings:
    app_env = os.getenv("APP_ENV", "development")
    secret_key = os.getenv("APP_SECRET_KEY", "change-me-in-production")
    app_password = os.getenv("APP_PASSWORD", "opencode")
    database_url = os.getenv("DATABASE_URL", "sqlite:///backend/data/app.db")
    frontend_origin = os.getenv("FRONTEND_ORIGIN", "http://localhost:5173")
    frontend_origins = _split_csv(os.getenv("FRONTEND_ORIGINS")) or (frontend_origin,)
    opencode_base_url = os.getenv("OPENCODE_BASE_URL", "http://127.0.0.1:4096")
    opencode_username = os.getenv("OPENCODE_SERVER_USERNAME", "")
    opencode_password = os.getenv("OPENCODE_SERVER_PASSWORD", "")
    cors_enabled = _as_bool(os.getenv("ENABLE_CORS", "true"), True)
    scheduler_poll_interval_seconds = int(
        os.getenv("SCHEDULER_POLL_INTERVAL_SECONDS", "20")
    )
    task_run_retention_days = int(os.getenv("TASK_RUN_RETENTION_DAYS", "30"))
    stt_base_url = os.getenv("STT_BASE_URL", "http://127.0.0.1:8969/v1")
    stt_model = os.getenv("STT_MODEL", "Systran/faster-whisper-medium.en")
    stt_api_key = os.getenv("STT_API_KEY", "")
    tts_base_url = os.getenv("TTS_BASE_URL", "http://127.0.0.1:8969/v1")
    tts_model = os.getenv("TTS_MODEL", "speaches-ai/Kokoro-82M-v1.0-ONNX")
    tts_voice = os.getenv("TTS_VOICE", "af_alloy")
    tts_api_key = os.getenv("TTS_API_KEY", "")
    voice_provider_mode = os.getenv("VOICE_PROVIDER_MODE", "auto").strip().lower()
    if voice_provider_mode not in {"auto", "external", "builtin"}:
        voice_provider_mode = "auto"

    builtin_stt_model = os.getenv("BUILTIN_STT_MODEL", "small.en")
    builtin_stt_compute_type = os.getenv("BUILTIN_STT_COMPUTE_TYPE", "int8")
    builtin_stt_device = os.getenv("BUILTIN_STT_DEVICE", "cpu")
    builtin_tts_model = os.getenv(
        "BUILTIN_TTS_MODEL", "tts_models/en/ljspeech/tacotron2-DDC"
    )
    builtin_tts_speaker = os.getenv("BUILTIN_TTS_SPEAKER", "")
    builtin_tts_language = os.getenv("BUILTIN_TTS_LANGUAGE", "")
    default_project_root = os.getenv("DEFAULT_PROJECT_ROOT", "")
    parsed_frontend = urlparse(frontend_origins[0])
    frontend_port = parsed_frontend.port or 5173

    return Settings(
        app_env=app_env,
        secret_key=secret_key,
        app_password=app_password,
        database_url=database_url,
        frontend_origin=frontend_origin,
        frontend_origins=frontend_origins,
        opencode_base_url=opencode_base_url,
        opencode_username=opencode_username,
        opencode_password=opencode_password,
        cors_enabled=cors_enabled,
        scheduler_poll_interval_seconds=scheduler_poll_interval_seconds,
        task_run_retention_days=max(task_run_retention_days, 1),
        stt_base_url=stt_base_url.rstrip("/"),
        stt_model=stt_model,
        stt_api_key=stt_api_key,
        tts_base_url=tts_base_url.rstrip("/"),
        tts_model=tts_model,
        tts_voice=tts_voice,
        tts_api_key=tts_api_key,
        voice_provider_mode=voice_provider_mode,
        builtin_stt_model=builtin_stt_model,
        builtin_stt_compute_type=builtin_stt_compute_type,
        builtin_stt_device=builtin_stt_device,
        builtin_tts_model=builtin_tts_model,
        builtin_tts_speaker=builtin_tts_speaker,
        builtin_tts_language=builtin_tts_language,
        default_project_root=default_project_root,
        frontend_port=frontend_port,
    )
