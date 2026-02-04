"""Pointer file reader for Duet backend.

The pointer file (~/.org.ve68.duet) is a JSON file that points to:
- DuetData: local cache directory
- DuetConfig: cloud-synced configuration directory
- machine: identifier for machine-specific config

Pointer file format:
{
    "machine": "mac_work",
    "duetDataPath": "/Users/.../DuetData",
    "duetConfigPath": "/Users/.../DuetConfig"
}

For testing: set env DUET_POINTER_FILE to override default path.
"""

import json
import os
from pathlib import Path
from typing import TypedDict


class PointerData(TypedDict):
    """Contents of the pointer file."""

    machine: str
    duetDataPath: str
    duetConfigPath: str


class PointerNotFoundError(Exception):
    """Raised when pointer file does not exist."""

    pass


class PointerInvalidError(Exception):
    """Raised when pointer file is invalid or missing required fields."""

    pass


def get_pointer_path() -> Path:
    """Get path to pointer file.

    Default: ~/.org.ve68.duet
    Override: env DUET_POINTER_FILE (for testing)
    """
    env_path = os.environ.get("DUET_POINTER_FILE")
    if env_path:
        return Path(env_path)
    return Path.home() / ".org.ve68.duet"


def read_pointer() -> PointerData:
    """Read and validate pointer file.

    Returns:
        PointerData with machine, duetDataPath, duetConfigPath.

    Raises:
        PointerNotFoundError: If pointer file does not exist.
        PointerInvalidError: If file is invalid JSON or missing required fields.
    """
    pointer_path = get_pointer_path()

    if not pointer_path.exists():
        raise PointerNotFoundError(
            f"Pointer file not found: {pointer_path}. "
            "Run Duet Host to create it."
        )

    try:
        data = json.loads(pointer_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        raise PointerInvalidError(f"Invalid JSON in pointer file: {e}") from e

    # Validate required fields
    required = ["machine", "duetDataPath", "duetConfigPath"]
    missing = [f for f in required if f not in data or not data[f]]
    if missing:
        raise PointerInvalidError(
            f"Pointer file missing required fields: {', '.join(missing)}"
        )

    # Validate types
    for field in required:
        if not isinstance(data[field], str):
            raise PointerInvalidError(
                f"Pointer field '{field}' must be a string, got {type(data[field]).__name__}"
            )

    return PointerData(
        machine=data["machine"],
        duetDataPath=data["duetDataPath"],
        duetConfigPath=data["duetConfigPath"],
    )


def pointer_exists() -> bool:
    """Check if pointer file exists (without reading it)."""
    return get_pointer_path().exists()
