#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TOOLS_DIR="$ROOT_DIR/build/native-tools"
PLATFORM="$(uname -s | tr '[:upper:]' '[:lower:]')"
case "$PLATFORM" in
  linux) PLATFORM_DIR="linux" ;;
  darwin) PLATFORM_DIR="darwin" ;;
  *) PLATFORM_DIR="linux" ;;
esac

TARGET_DIR="$TOOLS_DIR/$PLATFORM_DIR"
mkdir -p "$TARGET_DIR/bin" "$TARGET_DIR/tessdata"

link_or_copy() {
  local name="$1"
  local source
  source="$(command -v "$name" || true)"
  if [[ -z "$source" ]]; then
    echo "Warning: $name not found on PATH; desktop OCR/cert features may be unavailable."
    return 0
  fi
  ln -sf "$source" "$TARGET_DIR/bin/$name"
}

link_or_copy openssl
link_or_copy tesseract

if command -v tesseract >/dev/null 2>&1; then
  TESS_PREFIX="$(tesseract --print-parameters 2>/dev/null | awk -F= '/^tessdata_dir/ {print $2; exit}')"
  if [[ -z "$TESS_PREFIX" ]]; then
    for candidate in /usr/share/tesseract-ocr/5/tessdata /usr/share/tesseract-ocr/4.00/tessdata /usr/share/tessdata; do
      if [[ -d "$candidate" ]]; then
        TESS_PREFIX="$candidate"
        break
      fi
    done
  fi
  if [[ -n "${TESS_PREFIX:-}" && -d "$TESS_PREFIX" ]]; then
    ln -sfn "$TESS_PREFIX" "$TARGET_DIR/tessdata"
  fi
fi

echo "Native tool links prepared in $TARGET_DIR"
