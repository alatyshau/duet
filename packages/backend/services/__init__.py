"""Business logic services for Duet backend.

Keep this package initializer side-effect free. Scanner imports
``services.manifest``; eager imports of higher-level services from here create
an import cycle (``scanner -> services -> services.entities -> scanner``).
"""

__all__ = ["WorkspaceService", "EntitiesService"]


def __getattr__(name: str):
    """Lazily expose service classes without import-time cycles."""
    if name == "WorkspaceService":
        from services.workspace import WorkspaceService

        return WorkspaceService
    if name == "EntitiesService":
        from services.entities import EntitiesService

        return EntitiesService
    raise AttributeError(name)
