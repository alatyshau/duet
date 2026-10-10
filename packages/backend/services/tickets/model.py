"""Tickets and businesses as they are on disk, and how to find them."""

from __future__ import annotations

import threading
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass
from pathlib import Path

from services.manifest import MANIFEST_FILENAME, read_manifest
from services.resolve_paths import ContextRef, TICKET_NUMBER_RE, list_ticket_folders
from services.tickets.frontmatter import Frontmatter
from services.tickets.naming import KIND_BY_LETTER

INDEX_FILENAME = "INDEX.md"
SHELVES = ("work", "backlog", "archive")

# Held while a business's folders are being read and for the whole of every
# write. Without it, a read that overlaps a move can see the ticket in neither
# place, or in both, and report a missing or duplicated ticket that isn't.
# Reentrant because a write loads the business while holding it.
_disk_lock = threading.RLock()
# How long to wait for the lock. A read stalled on the drive keeps holding it,
# and without a deadline every later operation would queue behind it forever.
LOCK_TIMEOUT_SECONDS = 20


@contextmanager
def disk_lock():
    """Hold the disk lock, or fail with a clear error if it can't be had in time."""
    if not _disk_lock.acquire(timeout=LOCK_TIMEOUT_SECONDS):
        raise TicketError("another ticket operation is still running; the drive may be "
                          "stalled. Nothing was changed. Try again.")
    try:
        yield
    finally:
        _disk_lock.release()


class TicketError(Exception):
    """An operation can't be completed. The message says why and how to fix it."""


@dataclass
class Ticket:
    number: str
    name: str            # Folder name without the number, e.g. `CoreProtocols`.
    folder: Path
    shelf: str           # "work", "backlog", or "archive".
    frontmatter: Frontmatter
    # Why INDEX.md couldn't be read, or None. An unreadable file is not an
    # empty one: its frontmatter is unknown, and it must never be overwritten.
    read_error: str | None = None
    # False if the folder has no INDEX.md at all. That is a valid ticket.
    has_index: bool = True

    @property
    def kind(self) -> str:
        letter = self.number[3] if self.number[3].isalpha() else ""
        return KIND_BY_LETTER.get(letter, "ticket")

    @property
    def is_group(self) -> bool:
        """Whether this ticket can be a parent (a program or a process)."""
        return self.kind in ("program", "process")

    @property
    def parent(self) -> str | None:
        raw = self.frontmatter.get("parent")
        if raw is None:
            return None
        match = TICKET_NUMBER_RE.match(raw.lstrip("@"))
        return match.group(0) if match else raw

    @property
    def description(self) -> str | None:
        return self.frontmatter.get("description")

    @property
    def title(self) -> str:
        return f"{self.number} {self.name}" if self.name else self.number

    @property
    def index_path(self) -> Path:
        return self.folder / INDEX_FILENAME


@dataclass
class Business:
    name: str
    code: str
    folder: Path
    tickets: list[Ticket]

    def find(self, number: str) -> list[Ticket]:
        return [t for t in self.tickets if t.number == number]

    def children(self, number: str | None) -> list[Ticket]:
        """Return a parent's tickets, or the parentless projects if `number` is None.

        Tickets whose `INDEX.md` couldn't be read are never included, because
        their parent is unknown; see `unreadable`.
        """
        readable = [t for t in self.tickets if t.read_error is None]
        if number is None:
            return [t for t in readable if t.parent is None and not t.is_group]
        return [t for t in readable if t.parent == number]

    @property
    def unreadable(self) -> list[Ticket]:
        return [t for t in self.tickets if t.read_error is not None]


def _read_ticket(folder: Path, parts: list[str], name: str) -> Ticket:
    text, read_error, has_index = "", None, True
    try:
        # Decode the raw bytes: `read_text` would translate CRLF to LF, and the
        # file is later written back in full.
        text = (folder / INDEX_FILENAME).read_bytes().decode("utf-8")
    except FileNotFoundError:
        has_index = False
    except UnicodeDecodeError:
        read_error = "not valid UTF-8"
    except OSError as error:
        read_error = error.strerror or str(error)
    return Ticket(number=name[:6], name=name[7:], folder=folder, shelf=parts[0],
                  frontmatter=Frontmatter.parse(text), read_error=read_error,
                  has_index=has_index)


def load_business(context: ContextRef, code: str) -> Business:
    with disk_lock():
        try:
            # Strict: a folder we can't list could hide tickets, and a partial list
            # must never be presented as the full one.
            found = list_ticket_folders(Path(context.folder), strict=True)
        except OSError as error:
            raise TicketError(
                f"couldn't read the ticket folders of {context.name}: {error}. The ticket "
                f"list would be incomplete, so nothing was done. Try again once the drive "
                f"is available."
            ) from error
        tickets = sorted((_read_ticket(*item) for item in found), key=lambda t: t.number)
    return Business(context.name, code, Path(context.folder), tickets)


def _businesses_with_codes(contexts: list[ContextRef]) -> list[tuple[ContextRef, str]]:
    out = []
    for context in contexts:
        manifest = read_manifest(context.folder)
        if manifest and manifest.ticket_code:
            out.append((context, manifest.ticket_code))
    return out


def available_codes_hint(contexts: list[ContextRef]) -> str:
    coded = _businesses_with_codes(contexts)
    if not coded:
        return "No business has a ticket code yet."
    return "Businesses with ticket codes: " + ", ".join(
        f"{context.name} ({code})" for context, code in coded) + "."


def resolve_business(contexts: list[ContextRef], code: str = "",
                     business: str = "") -> Business:
    """Look up a business by ticket code or by name and load its tickets."""
    if code:
        owners = [(c, k) for c, k in _businesses_with_codes(contexts) if k == code]
        if not owners:
            raise TicketError(f"no business has ticket code {code}. "
                              f"{available_codes_hint(contexts)}")
        if len(owners) > 1:
            names = ", ".join(c.name for c, _ in owners)
            raise TicketError(f"ticket code {code} is declared by multiple businesses: "
                              f"{names}. Remove it from all but one.")
        if business and owners[0][0].name != business:
            raise TicketError(f"ticket code {code} belongs to {owners[0][0].name}, not "
                              f"{business}. Pass only one of `code` and `business`.")
        return load_business(owners[0][0], code)
    if business:
        named = [c for c in contexts if c.name == business]
        if not named:
            raise TicketError(f"business {business} not found. "
                              f"{available_codes_hint(contexts)}")
        manifest = read_manifest(named[0].folder)
        if not manifest or not manifest.ticket_code:
            raise TicketError(
                f'{business} has no ticket code. Add `"ticket_code": "ABC"` to '
                f"`{Path(named[0].folder) / MANIFEST_FILENAME}` and try again.")
        return resolve_business(contexts, code=manifest.ticket_code)
    raise TicketError(f"specify a business with `code` or `business`. "
                      f"{available_codes_hint(contexts)}")


def parse_number(raw: str) -> str:
    """Normalize a ticket number: `@due028` -> `DUE028`. Raises if it isn't one."""
    number = raw.strip().lstrip("@").upper()
    if TICKET_NUMBER_RE.fullmatch(number):
        return number
    parts = [part.strip() for part in raw.split(",")]
    if len(parts) > 1 and all(parts):
        as_list = ", ".join(f'"{part}"' for part in parts)
        raise TicketError(f"`{raw}` is not a valid ticket number. To look up several "
                          f"tickets, pass a list: [{as_list}].")
    raise TicketError(f"`{raw}` is not a valid ticket number. Expected the 3-letter "
                      f"business code followed by 3 characters, e.g. DUE009, DUEX01, "
                      f"or DUEA01.")


def find_ticket(biz: Business, number: str) -> Ticket:
    found = biz.find(number)
    if not found:
        raise TicketError(f"ticket {number} not found in {biz.name} "
                          f"(checked work, backlog, and archive).")
    if len(found) > 1:
        listing = ", ".join(f"`{t.folder}`" for t in found)
        raise TicketError(f"multiple folders in {biz.name} use ticket number {number}: "
                          f"{listing}. This needs a human decision: ask the user which one "
                          f"to keep. Don't delete or renumber folders yourself.")
    return found[0]


def check_same_business(biz: Business, number: str, code: str, business: str) -> None:
    """Reject a `code` or `business` that contradicts the business a number implies."""
    if code and code != biz.code:
        raise TicketError(f"{number} doesn't match ticket code {code}. A ticket number "
                          f"already identifies its business; omit `code` and `business`.")
    if business and business != biz.name:
        raise TicketError(f"{number} belongs to {biz.name}, not {business}. A ticket number "
                          f"already identifies its business; omit `code` and `business`.")


def group_numbers(biz: Business) -> list[str]:
    """Return group numbers: programs, then processes, then any other parent in use."""
    own = {t.number for t in biz.tickets if t.is_group}
    referenced = {t.parent for t in biz.tickets if t.parent}
    rank = {"X": 0, "A": 1}
    return sorted(own | referenced, key=lambda n: (rank.get(n[3:4], 2), n))


def pluralize(count: int, word: str) -> str:
    if count == 1:
        return f"{count} {word}"
    return f"{count} {word}es" if word.endswith("s") else f"{count} {word}s"


def location_lines(ticket: Ticket) -> list[str]:
    """Where a ticket is now, plus an address that survives moves and renames."""
    return [f"**Folder:** `{ticket.folder}`", "",
            f"**Index:** `@{ticket.number}/{INDEX_FILENAME}`"]



# The tickets an operation looked up, created, moved, or edited, in order. The
# Markdown is for people and agents; a program calling over REST needs the
# number and the folder as data, without parsing text.
_affected: ContextVar[list[dict] | None] = ContextVar("affected_tickets", default=None)


@contextmanager
def collect_affected():
    """Collect the tickets the enclosed operation reports with `record`."""
    collected: list[dict] = []
    token = _affected.set(collected)
    try:
        yield collected
    finally:
        _affected.reset(token)


def record(ticket: Ticket) -> None:
    """Report a ticket the current operation resolved or changed."""
    collected = _affected.get()
    if collected is not None:
        collected.append({"number": ticket.number, "name": ticket.name,
                          "shelf": ticket.shelf, "folder": str(ticket.folder)})
