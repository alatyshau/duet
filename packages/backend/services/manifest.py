"""Shared manifest readers.

Entity manifests (business.json / stream.json / product.json) are the source
of truth on disk. Several services read them fresh per request (scanner caches
into DB, but workspace/entities services read live for freshness). This module
centralizes the raw parsing so callers share one implementation.
"""

from __future__ import annotations

import json
from pathlib import Path


# Manifest filename by entity type (entities that carry a manifest on disk).
MANIFEST_FILENAMES: dict[str, str] = {
    "business": "business.json",
    "stream": "stream.json",
    "product": "product.json",
}


def read_manifest(folder: Path | str | None, entity_type: str) -> dict | None:
    """Read and parse the manifest for an entity at `folder`.

    Returns parsed JSON dict, or None if the entity type has no manifest,
    the folder is missing, or the file is absent/unreadable/invalid JSON.
    """
    filename = MANIFEST_FILENAMES.get(entity_type)
    if not filename or not folder:
        return None

    manifest_path = Path(folder) / filename
    try:
        with open(manifest_path, "r", encoding="utf-8") as f:
            data = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return None

    return data if isinstance(data, dict) else None


def read_reference_repos(
    folder: Path | str | None, entity_type: str
) -> dict[str, str] | None:
    """Return `{name: url}` from the entity's manifest, or None if absent.

    Values are coerced to str; non-dict manifest field or empty dict yields None.
    """
    data = read_manifest(folder, entity_type)
    if not data:
        return None

    ref_repos = data.get("reference_repos")
    if not isinstance(ref_repos, dict) or not ref_repos:
        return None

    return {str(k): str(v) for k, v in ref_repos.items()}
