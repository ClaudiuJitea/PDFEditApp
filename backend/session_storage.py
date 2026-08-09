"""Filesystem layout for PDF editing sessions.

data/
  unsaved/<session_id>/
    document.pdf   # working copy (incremental saves)
    meta.json      # session metadata
    drafts.json    # uncommitted per-page editor state
  saved/<session_id>/
    document.pdf   # last committed save (updated when you click Save)
    meta.json
  saved/           # timestamped export archives at root
"""

import json
import os
import re
import shutil
from datetime import datetime, timezone

import desktop_config

APP_ROOT = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = str(desktop_config.DATA_DIR)
UNSAVED_DIR = os.path.join(DATA_DIR, "unsaved")
SAVED_DIR = os.path.join(DATA_DIR, "saved")

LEGACY_SESSION_DB = os.path.join(APP_ROOT, "sessions_db.json")

DOCUMENT_NAME = "document.pdf"
META_NAME = "meta.json"
DRAFTS_NAME = "drafts.json"


def ensure_data_dirs():
    desktop_config.ensure_runtime_dirs()
    os.makedirs(UNSAVED_DIR, exist_ok=True)
    os.makedirs(SAVED_DIR, exist_ok=True)


def session_dir(session_id):
    return os.path.join(UNSAVED_DIR, session_id)


def document_path(session_id):
    return os.path.join(session_dir(session_id), DOCUMENT_NAME)


def meta_path(session_id):
    return os.path.join(session_dir(session_id), META_NAME)


def drafts_path(session_id):
    return os.path.join(session_dir(session_id), DRAFTS_NAME)


def session_exists(session_id):
    return os.path.isfile(document_path(session_id))


def write_meta(session_id, meta):
    ensure_data_dirs()
    os.makedirs(session_dir(session_id), exist_ok=True)
    existing = read_meta(session_id) or {}
    merged = {**existing, **meta, "updated_at": _utc_now()}
    if "created_at" not in merged:
        merged["created_at"] = merged["updated_at"]
    with open(meta_path(session_id), "w", encoding="utf-8") as f:
        json.dump(merged, f, indent=2)


def read_meta(session_id):
    path = meta_path(session_id)
    if not os.path.isfile(path):
        return None
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError):
        return None


def read_drafts(session_id):
    path = drafts_path(session_id)
    if not os.path.isfile(path):
        return None
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError):
        return None


def write_drafts(session_id, drafts):
    ensure_data_dirs()
    os.makedirs(session_dir(session_id), exist_ok=True)
    payload = {**drafts, "updated_at": _utc_now()}
    with open(drafts_path(session_id), "w", encoding="utf-8") as f:
        json.dump(payload, f)


def create_session_from_bytes(session_id, pdf_bytes, meta=None):
    ensure_data_dirs()
    os.makedirs(session_dir(session_id), exist_ok=True)
    with open(document_path(session_id), "wb") as f:
        f.write(pdf_bytes)
    write_meta(session_id, meta or {})


def delete_session_workspace(session_id):
    path = session_dir(session_id)
    if os.path.isdir(path):
        shutil.rmtree(path, ignore_errors=True)


def saved_session_dir(session_id):
    return os.path.join(SAVED_DIR, session_id)


def sync_working_copy_to_saved(session_id):
    """Copy the working PDF from unsaved into data/saved after a successful Save."""
    src = document_path(session_id)
    if not os.path.isfile(src):
        return None

    dest_dir = saved_session_dir(session_id)
    os.makedirs(dest_dir, exist_ok=True)
    dest_pdf = os.path.join(dest_dir, DOCUMENT_NAME)
    shutil.copy2(src, dest_pdf)

    meta = read_meta(session_id) or {}
    meta = {
        **meta,
        "last_saved_at": _utc_now(),
        "saved_document": dest_pdf,
    }
    with open(os.path.join(dest_dir, META_NAME), "w", encoding="utf-8") as f:
        json.dump(meta, f, indent=2)

    friendly = _safe_filename(meta.get("original_filename") or "document.pdf")
    friendly_path = os.path.join(dest_dir, friendly)
    if friendly_path != dest_pdf:
        shutil.copy2(src, friendly_path)

    return dest_pdf


def _safe_filename(name):
    base = os.path.basename(name or "document.pdf")
    base = re.sub(r"[^\w.\- ]+", "_", base).strip() or "document.pdf"
    if not base.lower().endswith(".pdf"):
        base += ".pdf"
    return base[:180]


def save_export_copy(session_id, pdf_bytes, suggested_name=None):
    ensure_data_dirs()
    meta = read_meta(session_id) or {}
    original = suggested_name or meta.get("original_filename") or "edited.pdf"
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    filename = f"{stamp}_{_safe_filename(original)}"
    out_path = os.path.join(SAVED_DIR, filename)
    with open(out_path, "wb") as f:
        f.write(pdf_bytes)
    return out_path


def migrate_legacy_sessions():
    """Move entries from sessions_db.json + /tmp paths into data/unsaved/."""
    if not os.path.isfile(LEGACY_SESSION_DB):
        return
    try:
        with open(LEGACY_SESSION_DB, encoding="utf-8") as f:
            db = json.load(f)
    except (json.JSONDecodeError, OSError):
        return
    if not isinstance(db, dict):
        return

    for session_id, info in db.items():
        if session_exists(session_id):
            continue
        legacy_path = (info or {}).get("temp_path")
        if not legacy_path or not os.path.isfile(legacy_path):
            continue
        try:
            os.makedirs(session_dir(session_id), exist_ok=True)
            shutil.copy2(legacy_path, document_path(session_id))
            write_meta(session_id, {
                "migrated_from": "sessions_db.json",
                "legacy_temp_path": legacy_path,
                "page_count": info.get("page_count"),
            })
        except OSError as err:
            print(f"Legacy session migrate failed {session_id}: {err}", file=__import__("sys").stderr)

    backup = LEGACY_SESSION_DB + ".migrated"
    try:
        if not os.path.isfile(backup):
            os.rename(LEGACY_SESSION_DB, backup)
    except OSError:
        pass


def cleanup_stale_sessions(max_age_hours: int = 168) -> int:
    """Remove abandoned unsaved session workspaces older than max_age_hours."""
    ensure_data_dirs()
    removed = 0
    cutoff = datetime.now(timezone.utc).timestamp() - (max_age_hours * 3600)
    if not os.path.isdir(UNSAVED_DIR):
        return removed
    for name in os.listdir(UNSAVED_DIR):
        path = os.path.join(UNSAVED_DIR, name)
        if not os.path.isdir(path):
            continue
        meta = read_meta(name) or {}
        updated = meta.get("updated_at")
        try:
            if updated:
                updated_dt = datetime.fromisoformat(updated.replace("Z", "+00:00"))
                if updated_dt.timestamp() > cutoff:
                    continue
            elif os.path.getmtime(path) > cutoff:
                continue
        except (TypeError, ValueError, OSError):
            pass
        shutil.rmtree(path, ignore_errors=True)
        removed += 1
    return removed


def _utc_now():
    return datetime.now(timezone.utc).isoformat()


ensure_data_dirs()
