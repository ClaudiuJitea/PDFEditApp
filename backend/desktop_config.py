"""Runtime configuration for the PDFEdit desktop sidecar."""

from __future__ import annotations

import os
import secrets
import sys
from pathlib import Path


def _env_bool(name: str, default: bool = False) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _default_data_dir() -> Path:
  if sys.platform == "win32":
    base = os.environ.get("APPDATA") or str(Path.home() / "AppData" / "Roaming")
    return Path(base) / "PDFEdit"
  if sys.platform == "darwin":
    return Path.home() / "Library" / "Application Support" / "PDFEdit"
  xdg = os.environ.get("XDG_DATA_HOME")
  if xdg:
    return Path(xdg) / "pdfedit"
  return Path.home() / ".local" / "share" / "pdfedit"


BACKEND_ROOT = Path(__file__).resolve().parent
DATA_DIR = Path(os.environ.get("PDFEDIT_DATA_DIR", str(_default_data_dir()))).expanduser()
HOST = os.environ.get("PDFEDIT_HOST", "127.0.0.1")
PORT = int(os.environ.get("PDFEDIT_PORT", "5001"))
DEBUG = _env_bool("PDFEDIT_DEBUG", False)
AUTH_TOKEN = os.environ.get("PDFEDIT_AUTH_TOKEN", "").strip() or secrets.token_urlsafe(32)
ALLOWED_ORIGINS = [
    origin.strip()
    for origin in os.environ.get("PDFEDIT_ALLOWED_ORIGINS", "").split(",")
    if origin.strip()
]
OPENSSL_PATH = os.environ.get("PDFEDIT_OPENSSL_PATH", "").strip()
TESSERACT_CMD = os.environ.get("PDFEDIT_TESSERACT_CMD", "").strip()
TESSDATA_PREFIX = os.environ.get("PDFEDIT_TESSDATA_PREFIX", "").strip()


def ensure_runtime_dirs() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)


def resolve_openssl() -> str | None:
    if OPENSSL_PATH and Path(OPENSSL_PATH).is_file():
        return OPENSSL_PATH
    from shutil import which

    return which("openssl")


def configure_tesseract() -> dict[str, str | None]:
    """Apply bundled Tesseract settings to the current process."""
    info: dict[str, str | None] = {
        "tesseract_cmd": TESSERACT_CMD or None,
        "tessdata_prefix": TESSDATA_PREFIX or None,
    }
    if TESSDATA_PREFIX:
        os.environ["TESSDATA_PREFIX"] = TESSDATA_PREFIX
    return info
