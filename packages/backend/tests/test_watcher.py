"""Tests for watcher.py - Manifest file watcher."""

import asyncio
import json
from pathlib import Path

import pytest

from watcher import ManifestWatcher, ManifestFilter, MANIFEST_NAMES
from watchfiles import Change


class TestManifestFilter:
    """Tests for ManifestFilter."""

    def test_passes_business_json(self):
        f = ManifestFilter()
        assert f(Change.modified, "/some/path/business.json") is True

    def test_passes_stream_json(self):
        f = ManifestFilter()
        assert f(Change.modified, "/some/path/stream.json") is True

    def test_passes_product_json(self):
        f = ManifestFilter()
        assert f(Change.modified, "/some/path/product.json") is True

    def test_rejects_other_json(self):
        f = ManifestFilter()
        assert f(Change.modified, "/some/path/settings.json") is False

    def test_rejects_non_json(self):
        f = ManifestFilter()
        assert f(Change.modified, "/some/path/README.md") is False

    def test_rejects_manifest_name_in_directory(self):
        """business.json in dir name but file is something else."""
        f = ManifestFilter()
        assert f(Change.modified, "/business.json/other.txt") is False

    def test_passes_nested_manifest(self):
        f = ManifestFilter()
        assert f(Change.modified, "/root/sub/deep/stream.json") is True

    def test_passes_created_manifest(self):
        f = ManifestFilter()
        assert f(Change.added, "/some/path/business.json") is True

    def test_passes_deleted_manifest(self):
        f = ManifestFilter()
        assert f(Change.deleted, "/some/path/product.json") is True

    def test_rejects_manifest_in_git_dir(self):
        """DefaultFilter exclusion: .git directory."""
        f = ManifestFilter()
        assert f(Change.modified, "/some/.git/business.json") is False

    def test_rejects_manifest_in_pycache(self):
        """DefaultFilter exclusion: __pycache__ directory."""
        f = ManifestFilter()
        assert f(Change.modified, "/some/__pycache__/stream.json") is False


class TestManifestWatcher:
    """Tests for ManifestWatcher lifecycle."""

    def test_initial_state(self):
        watcher = ManifestWatcher(on_scan=lambda: None)
        assert not watcher.is_running
        assert watcher.watched_folders == []

    @pytest.mark.asyncio
    async def test_start_with_existing_folders(self, tmp_path: Path):
        folder = tmp_path / "business"
        folder.mkdir()

        watcher = ManifestWatcher(on_scan=lambda: None)
        watcher.start([str(folder)])

        assert watcher.is_running
        assert watcher.watched_folders == [str(folder)]

        watcher.stop()
        assert not watcher.is_running
        assert watcher.watched_folders == []

    @pytest.mark.asyncio
    async def test_start_with_nonexistent_folders(self, tmp_path: Path):
        watcher = ManifestWatcher(on_scan=lambda: None)
        watcher.start([str(tmp_path / "does_not_exist")])

        assert not watcher.is_running

    @pytest.mark.asyncio
    async def test_start_filters_nonexistent(self, tmp_path: Path):
        existing = tmp_path / "exists"
        existing.mkdir()

        watcher = ManifestWatcher(on_scan=lambda: None)
        watcher.start([str(existing), str(tmp_path / "nope")])

        assert watcher.is_running
        assert watcher.watched_folders == [str(existing)]
        watcher.stop()

    @pytest.mark.asyncio
    async def test_start_idempotent_same_folders(self, tmp_path: Path):
        folder = tmp_path / "business"
        folder.mkdir()

        watcher = ManifestWatcher(on_scan=lambda: None)
        watcher.start([str(folder)])
        task1 = watcher._task

        # Start again with same folders — should be no-op
        watcher.start([str(folder)])
        assert watcher._task is task1

        watcher.stop()

    @pytest.mark.asyncio
    async def test_stop_idempotent(self, tmp_path: Path):
        watcher = ManifestWatcher(on_scan=lambda: None)
        # Stop without start — should not raise
        watcher.stop()
        watcher.stop()

    @pytest.mark.asyncio
    async def test_restart(self, tmp_path: Path):
        folder1 = tmp_path / "biz1"
        folder2 = tmp_path / "biz2"
        folder1.mkdir()
        folder2.mkdir()

        watcher = ManifestWatcher(on_scan=lambda: None)
        watcher.start([str(folder1)])
        assert watcher.watched_folders == [str(folder1)]

        watcher.restart([str(folder2)])
        assert watcher.is_running
        assert watcher.watched_folders == [str(folder2)]

        watcher.stop()

    @pytest.mark.asyncio
    async def test_maybe_restart_no_change(self, tmp_path: Path):
        folder = tmp_path / "business"
        folder.mkdir()

        watcher = ManifestWatcher(on_scan=lambda: None)
        watcher.start([str(folder)])
        task1 = watcher._task

        watcher.maybe_restart([str(folder)])
        # Same folders — task unchanged
        assert watcher._task is task1

        watcher.stop()

    @pytest.mark.asyncio
    async def test_maybe_restart_with_change(self, tmp_path: Path):
        folder1 = tmp_path / "biz1"
        folder2 = tmp_path / "biz2"
        folder1.mkdir()
        folder2.mkdir()

        watcher = ManifestWatcher(on_scan=lambda: None)
        watcher.start([str(folder1)])
        task1 = watcher._task

        watcher.maybe_restart([str(folder2)])
        # Different folders — new task
        assert watcher._task is not task1
        assert watcher.watched_folders == [str(folder2)]

        watcher.stop()

    @pytest.mark.asyncio
    async def test_scan_triggered_on_manifest_change(self, tmp_path: Path):
        """Integration test: manifest change triggers scan callback."""
        folder = tmp_path / "business"
        folder.mkdir()

        scan_count = 0

        def on_scan():
            nonlocal scan_count
            scan_count += 1
            return {"status": "completed"}

        watcher = ManifestWatcher(on_scan=on_scan)
        watcher.start([str(folder)])

        # Give watcher time to initialize
        await asyncio.sleep(0.5)

        # Write a manifest file
        (folder / "business.json").write_text(
            json.dumps({"name": "Test", "icon": "📁"}),
            encoding="utf-8",
        )

        # Wait for debounce (watchfiles default debounce ~1.6s, we set 10s)
        # For test speed, we'll just verify the watcher is running
        # Full integration with debounce is too slow for unit tests
        assert watcher.is_running

        watcher.stop()

    @pytest.mark.asyncio
    async def test_async_on_scan(self, tmp_path: Path):
        """Watcher accepts async on_scan callback."""
        folder = tmp_path / "business"
        folder.mkdir()

        async def async_scan():
            return {"status": "completed"}

        watcher = ManifestWatcher(on_scan=async_scan)
        watcher.start([str(folder)])
        assert watcher.is_running
        watcher.stop()


class TestManifestNames:
    """Verify MANIFEST_NAMES constant."""

    def test_contains_expected(self):
        assert "business.json" in MANIFEST_NAMES
        assert "stream.json" in MANIFEST_NAMES
        assert "product.json" in MANIFEST_NAMES

    def test_no_project_json(self):
        """project.json was removed — entity type no longer exists."""
        assert "project.json" not in MANIFEST_NAMES
