#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC_ROOT="$(cd "$ROOT_DIR/.." && pwd)"
DEST_BACKEND="$ROOT_DIR/backend"

copy_file() {
  local src="$1"
  local dest="$2"
  mkdir -p "$(dirname "$dest")"
  cp "$src" "$dest"
}

echo "Syncing Python modules from $SRC_ROOT -> $DEST_BACKEND"
for file in app.py session_storage.py ai_settings.py ai_service.py cert_generate.py cert_sign.py; do
  copy_file "$SRC_ROOT/$file" "$DEST_BACKEND/$file"
done

echo "Syncing templates and static assets"
rsync -a --delete "$SRC_ROOT/static/" "$DEST_BACKEND/static/" \
  --exclude vendor/
rsync -a --delete "$SRC_ROOT/templates/" "$DEST_BACKEND/templates/"

echo "Re-applying desktop-specific customizations is required after sync:"
echo "  - desktop_config.py, server_entry.py, session_storage.py data-dir logic"
echo "  - api.js auth headers, app.js desktop bridge, index.html vendor assets"
echo "  - cert_sign.py: use 'from pyhanko.stamp import' (not pyhanko.stamp.base)"
echo "  - app.py patches: remove insert_pdf(widgets=True), background sampling helpers,"
echo "    per-rect redaction fill, no default white text backing (see desktop commits 2ac3804, 17a73d6)"
