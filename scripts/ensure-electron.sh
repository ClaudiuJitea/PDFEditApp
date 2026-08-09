#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ELECTRON_DIR="$ROOT_DIR/node_modules/electron"
VERSION="$(node -p "require('$ELECTRON_DIR/package.json').version")"
PLATFORM="$(node -p "process.platform")"
ARCH="$(node -p "process.arch")"

case "$PLATFORM" in
  linux) PLATFORM_PATH="electron" ;;
  darwin) PLATFORM_PATH="Electron.app/Contents/MacOS/Electron" ;;
  win32) PLATFORM_PATH="electron.exe" ;;
  *) echo "Unsupported platform: $PLATFORM" >&2; exit 1 ;;
esac

DIST_DIR="$ELECTRON_DIR/dist"
BINARY_PATH="$DIST_DIR/$PLATFORM_PATH"
PATH_FILE="$ELECTRON_DIR/path.txt"

if [[ -f "$PATH_FILE" && -e "$BINARY_PATH" ]]; then
  exit 0
fi

echo "Electron binary missing; repairing installation..."

ZIP_NAME="electron-v${VERSION}-${PLATFORM}-${ARCH}.zip"
CACHE_DIR="${ELECTRON_CACHE_DIR:-$HOME/.cache/electron}"
ZIP_PATH=""

if [[ -d "$CACHE_DIR" ]]; then
  ZIP_PATH="$(find "$CACHE_DIR" -type f -name "$ZIP_NAME" | head -n 1 || true)"
fi

if [[ -z "$ZIP_PATH" || ! -f "$ZIP_PATH" ]]; then
  echo "Downloading Electron ${VERSION} for ${PLATFORM}/${ARCH}..."
  node "$ELECTRON_DIR/install.js"
  if [[ -d "$CACHE_DIR" ]]; then
    ZIP_PATH="$(find "$CACHE_DIR" -type f -name "$ZIP_NAME" | head -n 1 || true)"
  fi
fi

if [[ -z "$ZIP_PATH" || ! -f "$ZIP_PATH" ]]; then
  echo "Could not locate Electron archive for ${ZIP_NAME}." >&2
  echo "Try: rm -rf node_modules/electron && npm install" >&2
  exit 1
fi

rm -rf "$DIST_DIR"
mkdir -p "$DIST_DIR"

if command -v unzip >/dev/null 2>&1; then
  unzip -q "$ZIP_PATH" -d "$DIST_DIR"
elif command -v tar >/dev/null 2>&1; then
  tar -xf "$ZIP_PATH" -C "$DIST_DIR"
else
  node -e "
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const extract = require('extract-zip');
const zip = process.argv[1];
const dist = path.resolve(process.argv[2]);
extract(zip, { dir: dist }).then(() => {
  if (!fs.existsSync(path.join(dist, process.argv[3]))) {
    throw new Error('extract-zip completed without expected binary');
  }
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
" "$ZIP_PATH" "$DIST_DIR" "$PLATFORM_PATH"
fi

if [[ ! -e "$BINARY_PATH" ]]; then
  echo "Electron binary not found at $BINARY_PATH after extraction." >&2
  exit 1
fi

printf '%s' "$PLATFORM_PATH" > "$PATH_FILE"
echo "Electron repaired: $BINARY_PATH"
