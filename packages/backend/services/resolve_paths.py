"""Resolution of alpha paths for agents — the `resolve_paths` MCP tool.

An alpha path is `@<head>/<rest>`. `<head>` is, in this order:

1. a repo dir under ``<DuetData>/repos`` (``@Duet.git``);
2. a context name, canonical as in the entities DB (``@DuetLab``);
3. a ticket number (``@DUE009``, ``@DUEX01``) — three letters of the
   business's ticket code, then three characters of the number. A leading
   letter in the number types the ticket: ``X`` program, ``A`` routine, none
   a project.

A ticket resolves through the context whose `context.json` declares that
`ticket_code`; its folder ``<number>_*`` is searched at any depth (bounded)
inside the context's ``work/``, ``backlog/`` and ``archive/``, and the state
is the first of those folders. Codes are read live from the manifests on each
call, so a code the agent has just added works on the next call, without
waiting for a rescan.

The form of an address, the repo and context heads and the containment check
are not decided here: they are `services/at_paths.py`, the same code that
resolves deploy declarations. This module adds what an agent needs on top —
ticket heads, and an explanation for every failure, because its reader has to
act on the answer. `render_markdown` turns the results into the tool's text;
the structured results are the contract for any future JSON API.
"""

from __future__ import annotations

import os
import re
from dataclasses import dataclass
from pathlib import Path

from normalization import normalize_path
from services.at_paths import (
    AtPathError,
    canonical_at_path,
    find_base,
    join_under,
    parse_at_path,
)
from services.manifest import MANIFEST_FILENAME, read_manifest


# `DUE009`, `DUEX01`, `DUEA01`: code + (three digits | letter + two digits).
TICKET_NUMBER_RE = re.compile(r"([A-Z]{3})(\d{3}|[A-Z]\d{2})")
# Any ticket folder: `<number>` or `<number>_<name>`.
TICKET_FOLDER_RE = re.compile(r"[A-Z]{3}(?:\d{3}|[A-Z]\d{2})(?:_|$)")

# Where a business keeps its tickets; the first one on the path is the state.
STATUS_DIRS = ("work", "backlog", "archive")
STATE_BY_DIR = {"work": "active", "backlog": "waiting", "archive": "closed"}
# Grouping levels allowed below a status dir: `archive/2026/09/<ticket>`.
MAX_GROUPING_DEPTH = 3

# Work type by the leading letter of the number.
WORK_TYPE_BY_LETTER = {"": "Project", "X": "Program", "A": "Routine"}
UNKNOWN_WORK_TYPE = "Ticket"
# The same words the `tickets` tool uses for a ticket's state; a closed ticket
# also gets its archive month here when the folder shows one.
STATE_LABELS = {"active": "in work", "waiting": "in backlog", "closed": "closed (archived)"}
MONTHS = ("January", "February", "March", "April", "May", "June", "July", "August",
          "September", "October", "November", "December")

# What the agent is told when an address is refused by its form alone.
# Messages follow the ticket tools: lowercase, what is wrong, then what to do.
# `render_markdown` puts `Error:` in front.
_FORM_REFUSALS = {
    "not_alpha_path": "not an alpha path. An alpha path starts with `@` and a business "
                      "name, a repo, or a ticket number, e.g. `@DuetLab/INDEX.md`, "
                      "`@Duet.git/README.md`, or `@DUE009`.",
    "dot_segment": "an alpha path can't contain `.` or `..` segments. Write the full "
                   "path from the business, repo, or ticket.",
}


@dataclass
class ContextRef:
    """A registered context: canonical name and absolute Drive folder."""

    name: str
    folder: Path


@dataclass
class TicketInfo:
    number: str
    letter: str        # "" project, "X" program, "A" routine, other letter
    state: str         # "active" | "waiting" | "closed"
    business: str
    archive_month: tuple[int, int] | None = None  # (year, month)


@dataclass
class Resolution:
    """The answer for one requested alpha path.

    `absolute` is set whenever a path can be built, even for a file that does
    not exist yet (`exists` is then False and `nearest` names the closest
    existing folder), because the agent may be about to create it.
    `error` is set when the path does not resolve; `error_code` is stable.
    """

    path: str
    absolute: Path | None = None
    exists: bool = False
    nearest: tuple[str, Path] | None = None
    ticket: TicketInfo | None = None
    error_code: str | None = None
    error: str | None = None


def resolve_paths(
    paths: list[str],
    repos_path: Path | None,
    contexts: list[ContextRef],
) -> list[Resolution]:
    """Resolve each alpha path; one `Resolution` per input, in input order."""
    resolver = _Resolver(repos_path, contexts)
    return [resolver.resolve(p) for p in paths]


class _Resolver:
    def __init__(self, repos_path: Path | None, contexts: list[ContextRef]):
        self.repos_path = repos_path
        self.contexts = contexts
        self.context_folders = {c.name: c.folder for c in contexts}
        self._codes: dict[str, str | None] | None = None  # name → ticket_code

    # --- entry point ---

    def resolve(self, raw: str) -> Resolution:
        res = Resolution(path=canonical_at_path(raw))
        try:
            parsed = parse_at_path(res.path)
        except AtPathError as e:
            return _fail(res, e.code, _FORM_REFUSALS[e.code])
        head, rest = parsed.head, parsed.rest

        base = find_base(head, self.repos_path, self.context_folders)
        if base is not None:
            return self._finish(res, head, base, rest)

        match = TICKET_NUMBER_RE.fullmatch(head)
        if match:
            return self._resolve_ticket(res, head, match.group(1), rest)

        return _fail(res, "unknown_head", self._unknown_head_message(head))

    # --- tickets ---

    def _resolve_ticket(self, res: Resolution, number: str, code: str, rest: str) -> Resolution:
        owners = [c for c in self.contexts if self._code_of(c) == code]

        if len(owners) > 1:
            names = ", ".join(c.name for c in owners)
            return _fail(res, "ticket_code_conflict",
                         f"ticket code {code} is declared by multiple businesses: "
                         f"{names}. Remove it from all but one.")

        if not owners:
            return self._unregistered_code(res, number, code)

        owner = owners[0]
        found = find_ticket_folders(Path(owner.folder), number)
        if not found:
            return _fail(res, "ticket_not_found",
                         f"ticket {number} not found in {owner.name} "
                         f"(checked work, backlog, and archive).")
        if len(found) > 1:
            listing = ", ".join(f"`{f}`" for f, _ in found)
            return _fail(res, "ticket_ambiguous",
                         f"multiple folders in {owner.name} use ticket number {number}: "
                         f"{listing}. This needs a human decision: ask the user which one "
                         f"to keep. Don't delete or renumber folders yourself.")

        folder, parts = found[0]
        res.ticket = _ticket_info(number, owner.name, parts)
        return self._finish(res, number, folder.resolve(), rest)

    def _unregistered_code(self, res: Resolution, number: str, code: str) -> Resolution:
        hits = [(c, found) for c in self.contexts
                if (found := find_ticket_folders(Path(c.folder), number))]
        head = f"no business has ticket code {code}."

        if not hits:
            return _fail(res, "ticket_code_unregistered",
                         f"{head} No business has a ticket folder {number}_* either "
                         f"(checked work, backlog, and archive).")

        if len(hits) > 1:
            lines = ", ".join(f"{c.name} (`{found[0][0]}`)" for c, found in hits)
            return _fail(res, "ticket_code_unregistered",
                         f"{head} A folder {number}_* exists in several businesses: "
                         f"{lines}. Only one business can own a code: ask the user "
                         f"which one.")

        context, found = hits[0]
        folder = found[0][0]
        other = self._code_of(context)
        if other:
            return _fail(res, "ticket_code_unregistered",
                         f"{head} `{folder}` is in {context.name}, whose ticket code "
                         f"is {other}.")
        manifest = Path(context.folder) / MANIFEST_FILENAME
        return _fail(res, "ticket_code_unregistered",
                     f"{head} `{folder}` is in {context.name}. Add "
                     f"`\"ticket_code\": \"{code}\"` to `{manifest}` and try again.")

    def _code_of(self, context: ContextRef) -> str | None:
        if self._codes is None:
            self._codes = {}
            for c in self.contexts:
                manifest = read_manifest(c.folder)
                self._codes[c.name] = manifest.ticket_code if manifest else None
        return self._codes.get(context.name)

    # --- shared tail ---

    def _finish(self, res: Resolution, head: str, base: Path, rest: str) -> Resolution:
        try:
            target = join_under(base, rest)
        except AtPathError as e:
            return _fail(res, e.code, f"the path escapes `@{head}`.")
        res.absolute = target
        res.exists = target.exists()
        if not res.exists:
            nearest = target.parent
            while nearest != base and not nearest.exists():
                nearest = nearest.parent
            relative = nearest.relative_to(base).as_posix()
            alpha = f"@{head}" if relative == "." else f"@{head}/{relative}"
            res.nearest = (normalize_path(alpha), nearest)
        return res

    def _unknown_head_message(self, head: str) -> str:
        candidates = [c.name for c in self.contexts]
        if self.repos_path is not None and self.repos_path.is_dir():
            with os.scandir(self.repos_path) as entries:
                candidates += [e.name for e in entries if e.is_dir()]
        lowered = head.casefold()
        close = sorted({normalize_path(n) for n in candidates if normalize_path(n).casefold() == lowered})
        message = (f"`@{head}` is not a business, a repo, or a ticket number. A business "
                   f"name must match the name Duet registers exactly; a ticket number is "
                   f"the 3-letter business code followed by 3 characters, e.g. DUE009 "
                   f"or DUEX01.")
        if close:
            message += " Did you mean " + ", ".join(f"`@{n}`" for n in close) + "?"
        return message


def find_ticket_folders(context_folder: Path, number: str) -> list[tuple[Path, list[str]]]:
    """Find folders named `<number>` or `<number>_*` in a context's status dirs.

    Returns `(folder, parts)` pairs, where `parts` is the path from the
    context folder (`["archive", "2026", "09"]`) without the ticket itself.
    Never descends into another ticket's folder: a ticket's materials are not
    a place where other tickets of the business live.
    """
    return [
        (folder, parts)
        for folder, parts, name in list_ticket_folders(context_folder)
        if name == number or name.startswith(number + "_")
    ]


def list_ticket_folders(
    context_folder: Path, strict: bool = False
) -> list[tuple[Path, list[str], str]]:
    """List every ticket folder in a context's status dirs.

    Returns `(folder, parts, name)` tuples, where `parts` is the same as in
    `find_ticket_folders` and `name` is the NFC-normalized folder name. The
    resolver and the ticket tools share this walk, so a number the tools
    consider free is guaranteed to be one the resolver can't find.

    With `strict=True`, an unreadable folder raises `OSError` instead of
    being treated as empty; allocating a number without seeing it could
    produce a duplicate. A missing status dir is treated as empty either way.
    """
    found: list[tuple[Path, list[str], str]] = []
    for status in STATUS_DIRS:
        _walk(context_folder / status, [status], 0, found, strict)
    return found


def _walk(folder: Path, parts: list[str], depth: int,
          found: list[tuple[Path, list[str], str]], strict: bool) -> None:
    try:
        with os.scandir(folder) as it:
            entries = sorted(it, key=lambda e: e.name)
    except (FileNotFoundError, NotADirectoryError):
        return
    except OSError:
        if strict:
            raise
        return
    for entry in entries:
        if entry.name.startswith(".") or not entry.is_dir():
            continue
        name = normalize_path(entry.name)
        if TICKET_FOLDER_RE.match(name):
            found.append((Path(entry.path), list(parts), name))
        elif depth < MAX_GROUPING_DEPTH:
            _walk(Path(entry.path), parts + [name], depth + 1, found, strict)


def _ticket_info(number: str, business: str, parts: list[str]) -> TicketInfo:
    letter = number[3] if number[3].isalpha() else ""
    status = parts[0]
    month = _archive_month(parts[1:]) if status == "archive" else None
    return TicketInfo(number=number, letter=letter, state=STATE_BY_DIR[status],
                      business=business, archive_month=month)


def _archive_month(grouping: list[str]) -> tuple[int, int] | None:
    """`["202609"]` or `["2026", "09"]` → (2026, 9); anything else → None."""
    if len(grouping) == 1 and re.fullmatch(r"\d{6}", grouping[0]):
        year, month = int(grouping[0][:4]), int(grouping[0][4:])
    elif (len(grouping) == 2 and re.fullmatch(r"\d{4}", grouping[0])
          and re.fullmatch(r"\d{2}", grouping[1])):
        year, month = int(grouping[0]), int(grouping[1])
    else:
        return None
    return (year, month) if 1 <= month <= 12 else None


def _fail(res: Resolution, code: str, message: str) -> Resolution:
    res.error_code = code
    res.error = message
    return res


# === Markdown rendering for the MCP tool ===


def describe_ticket(ticket: TicketInfo) -> str:
    """`Project DUE002, closed (archived September 2026). Business: DuetLab.`"""
    word = WORK_TYPE_BY_LETTER.get(ticket.letter, UNKNOWN_WORK_TYPE)
    state = STATE_LABELS[ticket.state]
    if ticket.state == "closed" and ticket.archive_month:
        year, month = ticket.archive_month
        state = f"closed (archived {MONTHS[month - 1]} {year})"
    return f"{word} {ticket.number}, {state}. Business: {ticket.business}."


def render_markdown(results: list[Resolution]) -> str:
    """One `### <alpha path>` section per result, in request order."""
    sections = []
    for res in results:
        lines = [f"### {res.path}", ""]
        if res.error:
            lines.append(f"Error: {res.error}")
        else:
            lines.append(f"`{res.absolute}`")
            if res.ticket:
                lines += ["", describe_ticket(res.ticket)]
            if not res.exists and res.nearest:
                alpha, folder = res.nearest
                lines += ["", f"Doesn't exist yet. Nearest existing folder: `{alpha}`",
                          f"`{folder}`"]
        sections.append("\n".join(lines))
    return "\n\n".join(sections)
