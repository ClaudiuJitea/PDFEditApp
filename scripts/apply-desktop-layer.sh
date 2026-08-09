#!/usr/bin/env bash
# Re-apply Electron/desktop customizations after sync-from-web.sh
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND="$ROOT_DIR/backend"
DESKTOP="$ROOT_DIR/desktop"

python3 - "$BACKEND" "$DESKTOP" <<'PY'
import re
import sys
from pathlib import Path

backend = Path(sys.argv[1])
desktop = Path(sys.argv[2])

# --- api.js: auth-aware fetch wrapper ---
api_js = backend / "static/api.js"
text = api_js.read_text(encoding="utf-8")
if "function apiFetch" not in text:
    header = '''function getAuthToken() {
    return window.__PDFEDIT_AUTH_TOKEN__ || '';
}

function apiFetch(url, options = {}) {
    const headers = new Headers(options.headers || {});
    const token = getAuthToken();
    if (token) {
        headers.set('X-PDFEdit-Token', token);
    }
    return fetch(url, { ...options, headers });
}

'''
    text = text.replace(
        "const API = {",
        header + "const API = {",
        1,
    )
    text = re.sub(r"\bfetch\(`", "apiFetch(`", text)
    text = re.sub(r"\bfetch\(", "apiFetch(", text)
    api_js.write_text(text, encoding="utf-8")
    print("Patched api.js")

# --- index.html: offline vendors, auth token, About/Quit ---
index = backend / "templates/index.html"
html = index.read_text(encoding="utf-8")

html = re.sub(
    r"<link rel=\"preconnect\" href=\"https://fonts\.googleapis\.com\">.*?display=swap\" rel=\"stylesheet\">",
    '<link rel="stylesheet" href="{{ url_for(\'static\', filename=\'vendor/fonts/fonts.css\') }}?v=1.0.0">',
    html,
    count=1,
    flags=re.S,
)
html = html.replace(
    '<script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>\n',
    "",
)
html = html.replace(
    '<script src="https://cdnjs.cloudflare.com/ajax/libs/fabric.js/5.3.1/fabric.min.js"></script>',
    '<script src="{{ url_for(\'static\', filename=\'vendor/fabric/fabric.min.js\') }}?v=5.3.1"></script>',
)
html = html.replace(
    '<script src="https://unpkg.com/lucide@latest/dist/umd/lucide.js"></script>',
    '<script src="{{ url_for(\'static\', filename=\'vendor/lucide/lucide.min.js\') }}?v=0.468.0"></script>',
)

about_quit_buttons = '''                <div class="top-btn-group top-btn-group-icons" role="group" aria-label="App">
                    <button id="btn-about" class="top-btn icon-only" title="About PDFEdit">
                        <i data-lucide="info" class="btn-icon"></i>
                    </button>
                    <button id="btn-quit" class="top-btn top-btn-quiet-danger" title="Quit PDFEdit">
                        <i data-lucide="log-out" class="btn-icon"></i>
                        <span>Quit</span>
                    </button>
                </div>
'''
if 'id="btn-about"' not in html:
    html = html.replace(
        '            <div class="top-bar-right">',
        '            <div class="top-bar-right">\n' + about_quit_buttons,
        1,
    )

about_modals = Path(desktop / "fragments/about-quit-modals.html")
if about_modals.is_file() and 'id="about-modal"' not in html:
    html = html.replace(
        '        <!-- Mobile Banner -->',
        about_modals.read_text(encoding="utf-8") + '\n        <!-- Mobile Banner -->',
        1,
    )

html = re.sub(
    r"pdfjsLib\.GlobalWorkerOptions\.workerSrc\s*=\s*'[^']*';",
    "window.__PDFEDIT_AUTH_TOKEN__ = {{ auth_token|tojson }};",
    html,
)

index.write_text(html, encoding="utf-8")
print("Patched index.html")

# --- style.css: append desktop-only rules if missing ---
style = backend / "static/style.css"
css = style.read_text(encoding="utf-8")
extra = Path(desktop / "fragments/desktop-extra.css")
if extra.is_file() and ".modal-about .about-dialog" not in css:
    css = css.rstrip() + "\n\n" + extra.read_text(encoding="utf-8") + "\n"
    style.write_text(css, encoding="utf-8")
    print("Appended desktop-extra.css")

# --- app.js: merge desktop bridge if missing ---
app_js = backend / "static/app.js"
app = app_js.read_text(encoding="utf-8")
patch = Path(desktop / "fragments/app-desktop.js")
if patch.is_file() and "pdfEditDesktop" not in app:
  # Full merge handled by keeping app.js from repo; skip if already patched
    pass
elif patch.is_file() and "_initDesktopControls" not in app:
    print("WARNING: app.js missing desktop controls — restore from git or merge app-desktop.js manually")

print("Desktop layer applied.")
PY

# cert_sign import fix
sed -i 's/from pyhanko.stamp.base import/from pyhanko.stamp import/' "$BACKEND/cert_sign.py" 2>/dev/null || true

python3 "$ROOT_DIR/scripts/patch-app-desktop.py" "$BACKEND"

echo "Done."
