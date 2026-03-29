"""Workspace information service.

Provides workspace context for AI agents and extension.
"""

import json
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
from instructions import scan_instructions
from normalization import normalize_path
from scanner import scan_components

logger = logging.getLogger(__name__)


class WorkspaceService:
    """Service for workspace information retrieval."""

    def __init__(self, db: DatabaseManager):
        self.db = db

    # === Entity resolution (unchanged) ===

    def _resolve_entity(self, workspace_path: str) -> Entity | None:
        """Resolve workspace path to an entity.

        Algorithm:
        1. If path starts with {DuetData}/repos/:
           - Extract repo folder name (first segment after repos/)
           - Strip .git suffix (and future .wt-* for worktree)
           - find_by_name(folder_name) -> entity (search by name)
           - If not found -> None (UNKNOWN)

        2. Otherwise (Google Drive path):
           - Find which business_folder is a prefix of the path
           - Strip business_folder prefix -> relative_path
           - Normalize slashes -> /
           - find_closest_entity(relative_path) -> entity
           - If no business_folder is prefix -> None (UNKNOWN)

        Args:
            workspace_path: Absolute path to workspace (cwd of AI agent).

        Returns:
            Entity if found, None otherwise.
        """
        # Normalize Unicode: HTTP requests may be in NFC, filesystem in NFD
        workspace_path = normalize_path(workspace_path)
        path = Path(workspace_path).resolve()
        path_str = str(path)

        # Check if path is in repos/
        repos_path = get_repos_path()
        if repos_path:
            repos_str = str(repos_path.resolve())
            if path_str == repos_str or path_str.startswith(repos_str + "/"):
                return self._resolve_from_repos(path, repos_path)

        # Otherwise, try Google Drive path
        return self._resolve_from_drive(path_str)

    def _resolve_from_repos(self, path: Path, repos_path: Path) -> Entity | None:
        """Resolve entity from repos path.

        Extracts product name from path like /DuetData/repos/Duet.git/...
        and finds entity by name.
        """
        try:
            # Get path relative to repos/
            relative = path.relative_to(repos_path)
            # First part is the repo folder name (e.g., "Duet.git")
            parts = relative.parts
            if not parts:
                return None

            repo_folder = parts[0]
            # Strip suffixes: .git, .wt-* (worktree)
            product_name = self._strip_repo_suffixes(repo_folder)

            # Find entity by name
            return self.db.find_by_name(product_name)
        except ValueError:
            return None

    def _strip_repo_suffixes(self, repo_folder: str) -> str:
        """Strip .git and .wt-* suffixes from repo folder name.

        Examples:
            Duet.git -> Duet
            Duet.wt-feature -> Duet
            Duet.git.wt-feature -> Duet (hypothetical)
        """
        name = repo_folder
        # Strip .wt-* suffix first (worktree)
        name = re.sub(r"\.wt-[^/]*$", "", name)
        # Strip .git suffix
        if name.endswith(".git"):
            name = name[:-4]
        return name

    def _resolve_from_drive(self, path_str: str) -> Entity | None:
        """Resolve entity from Google Drive path.

        Finds which business_folder is a prefix, strips it,
        and searches for closest entity by relative path.

        Path format in DB: {business_folder_name}/{relative_path}
        """
        business_folders = get_business_folders()

        for folder in business_folders:
            folder_path = Path(folder).resolve()
            folder_str = str(folder_path)

            # Check if workspace_path starts with this business_folder
            if path_str == folder_str or path_str.startswith(folder_str + "/"):
                # Calculate relative path with business_folder name prefix
                try:
                    business_name = folder_path.name
                    relative = Path(path_str).relative_to(folder_path)
                    relative_str = str(relative).replace("\\", "/")

                    # Build full relative path matching DB format
                    if relative_str == ".":
                        full_relative = business_name
                    else:
                        full_relative = f"{business_name}/{relative_str}"

                    # Find closest entity by relative path
                    return self.db.find_closest_entity(full_relative)
                except ValueError:
                    continue

        return None

    def _is_path_in_hierarchy(self, workspace_path: str) -> bool:
        """Check if path is in repos/ or any business_folder.

        Used to determine reason for unknown status.
        """
        workspace_path = normalize_path(workspace_path)
        path = Path(workspace_path).resolve()
        path_str = str(path)

        # Check repos/
        repos_path = get_repos_path()
        if repos_path:
            repos_str = str(repos_path.resolve())
            if path_str == repos_str or path_str.startswith(repos_str + "/"):
                return True

        # Check business_folders
        for folder in get_business_folders():
            folder_str = str(Path(folder).resolve())
            if path_str == folder_str or path_str.startswith(folder_str + "/"):
                return True

        return False

    # === Path resolution helpers ===

    def _resolve_drive_path(self, entity: Entity) -> Path | None:
        """Resolve entity's drive_path to absolute filesystem path.

        Drive path format: {business_folder_name}/{relative}
        Reconstructs absolute path by finding matching business_folder.
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
        """Get filesystem path to product for scanning components.

        For products:
        - If entity has git_url, use repos path
        - Otherwise reconstruct from drive_path + business_folder
        """
        repos_path = get_repos_path()

        # Prefer repos path if available
        if repos_path:
            repo_path = repos_path / f"{entity.name}.git"
            if repo_path.exists():
                return repo_path

        # Fall back to drive path
        drive_path = self._resolve_drive_path(entity)
        if drive_path and drive_path.exists():
            return drive_path

        # Last resort
        business_folders = get_business_folders()
        if business_folders and entity.drive_path:
            for folder in business_folders:
                full_path = Path(folder) / entity.drive_path
                if full_path.exists():
                    return full_path

        return Path(entity.drive_path)

    # === Multi-path entity resolution ===

    def _classify_path(self, path_str: str) -> tuple[str, Entity | None]:
        """Classify a workspace path and resolve to entity.

        Returns:
            Tuple of (classification, entity_or_none).
            classification: "git" | "stream" | "ignored"
        """
        normalized = normalize_path(path_str)
        path = Path(normalized).resolve()
        path_s = str(path)

        # Check if path is in repos/
        repos_path = get_repos_path()
        if repos_path:
            repos_str = str(repos_path.resolve())
            if path_s == repos_str or path_s.startswith(repos_str + "/"):
                entity = self._resolve_from_repos(path, repos_path)
                return ("git", entity)

        # Check if path contains a manifest (streamFolder)
        manifest_names = [
            "business.json", "stream.json", "product.json", "project.json"
        ]
        for manifest_name in manifest_names:
            if (path / manifest_name).exists():
                entity = self._resolve_from_drive(path_s)
                return ("stream", entity)

        return ("ignored", None)

    def _resolve_multi_path(self, workspace_paths: list[str]) -> Entity | None:
        """Resolve best entity from multiple workspace paths.

        Algorithm:
        1. Classify each path → git/stream/ignored
        2. Collect resolved entities
        3. Prioritize: root business > business > stream > product > project
        """
        entities: list[Entity] = []
        for path_str in workspace_paths:
            _, entity = self._classify_path(path_str)
            if entity and entity.id:
                entities.append(entity)

        if not entities:
            return None

        # Check for root business first
        root_business = self.db.find_root_business()
        if root_business and root_business.id:
            for e in entities:
                if e.id == root_business.id:
                    return e

        # Priority: business(1) > stream(2) > product(3) > project(4)
        type_priority = {"business": 1, "stream": 2, "product": 3, "project": 4}
        entities.sort(key=lambda e: type_priority.get(e.type, 99))
        return entities[0]

    # === workspace_info v3 ===

    def get_workspace_info(
        self, workspace_path: str | None = None, workspace_paths: list[str] | None = None
    ) -> dict:
        """Get full workspace information for AI agents.

        Args:
            workspace_path: Single path (legacy, used if workspace_paths not provided).
            workspace_paths: List of all workspace paths. First is primary.

        Returns:
            Dict with status, duet_paths, context, workspace_paths, key_files,
            components, instructions.
        """
        duet_data = get_duet_data_path()

        # Always return duet_paths (available without workspace resolution)
        result: dict = {
            "status": "unknown",
            "duet_paths": {
                "duetDataPath": str(duet_data.resolve()),
                "machineConfig": str(get_machine_config_path().resolve()),
            },
        }

        # Instructions catalog (always present — backend validates at startup)
        instructions_path = get_instructions_path()
        result["instructions"] = scan_instructions(instructions_path)

        # Determine paths to use
        paths = workspace_paths or ([workspace_path] if workspace_path else [])

        if not paths:
            result["reason"] = "no_workspace_path"
            return result

        # Resolve entity — multi-path or single-path
        if len(paths) > 1:
            entity = self._resolve_multi_path(paths)
        else:
            entity = self._resolve_entity(paths[0])

        if not (entity and entity.id):
            # Determine reason
            any_in_hierarchy = any(
                self._is_path_in_hierarchy(p) for p in paths
            )
            result["reason"] = (
                "entity_not_in_db" if any_in_hierarchy else "path_not_in_hierarchy"
            )
            return result

        # --- Status: found ---
        result["status"] = "found"

        # Build chain
        chain = self.db.get_entity_chain(entity.id)

        # context
        result["context"] = self._build_context(chain)

        # workspace_paths
        result["workspace_paths"] = self._build_workspace_paths(entity)

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

    def _build_workspace_paths(self, entity: Entity) -> dict:
        """Build workspace_paths block."""
        workspace_type = self._get_workspace_type(entity)
        main_folder = self._get_main_folder(entity)

        ws_paths: dict = {
            "workspace_type": workspace_type,
        }

        if main_folder:
            ws_paths["main_folder"] = str(main_folder)

        projects_folder = self._get_projects_folder(entity)
        if projects_folder:
            ws_paths["projects_folder"] = str(projects_folder)

        return ws_paths

    def _build_key_files(self, entity: Entity) -> dict | None:
        """Build key_files block for the resolved entity."""
        root_path = self._get_entity_root_path(entity)
        if root_path is None:
            return None

        key_files: dict = {}

        # spec (using fallback chain for entity type)
        spec_path = find_spec_file(root_path, entity.type)
        if spec_path:
            key_files["spec"] = str(spec_path)

        # readme
        readme_path = root_path / "README.md"
        if readme_path.exists():
            key_files["readme"] = str(readme_path)

        return key_files if key_files else None

    def _get_workspace_type(self, entity: Entity) -> str:
        """Determine workspace_type from entity."""
        if entity.type == "product":
            if entity.git_url:
                return "product_folder_with_git_repo"
            return "product_folder"
        elif entity.type == "stream":
            return "stream_folder"
        elif entity.type == "business":
            return "business_folder"
        elif entity.type == "project":
            return "project_folder"
        return "unknown"

    def _get_main_folder(self, entity: Entity) -> Path | None:
        """Get main_folder for workspace_paths.

        For product_with_git_repo: repos/{name}.git
        For everything else: resolved drive path.
        """
        return self._get_entity_root_path(entity)

    def _get_projects_folder(self, entity: Entity) -> Path | None:
        """Get projects_folder for workspace_paths.

        For product and stream: {drive_path}/projects/ (created on demand).
        For business and project: absent (None).
        """
        if entity.type in ("business", "project"):
            return None

        # Products and streams: projects are on Drive
        drive_path = self._resolve_drive_path(entity)
        if drive_path:
            projects_path = drive_path / "projects"
            try:
                projects_path.mkdir(parents=True, exist_ok=True)
            except OSError:
                pass  # Drive may be offline; return path anyway
            return projects_path

        return None

    def _get_entity_description(self, entity: Entity) -> str | None:
        """Get description for entity from its README.md.

        Product with git_url: README from repos/{name}.git/
        Stream/business: README from Drive path.
        """
        entity_path = self._get_entity_root_path(entity)
        if entity_path is None:
            return None

        readme_path = entity_path / "README.md"
        return extract_description(readme_path)
