"""The write side: `new_ticket`, `move_ticket`, and `edit_ticket`.

Failure contract: an error means nothing changed. Each operation validates
everything first, writes `INDEX.md` atomically, and rolls back a folder move
or creation if the write that follows it fails. The one exception is a failed
rollback, and in that case the error message describes the exact state left
on disk.
"""

from __future__ import annotations

import os
import re
import shutil
from datetime import date
from pathlib import Path

from services.resolve_paths import ContextRef, TICKET_NUMBER_RE
from services.tickets.frontmatter import Frontmatter, format_scalar
from services.tickets.model import (
    INDEX_FILENAME,
    SHELVES,
    Business,
    Ticket,
    TicketError,
    available_codes_hint,
    check_same_business,
    disk_lock,
    find_ticket,
    group_numbers,
    location_lines,
    parse_number,
    pluralize,
    record,
    resolve_business,
)
from services.tickets.naming import LETTER_BY_KIND, humanize_name, next_number, to_pascal_case

# The folder name is also used as a workspace file name, so keep it short.
MAX_NAME_LENGTH = 100
# One-line fields. The extension reads only the first 2 KB of INDEX.md, so a
# long description would push the fields after it out of its sight.
MAX_DESCRIPTION_LENGTH = 300

_MANAGED_NOTE = "this tool only manages the frontmatter"


# === Input validation ===


def _slugify(name: str) -> str:
    """Convert a name to its folder form. An empty name is allowed: a ticket can be just a number."""
    if not name.strip():
        return ""
    slug = to_pascal_case(name)
    if not slug:
        raise TicketError(f"the name `{name}` contains no letters or digits.")
    if len(slug) > MAX_NAME_LENGTH:
        raise TicketError(f"the name is too long: {len(slug)} characters as a folder name "
                          f"(`{slug[:30]}...`), and the limit is {MAX_NAME_LENGTH}.")
    return slug


def _name_note(name: str, slug: str) -> str:
    """Say what a name turned into, unless only the spaces between words were removed."""
    if slug == "".join(name.split()):
        return ""
    return f'the name "{name.strip()}" became the folder name {slug}'


def _one_line(value: str) -> str:
    """Collapse a value to a single line.

    Any run of whitespace becomes one space. That includes line breaks and
    U+2028, which pasted text often carries and which would otherwise start a
    new line in the frontmatter that reads as a different field.
    """
    return " ".join(value.split())


def _clean_description(value: str) -> str:
    text = _one_line(value)
    if len(text) > MAX_DESCRIPTION_LENGTH:
        raise TicketError(
            f"`description` is {len(text)} characters; the limit is {MAX_DESCRIPTION_LENGTH}. "
            f"Keep it to one line and put the details below the frontmatter in "
            f"{INDEX_FILENAME}.")
    return text


def _available_parents(biz: Business) -> str:
    """A sentence listing the tickets that can be a parent right now."""
    available = ", ".join(t.title for n in group_numbers(biz) for t in biz.find(n)
                          if t.is_group and t.shelf != "archive")
    if available:
        return f"Available parents in {biz.name}: {available}."
    return (f"{biz.name} has no programs or processes yet; create one with "
            f'`new_ticket(name="...", kind="program", code="{biz.code}")`.')


def _validate_parent(biz: Business, raw: str, child_kind: str, child: str = "") -> Ticket:
    """Return the parent ticket, or raise if it can't be a parent.

    A parent must be an open program or process in the same business, and
    only projects can have one, so nesting is never more than one level deep.
    """
    if child_kind in ("program", "process"):
        raise TicketError(f"a {child_kind} can't have a parent. Only projects can, and "
                          f"the parent must be a program or a process.")
    number = parse_number(raw)
    if number[:3] != biz.code:
        raise TicketError(f"{number} is not a {biz.name} ticket: its code is {number[:3]}, "
                          f"not {biz.code}. {_available_parents(biz)}")
    if number == child:
        raise TicketError(f"{number} can't be its own parent.")
    if not biz.find(number):
        raise TicketError(f"ticket {number} not found in {biz.name} (checked work, backlog, "
                          f"and archive). {_available_parents(biz)}")
    parent = find_ticket(biz, number)
    if not parent.is_group:
        raise TicketError(f"{parent.title} is a project. A parent must be a program or a "
                          f"process. {_available_parents(biz)}")
    if parent.shelf == "archive":
        raise TicketError(f"{parent.title} is closed. Reopen it with "
                          f'`move_ticket(ticket="{number}", to="work")` or pick a '
                          f"different parent.")
    if parent.read_error:
        raise TicketError(f"can't read `{parent.index_path}` ({parent.read_error}), so the "
                          f"business area of {parent.title} is unknown. Nothing was changed. "
                          f"Ask the user to fix the file.")
    return parent


def _require_editable(ticket: Ticket) -> None:
    """Refuse to modify a ticket whose `INDEX.md` we couldn't read.

    Writing back a file we never read would destroy its content.
    """
    if ticket.read_error:
        raise TicketError(
            f"can't read `{ticket.index_path}` ({ticket.read_error}), so {ticket.title} "
            f"can't be changed safely. Nothing was changed. Ask the user to fix the file.")


# === Writing to disk ===


def _write_index(path: Path, text: str) -> None:
    """Replace `INDEX.md` atomically, so a failed write never leaves a truncated file.

    Written as bytes so line endings go to disk exactly as they are in `text`.
    The new file keeps the permissions of the one it replaces.
    """
    temp = path.with_name(path.name + ".tmp")
    try:
        temp.write_bytes(text.encode("utf-8"))
        if path.exists():
            shutil.copymode(path, temp)
        os.replace(temp, path)
    except OSError:
        temp.unlink(missing_ok=True)
        raise


def _write_frontmatter(ticket: Ticket) -> None:
    try:
        _write_index(ticket.index_path, ticket.frontmatter.render())
    except OSError as error:
        raise TicketError(f"couldn't write `{ticket.index_path}`: {error}. Nothing was "
                          f"changed. Try again once the drive is available.") from error


def _move_folder_and_write(ticket: Ticket, target: Path) -> None:
    """Move a ticket's folder, then write its frontmatter, as one all-or-nothing step.

    If the write fails, the folder is moved back, so the caller sees a clean
    failure and can simply retry. If moving it back fails too, the error
    spells out what is on disk, because a retry alone won't repair it.
    """
    source = ticket.folder
    _move_folder(ticket, target)
    try:
        _write_index(ticket.index_path, ticket.frontmatter.render())
    except OSError as error:
        try:
            target.rename(source)
        except OSError as rollback_error:
            raise TicketError(
                f"{ticket.number} was left half-updated. Its folder is now `{target}`, but "
                f"the new frontmatter couldn't be written ({error}) and the folder couldn't "
                f"be moved back ({rollback_error}). Retrying won't fix this: tell the user "
                f"that `{target / INDEX_FILENAME}` still has its old frontmatter.") from error
        ticket.folder = source
        raise TicketError(f"couldn't write `{target / INDEX_FILENAME}`: {error}. The folder "
                          f"was moved back, so nothing was changed. Try again once the "
                          f"drive is available.") from error


def _move_folder(ticket: Ticket, target: Path) -> None:
    try:
        ticket.folder.rename(target)
    except OSError as error:
        raise TicketError(f"couldn't move `{ticket.folder}` to `{target}`: {error}. Nothing "
                          f"was changed. Try again once the drive is available.") from error
    ticket.folder = target


def _ensure_frontmatter(ticket: Ticket) -> None:
    """Give a ticket minimal frontmatter if it has none, so there's a place for new fields."""
    if ticket.frontmatter.present:
        return
    fm = ticket.frontmatter
    fm.present = True
    fm.lines = ["folder-type: work", f"work-type: {ticket.kind}"]
    if fm.body and not fm.body.startswith("\n"):
        fm.body = "\n" + fm.body
    if not fm.body:
        fm.body = f"\n# {ticket.number} — {humanize_name(ticket.name)}\n"


def _created_index_note(ticket: Ticket) -> list[str]:
    """Tell the caller when a write had to create `INDEX.md`, so it isn't a surprise."""
    if ticket.has_index:
        return []
    return ["", f"Created {INDEX_FILENAME}: {ticket.number} had none. It has only the "
                f"frontmatter and a title heading."]


def _frontmatter_block(frontmatter: Frontmatter, label: str) -> list[str]:
    return [label, "", "```yaml", *frontmatter.text().split("\n")[:-1], "```"]


# === new_ticket ===


def new_ticket(contexts: list[ContextRef], today: date, name: str, parent: str = "",
               kind: str = "project", shelf: str = "work", description: str = "",
               icon: str = "", area: str = "", code: str = "", business: str = "") -> str:
    """Create a ticket: allocate its number, create its folder, write `INDEX.md`.

    Not idempotent: every successful call creates a new ticket.
    """
    kind = (kind or "project").strip().lower()
    shelf = (shelf or "work").strip().lower()
    if kind not in LETTER_BY_KIND:
        raise TicketError(f'`kind` must be "project", "program", or "process"; got "{kind}".')
    if shelf not in ("work", "backlog"):
        raise TicketError(f'new tickets can only be created in "work" or "backlog"; '
                          f'got "{shelf}".')
    slug = _slugify(name)
    description = _clean_description(description or "")
    area = _one_line(area or "")
    icon = _one_line(icon or "")
    with disk_lock():
        if parent:
            parent_number = parse_number(parent)
            biz = resolve_business(contexts, code=parent_number[:3])
            check_same_business(biz, parent_number, code, business)
            parent_ticket = _validate_parent(biz, parent, kind)
            parent_area = parent_ticket.frontmatter.get("business-area")
            if area and parent_area and area != parent_area:
                raise TicketError(f"`area` conflicts with the parent: {parent_ticket.title} "
                                  f"is in {parent_area}. Omit `area` to inherit it.")
            area = parent_area or area
        else:
            if not code and not business:
                raise TicketError("specify `parent`, or a business with `code` or "
                                  f"`business`. {available_codes_hint(contexts)}")
            biz = resolve_business(contexts, code, business)
            parent_ticket = None

        number = next_number(biz.code, kind, [t.number for t in biz.tickets])
        if number is None:
            raise TicketError(f"no {kind} numbers left for code {biz.code}. Numbers are never "
                              f"reused, so the highest one in use decides.")

        folder = biz.folder / shelf / (f"{number}_{slug}" if slug else number)
        heading = f"# {number} — {humanize_name(slug)}" if slug else f"# {number}"
        frontmatter = Frontmatter(present=True, body=f"\n{heading}\n")
        frontmatter.lines = ["folder-type: work", f"work-type: {kind}"]
        if icon:
            frontmatter.set("icon", icon)
        if description:
            frontmatter.set("description", description)
        frontmatter.lines.append(f"opened: {today.isoformat()}")
        frontmatter.lines.append(
            f"business-area: {format_scalar(area)}" if area else "business-area:")
        frontmatter.lines.append(f"parent: {parent_ticket.number if parent_ticket else 'null'}")

        _create_ticket_folder(folder, number, frontmatter)

    created = Ticket(number, slug, folder, shelf, frontmatter)
    record(created)
    summary = [f"{kind.capitalize()} in {shelf}."]
    summary.append(f"Parent: {parent_ticket.title}." if parent_ticket else "No parent.")
    if area:
        summary.append(f"Business area: {area}.")
    else:
        summary.append("No business area; set one with `edit_ticket` if it belongs to one.")
    lines = [f"### Created {created.title}", "", *location_lines(created), "",
             " ".join(summary), ""]
    if note := _name_note(name, slug):
        lines += [f"{note[0].upper()}{note[1:]}.", ""]
    lines += [*_frontmatter_block(frontmatter, f"Frontmatter written to {INDEX_FILENAME}:"), "",
              f"{INDEX_FILENAME} already has a title heading. Add your content below it; "
              f"{_MANAGED_NOTE}."]
    return "\n".join(lines)


def _create_ticket_folder(folder: Path, number: str, frontmatter: Frontmatter) -> None:
    """Create a ticket folder with its `INDEX.md`, or leave nothing behind."""
    try:
        folder.parent.mkdir(parents=True, exist_ok=True)
        # Not exist_ok: never write into a folder someone else just created.
        folder.mkdir()
    except FileExistsError:
        raise TicketError(f"`{folder}` was just created by someone else. Nothing was "
                          f"changed. Try again to get the next number.") from None
    except OSError as error:
        raise TicketError(f"couldn't create `{folder}`: {error}. Nothing was changed. Try "
                          f"again once the drive is available.") from error
    try:
        _write_index(folder / INDEX_FILENAME, frontmatter.render())
    except OSError as error:
        try:
            folder.rmdir()
        except OSError as rollback_error:
            raise TicketError(
                f"{number} was left half-created. The folder `{folder}` exists, but its "
                f"{INDEX_FILENAME} couldn't be written ({error}) and the folder couldn't be "
                f"removed ({rollback_error}). Don't call `new_ticket` again for this ticket, "
                f"or you'll get a second number: tell the user that {number} has no "
                f"{INDEX_FILENAME}.") from error
        raise TicketError(f"couldn't write `{folder / INDEX_FILENAME}`: {error}. The new "
                          f"folder was removed, so nothing was changed and {number} is still "
                          f"free. Try again once the drive is available.") from error


# === move_ticket ===


def _archive_month_dir(biz: Business, today: date) -> Path:
    """Return this month's archive folder, matching the business's existing layout.

    Defaults to `archive/202610`; uses `archive/2026/10` if the archive is
    already organized by year.
    """
    archive = biz.folder / "archive"
    names = [p.name for p in archive.iterdir() if p.is_dir()] if archive.is_dir() else []
    uses_year_folders = (not any(re.fullmatch(r"\d{6}", n) for n in names)
                         and any(re.fullmatch(r"\d{4}", n) for n in names))
    if uses_year_folders:
        return archive / f"{today.year:04d}" / f"{today.month:02d}"
    return archive / f"{today.year:04d}{today.month:02d}"


def move_ticket(contexts: list[ContextRef], today: date, ticket: str, to: str) -> str:
    """Move a ticket to work, backlog, or archive, recording close and reopen dates.

    Idempotent: moving a ticket to the shelf it's already on succeeds without
    writing anything, so a retry after a lost response never adds a date.
    """
    to = (to or "").strip().lower()
    if to not in SHELVES:
        raise TicketError(f'`to` must be "work", "backlog", or "archive"; got "{to}".')
    number = parse_number(ticket)
    with disk_lock():
        biz = resolve_business(contexts, code=number[:3])
        item = find_ticket(biz, number)
        if item.shelf == to:
            record(item)
            return "\n".join([f"### {item.title} is already in {to}", "",
                              *location_lines(item), "", "No changes."])
        # Only closing and reopening are dated; work <-> backlog is not, and it
        # doesn't touch INDEX.md, so it works even on a file we couldn't read.
        date_field = None
        if to == "archive":
            date_field = "closed"
        elif item.shelf == "archive":
            date_field = "reopened"
        if date_field:
            _require_editable(item)
        children = biz.children(number)
        if to == "archive":
            open_children = [t for t in children if t.shelf != "archive"]
            if open_children:
                names = ", ".join(t.title for t in open_children)
                raise TicketError(
                    f"{item.title} still has open tickets: {names}. Close them or "
                    f"reassign them with `edit_ticket` first.")
            unknown = [t for t in biz.unreadable if t.shelf != "archive"]
            if item.is_group and unknown:
                names = ", ".join(t.title for t in unknown)
                raise TicketError(
                    f"can't confirm that {item.title} has no open tickets, because "
                    f"{INDEX_FILENAME} could not be read for {names}. Nothing was changed. "
                    f"Ask the user to fix the file.")
            target_dir = _archive_month_dir(biz, today)
        else:
            target_dir = biz.folder / to
        target = target_dir / item.folder.name
        if target.exists():
            raise TicketError(f"`{target}` already exists, so {item.title} can't be moved "
                              f"there. Nothing was changed. Ask the user how to resolve "
                              f"the conflict.")

        source_shelf = item.shelf
        try:
            target_dir.mkdir(parents=True, exist_ok=True)
        except OSError as error:
            raise TicketError(f"couldn't create `{target_dir}`: {error}. Nothing was "
                              f"changed. Try again once the drive is available.") from error
        if date_field:
            _ensure_frontmatter(item)
            dates = item.frontmatter.get_list(date_field) + [today.isoformat()]
            item.frontmatter.set(date_field, dates)
            _move_folder_and_write(item, target)
        else:
            _move_folder(item, target)
        closed_parent = _closed_parent(biz, item) if source_shelf == "archive" else None
        item.shelf = to
        record(item)

    lines = [f"### Moved {item.title} from {source_shelf} to {to}", "", *location_lines(item)]
    if date_field:
        lines += _created_index_note(item)
    if children:
        stay = "stays where it is" if len(children) == 1 else "stay where they are"
        lines += ["", f"Only {number} was moved; the {pluralize(len(children), 'ticket')} "
                      f"under it {stay}."]
    if closed_parent:
        lines += ["", f"Note: its parent {closed_parent.title} is closed. Reopen the parent "
                      f'with `move_ticket(ticket="{closed_parent.number}", to="work")` or '
                      f"give this ticket another parent with `edit_ticket`."]
    if date_field:
        kept = " Earlier dates were kept." if len(dates) > 1 else ""
        lines += ["", f"Added `{date_field}: {today.isoformat()}` to the frontmatter.{kept}",
                  "", *_frontmatter_block(item.frontmatter, "Updated frontmatter:")]
    return "\n".join(lines)


def _closed_parent(biz: Business, ticket: Ticket) -> Ticket | None:
    """Return the ticket's parent if that parent is in the archive."""
    parents = biz.find(ticket.parent) if ticket.parent else []
    return parents[0] if parents and parents[0].shelf == "archive" else None


# === edit_ticket ===


def edit_ticket(contexts: list[ContextRef], today: date, ticket: str,
                name: str | None = None, parent: str | None = None,
                area: str | None = None, icon: str | None = None,
                description: str | None = None) -> str:
    """Change a ticket's name, parent, business area, icon, or description.

    For every field, None means "leave unchanged" and an empty string means
    "clear" (a name can't be cleared). Idempotent: if the ticket already has
    the requested values, the call succeeds without writing anything.
    """
    if all(value is None for value in (name, parent, area, icon, description)):
        raise TicketError("nothing to change. Pass at least one of `name`, `parent`, "
                          "`area`, `icon`, or `description`. To clear a field, pass an "
                          "empty string; null leaves it unchanged.")
    if name is not None and not name.strip():
        raise TicketError("a ticket's name can't be cleared. Pass the new name, or leave "
                          "`name` out to keep the current one.")
    slug = _slugify(name) if name is not None else None
    area = _one_line(area) if area is not None else None
    icon = _one_line(icon) if icon is not None else None
    description = _clean_description(description) if description is not None else None
    return _edit_one(contexts, today, ticket, name, slug, parent, area, icon, description)


def _describe_change(label: str, old: str | None, new: str | None, quote: bool = False,
                     suffix: str = "") -> str:
    """One change line that names the previous value, so the change can be reported or undone."""
    show = (lambda value: f'"{value}"') if quote else (lambda value: value)
    if not new:
        return f"{label} cleared (was {show(old)})"
    if not old:
        return f"{label} set to {show(new)}{suffix}"
    return f"{label} changed from {show(old)} to {show(new)}{suffix}"


def _edit_one(contexts: list[ContextRef], today: date, ticket: str, name: str | None,
              slug: str | None, parent: str | None, area: str | None, icon: str | None,
              description: str | None) -> str:
    number = parse_number(ticket)
    with disk_lock():
        biz = resolve_business(contexts, code=number[:3])
        item = find_ticket(biz, number)
        _require_editable(item)
        changes: list[str] = []
        target = item.folder
        old_name, old_folder_name = item.name, item.folder.name

        if slug == item.name:
            slug = None
        if slug is not None:
            target = item.folder.with_name(f"{number}_{slug}")
            # On a case-insensitive filesystem, a case-only rename finds the folder itself.
            if target.exists() and not target.samefile(item.folder):
                raise TicketError(f"`{target}` already exists. Pick a different name.")

        old_parent = biz.find(item.parent)[0] if item.parent and biz.find(item.parent) else None
        old_parent_title = old_parent.title if old_parent else item.parent
        new_parent: Ticket | None = None
        clear_parent = parent is not None and not parent.strip()
        if parent is not None and not clear_parent:
            if not TICKET_NUMBER_RE.fullmatch(parent.strip().lstrip("@").upper()):
                # Callers reach for "none" or "null" here; point them at the real way.
                raise TicketError(
                    f"`{parent}` is not a valid ticket number. Expected the 3-letter "
                    f"business code followed by 3 characters, e.g. DUE009, DUEX01, or "
                    f"DUEA01. To clear the parent, pass an empty string.")
            new_parent = _validate_parent(biz, parent, item.kind, child=number)

        # The business area is inherited from the parent the ticket will have after this call.
        final_parent = new_parent if new_parent else (None if clear_parent else old_parent)
        inherited = final_parent.frontmatter.get("business-area") if final_parent else None
        if area is not None and inherited and area != inherited:
            raise TicketError(
                f"`area` conflicts with the parent: {final_parent.title} is in {inherited}. "
                f"A ticket inherits its business area from its parent; omit `area`, or "
                f"clear the parent in the same call.")

        _ensure_frontmatter(item)
        fm = item.frontmatter
        old_area = fm.get("business-area")
        if slug is not None:
            fm.set("renamed-from", fm.get_list("renamed-from") + [old_folder_name])
            fm.set("renamed", fm.get_list("renamed") + [today.isoformat()])
            note = _name_note(name, slug)
            changes.append(f"Renamed {old_folder_name} to {target.name}"
                           + (f" ({note})" if note else ""))
            changes.append(_rename_title_heading(fm, number, old_name, slug))
        if new_parent is not None and item.parent != new_parent.number:
            fm.set("parent", new_parent.number)
            changes.append(_describe_change("Parent", old_parent_title, new_parent.title))
            # A parent with no business area doesn't erase the ticket's own.
            if inherited and inherited != old_area:
                fm.set("business-area", inherited)
                changes.append(_describe_change("Business area", old_area, inherited,
                                                suffix=" to match the parent"))
        elif clear_parent and item.parent is not None:
            fm.set("parent", "null", raw=True)
            kept = "" if area is not None else "; business area unchanged"
            changes.append(f"Parent cleared (was {old_parent_title}{kept})")

        new_area = fm.get("business-area")
        if area is not None and area != (new_area or ""):
            # An empty business area keeps its key, like a new ticket's.
            fm.set("business-area", area)
            changes.append(_describe_change("Business area", new_area, area))
            new_area = area or None
        for key, label, value, quote in (("icon", "Icon", icon, False),
                                         ("description", "Description", description, True)):
            old = fm.get(key)
            if value is None or (old or "") == value:
                continue
            fm.set(key, value or None)
            changes.append(_describe_change(label, old, value, quote=quote))

        if not changes:
            record(item)
            return "\n".join([f"### {item.title} is already up to date", "",
                              *location_lines(item), "", "No changes."])

        if slug is not None:
            _move_folder_and_write(item, target)
        else:
            _write_frontmatter(item)

    if slug is not None:
        item.name = slug
    record(item)
    title = item.title
    lines = [f"### Updated {title}", "", *location_lines(item), *_created_index_note(item), "",
             *[f"* {change}" for change in changes], "",
             *_frontmatter_block(fm, "Updated frontmatter:")]
    return "\n".join(lines)


def _rename_title_heading(frontmatter: Frontmatter, number: str, old_name: str,
                          slug: str) -> str:
    """Give the title heading in the body the ticket's new name. Returns the change line.

    A ticket's name appears in three places: the folder, the frontmatter
    history, and the first `# ` heading of `INDEX.md`. A rename that left the
    heading behind would leave the ticket with two names. The heading is
    rewritten only where it contains the old name, as words or as it stands
    in the folder name; anything else in it is kept. A heading that doesn't
    mention the old name was written for another reason and is left alone.
    """
    lines = frontmatter.body.split("\n")
    for index, line in enumerate(lines):
        heading = line.rstrip("\r")
        if not heading.startswith("# "):
            continue
        new_title = humanize_name(slug)
        if not old_name and heading.strip() == f"# {number}":
            # A ticket that had only a number gets its first name.
            renamed = f"# {number} — {new_title}"
            lines[index] = renamed + line[len(heading):]
            frontmatter.body = "\n".join(lines)
            return f"Title heading changed from `{heading}` to `{renamed}`"
        for old_form in (humanize_name(old_name), old_name, old_name.replace("_", " ")):
            if old_form and old_form in heading:
                renamed = heading.replace(old_form, new_title, 1)
                if renamed == heading:
                    return f"Title heading already reads `{heading}`"
                lines[index] = renamed + line[len(heading):]
                frontmatter.body = "\n".join(lines)
                return f"Title heading changed from `{heading}` to `{renamed}`"
        return f"Title heading left as is: `{heading}` doesn't mention the old name"
    return f"{INDEX_FILENAME} has no title heading to rename"
