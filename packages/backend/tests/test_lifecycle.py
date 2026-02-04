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
from tests.fixtures import DuetDataBuilder


class TestPidFile:
    """Tests for PID file operations."""

    def test_write_pid_file(self, duet_data: Path) -> None:
        """write_pid_file() writes current PID."""
        write_pid_file()

        pid_path = duet_data / ".pid"
        assert pid_path.exists()

        content = pid_path.read_text().strip()
        assert content == str(os.getpid())

    def test_write_pid_file_creates_parent_dirs(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """write_pid_file() creates parent directories if needed."""
        # Create DuetData at a nested path
        builder = DuetDataBuilder(tmp_path / "nested")
        builder.build(monkeypatch)

        write_pid_file()

        pid_path = builder.duet_data_path / ".pid"
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
    """Tests for startup validation (config checks).

    New architecture: Backend reads pointer file, not --data-path argument.
    """

    def _create_test_setup(self, tmp_path: Path, **overrides) -> Path:
        """Create test DuetData + DuetConfig + pointer structure.

        Returns path to pointer file.
        """
        builder = DuetDataBuilder(tmp_path)

        if "version" in overrides:
            builder.with_version(overrides["version"])
        if "port" in overrides:
            builder.with_port(overrides["port"])
        if "business_folders" in overrides:
            builder.with_business_folders(overrides["business_folders"])

        builder.build()
        return builder.pointer_path

    def test_startup_fails_without_version(self, tmp_path: Path) -> None:
        """main() exits with error if VERSION file missing."""
        builder = DuetDataBuilder(tmp_path)
        builder.with_version(None)  # Don't create VERSION file
        builder.build()

        # Run server.py with DUET_POINTER_FILE env
        server_py = Path(__file__).parent.parent / "server.py"
        env = {**os.environ, "DUET_POINTER_FILE": str(builder.pointer_path)}
        result = subprocess.run(
            [sys.executable, str(server_py)],
            capture_output=True,
            text=True,
            timeout=5,
            env=env,
        )

        assert result.returncode == 1
        # Check stderr or log file for error message
        output = result.stderr + result.stdout
        assert "VERSION" in output or "Config error" in output

    def test_startup_fails_without_port(self, tmp_path: Path) -> None:
        """main() exits with error if port not in machine config."""
        builder = DuetDataBuilder(tmp_path)
        builder.build()

        # Remove port from machine config
        machine_config_path = builder.duet_config_path / "test_machine.json"
        with open(machine_config_path, "r") as f:
            machine_config = json.load(f)
        del machine_config["port"]
        with open(machine_config_path, "w") as f:
            json.dump(machine_config, f)

        server_py = Path(__file__).parent.parent / "server.py"
        env = {**os.environ, "DUET_POINTER_FILE": str(builder.pointer_path)}
        result = subprocess.run(
            [sys.executable, str(server_py)],
            capture_output=True,
            text=True,
            timeout=5,
            env=env,
        )

        assert result.returncode == 1
        output = result.stderr + result.stdout
        assert "Port" in output or "port" in output or "Config error" in output

    def test_startup_fails_without_timezone(self, tmp_path: Path) -> None:
        """main() exits with error if timestampTZ not in settings."""
        builder = DuetDataBuilder(tmp_path)
        builder.build()

        # Remove timestampTZ from settings
        settings_path = builder.duet_config_path / "settings.json"
        with open(settings_path, "r") as f:
            settings = json.load(f)
        del settings["timestampTZ"]
        with open(settings_path, "w") as f:
            json.dump(settings, f)

        server_py = Path(__file__).parent.parent / "server.py"
        env = {**os.environ, "DUET_POINTER_FILE": str(builder.pointer_path)}
        result = subprocess.run(
            [sys.executable, str(server_py)],
            capture_output=True,
            text=True,
            timeout=5,
            env=env,
        )

        assert result.returncode == 1
        output = result.stderr + result.stdout
        assert "timestampTZ" in output or "Config error" in output

    def test_startup_fails_without_business_folders(self, tmp_path: Path) -> None:
        """main() exits with error if business_folders not in settings."""
        builder = DuetDataBuilder(tmp_path)
        builder.build()

        # Remove business_folders from settings
        settings_path = builder.duet_config_path / "settings.json"
        with open(settings_path, "r") as f:
            settings = json.load(f)
        del settings["business_folders"]
        with open(settings_path, "w") as f:
            json.dump(settings, f)

        server_py = Path(__file__).parent.parent / "server.py"
        env = {**os.environ, "DUET_POINTER_FILE": str(builder.pointer_path)}
        result = subprocess.run(
            [sys.executable, str(server_py)],
            capture_output=True,
            text=True,
            timeout=5,
            env=env,
        )

        assert result.returncode == 1
        output = result.stderr + result.stdout
        assert "business_folders" in output or "Config error" in output


@pytest.mark.asyncio
class TestStopEndpoint:
    """Tests for /stop endpoint."""

    async def test_stop_returns_stopping(self, client: AsyncClient) -> None:
        """POST /stop returns status: stopping."""
        response = await client.post("/stop")
        assert response.status_code == 200

        data = response.json()
        assert data["status"] == "stopping"
