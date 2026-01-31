"""Hierarchy scanner for Duet entities.

Port of packages/extension/src/core/scanner.ts to Python.

Key behaviors:
- Global name uniqueness: priority-based (business > stream > product > project)
- Self-healing: auto-creates/renames manifests to match hierarchy rules
- Hierarchy: root=business, intermediate=stream, leaf with git_url=product
- Deterministic order: readdir results sorted by name
"""

import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

from db import DatabaseManager, Entity
from config import read_config, get_repos_path


@dataclass
class Manifest:
    name: str
    icon: str | None = None
    git_url: str | None = None


# Type priorities: lower number = higher priority
# When name conflict occurs, higher-priority entity keeps the original name
TYPE_PRIORITIES = {
    "business": 1,
    "stream": 2,
    "product": 3,
    "project": 4,
}


class Scanner:
    """Scans Google Drive business folders and builds entities.db."""

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

    def scan(self) -> dict:
        """Run full scan of business folders.

        Returns scan statistics.
        """
        if self._scan_in_progress:
            return {"status": "skipped", "reason": "scan already in progress"}

        try:
            self._scan_in_progress = True
            self.db.init()
            self.db.clear()

            duet_config = read_config()
            for folder in duet_config.get("business_folders", []):
                self._scan_business(folder)

            entities = self.db.get_all_entities()
            return {
                "status": "completed",
                "entities_count": len(entities),
            }
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

    def _resolve_unique_name(self, base_name: str, new_type: str) -> str:
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

        if new_priority < existing_priority:
            # New entity has higher priority → rename existing, claim original name
            suffixed_name = self._find_available_name(base_name)
            self.db.update_entity_name(existing.id, suffixed_name)
            print(
                f'Name conflict: "{base_name}" - {new_type} claims name, '
                f'{existing.type} renamed to "{suffixed_name}"'
            )
            return base_name
        else:
            # New entity has lower/equal priority → get suffixed name
            suffixed_name = self._find_available_name(base_name)
            print(f'Name conflict: "{base_name}" - {new_type} gets "{suffixed_name}"')
            return suffixed_name

    def _create_business_manifest(self, folder_path: Path) -> bool:
        """Self-healing: create business.json if missing at root."""
        manifest = {"name": folder_path.name, "icon": "📁"}
        file_path = folder_path / "business.json"
        try:
            with open(file_path, "w", encoding="utf-8") as f:
                json.dump(manifest, f, indent=2, ensure_ascii=False)
            print(f"Self-healing: created {file_path}")
            return True
        except OSError as e:
            msg = f"Self-healing failed: could not create {file_path}: {e}"
            if self.on_error:
                self.on_error(msg)
            else:
                print(msg)
            return False

    def _rename_stream_to_business(self, folder_path: Path) -> bool:
        """Self-healing: rename stream.json to business.json at root."""
        stream_path = folder_path / "stream.json"
        business_path = folder_path / "business.json"
        try:
            stream_path.rename(business_path)
            print(f"Self-healing: renamed {stream_path} to {business_path}")
            return True
        except OSError as e:
            msg = f"Self-healing failed: could not rename {stream_path} to {business_path}: {e}"
            if self.on_error:
                self.on_error(msg)
            else:
                print(msg)
            return False

    def _rename_business_to_stream(self, folder_path: Path) -> bool:
        """Self-healing: rename business.json to stream.json inside chain."""
        business_path = folder_path / "business.json"
        stream_path = folder_path / "stream.json"
        try:
            business_path.rename(stream_path)
            print(f"Self-healing: renamed {business_path} to {stream_path}")
            return True
        except OSError as e:
            msg = f"Self-healing failed: could not rename {business_path} to {stream_path}: {e}"
            if self.on_error:
                self.on_error(msg)
            else:
                print(msg)
            return False

    def _readdir_sorted(self, folder_path: Path) -> list[os.DirEntry]:
        """Read directory entries sorted by name for deterministic scan order."""
        try:
            entries = list(os.scandir(folder_path))
            return sorted(entries, key=lambda e: e.name)
        except OSError:
            return []

    def _scan_business(self, folder_path: str) -> None:
        """Scan a business folder (root level in business_folders).

        Self-healing: creates business.json if missing, renames stream.json to business.json.
        """
        path = Path(folder_path)
        if not path.exists():
            return

        # Self-healing: check for manifest issues at root
        manifest = self._read_manifest(path, "business.json")

        if not manifest:
            # Check if stream.json exists (wrong manifest type at root)
            stream_manifest = self._read_manifest(path, "stream.json")
            if stream_manifest:
                # Rename stream.json to business.json
                if self._rename_stream_to_business(path):
                    manifest = stream_manifest
            else:
                # No manifest at all - create business.json
                self._create_business_manifest(path)

            # Use fallback manifest if self-healing failed or no manifest read
            if not manifest:
                manifest = Manifest(name=path.name, icon="📁")

        base_name = manifest.name or path.name
        unique_name = self._resolve_unique_name(base_name, "business")
        icon = manifest.icon or "📁"

        business_id = self.db.insert_entity(
            Entity(
                id=None,
                type="business",
                name=unique_name,
                icon=icon,
                drive_path=str(path),
            )
        )

        # Scan for projects at business level
        self._scan_projects(path, business_id)

        # Scan children (Stream or Product) - sorted for determinism
        for entry in self._readdir_sorted(path):
            if not entry.is_dir() or entry.name.startswith("."):
                continue
            self._scan_stream_or_product(Path(entry.path), business_id)

    def _scan_stream_or_product(self, folder_path: Path, parent_id: int) -> None:
        """Scan a folder that could be stream or product (inside business).

        Self-healing: renames business.json to stream.json if found inside chain.
        """
        # Check for stream.json first
        stream_manifest = self._read_manifest(folder_path, "stream.json")

        # Self-healing: check for business.json inside chain (should be stream.json)
        if not stream_manifest:
            business_manifest = self._read_manifest(folder_path, "business.json")
            if business_manifest:
                # Rename business.json to stream.json
                if self._rename_business_to_stream(folder_path):
                    stream_manifest = business_manifest
                # If rename failed, we don't use the manifest

        if stream_manifest:
            base_name = stream_manifest.name or folder_path.name
            unique_name = self._resolve_unique_name(base_name, "stream")

            stream_id = self.db.insert_entity(
                Entity(
                    id=None,
                    type="stream",
                    name=unique_name,
                    icon=stream_manifest.icon or "🌊",
                    drive_path=str(folder_path),
                    parent_id=parent_id,
                )
            )

            # Scan for projects at stream level
            self._scan_projects(folder_path, stream_id)

            # Scan children inside stream (can be nested streams or products)
            for entry in self._readdir_sorted(folder_path):
                if not entry.is_dir() or entry.name.startswith("."):
                    continue
                # Recursive call - streams can contain streams or products
                self._scan_stream_or_product(Path(entry.path), stream_id)
            return

        # Check for product.json
        product_manifest = self._read_manifest(folder_path, "product.json")
        if product_manifest:
            self._save_product(folder_path, parent_id, product_manifest)
            return

        # No manifest - recurse to find deeper items
        for entry in self._readdir_sorted(folder_path):
            if not entry.is_dir() or entry.name.startswith("."):
                continue
            self._scan_stream_or_product(Path(entry.path), parent_id)

    def _save_product(
        self, folder_path: Path, parent_id: int, manifest: Manifest
    ) -> None:
        """Save a product entity and scan for projects inside it.

        Products are terminal nodes - we don't scan deeper for manifests.
        Scans projects from both drive path and git repo (if repos_path configured).
        """
        base_name = manifest.name or folder_path.name
        unique_name = self._resolve_unique_name(base_name, "product")

        product_id = self.db.insert_entity(
            Entity(
                id=None,
                type="product",
                name=unique_name,
                icon=manifest.icon or "📦",
                drive_path=str(folder_path),
                parent_id=parent_id,
                git_url=manifest.git_url,
            )
        )

        # Scan projects from drive path
        self._scan_projects(folder_path, product_id)

        # Also scan projects from git repo if repos_path is configured
        if self.repos_path:
            repo_path = self.repos_path / f"{unique_name}.git"
            self._scan_projects(repo_path, product_id)

    def _scan_projects(self, folder_path: Path, parent_id: int) -> None:
        """Scan for projects (folders inside /projects/) - any entity can have projects."""
        projects_path = folder_path / "projects"
        if not projects_path.exists():
            return

        for entry in self._readdir_sorted(projects_path):
            if entry.is_dir() and not entry.name.startswith("."):
                project_base_name = entry.name
                project_unique_name = self._resolve_unique_name(
                    project_base_name, "project"
                )

                self.db.insert_entity(
                    Entity(
                        id=None,
                        type="project",
                        name=project_unique_name,
                        icon="📋",
                        drive_path=entry.path,
                        parent_id=parent_id,
                    )
                )

    def _read_manifest(self, folder_path: Path, filename: str) -> Manifest | None:
        """Read and parse a manifest file."""
        file_path = folder_path / filename
        try:
            with open(file_path, "r", encoding="utf-8") as f:
                data = json.load(f)
                return Manifest(
                    name=data.get("name", ""),
                    icon=data.get("icon"),
                    git_url=data.get("git_url"),
                )
        except FileNotFoundError:
            return None
        except (json.JSONDecodeError, OSError) as e:
            msg = f"Failed to parse {filename} at {folder_path}: {e}"
            if self.on_error:
                self.on_error(msg)
            else:
                print(msg)
            return None


def scan_components(product_path: Path) -> list[dict]:
    """Scan product directory for components (packages with spec/).

    Components are subdirectories of packages/ that may contain a spec/ folder.

    Args:
        product_path: Path to product directory.

    Returns:
        List of component dicts with name, path, hasSpec.
    """
    components = []

    # Check packages/ directory
    packages_dir = product_path / "packages"
    if packages_dir.exists():
        for entry in sorted(packages_dir.iterdir()):
            if entry.is_dir():
                has_spec = (entry / "spec").exists()
                components.append(
                    {
                        "name": entry.name,
                        "path": f"packages/{entry.name}",
                        "hasSpec": has_spec,
                    }
                )

    return components
