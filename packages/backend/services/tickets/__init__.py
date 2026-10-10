"""Ticket operations shared by the MCP tools and the extension.

A ticket is a folder named `<number>_<Name>` under a business's `work/`,
`backlog/`, or `archive/` directory. Its metadata (kind, parent, dates) lives
in the YAML frontmatter of its `INDEX.md`.

Four operations are exposed, each a single call:

- `tickets`: list a business's tickets.
- `new_ticket`: allocate a number, create the folder, write the frontmatter.
- `move_ticket`: move a ticket between work, backlog, and archive.
- `edit_ticket`: change a ticket's name, parent, icon, or description.

These operations own the ticket's name and its frontmatter. The name lives
in the folder name and in the title heading of `INDEX.md`, and a rename
changes both. Everything else below the frontmatter belongs to whoever writes
the ticket and is never modified.

The operations take the registered contexts and the current date as
arguments, so they have no hidden dependencies. Each returns Markdown for the
caller to display and raises `TicketError` when it can't proceed. `run` wraps
both outcomes in a `Result`, so callers never infer failure from the text.

Failure contract: an error means nothing changed. Write operations validate
everything first, write `INDEX.md` atomically, and roll back a folder move or
creation if the write that follows it fails. The one exception is a failed
rollback, and in that case the error message describes the exact state left
on disk.
"""

from __future__ import annotations

import difflib
import inspect
import types
import typing
from dataclasses import dataclass, field
from datetime import date

from services.resolve_paths import ContextRef
from services.tickets.model import TicketError, collect_affected
from services.tickets.views import tickets
from services.tickets.writes import edit_ticket, move_ticket, new_ticket

__all__ = ["ACTIONS", "Result", "TicketError", "argument_names", "check_arguments", "run"]

ACTIONS = {"tickets": tickets, "new_ticket": new_ticket,
           "move_ticket": move_ticket, "edit_ticket": edit_ticket}

# Arguments callers reach for that belong to a different tool.
_MISPLACED_ARGUMENTS = {
    ("edit_ticket", "status"): "To close, reopen, or shelve a ticket, use `move_ticket`.",
    ("edit_ticket", "shelf"): "To move a ticket to another shelf, use `move_ticket`.",
    ("edit_ticket", "to"): "To move a ticket to another shelf, use `move_ticket`.",
    ("new_ticket", "number"): "The number is allocated for you; leave it out.",
    ("move_ticket", "shelf"): "The destination is called `to`.",
}


@dataclass
class Result:
    """The outcome of an operation: the text to show and whether it failed.

    Callers branch on `is_error`, never on the text. A batch that succeeded
    for at least one ticket is not an error, even if some tickets failed.
    """

    text: str
    is_error: bool = False
    # The tickets the operation looked up, created, moved, or edited, as data:
    # `{number, name, shelf, folder}` each. Empty for listings and for failures.
    tickets: list[dict] = field(default_factory=list)


def argument_names(action: str) -> list[str]:
    """The arguments a caller may pass to an operation."""
    return list(inspect.signature(ACTIONS[action]).parameters)[2:]  # After contexts, today.


def check_arguments(action: str, arguments: dict) -> None:
    """Reject unknown arguments and wrong types before anything runs.

    An unknown argument must never be dropped: a misspelled `shelf` would
    silently fall back to its default, and the operation would then do
    something the caller didn't ask for. Both entry points, MCP and REST, go
    through this, so they refuse the same requests with the same message.
    """
    allowed = argument_names(action)
    for name in arguments:
        if name in allowed:
            continue
        close = difflib.get_close_matches(name, allowed, n=1)
        hint = _MISPLACED_ARGUMENTS.get((action, name)) or (
            f"Did you mean `{close[0]}`?" if close else "")
        raise TicketError(
            f"`{action}` has no argument `{name}`. {hint + ' ' if hint else ''}Its arguments "
            f"are: {', '.join(allowed)}. Nothing was changed.")
    hints = typing.get_type_hints(ACTIONS[action])
    for name, value in arguments.items():
        if not _has_type(value, hints[name]):
            raise TicketError(f"`{name}` must be {_describe_type(hints[name])}; got "
                              f"{type(value).__name__}. Nothing was changed.")
    signature = inspect.signature(ACTIONS[action])
    missing = [name for name in allowed
               if signature.parameters[name].default is inspect.Parameter.empty
               and name not in arguments]
    if missing:
        raise TicketError(f"`{action}` requires `{missing[0]}`. Nothing was changed.")


def _has_type(value, hint) -> bool:
    if typing.get_origin(hint) in (typing.Union, types.UnionType):
        return any(_has_type(value, option) for option in typing.get_args(hint))
    if typing.get_origin(hint) is list:
        return isinstance(value, list) and all(isinstance(item, str) for item in value)
    if hint is bool:
        return isinstance(value, bool)
    return isinstance(value, hint)


def _describe_type(hint) -> str:
    if typing.get_origin(hint) in (typing.Union, types.UnionType):
        options = [_describe_type(o) for o in typing.get_args(hint) if o is not type(None)]
        return " or ".join(options)
    if typing.get_origin(hint) is list:
        return "a list of strings"
    return {str: "a string", bool: "true or false"}.get(hint, hint.__name__)


def run(action: str, contexts: list[ContextRef], today: date, **arguments) -> Result:
    """Run an operation. Failures are returned as an error `Result`, not raised."""
    try:
        check_arguments(action, arguments)
        with collect_affected() as affected:
            text = ACTIONS[action](contexts, today, **arguments)
        return Result(text, tickets=affected)
    except TicketError as error:
        return Result(f"Error: {error}", is_error=True)
    except OSError as error:
        # Every expected filesystem failure is handled where it happens, so this is
        # a safety net: say plainly that the outcome is unknown.
        return Result(f"Error: unexpected filesystem failure: {error}. The ticket may be "
                      f"partially updated; check it with `tickets(number=...)` before "
                      f"retrying.", is_error=True)
