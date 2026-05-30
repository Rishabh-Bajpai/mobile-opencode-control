import os
import sys

from waitress import serve

from app import create_app


app = create_app()
BACKEND_PORT = int(os.environ.get("BACKEND_PORT", "38473"))


if __name__ == "__main__":
    if os.environ.get("FLASK_DEBUG", "").lower() in ("1", "true", "yes"):
        app.run(host="0.0.0.0", port=BACKEND_PORT, debug=True, threaded=True)
    else:
        try:
            serve(
                app,
                host="0.0.0.0",
                port=BACKEND_PORT,
                threads=16,  # raised from 8 to handle concurrent SSE streams without queue starvation
                channel_timeout=300,
            )
        except OSError as exc:
            print(f"Failed to bind to port {BACKEND_PORT}: {exc}", file=sys.stderr)
            print("Is another instance already running? Check: ss -tlnp | grep {BACKEND_PORT}".format(BACKEND_PORT=BACKEND_PORT), file=sys.stderr)
            sys.exit(1)
