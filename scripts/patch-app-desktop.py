#!/usr/bin/env python3
"""Transform synced web app.py into the desktop sidecar app."""

from __future__ import annotations

import re
import sys
from pathlib import Path


def patch_app_py(path: Path) -> None:
    text = path.read_text(encoding="utf-8")

    if "def create_app():" in text:
        print(f"{path}: already patched")
        return

    text = text.replace(
        "import session_storage as store",
        "import desktop_config\nimport session_storage as store",
        1,
    )

    text = text.replace(
        "app = Flask(__name__)\nCORS(app)\napp.config[\"MAX_CONTENT_LENGTH\"] = 50 * 1024 * 1024\n\nRENDER_SCALE = 2.0\n\nsessions = {}\n\nstore.ensure_data_dirs()\nstore.migrate_legacy_sessions()\n",
        '''app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 50 * 1024 * 1024

RENDER_SCALE = 2.0

sessions = {}
_app_initialized = False


def create_app():
    global _app_initialized
    if _app_initialized:
        return app

    origins = desktop_config.ALLOWED_ORIGINS or [
        f"http://{desktop_config.HOST}:{desktop_config.PORT}",
        f"http://127.0.0.1:{desktop_config.PORT}",
        f"http://localhost:{desktop_config.PORT}",
        "null",
    ]
    CORS(
        app,
        resources={r"/api/*": {"origins": origins}},
        supports_credentials=True,
        allow_headers=["Content-Type", "X-PDFEdit-Token", "X-AI-Settings-Token"],
    )

    desktop_config.ensure_runtime_dirs()
    desktop_config.configure_tesseract()
    store.ensure_data_dirs()
    store.migrate_legacy_sessions()
    store.cleanup_stale_sessions()

    @app.before_request
    def _require_auth_token():
        if request.method == "OPTIONS":
            return None
        if request.path in {"/", "/favicon.ico"} or request.path.startswith("/static/"):
            return None
        if request.path == "/api/health":
            return None
        provided = (request.headers.get("X-PDFEdit-Token") or "").strip()
        if provided != desktop_config.AUTH_TOKEN:
            return jsonify({"error": "Unauthorized"}), 401
        return None

    _app_initialized = True
    return app


create_app()

''',
        1,
    )

    helpers = '''
def _quantize_rgb(color, step=8):
    return tuple(min(255, (channel // step) * step) for channel in color[:3])


def _sample_rect_background_rgb(page, rect, dpi_scale=3.0):
    """Estimate the local background color inside a PDF rect (RGB 0-255)."""
    if rect.is_empty:
        return (255, 255, 255)

    clip = fitz.Rect(rect)
    clip.normalize()
    if clip.is_empty:
        return (255, 255, 255)

    try:
        pix = page.get_pixmap(matrix=fitz.Matrix(dpi_scale, dpi_scale), clip=clip, alpha=False)
    except Exception:
        return (255, 255, 255)

    if pix.width < 1 or pix.height < 1:
        return (255, 255, 255)

    img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
    counts = {}
    for pixel in img.getdata():
        key = _quantize_rgb(pixel)
        counts[key] = counts.get(key, 0) + 1

    if not counts:
        return (255, 255, 255)

    return max(counts.items(), key=lambda item: item[1])[0]


def _rgb255_to_pdf_fill(color):
    return (color[0] / 255.0, color[1] / 255.0, color[2] / 255.0)


def _pdf_fill_for_rect(page, rect):
    return _rgb255_to_pdf_fill(_sample_rect_background_rgb(page, rect))


def _page_background_pdf_fill(page, dpi_scale=2.0):
    """Match web editor masking: sample page corners for a consistent fill color."""
    mat = fitz.Matrix(dpi_scale, dpi_scale)
    pix = page.get_pixmap(matrix=mat, alpha=False, annots=False)
    img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
    return _rgb255_to_pdf_fill(_sample_page_background(img, pix.width, pix.height))

'''

    if "_page_background_pdf_fill" not in text:
        text = text.replace(
            "def _cover_with_color(draw, page, bbox, dpi_scale, color, pad=4):",
            helpers + "def _cover_with_color(draw, page, bbox, dpi_scale, color, pad=4):",
            1,
        )

    text = re.sub(
        r"export_doc\.insert_pdf\(doc, widgets=True\)",
        "export_doc.insert_pdf(doc)",
        text,
    )
    text = re.sub(
        r"export_doc\.insert_pdf\(doc, from_page=from_page, to_page=to_page, widgets=True\)",
        "export_doc.insert_pdf(doc, from_page=from_page, to_page=to_page)",
        text,
    )

    text = text.replace(
        "page.add_redact_annot(area, fill=(1, 1, 1))",
        "page.add_redact_annot(area, fill=page_fill)",
        1,
    )
    text = text.replace(
        "    for area in areas_to_redact:\n        if not area.is_empty:\n            page.add_redact_annot(area, fill=page_fill)\n",
        "    page_fill = _page_background_pdf_fill(page)\n\n    for area in areas_to_redact:\n        if not area.is_empty:\n            page.add_redact_annot(area, fill=page_fill)\n",
        1,
    )

    text = re.sub(
        r"        if bg_color:\n            shape_obj = page\.new_shape\(\)\n            shape_obj\.draw_rect\(draw_rect\)\n            shape_obj\.finish\(color=None, fill=bg_color\)\n            shape_obj\.commit\(\)\n        else:\n            shape_obj = page\.new_shape\(\)\n            shape_obj\.draw_rect\(draw_rect\)\n            shape_obj\.finish\(color=None, fill=\(1, 1, 1\)\)\n            shape_obj\.commit\(\)\n",
        "        if bg_color:\n            shape_obj = page.new_shape()\n            shape_obj.draw_rect(draw_rect)\n            shape_obj.finish(color=None, fill=bg_color)\n            shape_obj.commit()\n",
        text,
        count=1,
    )

    text = text.replace(
        '    return render_template("index.html")\n',
        '    return render_template("index.html", auth_token=desktop_config.AUTH_TOKEN)\n',
        1,
    )

    health_route = '''
@app.route("/api/health", methods=["GET"])
def health():
    return jsonify({
        "status": "ok",
        "version": "1.0.0",
        "data_dir": str(desktop_config.DATA_DIR),
        "openssl": bool(desktop_config.resolve_openssl()),
        "tesseract": bool(desktop_config.TESSERACT_CMD or desktop_config.TESSDATA_PREFIX),
    })

'''
    if "/api/health" not in text:
        text = text.replace(
            '@app.route("/api/upload"',
            health_route + '@app.route("/api/upload"',
            1,
        )

    text = re.sub(
        r"textpage = page\.get_textpage_ocr\(language=language\)",
        """ocr_kwargs = {"language": language}
        if desktop_config.TESSERACT_CMD:
            ocr_kwargs["tesseract"] = desktop_config.TESSERACT_CMD
        textpage = page.get_textpage_ocr(**ocr_kwargs)""",
        text,
        count=1,
    )

    text = re.sub(
        r'if __name__ == "__main__":\n    app\.run\(debug=True, port=5001\)\n',
        'if __name__ == "__main__":\n    from server_entry import main\n\n    raise SystemExit(main())\n',
        text,
        count=1,
    )

    path.write_text(text, encoding="utf-8")
    print(f"Patched {path}")


def patch_session_storage(path: Path) -> None:
    text = path.read_text(encoding="utf-8")
    if "desktop_config" in text:
        return
    text = text.replace(
        "APP_ROOT = os.path.dirname(os.path.abspath(__file__))\nDATA_DIR = os.path.join(APP_ROOT, \"data\")",
        "import desktop_config\n\nAPP_ROOT = os.path.dirname(os.path.abspath(__file__))\nDATA_DIR = str(desktop_config.DATA_DIR)",
        1,
    )
    text = text.replace(
        "def ensure_data_dirs():\n    os.makedirs(UNSAVED_DIR, exist_ok=True)",
        "def ensure_data_dirs():\n    desktop_config.ensure_runtime_dirs()\n    os.makedirs(UNSAVED_DIR, exist_ok=True)",
        1,
    )
    if "cleanup_stale_sessions" not in text:
        cleanup = '''

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
'''
        text = text.replace(
            "def _utc_now():",
            cleanup + "\n\ndef _utc_now():",
            1,
        )
    path.write_text(text, encoding="utf-8")
    print(f"Patched {path}")


def patch_cert_generate(path: Path) -> None:
    text = path.read_text(encoding="utf-8")
    if "desktop_config.resolve_openssl" in text:
        return
    text = text.replace(
        "    openssl = shutil.which(\"openssl\")",
        "    try:\n        import desktop_config\n\n        openssl = desktop_config.resolve_openssl()\n    except Exception:\n        openssl = shutil.which(\"openssl\")",
        1,
    )
    path.write_text(text, encoding="utf-8")
    print(f"Patched {path}")


def patch_cert_sign(path: Path) -> None:
    text = path.read_text(encoding="utf-8")
    text = text.replace(
        "from pyhanko.stamp.base import BaseStamp, BaseStampStyle",
        "from pyhanko.stamp import BaseStamp, BaseStampStyle",
    )
    path.write_text(text, encoding="utf-8")
    print(f"Patched {path}")


def main() -> int:
    backend = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parents[1] / "backend"
    patch_app_py(backend / "app.py")
    patch_session_storage(backend / "session_storage.py")
    patch_cert_generate(backend / "cert_generate.py")
    patch_cert_sign(backend / "cert_sign.py")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
