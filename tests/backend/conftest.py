import importlib
import sys
from pathlib import Path

import pytest

BACKEND_DIR = Path(__file__).resolve().parents[2] / "backend"
sys.path.insert(0, str(BACKEND_DIR))


@pytest.fixture()
def app_client(tmp_path, monkeypatch):
    monkeypatch.setenv("PDFEDIT_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv("PDFEDIT_AUTH_TOKEN", "test-token")
    monkeypatch.setenv("PDFEDIT_DEBUG", "1")

    for module_name in ["desktop_config", "session_storage", "app"]:
        if module_name in sys.modules:
            del sys.modules[module_name]

    import app as app_module

    importlib.reload(app_module)
    app_module.create_app()
    return app_module.app.test_client(), "test-token"
