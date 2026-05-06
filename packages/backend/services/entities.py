"""Entities service.

Provides entity listing and hierarchy scanning.
"""

import time
from pathlib import Path

from config import get_business_folders, get_repos_path
from db import DatabaseManager, Entity
from scanner import Scanner, make_scan_result
from services.manifest import read_reference_repos


# Minimum interval between scans (seconds)
SCAN_DEBOUNCE_SECONDS = 5


class EntitiesService:
    """Service for entity operations."""

    def __init__(self, db: DatabaseManager):
        self.db = db
        self._last_scan_time: float = 0

    def get_entities(
        self,
        entity_type: str | None = None,
        parent_id: int | None = None,
        root_only: bool = False,
    ) -> list[dict]:
        """Get list of entities with filters.

        Args:
            entity_type: Filter by type (business, stream, product)
            parent_id: Get only children of this parent
            root_only: Get only root entities (no parent)

        Returns:
            List of entity dicts.
        """
        if root_only:
            entities = self.db.get_entities(parent_id=None)
        elif parent_id is not None:
            entities = self.db.get_entities(parent_id=parent_id)
        else:
            entities = self.db.get_all_entities()

        # Filter by type if specified
        if entity_type:
            entities = [e for e in entities if e.type == entity_type]

        path_lookup = self._build_path_lookup()
        return [self._entity_to_dict(e, path_lookup) for e in entities]

    def get_streams(self) -> list[dict]:
        """Get streams (business, stream, product).

        Returns flat list for sidebar tree view.
        Client computes hasChildren from parent_id relations.
        """
        entities = self.db.get_streams()
        path_lookup = self._build_path_lookup()
        return [self._entity_to_dict(e, path_lookup) for e in entities]

    def run_scan(self) -> dict:
        """Run full hierarchy scan.

        Returns scan statistics. If scan was run < 5 seconds ago,
        returns {"status": "skipped", "reason": "recent_scan"}.
        """
        now = time.time()
        if now - self._last_scan_time < SCAN_DEBOUNCE_SECONDS:
            return make_scan_result("skipped", reason="recent_scan")

        scanner = Scanner(self.db)
        result = scanner.scan()
        self._last_scan_time = time.time()

        return result

    @staticmethod
    def _build_path_lookup() -> dict:
        """Build lookup for resolving relative drive_path to absolute path.

        Called once per request, shared across all entities in response.

        Returns dict with:
        - business_folders: {folder_name: Path} mapping
        - repos_path: Path | None
        """
        business_folders = get_business_folders()
        bf_lookup = {}
        for folder in business_folders:
            p = Path(folder)
            bf_lookup[p.name] = p
        return {
            "business_folders": bf_lookup,
            "repos_path": get_repos_path(),
        }

    @staticmethod
    def _resolve_absolute_path(drive_path: str | None, path_lookup: dict) -> str | None:
        """Resolve relative drive_path to absolute filesystem path.

        Algorithm:
        1. Split first segment of drive_path (business_folder name)
        2. Match against business_folder names → business_folder / rest
        3. If no match, try repos_path / drive_path (paths under cloned repos)
        4. If neither → None
        """
        if not drive_path:
            return None

        parts = drive_path.split("/", 1)
        first_segment = parts[0]
        rest = parts[1] if len(parts) > 1 else None

        # Try business folder match
        bf = path_lookup["business_folders"].get(first_segment)
        if bf:
            if rest:
                return str(bf / rest)
            return str(bf)

        # Try repos path (for subpaths under cloned repos like "Duet.git/...")
        repos_path = path_lookup["repos_path"]
        if repos_path:
            return str(repos_path / drive_path)

        return None

    @staticmethod
    def _entity_to_dict(entity: Entity, path_lookup: dict | None = None) -> dict:
        """Convert Entity to dict for API response."""
        absolute_path = None
        if path_lookup is not None:
            absolute_path = EntitiesService._resolve_absolute_path(
                entity.drive_path, path_lookup
            )
        return {
            "id": str(entity.id),
            "type": entity.type,
            "name": entity.name,
            "icon": entity.icon,
            "path": entity.drive_path,
            "absolute_path": absolute_path,
            "parent_id": str(entity.parent_id) if entity.parent_id else None,
            "git_url": entity.git_url,
            "reference_repos": read_reference_repos(absolute_path, entity.type),
        }
