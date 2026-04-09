"""Hierarchy scanner for Duet entities.

Port of packages/extension/src/core/scanner.ts to Python.

Key behaviors:
- Global name uniqueness: priority-based (business > stream > product)
- Self-healing: auto-creates/renames manifests to match hierarchy rules
- Hierarchy: root=business, intermediate=stream, leaf with git_url=product
- Deterministic order: readdir results sorted by name
"""

import json
import os
from dataclasses import dataclass
from pathlib import Path

from description import extract_description, find_spec_file
from typing import Callable

from db import DatabaseManager, Entity
from config import get_business_folders, get_repos_path
from normalization import normalize_path


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


@dataclass
class Manifest:
    name: str
    icon: str | None = None
    git_url: str | None = None
    root: bool = False
    reference_repos: dict[str, str] | None = None  # name -> URL


# Type priorities: lower number = higher priority
# When name conflict occurs, higher-priority entity keeps the original name
TYPE_PRIORITIES = {
    "business": 1,
    "stream": 2,
    "product": 3,
    "product_repo": 3,
    "reference_repo": 5,
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
        # Current business_folder being scanned (for relative path calculation)
        self._current_business_folder: Path | None = None
        # Structured errors collected during scan
        self.errors: list[dict] = []

    def _to_relative_path(self, absolute_path: Path) -> str:
        """Convert absolute path to relative path from current business_folder's parent.

        Path format: {business_folder_name}/{relative_path}
        - For root (business_folder itself): returns just the folder name
        - For nested: {business_folder_name}/Stream/Product
        - Normalizes slashes to forward slashes
        - Normalizes Unicode to NFC (macOS filesystem uses NFD)

        This ensures uniqueness across multiple business_folders.
        """
        if self._current_business_folder is None:
            return normalize_path(str(absolute_path))

        business_name = self._current_business_folder.name

        try:
            relative = absolute_path.relative_to(self._current_business_folder)
            relative_str = str(relative).replace("\\", "/")
            # For root, relative is "." - return just business name
            if relative_str == ".":
                result = business_name
            else:
                # For nested paths, prepend business name
                result = f"{business_name}/{relative_str}"
            # Normalize Unicode: macOS returns NFD, we store NFC
            return normalize_path(result)
        except ValueError:
            # Path not under business_folder - return as-is (shouldn't happen)
            return normalize_path(str(absolute_path))

    def scan(self) -> dict:
        """Run full scan of business folders.

        Returns scan statistics and errors.
        """
        if self._scan_in_progress:
            return make_scan_result("skipped", reason="scan already in progress")

        try:
            self._scan_in_progress = True
            self.errors = []
            self.db.init()
            self.db.clear()

            business_folders = get_business_folders()
            for folder in business_folders:
                self._scan_business(folder)

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
        self, base_name: str, new_type: str, folder_path: Path | None = None
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

        # Determine reason code based on types involved
        repo_types = {"product_repo", "reference_repo"}
        if new_type in repo_types or existing.type in repo_types:
            reason_code = "repo_collision"
        else:
            reason_code = "name_collision"

        path_str = str(folder_path) if folder_path else base_name

        if new_priority < existing_priority:
            # New entity has higher priority → rename existing, claim original name
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
            # New entity has lower/equal priority → get suffixed name
            suffixed_name = self._find_available_name(base_name)
            self.errors.append({
                "path": path_str,
                "reason_code": reason_code,
                "description": (
                    f'Name collision: "{base_name}" — {new_type} renamed to "{suffixed_name}"'
                ),
            })
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
        except OSError as e:  # pragma: no cover — OS-level write error
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
        except OSError:  # pragma: no cover — OS-level filesystem error
            return []

    def _scan_business(self, folder_path: str) -> None:
        """Scan a business folder (root level in business_folders).

        Self-healing: creates business.json if missing, renames stream.json to business.json.
        """
        path = Path(folder_path)
        if not path.exists():
            return

        # Set current business_folder for relative path calculation
        self._current_business_folder = path

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
                self.errors.append({
                    "path": str(path),
                    "reason_code": "missing_manifest",
                    "description": f"Missing business.json in {path.name} (auto-created)",
                })
                self._create_business_manifest(path)

            # Use fallback manifest if self-healing failed or no manifest read
            if not manifest:
                manifest = Manifest(name=path.name, icon="📁")

        base_name = manifest.name or path.name
        unique_name = self._resolve_unique_name(base_name, "business", path / "business.json")
        icon = manifest.icon or "📁"

        # Use relative path (empty string for root = business folder itself)
        relative_path = self._to_relative_path(path)

        business_id = self.db.insert_entity(
            Entity(
                id=None,
                type="business",
                name=unique_name,
                icon=icon,
                drive_path=relative_path,
                root=manifest.root,
            )
        )

        # Register reference_repo entities
        self._register_reference_repos(manifest, business_id, path / "business.json")

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
            unique_name = self._resolve_unique_name(base_name, "stream", folder_path / "stream.json")

            # Use relative path from business_folder
            relative_path = self._to_relative_path(folder_path)

            stream_id = self.db.insert_entity(
                Entity(
                    id=None,
                    type="stream",
                    name=unique_name,
                    icon=stream_manifest.icon or "🌊",
                    drive_path=relative_path,
                    parent_id=parent_id,
                )
            )

            # Register reference_repo entities
            self._register_reference_repos(stream_manifest, stream_id, folder_path / "stream.json")

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

    def _register_reference_repos(
        self, manifest: Manifest, parent_id: int, manifest_path: Path | None = None
    ) -> None:
        """Register reference_repo entities from manifest's reference_repos field.

        Creates reference_repo entity for each entry in manifest.reference_repos.
        Entity name includes .git suffix (e.g. "anthropic-cookbook.git").

        Args:
            manifest: Parsed manifest with reference_repos.
            parent_id: Parent entity ID.
            manifest_path: Path to the manifest file declaring reference_repos
                          (used for error reporting).
        """
        if not manifest.reference_repos:
            return

        for ref_name, ref_url in manifest.reference_repos.items():
            ref_entity_name = f"{ref_name}.git"
            resolved_name = self._resolve_unique_name(ref_entity_name, "reference_repo", manifest_path)
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

    def _save_product(
        self, folder_path: Path, parent_id: int, manifest: Manifest
    ) -> None:
        """Save a product entity and scan for projects inside it.

        Products are terminal nodes - we don't scan deeper for manifests.
        Scans projects from both drive path and git repo (if repos_path configured).
        """
        base_name = manifest.name or folder_path.name
        unique_name = self._resolve_unique_name(base_name, "product", folder_path / "product.json")

        # Use relative path from business_folder
        relative_path = self._to_relative_path(folder_path)

        product_id = self.db.insert_entity(
            Entity(
                id=None,
                type="product",
                name=unique_name,
                icon=manifest.icon or "📦",
                drive_path=relative_path,
                parent_id=parent_id,
                git_url=manifest.git_url,
            )
        )

        # Register product_repo entity if product has git_url
        if manifest.git_url:
            repo_entity_name = f"{unique_name}.git"
            resolved_repo_name = self._resolve_unique_name(repo_entity_name, "product_repo", folder_path / "product.json")
            self.db.insert_entity(
                Entity(
                    id=None,
                    type="product_repo",
                    name=resolved_repo_name,
                    icon="📂",
                    drive_path=resolved_repo_name,
                    parent_id=product_id,
                    git_url=manifest.git_url,
                )
            )

        # Register reference_repo entities
        self._register_reference_repos(manifest, product_id, folder_path / "product.json")

    def _read_manifest(self, folder_path: Path, filename: str) -> Manifest | None:
        """Read and parse a manifest file."""
        file_path = folder_path / filename
        try:
            with open(file_path, "r", encoding="utf-8") as f:
                data = json.load(f)
                ref_repos = data.get("reference_repos")
                return Manifest(
                    name=data.get("name", ""),
                    icon=data.get("icon"),
                    git_url=data.get("git_url"),
                    root=bool(data.get("root", False)),
                    reference_repos=ref_repos if isinstance(ref_repos, dict) else None,
                )
        except FileNotFoundError:
            return None
        except (json.JSONDecodeError, OSError) as e:
            msg = f"Invalid manifest {filename} at {folder_path}: {e}"
            self.errors.append({
                "path": str(file_path),
                "reason_code": "invalid_manifest",
                "description": msg,
            })
            if self.on_error:
                self.on_error(msg)
            else:
                print(msg)
            return None


def scan_components(product_path: Path) -> list[dict]:
    """Scan product directory for components (packages/).

    For each component, finds spec file via fallback chain and extracts
    description (first sentence) from it.

    Args:
        product_path: Path to product directory.

    Returns:
        List of component dicts with name, path, and optionally spec, description.
    """
    components = []

    packages_dir = product_path / "packages"
    if packages_dir.exists():
        for entry in sorted(packages_dir.iterdir()):
            if entry.is_dir() and not entry.name.startswith("."):
                component: dict = {
                    "name": entry.name,
                    "path": f"packages/{entry.name}",
                }

                # Find spec file using fallback chain
                spec_path = find_spec_file(entry, "component")
                if spec_path:
                    # Store relative path from product root
                    try:
                        rel_spec = spec_path.relative_to(product_path)
                        component["spec"] = str(rel_spec).replace("\\", "/")
                    except ValueError:
                        component["spec"] = str(spec_path)

                    # Extract description from spec file
                    desc = extract_description(spec_path)
                    if desc:
                        component["description"] = desc

                components.append(component)

    return components
