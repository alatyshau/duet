"""Strict v3 context-manifest reader.

Backend is a strict reader of `context.json` (schema v3). All migration —
including upgrades from legacy v1 (`business.json` / `stream.json` /
`product.json`) and v2 (`git_url` → `git_repos`) — is owned by Host on
startup. Backend never writes manifests.

v3 introduces multi-repo terminal contexts via the `git_repos` map
(alias → URL). Single-string `git_url` is gone.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path


MANIFEST_FILENAME = "context.json"
TARGET_VERSION = 3


@dataclass
class Manifest:
    version: int
    name: str
    icon: str | None = None
    meta: bool = False
    git_repos: dict[str, str] | None = None
    reference_repos: dict[str, str] | None = None
    description: str | None = None


def read_manifest(
    folder: Path | str | None,
    errors: list[dict] | None = None,
) -> Manifest | None:
    """Read and parse `context.json` at `folder`.

    Returns:
        Manifest on successful v3 parse.
        None when file is absent (not an error), invalid JSON, or version != 3.

    Errors (when `errors` list provided):
        - `invalid_manifest`: file present but not parseable as JSON / wrong shape.
        - `unrecognized_manifest_version`: file present but `version` is not 3.

    Backend never writes manifests; upgrades happen in Host.
    """
    if not folder:
        return None

    manifest_path = Path(folder) / MANIFEST_FILENAME
    try:
        text = manifest_path.read_text(encoding="utf-8")
    except FileNotFoundError:
        return None
    except OSError as e:
        if errors is not None:
            errors.append({
                "path": str(manifest_path),
                "reason_code": "invalid_manifest",
                "description": f"Cannot read context.json at {folder}: {e}",
            })
        return None

    try:
        data = json.loads(text)
    except json.JSONDecodeError as e:
        if errors is not None:
            errors.append({
                "path": str(manifest_path),
                "reason_code": "invalid_manifest",
                "description": f"Invalid JSON in context.json at {folder}: {e}",
            })
        return None

    if not isinstance(data, dict):
        _record_invalid(errors, manifest_path, folder, "must be a JSON object")
        return None

    version = data.get("version")
    if version != TARGET_VERSION:
        if errors is not None:
            errors.append({
                "path": str(manifest_path),
                "reason_code": "unrecognized_manifest_version",
                "description": (
                    f"context.json at {folder} has version={version!r}; "
                    f"backend only reads version={TARGET_VERSION}"
                ),
            })
        return None

    # Strict shape validation. Strict reader: silent coercion of malformed
    # shape (e.g. missing `name`) would let the scanner fall back to the
    # folder name and silently register a context the user never declared.
    name = data.get("name")
    if not isinstance(name, str) or not name.strip():
        _record_invalid(
            errors, manifest_path, folder,
            f"`name` must be a non-empty string, got {name!r}",
        )
        return None

    icon = data.get("icon")
    if icon is not None and not isinstance(icon, str):
        _record_invalid(
            errors, manifest_path, folder,
            f"`icon` must be a string when present, got {type(icon).__name__}",
        )
        return None

    meta_raw = data.get("meta", False)
    if not isinstance(meta_raw, bool):
        _record_invalid(
            errors, manifest_path, folder,
            f"`meta` must be a boolean when present, got {type(meta_raw).__name__}",
        )
        return None

    description = data.get("description")
    if description is not None and not isinstance(description, str):
        _record_invalid(
            errors, manifest_path, folder,
            f"`description` must be a string when present, got {type(description).__name__}",
        )
        return None

    ref_repos_raw = data.get("reference_repos")
    ref_repos: dict[str, str] | None
    if ref_repos_raw is None:
        ref_repos = None
    elif isinstance(ref_repos_raw, dict):
        for k, v in ref_repos_raw.items():
            if not isinstance(k, str) or not k.strip():
                _record_invalid(
                    errors, manifest_path, folder,
                    f"`reference_repos` keys must be non-empty strings, got {k!r}",
                )
                return None
            if not isinstance(v, str) or not v.strip():
                _record_invalid(
                    errors, manifest_path, folder,
                    f"`reference_repos[{k!r}]` must be a non-empty string, got {v!r}",
                )
                return None
        ref_repos = dict(ref_repos_raw) if ref_repos_raw else None
    else:
        _record_invalid(
            errors, manifest_path, folder,
            f"`reference_repos` must be an object when present, got {type(ref_repos_raw).__name__}",
        )
        return None

    git_repos_raw = data.get("git_repos")
    git_repos: dict[str, str] | None
    if git_repos_raw is None:
        git_repos = None
    elif not isinstance(git_repos_raw, dict):
        _record_invalid(
            errors, manifest_path, folder,
            "git_repos must be an object when present",
        )
        return None
    elif not git_repos_raw:
        _record_invalid(
            errors, manifest_path, folder,
            "git_repos must be non-empty when present",
        )
        return None
    else:
        for alias, url in git_repos_raw.items():
            if not isinstance(alias, str) or not alias.strip():
                _record_invalid(
                    errors, manifest_path, folder,
                    "git_repos keys must be non-empty strings",
                )
                return None
            if not isinstance(url, str) or not url.strip():
                _record_invalid(
                    errors, manifest_path, folder,
                    f"git_repos[{alias!r}] must be a non-empty string",
                )
                return None
        # Shared-namespace check: alias must not overlap with reference_repos.
        if ref_repos:
            overlap = set(git_repos_raw).intersection(ref_repos)
            if overlap:
                alias = next(iter(overlap))
                _record_invalid(
                    errors, manifest_path, folder,
                    f"alias '{alias}' is in both git_repos and reference_repos",
                )
                return None
        # Preserve insertion order (Python 3.7+ dict invariant) — products[]
        # order is the order keys appeared in the manifest.
        git_repos = dict(git_repos_raw)

    return Manifest(
        version=version,
        name=name,
        icon=icon,
        meta=meta_raw,
        git_repos=git_repos,
        reference_repos=ref_repos,
        description=description,
    )


def _record_invalid(
    errors: list[dict] | None,
    manifest_path: Path,
    folder: Path | str,
    detail: str,
) -> None:
    if errors is None:
        return
    errors.append({
        "path": str(manifest_path),
        "reason_code": "invalid_manifest",
        "description": f"context.json at {folder}: {detail}",
    })


def read_reference_repos(folder: Path | str | None) -> dict[str, str] | None:
    """Return `{name: url}` from the context's manifest, or None if absent."""
    manifest = read_manifest(folder)
    if not manifest or not manifest.reference_repos:
        return None
    return dict(manifest.reference_repos)


def read_git_repos(folder: Path | str | None) -> dict[str, str] | None:
    """Return `{alias: url}` from the context's manifest, or None if absent."""
    manifest = read_manifest(folder)
    if not manifest or not manifest.git_repos:
        return None
    return dict(manifest.git_repos)
