"""File I/O utilities for Duet backend."""

import json
from pathlib import Path


def atomic_write(path: Path, content: str) -> None:
    """Write file atomically via .new → rename → cleanup .old.

    File watchers never see half-written files.

    Args:
        path: Target file path.
        content: Text content to write.
    """
    path.parent.mkdir(parents=True, exist_ok=True)

    new_path = path.with_suffix(path.suffix + ".new")
    old_path = path.with_suffix(path.suffix + ".old")

    # Write to .new
    new_path.write_text(content, encoding="utf-8")

    # Rename current → .old (if exists)
    if path.exists():
        path.rename(old_path)

    # Rename .new → target
    new_path.rename(path)

    # Cleanup .old
    if old_path.exists():
        old_path.unlink()


def atomic_write_json(path: Path, data: dict | list) -> None:
    """Write JSON file atomically.

    Convenience wrapper over atomic_write with JSON serialization.
    """
    atomic_write(path, json.dumps(data, ensure_ascii=False, indent=2) + "\n")
