#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [ -d "$ROOT_DIR/../PDFEdit/static" ]; then
  SRC_ROOT="$(cd "$ROOT_DIR/../PDFEdit" && pwd)"
elif [ -d "$ROOT_DIR/../PDFEdit/PDFEdit/static" ]; then
  SRC_ROOT="$(cd "$ROOT_DIR/../PDFEdit/PDFEdit" && pwd)"
else
  echo "ERROR: Cannot find PDFEdit web app (expected ../PDFEdit or ../PDFEdit/PDFEdit)" >&2
  exit 1
fi
DEST_BACKEND="$ROOT_DIR/backend"

copy_file() {
  local src="$1"
  local dest="$2"
  mkdir -p "$(dirname "$dest")"
  cp "$src" "$dest"
}

echo "Syncing Python modules from $SRC_ROOT -> $DEST_BACKEND"
for file in ai_settings.py ai_service.py; do
  copy_file "$SRC_ROOT/$file" "$DEST_BACKEND/$file"
done
cp "$SRC_ROOT/app.py" "$DEST_BACKEND/app.py"
cp "$SRC_ROOT/session_storage.py" "$DEST_BACKEND/session_storage.py"
cp "$SRC_ROOT/cert_generate.py" "$DEST_BACKEND/cert_generate.py"
cp "$SRC_ROOT/cert_sign.py" "$DEST_BACKEND/cert_sign.py"
python3 "$ROOT_DIR/scripts/patch-app-desktop.py" "$DEST_BACKEND"

echo "Syncing templates and static assets from $SRC_ROOT"
rsync -a --delete "$SRC_ROOT/static/" "$DEST_BACKEND/static/" \
  --exclude vendor/ \
  --exclude api.js \
  --exclude app.js
rsync -a "$SRC_ROOT/templates/" "$DEST_BACKEND/templates/" \
  --exclude index.html

echo "Run: bash scripts/apply-desktop-layer.sh"
