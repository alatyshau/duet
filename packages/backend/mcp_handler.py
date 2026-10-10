"""MCP tools handler for Duet backend.

Provides MCP tools via HTTP transport using FastMCP.
Tools delegate to services for business logic.
"""

import functools
import time
from datetime import datetime
from html import escape
from pathlib import Path
from typing import Annotated
from zoneinfo import ZoneInfo

import anyio
from mcp.server.fastmcp import FastMCP
from mcp.shared.exceptions import McpError
from mcp.types import CallToolResult, ErrorData, INVALID_PARAMS, TextContent, ToolAnnotations
from pydantic import Field, ValidationError

from config import get_duet_data_path, get_timezone, get_version
from services.entities import EntitiesService
from services.resolve_paths import render_markdown
from services.tickets import TicketError, check_arguments
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


_REPORT_EXAMPLE = "### PPUAA — R18"


@mcp.tool(structured_output=False)
def turn_report(report: str) -> str:
    """Show one agent report on how the answer to the user was prepared.

    Prototype. One call shows one report in free-form Markdown; what the
    report contains is decided by the caller, not by the tool. The report is
    returned unchanged, so the client displays it next to the answer.

    The first non-empty line must be a level-3 heading with text, for example:

    ```markdown
    ### PPUAA — R18

    **Parse.** Вопрос: кто задаёт формат отчёта. Ответ нужен, а не действие.

    **Plan.** Ответить, разделив, что задаёт инструмент и что задаёт агент.
    ```

    Args:
        report: The report in Markdown, starting with a "### " heading.

    Returns text. Declared unstructured on purpose: a structured return
    would add an output schema, and the client then shows the
    {"result": ...} envelope instead of the text.
    """
    first = next((line for line in report.splitlines() if line.strip()), None)
    if first is None or not first.startswith("### ") or not first[4:].strip():
        raise McpError(
            ErrorData(
                code=INVALID_PARAMS,
                message=(
                    "report must start with a level-3 heading: the first non-empty "
                    "line begins with exactly '### ' followed by text, "
                    f"e.g. '{_REPORT_EXAMPLE}'"
                ),
            )
        )
    return report


@mcp.tool(structured_output=False)
def resolve_paths(paths: list[str]) -> str:
    """Resolve alpha paths to absolute paths. Pass all addresses in one call.

    An alpha path is `@<business>/...`, `@<repo>.git/...` or `@<ticket>/...`
    (`@DUE009`, `@DUEX01/notes.md`): a ticket resolves wherever its folder now
    lies, in work, backlog or archive.

    Args:
        paths: Alpha paths, e.g. ["@DUE009/INDEX.md", "@DuetLab/README.md"].

    Returns Markdown, one `### <path>` section per address: the absolute path;
    for a ticket, its kind and state; for a missing file, the path anyway and
    the nearest existing folder; for an address that does not resolve, the
    reason and what to do.
    """
    if not paths:
        raise McpError(ErrorData(code=INVALID_PARAMS, message="paths must not be empty"))
    return render_markdown(get_workspace_service().resolve_paths(paths))


# === Ticket tools ===
#
# All four tools share a contract:
# - The response is Markdown. A failed call starts with `Error:` and is flagged
#   with `isError`, so clients don't have to infer failure from the text.
# - An error means nothing was changed, unless the message says otherwise.
# - Unknown arguments are rejected (see `_reject_unknown_arguments`) instead of
#   being dropped, so a misspelled argument can't silently fall back to a default.
# - The work runs in a worker thread. Tickets live on a cloud-synced drive where
#   a read can stall, and a stalled read on the event loop would freeze the
#   server for every client.

_TICKET_TOOLS = ("tickets", "new_ticket", "move_ticket", "edit_ticket")


def _one_of(*values: str) -> dict:
    """Publish the allowed values in the schema without rejecting on letter case.

    The schema lists the values for the caller, but the argument stays a
    plain string so that `"Archive"` reaches the service, which normalizes it
    and answers an unknown value with a message in the tools' own format.
    """
    return {"enum": list(values)}


# How long a read may take before the caller is told the drive isn't responding.
# Writes have no deadline: abandoning one halfway would leave its outcome unknown.
_READ_TIMEOUT_SECONDS = 30


async def _ticket_tool(action: str, **arguments) -> str | CallToolResult:
    """Run a ticket operation off the event loop and map its result onto an MCP response."""
    service = _get_workspace_service()
    work = functools.partial(service.ticket_action, action, **arguments)
    if action == "tickets":
        try:
            with anyio.fail_after(_READ_TIMEOUT_SECONDS):
                result = await anyio.to_thread.run_sync(work, abandon_on_cancel=True)
        except TimeoutError:
            return _error_result(
                f"Error: reading the tickets took longer than {_READ_TIMEOUT_SECONDS} "
                f"seconds; the drive may be unavailable. Nothing was changed. Try again.")
    else:
        result = await anyio.to_thread.run_sync(work)
    return _error_result(result.text) if result.is_error else result.text


def _error_result(text: str) -> CallToolResult:
    return CallToolResult(content=[TextContent(type="text", text=text)], isError=True)


TicketNumbers = str | Annotated[list[str], Field(min_length=1)]


@mcp.tool(structured_output=False,
          annotations=ToolAnnotations(readOnlyHint=True, openWorldHint=False))
async def tickets(
    code: Annotated[str, Field(description='Ticket code of the business, e.g. "DUE".')] = "",
    business: Annotated[str, Field(
        description='Name of the business, e.g. "DuetLab". An alternative to `code`.')] = "",
    shelf: Annotated[str, Field(
        description="List only the tickets on this shelf. Combines with `parent`.",
        json_schema_extra=_one_of("", "work", "backlog", "archive"))] = "",
    parent: Annotated[str, Field(
        description='List the tickets under this program or process, e.g. "DUEX02". '
                    'Use "unsorted" for projects with no parent. Combines with '
                    "`shelf`.")] = "",
    number: Annotated[TicketNumbers, Field(
        description='Look up one ticket ("DUE028") or several (["DUE028", "DUEX03"]). '
                    "Can't be combined with `parent` or `shelf`.")] = "",
) -> str:
    """List a business's tickets. Use this instead of browsing ticket folders.

    Three ways to call it:

    1. Overview: `tickets(code="DUE")`. One section per program or process
       that is in work or has a ticket in work. Each section shows the
       description, a `Tickets:` line counting the group's tickets on every
       shelf (not counting the program or process itself), and every work
       and backlog ticket as `NUMBER Name "description"`. Projects with no
       parent are under `Unsorted`. A program that is itself in the backlog
       is shown with counts only. The archive is summarized by counts.
    2. Filtered list: `shelf`, `parent`, or both. `shelf` lists every ticket
       on that shelf, grouped by parent; unlike the overview, `shelf="work"`
       leaves backlog tickets out. `parent` lists a group's tickets on every
       shelf. Together they list that group's tickets on that shelf.
    3. Lookup: `number`. Shows where a ticket is, its stable `@NUMBER`
       address, and its frontmatter. For a program or process it also lists
       every ticket under it, so no second call is needed.

    A ticket's state is the shelf it's on. `closed` and `reopened` in the
    frontmatter are history: a reopened ticket still has a `closed` date.
    `none` in a response means the field is empty; it is not a value to send
    back.

    Returns:
        Markdown. A failed call returns a message starting with `Error:` that
        explains how to fix it. A `number` list is the exception: each number
        gets its own section, a number that can't be resolved gets an
        `Error:` section, and the first line says how many resolved. The
        call fails as a whole only if no number resolves.
    """
    return await _ticket_tool("tickets", code=code, business=business, shelf=shelf,
                              parent=parent, number=number)


@mcp.tool(structured_output=False,
          annotations=ToolAnnotations(readOnlyHint=False, destructiveHint=False,
                                      idempotentHint=False, openWorldHint=False))
async def new_ticket(
    name: Annotated[str, Field(
        description='The ticket name in plain words, e.g. "ui research". Converted to a '
                    "PascalCase folder name (`UiResearch`): only letters and digits are "
                    'kept, and each word is capitalized. "" creates a ticket with just '
                    "its number.")],
    parent: Annotated[str | None, Field(
        description='The program or process this ticket belongs to, e.g. "DUEX02". It '
                    "must be open (in work or backlog). The business and business area "
                    "are inherited from it.")] = None,
    kind: Annotated[str, Field(
        description="Only a project can have a parent.",
        json_schema_extra=_one_of("project", "program", "process"))] = "project",
    shelf: Annotated[str, Field(
        description="Where to create the ticket.",
        json_schema_extra=_one_of("work", "backlog"))] = "work",
    description: Annotated[str | None, Field(
        description="A one-line summary shown next to the ticket in `tickets`, up to 300 "
                    "characters. Line breaks become spaces.")] = None,
    icon: Annotated[str | None, Field(description="An emoji for the ticket.")] = None,
    area: Annotated[str | None, Field(
        description="The business area. Only for a ticket without a parent.")] = None,
    code: Annotated[str | None, Field(
        description='Ticket code of the business, e.g. "DUE". Required when there is no '
                    "`parent`, unless `business` is given.")] = None,
    business: Annotated[str | None, Field(
        description="Name of the business. An alternative to `code`.")] = None,
) -> str:
    """Create a ticket: allocates the next number, creates the folder, writes the frontmatter.

    Always use this to create a ticket. Don't pick a number, create the
    folder, or write the frontmatter of `INDEX.md` by hand. The new
    `INDEX.md` already contains the frontmatter and a title heading; add
    your content below them.

    Not idempotent: every successful call creates a new ticket with a new
    number. If a call's outcome is unknown (for example, the response was
    lost), check `tickets` before calling again.

    Example: `new_ticket(name="Thesaurus", parent="DUEX02")`.

    Not covered: changing a ticket's kind, moving it to another business,
    merging tickets, and deleting them. Ask the user how to proceed.

    Returns:
        Markdown with the new number, the folder path, the stable `@NUMBER`
        address, and the frontmatter that was written. A failed call returns
        a message starting with `Error:`; nothing is created unless the
        message says otherwise.
    """
    return await _ticket_tool(
        "new_ticket", name=name, parent=parent or "", kind=kind, shelf=shelf,
        description=description or "", icon=icon or "",
        area=area or "", code=code or "", business=business or "")


@mcp.tool(structured_output=False,
          annotations=ToolAnnotations(readOnlyHint=False, destructiveHint=False,
                                      idempotentHint=True, openWorldHint=False))
async def move_ticket(
    ticket: Annotated[str, Field(description='The ticket number, e.g. "DUE028".')],
    to: Annotated[str, Field(
        description="The shelf to move to: work (active), backlog (shelved), or archive "
                    "(closed).",
        json_schema_extra=_one_of("work", "backlog", "archive"))],
) -> str:
    """Close, reopen, shelve, or resume a ticket by moving it to work, backlog, or archive.

    Don't move ticket folders by hand. Moving a ticket to the archive closes
    it: today's date (in the timezone from Duet's settings) is appended to
    `closed` in the frontmatter and the folder goes into the current month's
    archive folder. Moving it out of the archive reopens it and appends the
    date to `reopened`. Dates accumulate; nothing is overwritten. Moves
    between work and backlog don't record a date.

    Only the named ticket moves. Moving a program or process doesn't move
    the tickets under it, and one can't be closed while any ticket under it
    is still in work or backlog: close those first.

    Safe to retry: moving a ticket to the shelf it's already on succeeds
    with "No changes" and records no date.

    Not covered: moving a ticket to another business. Ask the user how to
    proceed.

    Returns:
        Markdown with the new folder path, the stable `@NUMBER` address,
        and, if a date was recorded, the updated frontmatter. A failed call
        returns a message starting with `Error:`; nothing is moved unless
        the message says otherwise.
    """
    return await _ticket_tool("move_ticket", ticket=ticket, to=to)


@mcp.tool(structured_output=False,
          annotations=ToolAnnotations(readOnlyHint=False, destructiveHint=False,
                                      idempotentHint=True, openWorldHint=False))
async def edit_ticket(
    ticket: Annotated[str, Field(description='The ticket number, e.g. "DUE028".')],
    name: Annotated[str | None, Field(
        description="The new name in plain words. Renames the folder, updates the title "
                    "heading in INDEX.md, and records the previous folder name in "
                    "`renamed-from` and the date in `renamed`. "
                    "Can't be empty.")] = None,
    parent: Annotated[str | None, Field(
        description='The new parent, an open program or process, e.g. "DUEX02". The '
                    'business area is updated to match. Pass "" to remove the parent.')] = None,
    area: Annotated[str | None, Field(
        description="The business area, for a ticket with no parent. A ticket with a "
                    'parent inherits it. Pass "" to clear it.')] = None,
    icon: Annotated[str | None, Field(
        description='An emoji. Pass "" to remove it.')] = None,
    description: Annotated[str | None, Field(
        description='A one-line summary shown in `tickets`, up to 300 characters. Pass '
                    '"" to remove it.')] = None,
) -> str:
    """Change a ticket's name, parent, business area, icon, or description.

    Always use this to rename a ticket or edit the frontmatter of its
    `INDEX.md`. Renaming changes the name everywhere it is the ticket's name:
    the folder, and the title heading (the first `# ` line) of `INDEX.md`.
    Everything else below the frontmatter is yours and is never touched. The
    ticket number never changes.

    For every argument except `ticket`: omit it (or pass null) to leave the
    field unchanged, and pass an empty string to clear it. For example,
    `{"ticket": "DUE028", "parent": ""}` removes the parent, while
    `{"ticket": "DUE028", "parent": null}` changes nothing.

    Safe to retry: if the ticket already has the requested values, the call
    succeeds with "No changes".

    Not covered: changing a ticket's kind or number, `process-type`, and any
    other frontmatter field. To close, reopen, or shelve a ticket, use
    `move_ticket`. For anything else, ask the user how to proceed.

    Returns:
        Markdown listing what changed, with the previous values, the stable
        `@NUMBER` address, and the updated frontmatter. A failed call
        returns a message starting with `Error:`; nothing is changed unless
        the message says otherwise.
    """
    return await _ticket_tool("edit_ticket", ticket=ticket, name=name, parent=parent,
                              area=area, icon=icon, description=description)


def _reject_unknown_arguments(names: tuple[str, ...]) -> None:
    """Make tools fail, in their own words, on arguments they don't declare.

    FastMCP validates arguments with a pydantic model that ignores unknown
    keys, so a typo like `shelff="backlog"` would silently fall back to the
    default and the tool would act on a request the caller never made. For
    tools that write to disk that is not acceptable.

    Each tool's argument check is wrapped: unknown keys are refused with the
    service's own message (`services.tickets.check_arguments`, the same check
    REST goes through) before FastMCP sees them, and any remaining validation
    failure is reworded the same way. The published schema is made strict to
    match. This reaches into FastMCP's tool metadata; `TestMcpBoundary` fails
    loudly if a new SDK version moves it.
    """
    for name in names:
        tool = mcp._tool_manager.get_tool(name)
        tool.parameters["additionalProperties"] = False
        metadata = tool.fn_metadata
        validate_and_call = metadata.call_fn_with_arg_validation

        async def checked(fn, fn_is_async, arguments, direct, *, _name=name,
                          _declared=frozenset(metadata.arg_model.model_fields),
                          _validate_and_call=validate_and_call):
            unknown = {key: value for key, value in arguments.items() if key not in _declared}
            try:
                if unknown:
                    check_arguments(_name, unknown)
                return await _validate_and_call(fn, fn_is_async, arguments, direct)
            except TicketError as error:
                return _error_result(f"Error: {error}")
            except ValidationError as error:
                problems = "; ".join(
                    f"`{'.'.join(str(part) for part in issue['loc'])}`: {issue['msg']}"
                    for issue in error.errors())
                return _error_result(f"Error: invalid arguments for `{_name}`: {problems}. "
                                     f"Nothing was changed.")

        # FuncMetadata is a pydantic model, so a plain assignment is refused.
        object.__setattr__(metadata, "call_fn_with_arg_validation", checked)


_reject_unknown_arguments(_TICKET_TOOLS)


@mcp.tool(structured_output=False)
def orientation(path: str) -> str:
    """Orient a session in the folder it was opened in. Call once, before any work.

    Args:
        path: Absolute path of the folder the session was opened in.

    Returns Markdown: the paths of this machine, the business's ticket code
    if it has one, and what to read first. A meta venture also gets the
    folders of the other ventures.
    """
    if not Path(path).is_absolute():
        raise McpError(
            ErrorData(code=INVALID_PARAMS, message=f"path must be absolute, got {path!r}")
        )
    return _get_workspace_service().get_orientation(path)


@mcp.tool()
def business_tree() -> list[dict]:
    """Discover registered businesses across all ventures and their products.

    Use this to find a business by name or explore the business hierarchy,
    rather than searching the filesystem. Areas without their own
    context.json are described in business entry points, not in this registry.
    Use resolve_paths for a known alpha path.

    Returns a flat list linked by id and parent_id, with roots in configured
    order and other businesses alphabetically by name. Records include name,
    icon, absolute_path, description, meta, git_repos, and reference_repos.
    The storage type remains context; repository declarations are fields,
    not separate tree nodes.
    """
    service = _get_entities_service()
    return service.get_contexts()


@mcp.tool()
def scan() -> dict:
    """Rescan configured business folders and rebuild the entity hierarchy.

    Use when the file structure has changed (new folders, moved products)
    and `business_tree` returns stale data.

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
