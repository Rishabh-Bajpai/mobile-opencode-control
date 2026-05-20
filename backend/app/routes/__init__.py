from flask import Blueprint

api_bp = Blueprint("api", __name__, url_prefix="/api")

from .helpers import _utc_now  # noqa: F401,E402
from . import files  # noqa: F401,E402
from . import messages  # noqa: F401,E402
from . import notifications  # noqa: F401,E402
from . import opencode  # noqa: F401,E402
from . import projects  # noqa: F401,E402
from . import runtime  # noqa: F401,E402
from . import scheduler_routes  # noqa: F401,E402
from . import sessions  # noqa: F401,E402
from . import settings  # noqa: F401,E402
from . import stt  # noqa: F401,E402
from . import tasks  # noqa: F401,E402

_ROUTE_MODULES = (
    runtime,
    opencode,
    notifications,
    sessions,
    scheduler_routes,
    stt,
    projects,
    files,
    tasks,
    messages,
    settings,
)


def register_api_routes(app, settings, opencode_client, scheduler, voice_runtime):
    for module in _ROUTE_MODULES:
        configure = getattr(module, "configure", None)
        if callable(configure):
            configure(app, settings, opencode_client, scheduler, voice_runtime)

    if api_bp.name not in app.blueprints:
        app.register_blueprint(api_bp)


__all__ = ["api_bp", "register_api_routes", "_utc_now"]
