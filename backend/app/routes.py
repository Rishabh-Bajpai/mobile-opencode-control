import sys
from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path

_PACKAGE_NAME = f"{__package__}._routes_package"
_PACKAGE_INIT = Path(__file__).with_name("routes") / "__init__.py"

_module = sys.modules.get(_PACKAGE_NAME)
if _module is None:
    _spec = spec_from_file_location(
        _PACKAGE_NAME,
        _PACKAGE_INIT,
        submodule_search_locations=[str(_PACKAGE_INIT.parent)],
    )
    if _spec is None or _spec.loader is None:
        raise ImportError("Unable to load routes package")
    _module = module_from_spec(_spec)
    sys.modules[_PACKAGE_NAME] = _module
    _spec.loader.exec_module(_module)

api_bp = _module.api_bp
register_api_routes = _module.register_api_routes
_utc_now = _module._utc_now

__all__ = ["api_bp", "register_api_routes", "_utc_now"]
