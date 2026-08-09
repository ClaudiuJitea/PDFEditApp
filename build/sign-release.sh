#!/usr/bin/env bash
# Placeholder hooks for release signing. Wire these into CI secrets when certificates are available.

set -euo pipefail

PLATFORM="${1:-linux}"
ARTIFACT_DIR="${2:-dist/desktop}"

echo "Signing hook for platform: $PLATFORM"
echo "Artifacts directory: $ARTIFACT_DIR"

case "$PLATFORM" in
  windows)
    if [[ -z "${WINDOWS_SIGN_CERT:-}" ]]; then
      echo "WINDOWS_SIGN_CERT not set; skipping Authenticode signing."
      exit 0
    fi
    ;;
  macos)
    if [[ -z "${APPLE_SIGN_IDENTITY:-}" ]]; then
      echo "APPLE_SIGN_IDENTITY not set; skipping codesign/notarization."
      exit 0
    fi
    ;;
  linux)
    if [[ -z "${GPG_KEY_ID:-}" ]]; then
      echo "GPG_KEY_ID not set; skipping package signing."
      exit 0
    fi
    ;;
esac

echo "Signing configuration detected. Implement platform-specific signing commands here."
