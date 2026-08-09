"""Production entry point for the PDFEdit desktop sidecar."""

from __future__ import annotations

import json
import signal
import sys

import desktop_config as config


def _print_bootstrap() -> None:
    payload = {
        "host": config.HOST,
        "port": config.PORT,
        "auth_token": config.AUTH_TOKEN,
        "data_dir": str(config.DATA_DIR),
    }
    print(f"PDFEDIT_BOOTSTRAP {json.dumps(payload)}", flush=True)


def main() -> int:
    config.ensure_runtime_dirs()
    config.configure_tesseract()

    from app import app, create_app

    create_app()

    _print_bootstrap()

    if config.DEBUG:
        app.run(host=config.HOST, port=config.PORT, debug=True, use_reloader=False)
        return 0

    from waitress import serve

    def _handle_signal(signum, _frame):
        raise SystemExit(0)

    signal.signal(signal.SIGTERM, _handle_signal)
    signal.signal(signal.SIGINT, _handle_signal)

    serve(app, host=config.HOST, port=config.PORT, threads=8, channel_timeout=120)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
