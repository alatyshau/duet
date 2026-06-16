"""Hierarchy scanner for Duet entities.

Backend is strict v3 reader: walks each root context folder, registers
contexts that carry a valid `context.json` (v3). Host owns all
auto-upgrade and self-heal of legacy manifests.

Key behaviors:
- Single recursive function `_scan_context` for every level.
- Global name uniqueness: priority-based (context > product_repo > reference_repo).
- `git_repos` registers N `product_repo` children (one per alias); Drive
  recursion still continues so nested context folders are discoverable.
- Deterministic order: readdir results sorted by name.
"""

import os
from pathlib import Path
from typing import Callable

from db import DatabaseManager, Entity
from config import get_root_context_folders, get_repos_path
from normalization import normalize_path
from services.manifest import Manifest, read_manifest


def make_scan_result(
    status: str,
    entities_count: int = 0,
    errors: list[dict] | None = None,
    **extra,
) -> dict:
    """Build a scan result dict conforming to the ScanResult contract.

    All scan code paths MUST use this to guarantee required fields are present.
    """
    result = {
        "status": status,
        "entities_count": entities_count,
        "errors": errors if errors is not None else [],
    }
    result.update(extra)
    return result


# Type priorities: lower number = higher priority.
# All context entities share priority 2; product_repo and reference_repo
# stay at their original priorities. Collisions across contexts produce
# suffix `(1)` for the second-comer.
TYPE_PRIORITIES = {
    "context": 2,
    "product_repo": 3,
    "reference_repo": 5,
}


class Scanner:
    """Scans configured root context folders and rebuilds entities.db."""

    def __init__(
        self,
        db: DatabaseManager,
        on_error: Callable[[str], None] | None = None,
        repos_path: Path | None = None,
    ):
        self.db = db
        self.on_error = on_error
        self.repos_path = repos_path or get_repos_path()
        self._scan_in_progress = False
        # Current root-context folder being scanned (for relative path calculation)
        self._current_root_folder: Path | None = None
        # Structured errors collected during scan
        self.errors: list[dict] = []

    def _to_relative_path(self, absolute_path: Path) -> str:
        """Convert absolute path to relative path from current root context's parent.

        Path format: {root_folder_name}/{relative_path}
        - For root (root_context_folder itself): returns just the folder name
        - For nested: {root_folder_name}/Stream/Product
        - Normalizes slashes to forward slashes
        - Normalizes Unicode to NFC (macOS filesystem uses NFD)

        This ensures uniqueness across multiple root context folders.
        """
        if self._current_root_folder is None:
            return normalize_path(str(absolute_path))

        root_name = self._current_root_folder.name

        try:
            relative = absolute_path.relative_to(self._current_root_folder)
            relative_str = str(relative).replace("\\", "/")
            if relative_str == ".":
                result = root_name
            else:
                result = f"{root_name}/{relative_str}"
            return normalize_path(result)
        except ValueError:
            return normalize_path(str(absolute_path))

    def scan(self) -> dict:
        """Run full scan of root context folders.

        Returns scan statistics and errors.
        """
        if self._scan_in_progress:
            return make_scan_result("skipped", reason="scan already in progress")

        try:
            self._scan_in_progress = True
            self.errors = []
            self.db.init()
            self.db.clear()

            for folder in get_root_context_folders():
                path = Path(folder)
                if not path.exists():
                    continue
                self._current_root_folder = path
                self._scan_context(path, parent_id=None)

            entities = self.db.get_all_entities()
            return make_scan_result("completed", entities_count=len(entities), errors=self.errors)
        finally:
            self._scan_in_progress = False

    def _find_available_name(self, base_name: str) -> str:
        """Find first available name with suffix (1), (2), etc."""
        counter = 1
        name = f"{base_name} ({counter})"
        while self.db.name_exists(name):
            counter += 1
            name = f"{base_name} ({counter})"
        return name

    def _resolve_unique_name(
        self, base_name: str, new_type: str, manifest_path: Path | None = None
    ) -> str:
        """Resolve name for a new entity using priority-based algorithm.

        If name exists:
        - Compare priorities (lower = higher priority)
        - If new entity has higher priority → rename existing, return original name
        - If new entity has lower/equal priority → return suffixed name
        """
        existing = self.db.find_by_name(base_name)

        if not existing:
            return base_name

        new_priority = TYPE_PRIORITIES.get(new_type, 99)
        existing_priority = TYPE_PRIORITIES.get(existing.type, 99)

        repo_types = {"product_repo", "reference_repo"}
        if new_type in repo_types or existing.type in repo_types:
            reason_code = "repo_collision"
        else:
            reason_code = "name_collision"

        path_str = str(manifest_path) if manifest_path else base_name

        if new_priority < existing_priority:
            suffixed_name = self._find_available_name(base_name)
            self.db.update_entity_name(existing.id, suffixed_name)
            self.errors.append({
                "path": path_str,
                "reason_code": reason_code,
                "description": (
                    f'Name collision: "{base_name}" — {new_type} claims name, '
                    f'{existing.type} renamed to "{suffixed_name}"'
                ),
            })
            return base_name
        else:
            suffixed_name = self._find_available_name(base_name)
            self.errors.append({
                "path": path_str,
                "reason_code": reason_code,
                "description": (
                    f'Name collision: "{base_name}" — {new_type} renamed to "{suffixed_name}"'
                ),
            })
            return suffixed_name

    def _readdir_sorted(self, folder_path: Path) -> list[os.DirEntry]:
        """Read directory entries sorted by name for deterministic scan order."""
        try:
            entries = list(os.scandir(folder_path))
            return sorted(entries, key=lambda e: e.name)
        except OSError:  # pragma: no cover — OS-level filesystem error
            return []

    def _scan_context(self, folder_path: Path, parent_id: int | None) -> None:
        """Scan a folder as a context.

        Strict v3: reads `context.json` only. Folders without a manifest are
        silently traversed (recurse into children to find deeper contexts).
        Folders with `git_repos` additionally register one `product_repo`
        child per alias. Drive recursion still continues: `git_repos`
        declares clones under DuetData/repos; it does not stop context
        discovery under the context's Drive folder.
        """
        manifest_path = folder_path / "context.json"
        manifest = read_manifest(folder_path, self.errors)

        if manifest is None:
            # No usable manifest. Top-level folders with no manifest are
            # never registered (Host should have written one); for nested
            # folders we simply recurse to find deeper contexts.
            if parent_id is None:
                return
            for entry in self._readdir_sorted(folder_path):
                if not entry.is_dir() or entry.name.startswith("."):
                    continue
                self._scan_context(Path(entry.path), parent_id)
            return

        unique_name = self._resolve_unique_name(manifest.name, "context", manifest_path)
        icon = manifest.icon or ("📦" if manifest.git_repos else "📁")
        relative_path = self._to_relative_path(folder_path)

        context_id = self.db.insert_entity(
            Entity(
                id=None,
                type="context",
                name=unique_name,
                icon=icon,
                drive_path=relative_path,
                parent_id=parent_id,
                git_url=None,
                meta=manifest.meta,
            )
        )

        self._register_reference_repos(manifest, context_id, manifest_path)

        if manifest.git_repos:
            # One product_repo per alias. Do not return here: nested Drive
            # folders may carry their own context.json and must stay visible
            # in the context tree.
            for alias, url in manifest.git_repos.items():
                repo_entity_name = f"{alias}.git"
                resolved_repo_name = self._resolve_unique_name(
                    repo_entity_name, "product_repo", manifest_path
                )
                self.db.insert_entity(
                    Entity(
                        id=None,
                        type="product_repo",
                        name=resolved_repo_name,
                        icon="📂",
                        drive_path=resolved_repo_name,
                        parent_id=context_id,
                        git_url=url,
                    )
                )

        for entry in self._readdir_sorted(folder_path):
            if not entry.is_dir() or entry.name.startswith("."):
                continue
            self._scan_context(Path(entry.path), context_id)

    def _register_reference_repos(
        self, manifest: Manifest, parent_id: int, manifest_path: Path | None = None
    ) -> None:
        """Register reference_repo entities from manifest's reference_repos field."""
        if not manifest.reference_repos:
            return

        for ref_name, ref_url in manifest.reference_repos.items():
            ref_entity_name = f"{ref_name}.git"
            resolved_name = self._resolve_unique_name(
                ref_entity_name, "reference_repo", manifest_path
            )
            self.db.insert_entity(
                Entity(
                    id=None,
                    type="reference_repo",
                    name=resolved_name,
                    icon="📚",
                    drive_path=resolved_name,
                    parent_id=parent_id,
                    git_url=ref_url,
                )
            )
