from __future__ import annotations

import os
import sys
import asyncio
import logging
import threading
from pathlib import Path
from dataclasses import dataclass

# Setup paths
APP_DIR = Path(__file__).resolve().parent
CORE_DIR = APP_DIR / "core"
UI_DIR = APP_DIR / "ui"

if str(APP_DIR) not in sys.path:
    sys.path.insert(0, str(APP_DIR))
if str(CORE_DIR) not in sys.path:
    sys.path.insert(0, str(CORE_DIR))

import webview
from core.settings import Settings
from core.twitch import Twitch
from core.translate import _
from core.constants import IS_PACKAGED, LOG_PATH, FILE_FORMATTER

# Configure basic logging with file output
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("TwitchDrops")
try:
    _fh = logging.FileHandler(str(LOG_PATH), encoding="utf-8")
    _fh.setLevel(logging.INFO)
    _fh.setFormatter(logging.Formatter("[%(asctime)s] %(levelname)s: %(message)s", datefmt="%H:%M:%S"))
    logging.getLogger().addHandler(_fh)
except Exception:
    pass



@dataclass
class SimpleArgs:
    _verbose: int = 0
    _debug_ws: bool = False
    _debug_gql: bool = False
    log: bool = True
    dump: bool = False
    tray: bool = False

    @property
    def logging_level(self) -> int:
        return logging.INFO

    @property
    def debug_ws(self) -> int:
        return logging.NOTSET

    @property
    def debug_gql(self) -> int:
        return logging.NOTSET


def run_miner_loop(twitch: Twitch, loop: asyncio.AbstractEventLoop):
    asyncio.set_event_loop(loop)
    try:
        loop.run_until_complete(twitch.run())
    except Exception as exc:
        logger.error(f"Miner loop exited with error: {exc}", exc_info=True)
    finally:
        loop.close()


def main():
    args = SimpleArgs()
    settings = Settings(args)

    # Initialize language
    try:
        _.set_language(settings.language)
    except Exception:
        pass

    # Create miner client
    client = Twitch(settings)
    loop = asyncio.new_event_loop()
    client.gui.loop = loop

    # HTML UI path
    html_path = UI_DIR / "web" / "index.html"
    icon_path = APP_DIR / "icons" / "pickaxe.ico"

    # Create PyWebView window
    window = webview.create_window(
        title="Twitch Drops Miner Pro (By BCZ) v1.0.1-beta",
        url=str(html_path.resolve()),
        js_api=client.gui.bridge,
        width=1240,
        height=820,
        min_size=(960, 640),
        background_color="#0e0e11",
        text_select=False
    )
    client.gui.set_window(window)

    # Background miner worker thread
    miner_thread = threading.Thread(
        target=run_miner_loop,
        args=(client, loop),
        daemon=True,
        name="MinerAsyncThread"
    )

    def on_loaded():
        # Start miner thread after webview DOM is initialized
        if not miner_thread.is_alive():
            miner_thread.start()

    window.events.loaded += on_loaded

    def on_closing():
        client.gui.close(from_window=True)
        return True

    window.events.closing += on_closing

    def on_closed():
        client.gui.close(from_window=True)

    window.events.closed += on_closed

    # Launch PyWebView (Edge WebView2)
    webview.start(debug=False)



if __name__ == "__main__":
    main()
