"""Workspace information service.

Provides workspace context for AI agents and extension.
"""

import re
from pathlib import Path

from config import (
    get_ai_kit_path,
    get_aliases,
    get_business_folders,
    get_duet_config_path,
    get_duet_data_path,
    get_machine,
    get_repos_path,
)
from db import DatabaseManager, Entity
from normalization import normalize_path
from scanner import scan_components


class WorkspaceService:
    """Service for workspace information retrieval."""

    def __init__(self, db: DatabaseManager):
        self.db = db

    def _resolve_entity(self, workspace_path: str) -> Entity | None:
        """Resolve workspace path to an entity.

        Algorithm:
        1. If path starts with {DuetData}/repos/:
           - Extract repo folder name (first segment after repos/)
           - Strip .git suffix (and future .wt-* for worktree)
           - find_by_name(folder_name) → entity (search by name)
           - If not found → None (UNKNOWN)

        2. Otherwise (Google Drive path):
           - Find which business_folder is a prefix of the path
           - Strip business_folder prefix → relative_path
           - Normalize slashes → /
           - find_closest_entity(relative_path) → entity
           - If no business_folder is prefix → None (UNKNOWN)

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
            if path_str.startswith(repos_str):
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
            Duet.git → Duet
            Duet.wt-feature → Duet
            Duet.git.wt-feature → Duet (hypothetical)
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
            if path_str.startswith(folder_str):
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

        # Fall back to drive path (need to reconstruct absolute path)
        business_folders = get_business_folders()
        if business_folders and entity.drive_path:
            # drive_path is relative to first matching business_folder
            for folder in business_folders:
                full_path = Path(folder) / entity.drive_path
                if full_path.exists():
                    return full_path

        # Last resort: try drive_path as-is (for backward compatibility)
        return Path(entity.drive_path)

    def get_workspace_info(self, workspace_path: str | None = None) -> dict:
        """Get full workspace information for AI agents.

        Args:
            workspace_path: Optional path to workspace. If not provided,
                           returns general info without chain.

        Returns:
            Dict with:
            - duetDataPath: path to DuetData directory
            - duetConfigPath: path to DuetConfig directory
            - machine: machine identifier
            - aliases: dict of @alias -> absolute path
            - instructionsPath: path to ai-kit directory
            - chain: list of entities from root to current
            - components: list of components (if product found)
            - status: "found" | "unknown"
            - reason (only when status="unknown"):
                - "no_workspace_path": workspace_path not provided
                - "path_not_in_hierarchy": path not in repos/ or business_folders
                - "entity_not_in_db": path is valid but entity not found (needs scan?)
        """
        duet_data = get_duet_data_path()

        result: dict = {
            "duetDataPath": str(duet_data.resolve()),
            "duetConfigPath": str(get_duet_config_path().resolve()),
            "machine": get_machine(),
            "aliases": get_aliases(),
            "instructionsPath": str(get_ai_kit_path().resolve()),
            "chain": [],
            "components": [],
            "status": "unknown",
        }

        if not workspace_path:
            result["reason"] = "no_workspace_path"
            return result

        # Check if path is in a known location (repos or business_folders)
        path_in_hierarchy = self._is_path_in_hierarchy(workspace_path)

        # Resolve entity using the new algorithm
        entity = self._resolve_entity(workspace_path)

        if entity and entity.id:
            # Build chain from root to entity
            chain = self.db.get_entity_chain(entity.id)
            result["chain"] = [
                {
                    "id": str(e.id),
                    "type": e.type,
                    "name": e.name,
                    "path": e.drive_path,
                }
                for e in chain
            ]

            # Find product in chain for components
            product = next(
                (e for e in chain if e.type == "product"),
                None
            )
            if product:
                product_path = self._get_product_path(product)
                result["components"] = scan_components(product_path)

            result["status"] = "found"
        else:
            # Entity not found — determine reason
            if path_in_hierarchy:
                result["reason"] = "entity_not_in_db"
            else:
                result["reason"] = "path_not_in_hierarchy"

        return result

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
            if path_str.startswith(repos_str):
                return True

        # Check business_folders
        for folder in get_business_folders():
            folder_path = Path(folder).resolve()
            if path_str.startswith(str(folder_path)):
                return True

        return False
