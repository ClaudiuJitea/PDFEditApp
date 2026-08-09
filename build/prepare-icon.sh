#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PYTHON="${PDFEDIT_PYTHON:-python3}"

if [[ $# -gt 0 ]]; then
  "$PYTHON" "$ROOT_DIR/build/generate-icon.py" "$1"
else
  "$PYTHON" "$ROOT_DIR/build/generate-icon.py"
fi
