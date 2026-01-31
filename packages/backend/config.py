"""Configuration management for Duet backend.

Backend receives data_path from Extension via CLI argument.
All other configuration read from config.json.

Configuration file: config.json
- version: backend version (written by Extension from package.json)
- port: HTTP server port (required; written by Extension)
- business_folders: list of paths to scan (required; can be empty)
- timestampTZ: timezone for timestamp formatting (required)
"""

import json
import os
import tempfile
from pathlib import Path


VERSION_NOT_SET = "VERSION_NOT_SET"

# Initialized by server.py via init()
_data_path: Path | None = None


def init(data_path: str | Path) -> None:
    """Initialize configuration with DuetData path.

    Must be called before any other config functions.
    Called by server.py with --data-path argument.
    """
    global _data_path
    _data_path = Path(data_path)


def get_duet_data_path() -> Path:
    """Get path to DuetData directory.

    Raises RuntimeError if init() was not called.
    """
    if _data_path is None:
        raise RuntimeError(
            "Config not initialized. "
            "Call config.init(data_path) first or pass --data-path to server."
        )
    return _data_path


def get_db_path() -> Path:
    """Get path to SQLite database."""
    return get_duet_data_path() / "data" / "entities.db"


def get_pid_path() -> Path:
    """Get path to PID lockfile."""
    return get_duet_data_path() / ".pid"


def get_ai_kit_path() -> Path:
    """Get path to ai-kit directory."""
    return get_duet_data_path() / "ai-kit"


def get_config_path() -> Path:
    """Get path to config.json."""
    return get_duet_data_path() / "config.json"


def read_config() -> dict:
    """Read config.json.

    Returns dict with:
    - version: backend version (written by Extension)
    - port: HTTP server port (int) or None if missing/invalid
    - business_folders: list[str] or None if missing/invalid
    - timestampTZ: dict or None if missing/invalid
    """
    config_path = get_config_path()
    data = {}

    if config_path.exists():
        try:
            with open(config_path, "r", encoding="utf-8") as f:
                data = json.load(f)
        except (json.JSONDecodeError, IOError):
            pass

    # Port is required for backend start. We don't default here to avoid silently
    # starting on an unexpected port when Extension forgot to write config.
    port = data.get("port")
    if not isinstance(port, int):
        port = None

    # business_folders is required (but can be empty list)
    folders = data.get("business_folders")
    if not isinstance(folders, list):
        folders = None
    else:
        folders = [f for f in folders if isinstance(f, str)]

    # timestampTZ is required (dict with 'id' and 'value' keys)
    timezone = data.get("timestampTZ")
    if (
        not isinstance(timezone, dict)
        or "id" not in timezone
        or "value" not in timezone
        or not isinstance(timezone["id"], str)
        or not isinstance(timezone["value"], str)
    ):
        timezone = None

    # Get version (required field)
    version = data.get("version")

    return {
        "port": port,
        "business_folders": folders,
        "timestampTZ": timezone,
        "version": version,
    }


def get_port() -> int:
    """Get HTTP server port from config.json.

    Port must be written by Extension before starting backend.

    Raises:
        RuntimeError: If port is not set or invalid in config.json.
    """
    cfg = read_config()
    port = cfg.get("port")
    if port is None:
        raise RuntimeError(
            "Port not set in config.json. "
            "Extension must write 'port' before starting backend."
        )
    return port


def get_timezone() -> dict:
    """Get timezone configuration.

    Returns dict with 'id' and 'value' keys.
    """
    cfg = read_config()
    timezone = cfg.get("timestampTZ")
    if timezone is None:
        raise RuntimeError(
            "timestampTZ not set in config.json. "
            "Extension must write 'timestampTZ' before starting backend."
        )
    return timezone


def get_business_folders() -> list[str]:
    """Get list of business folders to scan."""
    cfg = read_config()
    folders = cfg.get("business_folders")
    if folders is None:
        raise RuntimeError(
            "business_folders not set in config.json. "
            "Extension must write 'business_folders' before starting backend."
        )
    return folders


def get_version() -> str:
    """Get backend version from config.json.

    Version is written by Extension from its package.json before starting backend.
    This ensures backend version always matches Extension version.

    Raises:
        RuntimeError: If version is not set in config (Extension must write it).
    """
    config = read_config()
    version = config.get("version")
    if not version:
        raise RuntimeError(
            "Version not set in config.json. "
            "Extension must write 'version' before starting backend."
        )
    return version


def get_repos_path() -> Path | None:
    """Get path to repos directory if exists."""
    repos_path = get_duet_data_path() / "repos"
    if repos_path.exists():
        return repos_path
    return None


def get_state_path() -> Path:
    """Get path to state.json for multi-window sync."""
    return get_duet_data_path() / "state.json"


def get_log_path() -> Path:
    """Get path to backend.log."""
    return get_duet_data_path() / "backend.log"


def atomic_write(path: Path, content: str) -> None:
    """Write content to file atomically using tmp + rename.

    Prevents corruption if process crashes mid-write.
    Works on same filesystem (rename is atomic on POSIX).

    Args:
        path: Target file path
        content: Content to write
    """
    # Create temp file in same directory (ensures same filesystem for atomic rename)
    dir_path = path.parent
    dir_path.mkdir(parents=True, exist_ok=True)

    fd, tmp_path = tempfile.mkstemp(dir=dir_path, prefix=f".{path.name}.", suffix=".tmp")
    try:
        os.write(fd, content.encode("utf-8"))
        os.close(fd)
        os.rename(tmp_path, path)
    except Exception:
        # Cleanup on error
        os.close(fd) if fd else None
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        raise
