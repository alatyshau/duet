"""Configuration management for Duet backend.

Backend receives data_path from Extension via CLI argument.
All other configuration read from config.json.

Configuration file: config.json
- version: backend version (written by Extension from package.json)
- port: HTTP server port (default 19680)
- business_folders: list of paths to scan
- timestampTZ: timezone for timestamp formatting
"""

import json
from pathlib import Path


DEFAULT_PORT = 19680
DEFAULT_TIMEZONE = {"id": "Z", "value": "UTC"}
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
    - port: HTTP server port
    - business_folders: list of paths to scan
    - timestampTZ: timezone config
    """
    config_path = get_config_path()
    data = {}

    if config_path.exists():
        try:
            with open(config_path, "r", encoding="utf-8") as f:
                data = json.load(f)
        except (json.JSONDecodeError, IOError):
            pass

    # Get port
    port = data.get("port", DEFAULT_PORT)
    if not isinstance(port, int):
        port = DEFAULT_PORT

    # Validate business_folders
    folders = data.get("business_folders", [])
    if not isinstance(folders, list):
        folders = []
    folders = [f for f in folders if isinstance(f, str)]

    # Validate timestampTZ (must be dict with 'id' and 'value' keys)
    timezone = data.get("timestampTZ", DEFAULT_TIMEZONE)
    if not isinstance(timezone, dict) or "id" not in timezone or "value" not in timezone:
        timezone = DEFAULT_TIMEZONE

    # Get version (required field)
    version = data.get("version")

    return {
        "port": port,
        "business_folders": folders,
        "timestampTZ": timezone,
        "version": version,
    }


def get_port() -> int:
    """Get HTTP server port."""
    config = read_config()
    return config.get("port", DEFAULT_PORT)


def get_timezone() -> dict:
    """Get timezone configuration.

    Returns dict with 'id' and 'value' keys.
    """
    config = read_config()
    return config.get("timestampTZ", DEFAULT_TIMEZONE)


def get_business_folders() -> list[str]:
    """Get list of business folders to scan."""
    config = read_config()
    return config.get("business_folders", [])


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
