"""Tests for pointer.py - Pointer file reader."""

import json
import os
from pathlib import Path

import pytest

import sys
sys.path.insert(0, str(Path(__file__).parent.parent))

from pointer import (
    PointerData,
    PointerInvalidError,
    PointerNotFoundError,
    get_pointer_path,
    pointer_exists,
    read_pointer,
)


class TestGetPointerPath:
    """Tests for get_pointer_path()."""

    def test_default_path(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """Default path is ~/.org.ve68.duet."""
        monkeypatch.delenv("DUET_POINTER_FILE", raising=False)
        assert get_pointer_path() == Path.home() / ".org.ve68.duet"

    def test_env_override(self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
        """DUET_POINTER_FILE env overrides default path."""
        custom_path = tmp_path / "custom_pointer"
        monkeypatch.setenv("DUET_POINTER_FILE", str(custom_path))
        assert get_pointer_path() == custom_path


class TestReadPointer:
    """Tests for read_pointer()."""

    def test_reads_valid_pointer(
        self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
    ) -> None:
        """Reads valid pointer file."""
        pointer_path = tmp_path / ".org.ve68.duet"
        pointer_path.write_text(
            json.dumps({
                "machine": "mac_work",
                "duetDataPath": "/Users/test/DuetData",
                "duetConfigPath": "/Users/test/DuetConfig",
            })
        )
        monkeypatch.setenv("DUET_POINTER_FILE", str(pointer_path))

        result = read_pointer()

        assert result["machine"] == "mac_work"
        assert result["duetDataPath"] == "/Users/test/DuetData"
        assert result["duetConfigPath"] == "/Users/test/DuetConfig"

    def test_raises_if_not_found(
        self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
    ) -> None:
        """Raises PointerNotFoundError if file doesn't exist."""
        pointer_path = tmp_path / "nonexistent"
        monkeypatch.setenv("DUET_POINTER_FILE", str(pointer_path))

        with pytest.raises(PointerNotFoundError, match="Pointer file not found"):
            read_pointer()

    def test_raises_on_invalid_json(
        self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
    ) -> None:
        """Raises PointerInvalidError on invalid JSON."""
        pointer_path = tmp_path / ".org.ve68.duet"
        pointer_path.write_text("{ invalid json }")
        monkeypatch.setenv("DUET_POINTER_FILE", str(pointer_path))

        with pytest.raises(PointerInvalidError, match="Invalid JSON"):
            read_pointer()

    def test_raises_on_missing_machine(
        self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
    ) -> None:
        """Raises PointerInvalidError if machine field is missing."""
        pointer_path = tmp_path / ".org.ve68.duet"
        pointer_path.write_text(
            json.dumps({
                "duetDataPath": "/path",
                "duetConfigPath": "/path",
            })
        )
        monkeypatch.setenv("DUET_POINTER_FILE", str(pointer_path))

        with pytest.raises(PointerInvalidError, match="missing required fields.*machine"):
            read_pointer()

    def test_raises_on_missing_duet_data_path(
        self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
    ) -> None:
        """Raises PointerInvalidError if duetDataPath field is missing."""
        pointer_path = tmp_path / ".org.ve68.duet"
        pointer_path.write_text(
            json.dumps({
                "machine": "mac",
                "duetConfigPath": "/path",
            })
        )
        monkeypatch.setenv("DUET_POINTER_FILE", str(pointer_path))

        with pytest.raises(PointerInvalidError, match="missing required fields.*duetDataPath"):
            read_pointer()

    def test_raises_on_missing_duet_config_path(
        self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
    ) -> None:
        """Raises PointerInvalidError if duetConfigPath field is missing."""
        pointer_path = tmp_path / ".org.ve68.duet"
        pointer_path.write_text(
            json.dumps({
                "machine": "mac",
                "duetDataPath": "/path",
            })
        )
        monkeypatch.setenv("DUET_POINTER_FILE", str(pointer_path))

        with pytest.raises(PointerInvalidError, match="missing required fields.*duetConfigPath"):
            read_pointer()

    def test_raises_on_empty_machine(
        self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
    ) -> None:
        """Raises PointerInvalidError if machine field is empty."""
        pointer_path = tmp_path / ".org.ve68.duet"
        pointer_path.write_text(
            json.dumps({
                "machine": "",
                "duetDataPath": "/path",
                "duetConfigPath": "/path",
            })
        )
        monkeypatch.setenv("DUET_POINTER_FILE", str(pointer_path))

        with pytest.raises(PointerInvalidError, match="missing required fields"):
            read_pointer()

    def test_raises_on_wrong_type(
        self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
    ) -> None:
        """Raises PointerInvalidError if field has wrong type."""
        pointer_path = tmp_path / ".org.ve68.duet"
        pointer_path.write_text(
            json.dumps({
                "machine": 123,  # Should be string
                "duetDataPath": "/path",
                "duetConfigPath": "/path",
            })
        )
        monkeypatch.setenv("DUET_POINTER_FILE", str(pointer_path))

        with pytest.raises(PointerInvalidError, match="must be a string"):
            read_pointer()


class TestPointerExists:
    """Tests for pointer_exists()."""

    def test_returns_true_if_exists(
        self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
    ) -> None:
        """Returns True if pointer file exists."""
        pointer_path = tmp_path / ".org.ve68.duet"
        pointer_path.write_text("{}")
        monkeypatch.setenv("DUET_POINTER_FILE", str(pointer_path))

        assert pointer_exists() is True

    def test_returns_false_if_not_exists(
        self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
    ) -> None:
        """Returns False if pointer file doesn't exist."""
        pointer_path = tmp_path / "nonexistent"
        monkeypatch.setenv("DUET_POINTER_FILE", str(pointer_path))

        assert pointer_exists() is False
