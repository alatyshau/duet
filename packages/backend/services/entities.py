"""Entities service.

Provides entity listing and hierarchy scanning.
"""

import time

from db import DatabaseManager, Entity
from scanner import Scanner


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
            entity_type: Filter by type (business, stream, product, project)
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

        return [self._entity_to_dict(e) for e in entities]

    def get_streams(self) -> list[dict]:
        """Get all streams (business, stream, product) without projects.

        Returns flat list for sidebar tree view.
        Client computes hasChildren from parent_id relations.
        """
        entities = self.db.get_streams()
        return [self._entity_to_dict(e) for e in entities]

    def get_projects(self, stream_id: int) -> list[dict]:
        """Get projects for a stream (any level: business, stream, or product).

        Args:
            stream_id: Parent entity ID
        """
        entities = self.db.get_projects(stream_id)
        return [self._entity_to_dict(e) for e in entities]

    def run_scan(self) -> dict:
        """Run full hierarchy scan.

        Returns scan statistics. If scan was run < 5 seconds ago,
        returns {"status": "skipped", "reason": "recent_scan"}.
        """
        now = time.time()
        if now - self._last_scan_time < SCAN_DEBOUNCE_SECONDS:
            return {"status": "skipped", "reason": "recent_scan"}

        scanner = Scanner(self.db)
        result = scanner.scan()
        self._last_scan_time = time.time()
        return result

    @staticmethod
    def _entity_to_dict(entity: Entity) -> dict:
        """Convert Entity to dict for API response."""
        return {
            "id": str(entity.id),
            "type": entity.type,
            "name": entity.name,
            "icon": entity.icon,
            "path": entity.drive_path,
            "parent_id": str(entity.parent_id) if entity.parent_id else None,
            "git_url": entity.git_url,
        }
