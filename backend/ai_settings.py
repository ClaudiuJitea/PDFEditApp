"""Server-side OpenRouter API key and model configuration."""

import json
import os
from datetime import datetime, timezone

import session_storage as store

SETTINGS_PATH = os.path.join(store.DATA_DIR, "ai_settings.json")


def _utc_now():
    return datetime.now(timezone.utc).isoformat()


def mask_api_key(key):
    if not key:
        return None
    key = str(key).strip()
    if len(key) <= 8:
        return "••••"
    return f"{key[:4]}…{key[-4:]}"


def _read_file_settings():
    if not os.path.isfile(SETTINGS_PATH):
        return {}
    try:
        with open(SETTINGS_PATH, encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except (OSError, json.JSONDecodeError):
        return {}


def get_effective_config():
    """Return {api_key, model} from env (overrides) merged with file settings."""
    file_data = _read_file_settings()
    api_key = (os.environ.get("OPENROUTER_API_KEY") or file_data.get("api_key") or "").strip()
    model = (os.environ.get("OPENROUTER_MODEL") or file_data.get("model") or "").strip()
    if not api_key:
        return None
    if not model:
        model = "openai/gpt-4o-mini"
    return {"api_key": api_key, "model": model}


def get_public_settings():
    """Settings safe to expose to the client (no full API key)."""
    config = get_effective_config()
    file_data = _read_file_settings()
    env_key = bool((os.environ.get("OPENROUTER_API_KEY") or "").strip())
    env_model = bool((os.environ.get("OPENROUTER_MODEL") or "").strip())
    return {
        "configured": config is not None,
        "model": config["model"] if config else (file_data.get("model") or ""),
        "key_preview": mask_api_key(config["api_key"]) if config else None,
        "key_from_env": env_key,
        "model_from_env": env_model,
    }


def save_settings(api_key=None, model=None):
    store.ensure_data_dirs()
    current = _read_file_settings()
    if api_key is not None and str(api_key).strip():
        current["api_key"] = str(api_key).strip()
    if model is not None and str(model).strip():
        current["model"] = str(model).strip()
    current["updated_at"] = _utc_now()
    with open(SETTINGS_PATH, "w", encoding="utf-8") as f:
        json.dump(current, f, indent=2)
    return get_public_settings()


def check_settings_token(request_headers):
    """If AI_SETTINGS_TOKEN is set, require matching header on writes."""
    expected = (os.environ.get("AI_SETTINGS_TOKEN") or "").strip()
    if not expected:
        return True
    provided = (request_headers.get("X-AI-Settings-Token") or "").strip()
    return provided == expected
