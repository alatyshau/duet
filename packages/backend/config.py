"""Configuration management for Duet backend.

Pointer-based architecture:
- ~/.org.ve68.duet (pointer) → duetDataPath, duetConfigPath, machine
- DuetConfig/settings.json → root_context_folders (@aliases), timestampTZ
- DuetConfig/{machine}.json → port, @alias mappings

Backend reads pointer at startup, resolves all paths itself.

For testing: env DUET_POINTER_FILE overrides pointer path.
"""

import json
import unicodedata
from functools import lru_cache
from pathlib import Path

from pointer import read_pointer, PointerData
from aliases import AliasResolver


# Cached pointer data (read once at startup)
_pointer: PointerData | None = None

# Cached resolver instance
_resolver: AliasResolver | None = None


class ConfigError(Exception):
    """Configuration error."""

    pass


def _get_pointer() -> PointerData:
    """Get cached pointer data.

    Reads pointer file on first call, caches result.

    Raises:
        ConfigError: If pointer file is missing or invalid.
    """
    global _pointer
    if _pointer is None:
        from pointer import PointerNotFoundError, PointerInvalidError

        try:
            _pointer = read_pointer()
        except (PointerNotFoundError, PointerInvalidError) as e:
            raise ConfigError(str(e)) from e
    return _pointer


def _get_resolver() -> AliasResolver:
    """Get cached alias resolver.

    Reads machine config on first call, caches result.
    """
    global _resolver
    if _resolver is None:
        machine_config = read_machine_config()
        _resolver = AliasResolver(machine_config)
    return _resolver


def reset_cache() -> None:
    """Reset all cached config data.

    Call this after changing pointer file (for testing).
    """
    global _pointer, _resolver
    _pointer = None
    _resolver = None


# === Path getters ===


def get_duet_data_path() -> Path:
    """Get path to DuetData directory from pointer."""
    pointer = _get_pointer()
    return Path(pointer["duetDataPath"])


def get_duet_config_path() -> Path:
    """Get path to DuetConfig directory from pointer."""
    pointer = _get_pointer()
    return Path(pointer["duetConfigPath"])


def get_machine() -> str:
    """Get machine identifier from pointer."""
    pointer = _get_pointer()
    return pointer["machine"]


def get_db_path() -> Path:
    """Get path to SQLite database."""
    return get_duet_data_path() / "data" / "entities.db"


def get_instructions_path() -> Path:
    """Get path to instructions workspace from machine.json.

    Reads instructionsPath from machine config (per-machine, absolute path).
    No fallback — missing field raises ConfigError.
    """
    machine_config = read_machine_config()
    instructions_path = machine_config.get("instructionsPath")

    if instructions_path is None:
        raise ConfigError(
            f"instructionsPath not set in {get_machine()}.json. "
            "Configure instructions workspace path in Host settings."
        )

    path = Path(instructions_path)
    if not path.exists():
        raise ConfigError(
            f"Instructions workspace not found: {instructions_path}. "
            "Check instructionsPath in machine config."
        )

    return path


def get_log_path() -> Path:
    """Get path to backend.log."""
    return get_duet_data_path() / "backend.log"


def get_repos_path() -> Path | None:
    """Get path to repos directory if exists."""
    repos_path = get_duet_data_path() / "repos"
    if repos_path.exists():
        return repos_path
    return None


def get_version_path() -> Path:
    """Get path to VERSION file in backend directory."""
    return get_duet_data_path() / "backend" / "VERSION"


def get_settings_path() -> Path:
    """Get path to settings.json in DuetConfig."""
    return get_duet_config_path() / "settings.json"


def get_machine_config_path() -> Path:
    """Get path to {machine}.json in DuetConfig."""
    machine = get_machine()
    return get_duet_config_path() / f"{machine}.json"


# === Config file readers ===


def read_settings() -> dict:
    """Read settings.json from DuetConfig.

    Returns:
        Dict with root_context_folders (list of @aliases), timestampTZ.

    Raises:
        ConfigError: If file is missing or invalid.
    """
    settings_path = get_settings_path()

    if not settings_path.exists():
        raise ConfigError(
            f"Settings file not found: {settings_path}. "
            "Create settings.json in DuetConfig."
        )

    try:
        data = json.loads(settings_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        raise ConfigError(f"Invalid JSON in settings.json: {e}") from e

    return data


def read_machine_config() -> dict:
    """Read {machine}.json from DuetConfig.

    Returns:
        Dict with port and @alias mappings.

    Raises:
        ConfigError: If file is missing or invalid.
    """
    machine_path = get_machine_config_path()

    if not machine_path.exists():
        raise ConfigError(
            f"Machine config not found: {machine_path}. "
            "Create {machine}.json in DuetConfig."
        )

    try:
        data = json.loads(machine_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        raise ConfigError(f"Invalid JSON in {machine_path.name}: {e}") from e

    return data


# === Getters for specific config values ===


def get_port() -> int:
    """Get HTTP server port from machine config.

    Raises:
        ConfigError: If port is not set or invalid.
    """
    machine_config = read_machine_config()
    port = machine_config.get("port")

    if port is None:
        raise ConfigError(
            f"Port not set in {get_machine()}.json. "
            "Add 'port' field to machine config."
        )

    if not isinstance(port, int):
        raise ConfigError(
            f"Port must be an integer in {get_machine()}.json, got {type(port).__name__}"
        )

    return port


def get_timezone() -> dict:
    """Get timezone configuration from settings.

    Returns:
        Dict with 'id' and 'value' keys.

    Raises:
        ConfigError: If timestampTZ is not set or invalid.
    """
    settings = read_settings()
    timezone = settings.get("timestampTZ")

    if timezone is None:
        raise ConfigError(
            "timestampTZ not set in settings.json. "
            "Add 'timestampTZ' field with 'id' and 'value'."
        )

    if not isinstance(timezone, dict):
        raise ConfigError(
            f"timestampTZ must be a dict in settings.json, got {type(timezone).__name__}"
        )

    if "id" not in timezone or "value" not in timezone:
        raise ConfigError(
            "timestampTZ must have 'id' and 'value' keys in settings.json"
        )

    return timezone


def get_root_context_folders() -> list[str]:
    """Get list of root context folders (resolved from @aliases).

    Reads root_context_folders from settings.json (as @aliases),
    resolves them to absolute paths using machine config.

    Normalizes paths to NFC for consistent comparison.

    Returns:
        List of absolute paths.

    Raises:
        ConfigError: If root_context_folders not set or alias not found.
    """
    settings = read_settings()
    folders = settings.get("root_context_folders")

    if folders is None:
        raise ConfigError(
            "root_context_folders not set in settings.json. "
            "Add 'root_context_folders' field with list of @aliases."
        )

    if not isinstance(folders, list):
        raise ConfigError(
            f"root_context_folders must be a list in settings.json, got {type(folders).__name__}"
        )

    resolver = _get_resolver()
    try:
        resolved = resolver.resolve_all(folders)
    except Exception as e:
        raise ConfigError(f"Failed to resolve root_context_folders: {e}") from e

    # Normalize Unicode: macOS filesystem may use NFD
    return [unicodedata.normalize("NFC", f) for f in resolved]


def get_version() -> str:
    """Get backend version from VERSION file.

    Version is written by Host when installing/updating backend.
    Located at DuetData/backend/VERSION.

    Returns:
        Version string.

    Raises:
        ConfigError: If VERSION file is missing.
    """
    version_path = get_version_path()

    if not version_path.exists():
        raise ConfigError(
            f"VERSION file not found: {version_path}. "
            "Backend may not be properly installed."
        )

    return version_path.read_text(encoding="utf-8").strip()


def get_aliases() -> dict[str, str]:
    """Get all @aliases from machine config.

    Returns:
        Dict mapping @alias to absolute path.
    """
    resolver = _get_resolver()
    return resolver.get_aliases()


def resolve_alias(path: str) -> str:
    """Resolve single @alias path to absolute path.

    Args:
        path: Path that may start with @alias.

    Returns:
        Resolved absolute path.

    Raises:
        ConfigError: If alias not found.
    """
    resolver = _get_resolver()
    try:
        return resolver.resolve(path)
    except Exception as e:
        raise ConfigError(f"Failed to resolve alias: {e}") from e


# === Legacy compatibility (for gradual migration) ===


def init(data_path: str | Path) -> None:
    """Legacy init function for tests.

    DEPRECATED: Backend now reads pointer file directly.
    This function is kept for test compatibility only.

    For tests, use DUET_POINTER_FILE env variable instead.
    """
    # This is a no-op now - tests should set up pointer file
    # and use DUET_POINTER_FILE env variable
    pass
