"""MCP tools handler for Duet backend.

Provides MCP tools via HTTP transport using FastMCP.
Tools delegate to services for business logic.
"""

import time
from datetime import datetime
from html import escape
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


_PLAN_FORMATS = ("md", "html", "line", "plain")

_PLAN_MARKS = {"done": "\u2705", "current": "\u23f3", "pending": "\u2b1c"}


@mcp.tool(structured_output=False)
def turn_plan(items: list[str], current: int = 0, fmt: str = "md") -> str:
    """Render the plan for the current turn.

    Prototype. Stateless by design: a plan lives for exactly one turn and is
    rebuilt on every call, so nothing is stored between calls.

    Steps close strictly in order, so the state is one index: everything
    before `current` is done, everything after it is pending. An out-of-order
    state cannot be expressed.

    Args:
        items: The turn's steps, in the order they are closed.
        current: Index of the step in progress. Pass len(items) when every
            step is closed.
        fmt: Output shape. "md" is a heading plus a Markdown checklist;
            "html" is the same as an HTML fragment; "line" puts the whole
            plan on one line; "plain" is one unadorned line per step with no
            heading, for clients whose preview box is a few lines tall.

    Returns text. Declared unstructured on purpose: a structured return
    would add an output schema, and the client then shows the
    {"result": ...} envelope instead of the text.
    """
    if not items:
        raise McpError(ErrorData(code=INVALID_PARAMS, message="items must not be empty"))
    if not 0 <= current <= len(items):
        raise McpError(
            ErrorData(
                code=INVALID_PARAMS,
                message=f"current must be between 0 and {len(items)}, got {current}",
            )
        )
    if fmt not in _PLAN_FORMATS:
        raise McpError(
            ErrorData(
                code=INVALID_PARAMS,
                message=f"fmt must be one of {', '.join(_PLAN_FORMATS)}, got {fmt!r}",
            )
        )

    if current >= len(items):
        title = f"План хода — все {len(items)} шагов закрыты"
    else:
        title = f"План хода — шаг {current + 1} из {len(items)}"

    def state(index: int) -> str:
        if index < current:
            return "done"
        return "current" if index == current else "pending"

    if fmt == "plain":
        rows = []
        for index, item in enumerate(items):
            mark = _PLAN_MARKS[state(index)]
            rows.append(f"{mark} {item}")
        return "\n".join(rows)

    if fmt == "line":
        parts = [f"**{title}**"]
        for index, item in enumerate(items):
            mark = _PLAN_MARKS[state(index)]
            if state(index) == "done":
                parts.append(f"{mark} ~~{item}~~")
            elif state(index) == "current":
                parts.append(f"{mark} **{item}**")
            else:
                parts.append(f"{mark} {item}")
        return " · ".join(parts)

    if fmt == "html":
        rows = []
        for index, item in enumerate(items):
            text = escape(item)
            mark = _PLAN_MARKS[state(index)]
            if state(index) == "done":
                rows.append(f"  <li>{mark} <s>{text}</s></li>")
            elif state(index) == "current":
                rows.append(f"  <li>{mark} <b>{text}</b> \u2190 сейчас</li>")
            else:
                rows.append(f"  <li>{mark} {text}</li>")
        body = "\n".join(rows)
        return f"<h3>{escape(title)}</h3>\n<ul>\n{body}\n</ul>"

    lines = [f"### {title}", ""]
    for index, item in enumerate(items):
        if state(index) == "done":
            lines.append(f"- [x] ~~{item}~~")
        elif state(index) == "current":
            lines.append(f"- [ ] **{item}** \u2190 сейчас")
        else:
            lines.append(f"- [ ] {item}")
    return "\n".join(lines)


@mcp.tool()
def orientation(workspace_paths: list[str] | None = None) -> dict:
    """Get full workspace information.

    Args:
        workspace_paths: List of all workspace paths available to the agent.
            Multi-path resolution: classifies paths, picks the meta-context if
            present, otherwise the first resolved context (multi-repo contexts
            unify all `repos/<alias>.git` paths to one owner).

    Returns information about:
    - duet_paths: {duetDataPath, machineConfig}
    - workspace: {kind, context_name, context_folder, git_folders[, reference_repos][, meta-only addons]}
    - context: {breadcrumb, chain with type/name/description?}
    - products: [{name, path, spec?, description?, components[]}] — top-level array
    - memory: {ref, path} context-memory pointer, or null when none declared
    """
    service = _get_workspace_service()
    return service.get_orientation(workspace_paths=workspace_paths or [])


@mcp.tool()
def contexts() -> list[dict]:
    """Find any context in the user's hierarchy.

    Use this to locate a context (or its bound product repo) by name, discover
    what exists, or navigate the context tree. Prefer this over filesystem
    searches (find, ls, glob) for discovering contexts.

    Each entity has: id, type, name, icon, path, parent_id, meta, git_url.
    """
    service = _get_entities_service()
    return service.get_contexts()


@mcp.tool()
def scan() -> dict:
    """Rescan configured business folders and rebuild the entity hierarchy.

    Use when the file structure has changed (new folders, moved products)
    and `streams` returns stale data.

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
