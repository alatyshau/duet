"""Workspace information service.

Provides workspace context for AI agents and extension.
"""

from pathlib import Path

from config import get_ai_kit_path, get_duet_data_path
from db import DatabaseManager
from scanner import scan_components


class WorkspaceService:
    """Service for workspace information retrieval."""

    def __init__(self, db: DatabaseManager):
        self.db = db

    def get_workspace_info(self, workspace_path: str | None = None) -> dict:
        """Get full workspace information for AI agents.

        Args:
            workspace_path: Optional path to workspace. If not provided,
                           returns general info without chain.

        Returns:
            Dict with duetDataPath, instructionsPath, chain, components.
        """
        duet_data = get_duet_data_path()

        result = {
            "duetDataPath": str(duet_data.resolve()),
            "instructionsPath": str(get_ai_kit_path().resolve()),
            "chain": [],
            "components": [],
        }

        if workspace_path:
            # Find closest entity for the workspace path
            entity = self.db.find_closest_entity(workspace_path)
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

                # If entity is a product, scan for components
                if entity.type == "product":
                    result["components"] = scan_components(Path(entity.drive_path))

        return result
