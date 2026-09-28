# -*- mode: python ; coding: utf-8 -*-
from pathlib import Path
import sys

SELF_PATH = str(Path(".").resolve())
if SELF_PATH not in sys.path:
    sys.path.insert(0, SELF_PATH)

datas = [
    ("ui/web", "ui/web"),
    ("icons", "icons"),
    ("lang", "lang"),
    ("core/lang", "core/lang"),
]

hiddenimports = [
    "clr",
    "clr_loader",
    "pythonnet",
    "webview",
    "bottle",
    "aiohttp",
    "yarl",
    "multidict",
    "async_timeout",
]

a = Analysis(
    ["main.py"],
    pathex=[SELF_PATH, str(Path(SELF_PATH) / "core"), str(Path(SELF_PATH) / "ui")],
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name="TwitchDropsMinerPro",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon="icons/pickaxe.ico",
)
