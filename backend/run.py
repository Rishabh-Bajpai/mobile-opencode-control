import os
import sys

from waitress import serve

from app import create_app


def _env_truthy(name: str) -> bool:
    return os.environ.get(name, "").lower() in ("1", "true", "yes")


def _read_positive_int_env(name: str, default: int) -> int:
    raw_value = os.environ.get(name)
    if raw_value is None:
        return default

    try:
        value = int(raw_value)
    except ValueError:
        return default

    return value if value > 0 else default


app = create_app()
BACKEND_PORT = int(os.environ.get("BACKEND_PORT", "38473"))
WAITRESS_THREADS = _read_positive_int_env("WAITRESS_THREADS", 16)
WAITRESS_CHANNEL_TIMEOUT = _read_positive_int_env("WAITRESS_CHANNEL_TIMEOUT", 300)


if __name__ == "__main__":
    if _env_truthy("FLASK_DEBUG"):
        debug_host = "0.0.0.0" if _env_truthy("FLASK_DEBUG_BIND_ALL") else "127.0.0.1"
        app.run(host=debug_host, port=BACKEND_PORT, debug=True, threaded=True)
    else:
        try:
            serve(
                app,
                host="0.0.0.0",
                port=BACKEND_PORT,
                threads=WAITRESS_THREADS,
                channel_timeout=WAITRESS_CHANNEL_TIMEOUT,
            )
        except OSError as exc:
            print(f"Failed to bind to port {BACKEND_PORT}: {exc}", file=sys.stderr)
            print("Is another instance already running? Check: ss -tlnp | grep {BACKEND_PORT}".format(BACKEND_PORT=BACKEND_PORT), file=sys.stderr)
            sys.exit(1)
