"""The read side: the `tickets` operation and its Markdown views."""

from __future__ import annotations

from datetime import date

from services.resolve_paths import ContextRef
from services.tickets.model import (
    INDEX_FILENAME,
    SHELVES,
    Business,
    Ticket,
    TicketError,
    check_same_business,
    find_ticket,
    group_numbers,
    location_lines,
    parse_number,
    pluralize,
    record,
    resolve_business,
)

UNSORTED = "Unsorted"


def tickets(contexts: list[ContextRef], today: date, code: str = "", business: str = "",
            shelf: str = "", parent: str = "", number: str | list[str] = "") -> str:
    """List a business's tickets. See the `tickets` MCP tool for the output format.

    `number` is a lookup and stands alone. `parent` and `shelf` are filters
    and combine. Conflicting arguments are rejected rather than ignored.
    """
    shelf = (shelf or "").strip().lower()
    if shelf and shelf not in SHELVES:
        raise TicketError(f'`shelf` must be "work", "backlog", or "archive"; got "{shelf}".')
    if number:
        if parent or shelf:
            raise TicketError("`number` can't be combined with `parent` or `shelf`. Use "
                              "`number` to look up specific tickets, or `parent` and "
                              "`shelf` to list them.")
        if isinstance(number, list):
            return _lookup_batch(contexts, number, code, business)
        return _lookup(contexts, number, code, business, {})
    if isinstance(number, list):
        raise TicketError("`number` is an empty list. Pass at least one ticket number.")
    if parent and parent.lower() != "unsorted":
        group = parse_number(parent)
        biz = resolve_business(contexts, code=group[:3])
        check_same_business(biz, group, code, business)
        return _render_group(biz, group, shelf)
    biz = resolve_business(contexts, code, business)
    if parent:
        return _render_group(biz, None, shelf)
    if shelf:
        return _render_shelf(biz, shelf)
    return _render_overview(biz)


def _lookup(contexts: list[ContextRef], raw: str, code: str, business: str,
            loaded: dict[str, Business]) -> str:
    """Look up one ticket. `loaded` caches businesses so a batch reads each one once."""
    number = parse_number(raw)
    if code and code != number[:3]:
        # Checked before resolving, so an unknown `code` isn't reported as a missing ticket.
        raise TicketError(f"{number} doesn't match ticket code {code}. A ticket number "
                          f"already identifies its business; omit `code` and `business`.")
    if number[:3] not in loaded:
        loaded[number[:3]] = resolve_business(contexts, code=number[:3])
    biz = loaded[number[:3]]
    check_same_business(biz, number, code, business)
    ticket = find_ticket(biz, number)
    record(ticket)
    return _render_ticket(biz, ticket)


def _lookup_batch(contexts: list[ContextRef], numbers: list[str],
                  code: str, business: str) -> str:
    """Look up several tickets. One failure doesn't affect the others.

    Each number gets its own section; one that can't be resolved gets an
    `Error:` section under its own heading. The first line says how many
    resolved. If none do, the whole call is an error.
    """
    loaded: dict[str, Business] = {}
    sections: list[str] = []
    failed: list[str] = []
    for raw in numbers:
        label = str(raw).strip().lstrip("@")
        try:
            sections.append(_lookup(contexts, raw, code, business, loaded))
        except TicketError as error:
            failed.append(label)
            sections.append(f"### {label}\n\nError: {error}")
    body = "\n\n".join(sections)
    if len(failed) == len(numbers):
        raise TicketError(f"none of the {pluralize(len(numbers), 'ticket')} could be "
                          f"resolved.\n\n{body}")
    headline = f"Resolved {len(numbers) - len(failed)} of {len(numbers)} tickets."
    if failed:
        headline += f" Failed: {', '.join(failed)}."
    return f"{headline}\n\n{body}"


def _count_line(items: list[Ticket]) -> str:
    parts = [f"{n} in {shelf}" for shelf in SHELVES
             if (n := sum(1 for t in items if t.shelf == shelf))]
    return "Tickets: " + (", ".join(parts) if parts else "none")


def _ticket_line(ticket: Ticket, current_shelf: str) -> str:
    """Format a list entry; tickets outside `current_shelf` get a shelf tag."""
    text = f"* `{ticket.number}`"
    if ticket.name:
        text += f" {ticket.name}"
    if ticket.description:
        text += f' "{ticket.description}"'
    if ticket.shelf != "archive":
        return text if ticket.shelf == current_shelf else f"{text} ({ticket.shelf})"
    closed = ticket.frontmatter.get_list("closed")
    tags = [] if current_shelf == "archive" else ["archive"]
    if closed:
        tags.append(f"closed {closed[-1]}")
    return f"{text} ({', '.join(tags)})" if tags else text


def _group_heading(biz: Business, number: str, current_shelf: str) -> tuple[str, Ticket | None]:
    found = biz.find(number)
    if not found:
        return f"{number} (not found)", None
    group = found[0]
    title = group.title if group.shelf == current_shelf else f"{group.title} ({group.shelf})"
    return title, group


def _render_section(title: str, group: Ticket | None, items: list[Ticket],
                    listed: list[Ticket], current_shelf: str) -> list[str]:
    lines = [f"#### {title}", ""]
    if group and group.description:
        lines += [group.description, ""]
    lines.append(_count_line(items))
    if listed:
        ordered = sorted(listed, key=lambda t: (SHELVES.index(t.shelf), t.number))
        lines += [""] + [_ticket_line(t, current_shelf) for t in ordered]
    return lines + [""]


def _render_overview(biz: Business) -> str:
    """Render the default view: active work, with each group's backlog alongside."""
    lines = [f"### Tickets of {biz.name} ({biz.code})", "",
             f"**Business folder:** `{biz.folder}`", ""]
    open_shelves = ("work", "backlog")
    backlog_groups: list[str] = []
    for number in group_numbers(biz):
        title, group = _group_heading(biz, number, "work")
        items = biz.children(number)
        listed = [t for t in items if t.shelf in open_shelves]
        has_active = any(t.shelf == "work" for t in items)
        if group and group.shelf == "backlog" and not has_active:
            # A shelved group is summarized by its counts only.
            backlog_groups += _render_section(title, group, items, [], "work")
        elif (group and group.shelf == "work") or has_active or (listed and not group) \
                or (listed and group.shelf == "archive"):
            lines += _render_section(title, group, items, listed, "work")
    unsorted = biz.children(None)
    if any(t.shelf in open_shelves for t in unsorted):
        lines += _render_section(UNSORTED, None, unsorted,
                                 [t for t in unsorted if t.shelf in open_shelves], "work")
    lines += backlog_groups
    lines += _render_unreadable(biz, open_shelves)
    lines += _render_archive_summary(biz)

    examples = [f'`tickets(code="{biz.code}", shelf="backlog")`',
                f'`tickets(code="{biz.code}", shelf="archive")`']
    groups = [n for n in group_numbers(biz) if biz.find(n)]
    if groups:
        examples.append(f'`tickets(parent="{groups[0]}")`')
    if biz.tickets:
        projects = [t for t in biz.tickets if not t.is_group and t.shelf == "work"]
        examples.append(f'`tickets(number="{(projects or biz.tickets)[0].number}")`')
    lines += ["", "For more detail: " + ", ".join(examples) + "."]
    return "\n".join(lines)


def _render_unreadable(biz: Business, shelves: tuple[str, ...]) -> list[str]:
    """List tickets that couldn't be read, so they aren't silently dropped from a listing."""
    unreadable = [t for t in biz.unreadable if t.shelf in shelves]
    if not unreadable:
        return []
    return ["#### Unreadable", "",
            f"{INDEX_FILENAME} could not be read for these tickets, so their parent is "
            f"unknown and they are missing from the groups above:", "",
            *[f"* `{t.number}` {t.name}: {t.read_error}" for t in unreadable], ""]


def _render_archive_summary(biz: Business) -> list[str]:
    """Summarize the archive: its size, and what the sections above don't show.

    The lines under the count are deliberately not a breakdown that adds up:
    closed projects of a program are already counted in that program's own
    section, so only closed programs, closed processes, and closed projects
    with no parent are named here. "including" says so.
    """
    archived = [t for t in biz.tickets if t.shelf == "archive"]
    lines = ["#### Archive", ""]
    if not archived:
        return lines + ["No tickets."]
    notable: list[str] = []
    for kind in ("program", "process"):
        of_kind = [t for t in archived if t.kind == kind]
        if of_kind:
            by_close_date = sorted(
                of_kind, key=lambda t: (t.frontmatter.get_list("closed")[-1:], t.number))
            names = ", ".join(t.number for t in by_close_date[-5:])
            suffix = ", 5 most recent" if len(of_kind) > 5 else ""
            notable.append(f"* {pluralize(len(of_kind), kind)} ({names}{suffix})")
    orphans = [t for t in archived if t.kind == "project" and t.parent is None]
    if orphans:
        word = "project" if len(orphans) == 1 else "projects"
        notable.append(f"* {len(orphans)} {word} without a parent")
    count = pluralize(len(archived), "ticket")
    return lines + ([f"{count}, including:", "", *notable] if notable else [f"{count}."])


def _render_shelf(biz: Business, shelf: str) -> str:
    """Render every ticket on one shelf, grouped by parent."""
    lines = [f"### {biz.name} ({biz.code}) {shelf}", ""]
    if not any(t.shelf == shelf for t in biz.tickets):
        return "\n".join(lines + ["No tickets."])
    for number in group_numbers(biz):
        title, group = _group_heading(biz, number, shelf)
        items = biz.children(number)
        listed = [t for t in items if t.shelf == shelf]
        if listed or (group and group.shelf == shelf):
            if group and group.shelf == shelf == "archive":
                closed = group.frontmatter.get_list("closed")
                title += f" (closed {closed[-1]})" if closed else ""
            lines += _render_section(title, group, items, listed, shelf)
    unsorted = biz.children(None)
    if any(t.shelf == shelf for t in unsorted):
        lines += _render_section(UNSORTED, None, unsorted,
                                 [t for t in unsorted if t.shelf == shelf], shelf)
    lines += _render_unreadable(biz, (shelf,))
    return "\n".join(lines).rstrip("\n")


def _render_group(biz: Business, number: str | None, shelf: str = "") -> str:
    """Render one group's tickets: every shelf by default, or just `shelf`."""
    items = biz.children(number)
    note: list[str] = []
    group: Ticket | None = None
    if number is None:
        title = UNSORTED
    elif not biz.find(number) and items:
        # Still answer: this is how a caller finds tickets to reassign.
        title = f"{number} (not found)"
        note = [f"No ticket {number} exists, but the tickets below name it as their parent. "
                f"Give them a valid parent with `edit_ticket`.", ""]
    else:
        group = find_ticket(biz, number)
        if not group.is_group and not items:
            raise TicketError(f"{group.title} is a project with no tickets under it. "
                              f'Use `tickets(number="{number}")` to see the ticket itself.')
        title = f"{group.title} ({group.shelf})" if group.shelf != "work" else group.title
    lines = [f"### {title} — {biz.name} ({biz.code})", "", *note]
    if group and group.description:
        lines += [group.description, ""]
    lines.append(_count_line(items))
    listed = [t for t in items if t.shelf == shelf] if shelf else items
    if shelf:
        lines += ["", f"Showing {shelf} only:" if listed else f"No tickets in {shelf}."]
    if listed:
        ordered = sorted(listed, key=lambda t: (SHELVES.index(t.shelf), t.number))
        lines += [""] + [_ticket_line(t, shelf or "work") for t in ordered]
    return "\n".join(lines)


_STATE_LABELS = {"work": "in work", "backlog": "in backlog", "archive": "closed (archived)"}


def _render_ticket(biz: Business, ticket: Ticket) -> str:
    """Render a single ticket: its location, its frontmatter fields, and any tickets under it."""
    lines = [f"### {ticket.title}", "",
             f"{ticket.kind.capitalize()}, {_STATE_LABELS[ticket.shelf]}. "
             f"Business: {biz.name} ({biz.code}).", "",
             *location_lines(ticket), ""]
    if ticket.read_error:
        return "\n".join(lines + [f"{INDEX_FILENAME} could not be read ({ticket.read_error}), "
                                  f"so its frontmatter is unknown."])
    if not ticket.has_index:
        lines.append(f"{ticket.number} has no {INDEX_FILENAME}.")
    elif not ticket.frontmatter.present:
        lines.append(f"{INDEX_FILENAME} has no frontmatter.")
    for key in ticket.frontmatter.keys():
        values = ticket.frontmatter.get_list(key)
        text = ", ".join(values) if values else "none"
        if key == "parent" and ticket.parent and biz.find(ticket.parent):
            text = biz.find(ticket.parent)[0].title
        lines.append(f"* {key}: {text}")
    children = biz.children(ticket.number)
    if children or ticket.is_group:
        ordered = sorted(children, key=lambda t: (SHELVES.index(t.shelf), t.number))
        lines += ["", _count_line(children)]
        if ordered:
            lines += [""] + [_ticket_line(t, "work") for t in ordered]
    return "\n".join(lines)
