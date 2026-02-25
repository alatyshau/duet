"""MCP tools handler for Duet backend.

Provides MCP tools via HTTP transport using FastMCP.
Tools delegate to services for business logic.
"""

import time
from datetime import datetime
from zoneinfo import ZoneInfo

from mcp.server.fastmcp import FastMCP
from mcp.shared.exceptions import McpError
from mcp.types import ErrorData, INVALID_PARAMS

from config import get_duet_data_path, get_timezone, get_version
from services.entities import EntitiesService
from services.workspace import WorkspaceService


# Create FastMCP server instance
# streamable_http_path="/" so final URL is /mcp (not /mcp/mcp)
mcp = FastMCP("duet", json_response=True, streamable_http_path="/")


# Services (initialized by server.py via init_services)
_workspace_service: WorkspaceService | None = None
_entities_service: EntitiesService | None = None
_start_time: float = 0


def init_services(
    workspace_service: WorkspaceService,
    entities_service: EntitiesService,
    start_time: float,
) -> None:
    """Initialize services for MCP tools.

    Called by server.py after database initialization.
    """
    global _workspace_service, _entities_service, _start_time
    _workspace_service = workspace_service
    _entities_service = entities_service
    _start_time = start_time


def reset_services() -> None:
    """Reset services to uninitialized state. Used by test teardown."""
    global _workspace_service, _entities_service, _start_time
    _workspace_service = None
    _entities_service = None
    _start_time = 0


def _get_workspace_service() -> WorkspaceService:
    if _workspace_service is None:
        raise RuntimeError("Services not initialized. Call init_services() first.")
    return _workspace_service


def _get_entities_service() -> EntitiesService:
    if _entities_service is None:
        raise RuntimeError("Services not initialized. Call init_services() first.")
    return _entities_service


def get_workspace_service() -> WorkspaceService:
    """Get workspace service. Raises if not initialized."""
    return _get_workspace_service()


def get_entities_service() -> EntitiesService:
    """Get entities service. Raises if not initialized."""
    return _get_entities_service()


# === Utility functions (stateless, no services needed) ===


def get_timestamp() -> str:
    """Get current timestamp in format YYMMDD_HHMMSS<tz>.

    Uses timezone from settings.json (timestampTZ field).
    """
    tz_config = get_timezone()
    tz = ZoneInfo(tz_config["value"])
    return datetime.now(tz).strftime(f"%y%m%d_%H%M%S{tz_config['id']}")


def get_duet_data_path_str() -> str:
    """Get absolute path to DuetData directory."""
    return str(get_duet_data_path().resolve())


# === MCP Tool registrations ===


@mcp.tool()
def timestamp() -> str:
    """Get current timestamp in format YYMMDD_HHMMSS<tz> (e.g., 260131_143052M).

    Uses timezone from settings.json (timestampTZ field).
    """
    return get_timestamp()


@mcp.tool()
def duet_data_path() -> str:
    """Get absolute path to DuetData directory."""
    return get_duet_data_path_str()


@mcp.tool()
def workspace_info(workspace_path: str = "") -> dict:
    """Get full workspace information.

    Args:
        workspace_path: Path to current workspace/repository.

    Returns information about:
    - duetDataPath: Path to DuetData directory
    - machineConfig: Path to machine config JSON file
    - instructionsPath: Path to ai-instructions directory
    - workspace_type: product_folder_with_git_repo | product_folder | stream_folder | business_folder | project_folder
    - main_folder: Absolute path to entity root directory
    - projects_folder: Absolute path to projects/ on Drive (product/stream only, absent for business/project)
    - context: {breadcrumb, chain with type/name/description?}
    - key_files: {spec?, readme?} — absolute paths to read first (absent if no files found)
    - components: List of components with name, path, spec?, description?
    """
    service = _get_workspace_service()
    return service.get_workspace_info(workspace_path if workspace_path else None)


@mcp.tool()
def streams() -> list[dict]:
    """Get all streams (business, stream, product) without projects.

    Returns flat list for sidebar tree view.
    Each entity has: id, type, name, icon, path, parent_id.
    Client computes hasChildren from parent_id relations.
    """
    service = _get_entities_service()
    return service.get_streams()


@mcp.tool()
def projects(stream_id: str) -> list[dict]:
    """Get projects for a stream.

    Args:
        stream_id: Parent entity ID (business, stream, or product)

    Returns list of project entities with id, type, name, icon, path, parent_id.

    Raises:
        McpError: If stream_id is not a valid integer.
    """
    service = _get_entities_service()
    try:
        sid = int(stream_id) if stream_id else 0
    except ValueError:
        raise McpError(
            ErrorData(
                code=INVALID_PARAMS,
                message=f"Invalid stream_id: '{stream_id}' is not a valid integer",
            )
        )
    return service.get_projects(sid)


@mcp.tool()
def scan() -> dict:
    """Rescan the entity hierarchy.

    Scans all business folders configured in settings.json
    and rebuilds the entities database.

    Returns scan statistics including entities_count.
    """
    service = _get_entities_service()
    return service.run_scan()


@mcp.tool()
def health() -> dict:
    """Check backend health status.

    Returns status, version, and uptime.
    """
    uptime = int(time.time() - _start_time) if _start_time else 0
    return {
        "status": "ok",
        "version": get_version(),
        "uptime_seconds": uptime,
    }
