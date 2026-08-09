#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
VENV_DIR="$BACKEND_DIR/.venv"

if [[ ! -d "$VENV_DIR" ]]; then
  python3 -m venv "$VENV_DIR"
  "$VENV_DIR/bin/python" -m pip install --upgrade pip
  "$VENV_DIR/bin/pip" install -r "$BACKEND_DIR/requirements.txt"
fi

export PDFEDIT_PYTHON="$VENV_DIR/bin/python"
export ELECTRON_DISABLE_SANDBOX=1
cd "$ROOT_DIR"
npm install
bash scripts/ensure-electron.sh
npm start
