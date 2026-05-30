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
        serve(
            app,
            host="0.0.0.0",
            port=BACKEND_PORT,
            threads=8,
            channel_timeout=300,
        )
