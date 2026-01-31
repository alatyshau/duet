"""Tests for server lifecycle (PID file, /stop endpoint)."""

import json
import os
import subprocess
from pathlib import Path

import pytest
from httpx import AsyncClient

import sys
sys.path.insert(0, str(Path(__file__).parent.parent))

import config
from server import (
    check_pid_file,
    remove_pid_file,
    write_pid_file,
)


class TestPidFile:
    """Tests for PID file operations."""

    def test_write_pid_file(self, duet_data: Path) -> None:
        """write_pid_file() writes current PID."""
        write_pid_file()

        pid_path = duet_data / ".pid"
        assert pid_path.exists()

        content = pid_path.read_text().strip()
        assert content == str(os.getpid())

    def test_write_pid_file_creates_parent_dirs(self, tmp_path: Path) -> None:
        """write_pid_file() creates parent directories if needed."""
        # Use a nested path that doesn't exist
        nested_path = tmp_path / "nested" / "duet"
        config.init(nested_path)

        write_pid_file()

        pid_path = nested_path / ".pid"
        assert pid_path.exists()

    def test_remove_pid_file(self, duet_data: Path) -> None:
        """remove_pid_file() removes the PID file."""
        write_pid_file()
        pid_path = duet_data / ".pid"
        assert pid_path.exists()

        remove_pid_file()
        assert not pid_path.exists()

    def test_remove_pid_file_no_error_if_missing(self, duet_data: Path) -> None:
        """remove_pid_file() doesn't raise if file doesn't exist."""
        pid_path = duet_data / ".pid"
        assert not pid_path.exists()

        # Should not raise
        remove_pid_file()

    def test_check_pid_file_returns_none_if_no_file(self, duet_data: Path) -> None:
        """check_pid_file() returns None if no PID file."""
        result = check_pid_file()
        assert result is None

    def test_check_pid_file_returns_pid_if_process_running(self, duet_data: Path) -> None:
        """check_pid_file() returns PID if process is running."""
        # Write our own PID (we're running)
        write_pid_file()

        result = check_pid_file()
        assert result == os.getpid()

    def test_check_pid_file_returns_none_if_process_not_running(self, duet_data: Path) -> None:
        """check_pid_file() returns None if process is not running."""
        pid_path = duet_data / ".pid"
        # Write a PID that definitely doesn't exist
        pid_path.write_text("999999999")

        result = check_pid_file()
        assert result is None

    def test_check_pid_file_returns_none_if_invalid_pid(self, duet_data: Path) -> None:
        """check_pid_file() returns None if PID file contains invalid data."""
        pid_path = duet_data / ".pid"
        pid_path.write_text("not_a_number")

        result = check_pid_file()
        assert result is None


class TestStartupValidation:
    """Tests for startup validation (version check)."""

    def test_startup_fails_without_version(self, tmp_path: Path) -> None:
        """main() exits with error if version not in config.json."""
        # Create config.json without version
        config_path = tmp_path / "config.json"
        config_path.write_text(json.dumps({"port": 19680}))

        # Run server.py with --data-path
        server_py = Path(__file__).parent.parent / "server.py"
        result = subprocess.run(
            [sys.executable, str(server_py), "--data-path", str(tmp_path)],
            capture_output=True,
            text=True,
            timeout=5,
        )

        assert result.returncode == 1
        assert "Version not set" in result.stderr
        assert "Extension must write required fields" in result.stderr

    def test_startup_fails_without_port(self, tmp_path: Path) -> None:
        """main() exits with error if port not in config.json."""
        # Create config.json without port
        config_path = tmp_path / "config.json"
        config_path.write_text(json.dumps({"version": "test"}))

        # Run server.py with --data-path
        server_py = Path(__file__).parent.parent / "server.py"
        result = subprocess.run(
            [sys.executable, str(server_py), "--data-path", str(tmp_path)],
            capture_output=True,
            text=True,
            timeout=5,
        )

        assert result.returncode == 1
        assert "Port not set" in result.stderr
        assert "Extension must write required fields" in result.stderr

    def test_startup_fails_without_timezone(self, tmp_path: Path) -> None:
        """main() exits with error if timestampTZ not in config.json."""
        config_path = tmp_path / "config.json"
        config_path.write_text(json.dumps({
            "version": "test",
            "port": 19680,
            "business_folders": [],
        }))

        server_py = Path(__file__).parent.parent / "server.py"
        result = subprocess.run(
            [sys.executable, str(server_py), "--data-path", str(tmp_path)],
            capture_output=True,
            text=True,
            timeout=5,
        )

        assert result.returncode == 1
        assert "timestampTZ not set" in result.stderr
        assert "Extension must write required fields" in result.stderr

    def test_startup_fails_without_business_folders(self, tmp_path: Path) -> None:
        """main() exits with error if business_folders not in config.json."""
        config_path = tmp_path / "config.json"
        config_path.write_text(json.dumps({
            "version": "test",
            "port": 19680,
            "timestampTZ": {"id": "Z", "value": "UTC"},
        }))

        server_py = Path(__file__).parent.parent / "server.py"
        result = subprocess.run(
            [sys.executable, str(server_py), "--data-path", str(tmp_path)],
            capture_output=True,
            text=True,
            timeout=5,
        )

        assert result.returncode == 1
        assert "business_folders not set" in result.stderr
        assert "Extension must write required fields" in result.stderr


@pytest.mark.asyncio
class TestStopEndpoint:
    """Tests for /stop endpoint."""

    async def test_stop_returns_stopping(self, client: AsyncClient) -> None:
        """POST /stop returns status: stopping."""
        response = await client.post("/stop")
        assert response.status_code == 200

        data = response.json()
        assert data["status"] == "stopping"
