# -*- mode: python ; coding: utf-8 -*-

from pathlib import Path

block_cipher = None
spec_dir = Path(SPECPATH)
backend_dir = spec_dir.parent / "backend"

a = Analysis(
    [str(backend_dir / "server_entry.py")],
    pathex=[str(backend_dir)],
    binaries=[],
    datas=[
        (str(backend_dir / "templates"), "templates"),
        (str(backend_dir / "static"), "static"),
    ],
    hiddenimports=[
        "waitress",
        "fitz",
        "PIL",
        "pyhanko",
        "tzlocal",
        "flask_cors",
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)
pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="pdfedit-sidecar",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name="pdfedit-sidecar",
)
