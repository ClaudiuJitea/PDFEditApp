#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
DIST_DIR="$ROOT_DIR/dist/sidecar"
SPEC_FILE="$ROOT_DIR/build/pdfedit-sidecar.spec"
VENV_DIR="$BACKEND_DIR/.venv"

if [[ ! -d "$VENV_DIR" ]]; then
  python3 -m venv "$VENV_DIR"
fi

"$VENV_DIR/bin/python" -m pip install --upgrade pip
"$VENV_DIR/bin/pip" install -r "$BACKEND_DIR/requirements-dev.txt"
mkdir -p "$DIST_DIR"

cd "$BACKEND_DIR"
"$VENV_DIR/bin/pyinstaller" "$SPEC_FILE" \
  --distpath "$DIST_DIR" \
  --workpath "$ROOT_DIR/build/pyinstaller-work" \
  --noconfirm

echo "Sidecar built at $DIST_DIR"
