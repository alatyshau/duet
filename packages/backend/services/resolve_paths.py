"""Resolution of alpha paths for agents — the `resolve_paths` MCP tool.

An alpha path is `@<head>/<rest>`. `<head>` is, in this order:

1. a repo dir under ``<DuetData>/repos`` (``@Duet.git``);
2. a context name, canonical as in the entities DB (``@DuetLab``);
3. a ticket number (``@DUE009``, ``@DUEX01``) — three letters of the
   business's ticket code, then three characters of the number. A leading
   letter in the number types the ticket: ``X`` program, ``A`` process, none
   a project.

A ticket resolves through the context whose `context.json` declares that
`ticket_code`; its folder ``<number>_*`` is searched at any depth (bounded)
inside the context's ``work/``, ``backlog/`` and ``archive/``, and the state
is the first of those folders. Codes are read live from the manifests on each
call, so a code the agent has just added works on the next call, without
waiting for a rescan.

Unlike `at_paths.resolve_at_path` (deploy declarations: returns a path or
None), this resolver explains every failure, because its reader is an agent
that has to act on the answer. `render_markdown` turns the results into the
tool's text; the structured results are the contract for any future JSON API.
"""

from __future__ import annotations

import os
import re
from dataclasses import dataclass
from pathlib import Path

from normalization import normalize_path
from services.manifest import MANIFEST_FILENAME, read_manifest


AT_PREFIX = "@"

# `DUE009`, `DUEX01`, `DUEA01`: code + (three digits | letter + two digits).
TICKET_NUMBER_RE = re.compile(r"([A-Z]{3})(\d{3}|[A-Z]\d{2})")
# Any ticket folder: `<number>` or `<number>_<name>`.
TICKET_FOLDER_RE = re.compile(r"[A-Z]{3}(?:\d{3}|[A-Z]\d{2})(?:_|$)")

# Where a business keeps its tickets; the first one on the path is the state.
STATUS_DIRS = ("work", "backlog", "archive")
STATE_BY_DIR = {"work": "active", "backlog": "waiting", "archive": "closed"}
# Grouping levels allowed below a status dir: `archive/2026/09/<ticket>`.
MAX_GROUPING_DEPTH = 3

# Ticket kind by the leading letter of the number: (word, grammatical gender).
TICKET_KINDS = {"": ("Проект", "m"), "X": ("Программа", "f"), "A": ("Процесс", "m")}
UNKNOWN_KIND = ("Тикет", "m")

MONTHS = (
    "январь", "февраль", "март", "апрель", "май", "июнь",
    "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь",
)


@dataclass
class ContextRef:
    """A registered context: canonical name and absolute Drive folder."""

    name: str
    folder: Path


@dataclass
class TicketInfo:
    number: str
    kind: str          # "" project, "X" program, "A" process, other letter
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
        self.by_name = {normalize_path(c.name): c for c in contexts}
        self._codes: dict[str, str | None] | None = None  # name → ticket_code

    # --- entry point ---

    def resolve(self, raw: str) -> Resolution:
        path = normalize_path(raw.strip())
        res = Resolution(path=path)
        if not path.startswith(AT_PREFIX) or len(path) == 1 or path[1] == "/":
            return _fail(res, "not_alpha_path",
                         "Не альфа-путь: адрес начинается с `@`, за которым идёт имя "
                         "бизнеса, репозитория или номер тикета.")

        head, _, rest = path[1:].partition("/")
        rest = rest.strip("/")
        if head in (".", ".."):
            return _fail(res, "escapes_root",
                         f"Не разрешён: `@{head}` не имя бизнеса, репозитория или тикета.")

        if self.repos_path is not None and (self.repos_path / head).is_dir():
            return self._finish(res, head, (self.repos_path / head).resolve(), rest)
        if head in self.by_name:
            return self._finish(res, head, Path(self.by_name[head].folder).resolve(), rest)

        match = TICKET_NUMBER_RE.fullmatch(head)
        if match:
            return self._resolve_ticket(res, head, match.group(1), rest)

        return _fail(res, "unknown_head", self._unknown_head_message(head))

    # --- tickets ---

    def _resolve_ticket(self, res: Resolution, number: str, code: str, rest: str) -> Resolution:
        owners = [c for c in self.contexts if self._code_of(c) == code]

        if len(owners) > 1:
            names = _join_names([c.name for c in owners])
            return _fail(res, "ticket_code_conflict",
                         f"Не разрешён: код {code} записан у нескольких бизнесов: {names}. "
                         f"Нужно оставить его одному.")

        if not owners:
            return self._unregistered_code(res, number, code)

        owner = owners[0]
        found = find_ticket_folders(Path(owner.folder), number)
        if not found:
            return _fail(res, "ticket_not_found",
                         f"Не найден: в {owner.name} нет папки {number}_* "
                         f"ни в работе, ни в ожидании, ни в архиве.")
        if len(found) > 1:
            listing = "\n".join(f"`{f}`" for f, _ in found)
            return _fail(res, "ticket_ambiguous",
                         f"Не разрешён: в {owner.name} несколько папок с номером {number}; "
                         f"нужно оставить одну:\n{listing}")

        folder, parts = found[0]
        res.ticket = _ticket_info(number, owner.name, parts)
        return self._finish(res, number, folder.resolve(), rest)

    def _unregistered_code(self, res: Resolution, number: str, code: str) -> Resolution:
        hits = [(c, found) for c in self.contexts
                if (found := find_ticket_folders(Path(c.folder), number))]
        head = f"Не разрешён: код {code} не записан ни у одного бизнеса."

        if not hits:
            return _fail(res, "ticket_code_unregistered",
                         f"{head} Папки {number}_* нет ни в одном бизнесе "
                         f"(искал в работе, в ожидании и в архиве).")

        if len(hits) > 1:
            lines = "\n".join(f"{c.name}: `{found[0][0]}`" for c, found in hits)
            return _fail(res, "ticket_code_unregistered",
                         f"{head} Папка {number}_* найдена в нескольких бизнесах; "
                         f"код можно записать только одному из них:\n{lines}")

        context, found = hits[0]
        folder = found[0][0]
        other = self._code_of(context)
        if other:
            return _fail(res, "ticket_code_unregistered",
                         f"{head} Папка {folder.name} найдена в бизнесе {context.name}, "
                         f"но у него записан другой код, {other}:\n`{folder}`")
        manifest = Path(context.folder) / MANIFEST_FILENAME
        return _fail(res, "ticket_code_unregistered",
                     f"{head}\nПапка {folder.name} найдена в бизнесе {context.name}: "
                     f"`{folder}`\nДобавьте в его context.json строку "
                     f"`\"ticket_code\": \"{code}\"`:\n`{manifest}`")

    def _code_of(self, context: ContextRef) -> str | None:
        if self._codes is None:
            self._codes = {}
            for c in self.contexts:
                manifest = read_manifest(c.folder)
                self._codes[c.name] = manifest.ticket_code if manifest else None
        return self._codes.get(context.name)

    # --- shared tail ---

    def _finish(self, res: Resolution, head: str, base: Path, rest: str) -> Resolution:
        target = (base / rest).resolve() if rest else base
        try:
            target.relative_to(base)
        except ValueError:
            return _fail(res, "escapes_root",
                         f"Не разрешён: путь выходит за пределы `@{head}`.")
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
        message = (f"Не разрешён: нет бизнеса, репозитория или номера тикета `{head}`. "
                   f"Имя бизнеса пишется точно как в Duet, номер тикета — три заглавные "
                   f"латинские буквы кода и три символа номера (`DUE009`, `DUEX01`).")
        if close:
            message += " Возможно, имелось в виду: " + ", ".join(f"`@{n}`" for n in close) + "."
        return message


def find_ticket_folders(context_folder: Path, number: str) -> list[tuple[Path, list[str]]]:
    """Find folders named `<number>` or `<number>_*` in a context's status dirs.

    Returns `(folder, parts)` pairs, where `parts` is the path from the
    context folder (`["archive", "2026", "09"]`) without the ticket itself.
    Never descends into another ticket's folder: a ticket's materials are not
    a place where other tickets of the business live.
    """
    found: list[tuple[Path, list[str]]] = []
    for status in STATUS_DIRS:
        _walk(context_folder / status, [status], number, 0, found)
    return found


def _walk(folder: Path, parts: list[str], number: str, depth: int,
          found: list[tuple[Path, list[str]]]) -> None:
    try:
        with os.scandir(folder) as it:
            entries = sorted(it, key=lambda e: e.name)
    except OSError:
        return
    for entry in entries:
        if entry.name.startswith(".") or not entry.is_dir():
            continue
        name = normalize_path(entry.name)
        if name == number or name.startswith(number + "_"):
            found.append((Path(entry.path), list(parts)))
        elif TICKET_FOLDER_RE.match(name):
            continue
        elif depth < MAX_GROUPING_DEPTH:
            _walk(Path(entry.path), parts + [name], number, depth + 1, found)


def _ticket_info(number: str, business: str, parts: list[str]) -> TicketInfo:
    letter = number[3] if number[3].isalpha() else ""
    status = parts[0]
    month = _archive_month(parts[1:]) if status == "archive" else None
    return TicketInfo(number=number, kind=letter, state=STATE_BY_DIR[status],
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


def _join_names(names: list[str]) -> str:
    return ", ".join(names[:-1]) + " и " + names[-1] if len(names) > 1 else names[0]


# === Markdown rendering for the MCP tool ===


def describe_ticket(ticket: TicketInfo) -> str:
    """`Проект DUE002 закрыт, лежит в архиве за сентябрь 2026.`"""
    word, gender = TICKET_KINDS.get(ticket.kind, UNKNOWN_KIND)
    if ticket.state == "active":
        state = "в работе"
    elif ticket.state == "waiting":
        state = "ждёт"
    else:
        state = "закрыта" if gender == "f" else "закрыт"
    text = f"{word} {ticket.number} {state}"
    if ticket.state == "closed":
        if ticket.archive_month:
            year, month = ticket.archive_month
            text += f", лежит в архиве за {MONTHS[month - 1]} {year}"
        else:
            text += ", лежит в архиве"
    return text + "."


def render_markdown(results: list[Resolution]) -> str:
    """One `### <alpha path>` section per result, in request order."""
    sections = []
    for res in results:
        lines = [f"### {res.path}", ""]
        if res.error:
            lines.append(res.error)
        else:
            lines.append(f"`{res.absolute}`")
            if res.ticket:
                lines += ["", describe_ticket(res.ticket)]
            if not res.exists and res.nearest:
                alpha, folder = res.nearest
                lines += ["", f"Файла нет. Ближайшая существующая папка — `{alpha}`:",
                          f"`{folder}`"]
        sections.append("\n".join(lines))
    return "\n\n".join(sections)
