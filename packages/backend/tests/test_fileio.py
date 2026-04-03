"""Tests for fileio module."""

import json
from pathlib import Path

from fileio import atomic_write, atomic_write_json


class TestAtomicWrite:
    """Tests for atomic_write (base function)."""

    def test_writes_text_file(self, tmp_path: Path):
        path = tmp_path / "test.md"

        atomic_write(path, "# Hello\n\nContent here.\n")

        assert path.read_text(encoding="utf-8") == "# Hello\n\nContent here.\n"

    def test_creates_parent_directories(self, tmp_path: Path):
        path = tmp_path / "nested" / "dir" / "test.txt"

        atomic_write(path, "data")

        assert path.exists()
        assert path.read_text(encoding="utf-8") == "data"

    def test_overwrites_existing_file(self, tmp_path: Path):
        path = tmp_path / "test.txt"
        path.write_text("old", encoding="utf-8")

        atomic_write(path, "new")

        assert path.read_text(encoding="utf-8") == "new"

    def test_no_leftover_tmp_files(self, tmp_path: Path):
        path = tmp_path / "test.txt"

        atomic_write(path, "data")

        files = list(tmp_path.iterdir())
        assert len(files) == 1
        assert files[0].name == "test.txt"

    def test_preserves_unicode(self, tmp_path: Path):
        path = tmp_path / "test.md"

        atomic_write(path, "Привет 🎯")

        assert path.read_text(encoding="utf-8") == "Привет 🎯"


class TestAtomicWriteJson:
    """Tests for atomic_write_json (JSON convenience wrapper)."""

    def test_writes_json_file(self, tmp_path: Path):
        path = tmp_path / "test.json"
        data = {"key": "value", "number": 42}

        atomic_write_json(path, data)

        result = json.loads(path.read_text(encoding="utf-8"))
        assert result == data

    def test_creates_parent_directories(self, tmp_path: Path):
        path = tmp_path / "nested" / "dir" / "test.json"

        atomic_write_json(path, {"ok": True})

        assert path.exists()

    def test_preserves_unicode(self, tmp_path: Path):
        path = tmp_path / "test.json"

        atomic_write_json(path, {"name": "МетаЛаб", "emoji": "🎯"})

        raw = path.read_text(encoding="utf-8")
        assert "МетаЛаб" in raw
        assert "🎯" in raw

    def test_writes_list(self, tmp_path: Path):
        path = tmp_path / "test.json"
        data = [{"a": 1}, {"b": 2}]

        atomic_write_json(path, data)

        result = json.loads(path.read_text(encoding="utf-8"))
        assert result == data

    def test_trailing_newline(self, tmp_path: Path):
        path = tmp_path / "test.json"

        atomic_write_json(path, {"x": 1})

        raw = path.read_text(encoding="utf-8")
        assert raw.endswith("\n")
