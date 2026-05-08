"""Manifest file watcher for auto-rescan.

Watches root context folders for changes to `context.json` manifests.
On change, debounces 10s then triggers a rescan.

Uses watchfiles (async-native, Rust notify-rs) for OS-level
file system events (FSEvents/inotify/ReadDirectoryChangesW).
"""

import asyncio
import logging
from pathlib import Path
from typing import Awaitable, Callable

from watchfiles import awatch, Change, DefaultFilter

logger = logging.getLogger("duet")

MANIFEST_NAMES = frozenset({"context.json"})
DEBOUNCE_SECONDS = 10


class ManifestFilter(DefaultFilter):
    """Filter that only passes manifest file changes.

    Inherits DefaultFilter exclusions (.git, __pycache__, node_modules,
    hidden files, temp files) then narrows to manifest filenames only.
    """

    def __call__(self, change: Change, path: str) -> bool:
        if not super().__call__(change, path):
            return False
        return Path(path).name in MANIFEST_NAMES


class ManifestWatcher:
    """Watches root context folders for manifest changes, triggers rescan.

    Usage:
        watcher = ManifestWatcher(on_scan=run_scan_with_cache)
        watcher.start(folders)
        # ... later ...
        watcher.stop()
    """

    def __init__(self, on_scan: Callable[[], Awaitable[dict] | dict]):
        self._on_scan = on_scan
        self._task: asyncio.Task | None = None
        self._watched_folders: list[str] = []

    @property
    def is_running(self) -> bool:
        return self._task is not None and not self._task.done()

    @property
    def watched_folders(self) -> list[str]:
        return list(self._watched_folders)

    def start(self, folders: list[str]) -> None:
        """Start watching folders. No-op if already watching same folders."""
        existing = [f for f in folders if Path(f).exists()]
        if not existing:
            logger.info("Watcher: no existing root context folders to watch")
            return

        if self.is_running and existing == self._watched_folders:
            return

        self.stop()
        self._watched_folders = existing
        self._task = asyncio.create_task(self._watch_loop(existing))
        logger.info(f"Watcher: started on {len(existing)} folder(s)")

    def stop(self) -> None:
        """Stop watching."""
        if self._task and not self._task.done():
            self._task.cancel()
            logger.info("Watcher: stopped")
        self._task = None
        self._watched_folders = []

    def restart(self, folders: list[str]) -> None:
        """Restart with new folder list."""
        self.stop()
        self.start(folders)

    def maybe_restart(self, folders: list[str]) -> None:
        """Restart only if folder list changed."""
        existing = [f for f in folders if Path(f).exists()]
        if existing != self._watched_folders:
            logger.info("Watcher: root context folders changed, restarting")
            self.restart(folders)

    async def _watch_loop(self, folders: list[str]) -> None:
        """Main watch loop with debounce."""
        try:
            async for _changes in awatch(
                *folders,
                watch_filter=ManifestFilter(),
                debounce=DEBOUNCE_SECONDS * 1000,  # ms
                recursive=True,
            ):
                logger.info("Watcher: manifest change detected, running scan")
                try:
                    result = self._on_scan()
                    if asyncio.iscoroutine(result):
                        await result
                except Exception:
                    logger.exception("Watcher: scan failed")
        except asyncio.CancelledError:
            pass
        except Exception:
            logger.exception("Watcher: watch loop error")
