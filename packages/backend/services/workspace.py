"""Workspace orientation service.

Provides workspace context for AI agents and extension.
"""

import logging
import re
from pathlib import Path

from config import (
    get_business_folders,
    get_duet_data_path,
    get_instructions_path,
    get_machine_config_path,
    get_repos_path,
)
from db import DatabaseManager, Entity
from description import extract_description, find_spec_file
from normalization import normalize_path
from paths import is_path_inside
from scanner import scan_components
from services.manifest import read_reference_repos as _read_manifest_reference_repos

logger = logging.getLogger(__name__)


# Topology strings per workspace type
_TOPOLOGIES = {
    "product_in_git": (
        "Product with git repo. git_folder is the cloned repository — versioned product content. "
        "drive_folder is the accompanying folder on Google Drive — management, work/, drafts/, "
        "binaries, and other non-versioned files. "
        "These are two separate locations on disk."
    ),
    "product_on_drive": (
        "Product without git repo. drive_folder contains everything — product content, "
        "management, work/, drafts/, binaries. "
        "All paths are within this single folder."
    ),
    "stream": (
        "Stream folder on Google Drive. drive_folder contains stream.json, work/, "
        "nested streams or products, and any stream-level resources (documents, notes, assets)."
    ),
    "business": (
        "Business folder on Google Drive. drive_folder contains business.json, work/, "
        "nested streams or products, and any business-level resources (documents, notes, assets)."
    ),
    "root_business": (
        "Multi-root workspace for cross-business work. root_business_folder is the default folder "
        "for paths. business_folders lists all business folders (root_business_folder is one of them) "
        "— your starting points for navigation. duet_data_folder contains repos, instructions, "
        "and local data."
    ),
}

_REFERENCE_REPOS_TOPOLOGY_ADDON = (
    "Reference repos are read-only clones for context — do not modify or commit to them."
)


class WorkspaceService:
    """Service for workspace orientation."""

    def __init__(self, db: DatabaseManager):
        self.db = db

    # === Entity resolution ===

    def _resolve_entity(self, workspace_path: str) -> Entity | None:
        """Resolve workspace path to an entity.

        Algorithm:
        1. If path starts with {DuetData}/repos/:
           - Extract repo folder name (first segment after repos/)
           - Strip .wt-* suffix, ensure .git suffix
           - find_by_name(name) -> product_repo/reference_repo entity
           - Navigate to parent (the product/stream/business that owns it)

        2. Otherwise (Google Drive path):
           - Find which business_folder is a prefix of the path
           - Strip business_folder prefix -> relative_path
           - Normalize slashes -> /
           - find_closest_entity(relative_path) -> entity
        """
        workspace_path = normalize_path(workspace_path)
        path = Path(workspace_path).resolve()
        path_str = str(path)

        repos_path = get_repos_path()
        if repos_path:
            if is_path_inside(path, repos_path.resolve()):
                return self._resolve_from_repos(path, repos_path)

        return self._resolve_from_drive(path_str)

    def _resolve_from_repos(self, path: Path, repos_path: Path) -> Entity | None:
        """Resolve entity from repos path.

        Extracts repo name from path like /DuetData/repos/Duet.git/...
        Finds product_repo/reference_repo by name, returns parent entity.
        """
        try:
            relative = path.relative_to(repos_path)
            parts = relative.parts
            if not parts:
                return None

            repo_folder = parts[0]
            # Strip worktree suffix, ensure .git suffix for DB lookup
            repo_name = re.sub(r"\.wt-[^/]*$", "", repo_folder)
            if not repo_name.endswith(".git"):
                repo_name = repo_name + ".git"

            # Direct DB lookup by repo entity name
            repo_entity = self.db.find_by_name(repo_name)
            if not repo_entity:
                return None

            if repo_entity.type in ("product_repo", "reference_repo"):
                # Navigate to parent entity (product/stream/business)
                if repo_entity.parent_id:
                    return self.db.get_entity(repo_entity.parent_id)
                return None

            return repo_entity
        except ValueError:
            return None

    def _resolve_from_drive(self, path_str: str) -> Entity | None:
        """Resolve entity from Google Drive path.

        Finds which business_folder is a prefix, strips it,
        and searches for closest entity by relative path.
        """
        business_folders = get_business_folders()

        path = Path(path_str)
        for folder in business_folders:
            folder_path = Path(folder).resolve()

            if is_path_inside(path, folder_path):
                try:
                    business_name = folder_path.name
                    relative = path.relative_to(folder_path)
                    relative_str = str(relative).replace("\\", "/")

                    if relative_str == ".":
                        full_relative = business_name
                    else:
                        full_relative = f"{business_name}/{relative_str}"

                    return self.db.find_closest_entity(full_relative)
                except ValueError:
                    continue

        return None

    def _is_path_in_hierarchy(self, workspace_path: str) -> bool:
        """Check if path is in repos/ or any business_folder."""
        workspace_path = normalize_path(workspace_path)
        path = Path(workspace_path).resolve()

        repos_path = get_repos_path()
        if repos_path and is_path_inside(path, repos_path.resolve()):
            return True

        for folder in get_business_folders():
            if is_path_inside(path, Path(folder).resolve()):
                return True

        return False

    # === Path resolution helpers ===

    def _resolve_drive_path(self, entity: Entity) -> Path | None:
        """Resolve entity's drive_path to absolute filesystem path.

        Invariant: entity.drive_path is stored with `/` separator regardless
        of host OS — Scanner normalizes via `replace("\\", "/")` (see
        scanner._to_relative_path). Splitting on `/` here is therefore safe
        on Windows. Do NOT pass raw OS paths into this string field.
        """
        if not entity.drive_path:
            return None

        first_segment = entity.drive_path.split("/")[0]

        for folder in get_business_folders():
            folder_path = Path(folder)
            if normalize_path(folder_path.name) == first_segment:
                return folder_path.parent / entity.drive_path

        return None

    def _get_entity_root_path(self, entity: Entity) -> Path | None:
        """Get absolute filesystem path for entity root.

        Product with git_url -> repos/{name}.git
        Everything else -> resolved drive path.
        """
        if entity.type == "product" and entity.git_url:
            repos_path = get_repos_path()
            if repos_path:
                repo_path = repos_path / f"{entity.name}.git"
                if repo_path.exists():
                    return repo_path

        return self._resolve_drive_path(entity)

    def _get_product_path(self, entity: Entity) -> Path:
        """Get filesystem path to product for scanning components."""
        repos_path = get_repos_path()

        if repos_path:
            repo_path = repos_path / f"{entity.name}.git"
            if repo_path.exists():
                return repo_path

        drive_path = self._resolve_drive_path(entity)
        if drive_path and drive_path.exists():
            return drive_path

        business_folders = get_business_folders()
        if business_folders and entity.drive_path:
            for folder in business_folders:
                full_path = Path(folder) / entity.drive_path
                if full_path.exists():
                    return full_path

        return Path(entity.drive_path)

    # === Multi-path entity resolution ===

    def _classify_path(self, path_str: str) -> tuple[str, Entity | None]:
        """Classify a workspace path and resolve to entity."""
        normalized = normalize_path(path_str)
        path = Path(normalized).resolve()
        path_s = str(path)

        repos_path = get_repos_path()
        if repos_path and is_path_inside(path, repos_path.resolve()):
            entity = self._resolve_from_repos(path, repos_path)
            return ("git", entity)

        manifest_names = ["business.json", "stream.json", "product.json"]
        for manifest_name in manifest_names:
            if (path / manifest_name).exists():
                entity = self._resolve_from_drive(path_s)
                return ("stream", entity)

        return ("ignored", None)

    def _resolve_multi_path(self, workspace_paths: list[str]) -> Entity | None:
        """Resolve best entity from multiple workspace paths."""
        entities: list[Entity] = []
        for path_str in workspace_paths:
            _, entity = self._classify_path(path_str)
            if entity and entity.id:
                entities.append(entity)

        if not entities:
            return None

        root_business = self.db.find_root_business()
        if root_business and root_business.id:
            for e in entities:
                if e.id == root_business.id:
                    return e

        type_priority = {"business": 1, "stream": 2, "product": 3}
        entities.sort(key=lambda e: type_priority.get(e.type, 99))
        return entities[0]

    # === Orientation response (formerly workspace_info v3) ===

    def get_orientation(
        self, workspace_path: str | None = None, workspace_paths: list[str] | None = None
    ) -> dict:
        """Get full workspace orientation for AI agents.

        Returns:
            Dict with duet_paths, workspace, context,
            key_files, components.
        """
        duet_data = get_duet_data_path()

        # instructionsPath required — without it bootstrapper is not merged,
        # agent has no instructions. Raises ConfigError → 422.
        instructions_path = get_instructions_path()

        result: dict = {
            "duet_paths": {
                "duetDataPath": str(duet_data.resolve()),
                "machineConfig": str(get_machine_config_path().resolve()),
                "instructionsPath": str(instructions_path.resolve()),
            },
        }

        # Determine paths to use
        paths = workspace_paths or ([workspace_path] if workspace_path else [])

        if not paths:
            result["workspace"] = self._build_unknown_workspace("no_workspace_path", paths)
            return result

        # Resolve entity
        if len(paths) > 1:
            entity = self._resolve_multi_path(paths)
        else:
            entity = self._resolve_entity(paths[0])

        if not (entity and entity.id):
            any_in_hierarchy = any(
                self._is_path_in_hierarchy(p) for p in paths
            )
            reason = "entity_not_in_db" if any_in_hierarchy else "path_not_in_hierarchy"
            result["workspace"] = self._build_unknown_workspace(reason, paths)
            return result

        # --- Entity resolved ---
        chain = self.db.get_entity_chain(entity.id)

        # context
        result["context"] = self._build_context(chain)

        # workspace
        result["workspace"] = self._build_workspace(entity)

        # key_files
        key_files = self._build_key_files(entity)
        if key_files:
            result["key_files"] = key_files

        # components (if product in chain)
        product = next((e for e in chain if e.type == "product"), None)
        if product:
            product_path = self._get_product_path(product)
            result["components"] = scan_components(product_path)

        return result

    def _build_unknown_workspace(self, reason: str, paths: list[str]) -> dict:
        """Build workspace block for unknown/unresolved workspace."""
        if reason == "no_workspace_path":
            topology = "No workspace paths provided."
        else:
            if len(paths) == 1:
                topology = "The folder open in the workspace is outside of Duet business folders."
            else:
                topology = "The folders open in the workspace are outside of Duet business folders."

        return {
            "type": "unknown",
            "reason": reason,
            "topology": topology,
        }

    def _build_context(self, chain: list[Entity]) -> dict:
        """Build context block with breadcrumb and chain."""
        chain_items = []
        for entity in chain:
            item: dict = {"type": entity.type, "name": entity.name}
            desc = self._get_entity_description(entity)
            if desc:
                item["description"] = desc
            chain_items.append(item)

        return {
            "breadcrumb": " / ".join(e.name for e in chain),
            "chain": chain_items,
        }

    def _build_workspace(self, entity: Entity) -> dict:
        """Build workspace block with type, topology, and typed attributes."""
        ws_type = self._get_workspace_type(entity)
        topology = _TOPOLOGIES.get(ws_type, "")

        workspace: dict = {"type": ws_type}

        # Type-specific attributes
        if ws_type == "product_in_git":
            repos_path = get_repos_path()
            git_folder = repos_path / f"{entity.name}.git" if repos_path else None
            drive_folder = self._resolve_drive_path(entity)
            if git_folder:
                workspace["git_folder"] = str(git_folder)
            if drive_folder:
                workspace["drive_folder"] = str(drive_folder)

        elif ws_type == "product_on_drive":
            drive_folder = self._resolve_drive_path(entity)
            if drive_folder:
                workspace["drive_folder"] = str(drive_folder)

        elif ws_type == "root_business":
            drive_folder = self._resolve_drive_path(entity)
            if drive_folder:
                workspace["root_business_folder"] = str(drive_folder)
            # Build business_folders map: name -> path
            all_businesses = [e for e in self.db.get_all_entities() if e.type == "business"]
            business_folders_map: dict[str, str] = {}
            for biz in all_businesses:
                biz_path = self._resolve_drive_path(biz)
                if biz_path:
                    business_folders_map[biz.name] = str(biz_path)
            workspace["business_folders"] = business_folders_map
            workspace["duet_data_folder"] = str(get_duet_data_path().resolve())

        elif ws_type in ("business", "stream"):
            drive_folder = self._resolve_drive_path(entity)
            if drive_folder:
                workspace["drive_folder"] = str(drive_folder)

        # Reference repos from manifest (read from disk for freshness)
        ref_repos = self._read_reference_repos(entity)
        if ref_repos:
            workspace["reference_repos"] = ref_repos
            topology += " " + _REFERENCE_REPOS_TOPOLOGY_ADDON

        workspace["topology"] = topology

        return workspace

    def _read_reference_repos(self, entity: Entity) -> dict[str, str] | None:
        """Read reference_repos from entity's manifest on disk.

        Returns map of {name.git: absolute_path} for existing clones.
        """
        drive_path = self._resolve_drive_path(entity)
        ref_repos_raw = _read_manifest_reference_repos(drive_path, entity.type)
        if not ref_repos_raw:
            return None

        repos_path = get_repos_path()
        if not repos_path:
            return None

        result: dict[str, str] = {}
        for ref_name in ref_repos_raw:
            clone_name = f"{ref_name}.git"
            clone_path = repos_path / clone_name
            if clone_path.exists():
                result[clone_name] = str(clone_path)

        return result if result else None

    def _build_key_files(self, entity: Entity) -> dict | None:
        """Build key_files block for the resolved entity."""
        root_path = self._get_entity_root_path(entity)
        if root_path is None:
            return None

        key_files: dict = {}

        spec_path = find_spec_file(root_path, entity.type)
        if spec_path:
            key_files["spec"] = str(spec_path)

        readme_path = root_path / "README.md"
        if readme_path.exists():
            key_files["readme"] = str(readme_path)

        return key_files if key_files else None

    def _get_workspace_type(self, entity: Entity) -> str:
        """Determine workspace type from entity."""
        if entity.type == "product":
            if entity.git_url:
                return "product_in_git"
            return "product_on_drive"
        elif entity.type == "stream":
            return "stream"
        elif entity.type == "business":
            if entity.root:
                return "root_business"
            return "business"
        return "unknown"

    def _get_entity_description(self, entity: Entity) -> str | None:
        """Get description for entity from its README.md."""
        entity_path = self._get_entity_root_path(entity)
        if entity_path is None:
            return None

        readme_path = entity_path / "README.md"
        return extract_description(readme_path)
