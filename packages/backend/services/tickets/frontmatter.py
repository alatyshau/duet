"""Line-preserving editing of the YAML frontmatter in a ticket's `INDEX.md`."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field

# Canonical field order, used to place a field that isn't in the file yet.
FIELD_ORDER = (
    "folder-type", "work-type", "process-type", "icon", "description",
    "opened", "closed", "reopened", "renamed-from", "renamed",
    "business-area", "parent",
)

_FRONTMATTER_RE = re.compile(r"\A(\ufeff?)---[ \t]*\r?\n(.*?)^---[ \t]*(?:\r?\n|\Z)", re.S | re.M)
_FIELD_RE = re.compile(r"([A-Za-z][\w-]*)[ \t]*:(.*)")


@dataclass
class Frontmatter:
    """The frontmatter of an `INDEX.md`, edited in place line by line.

    Lines that aren't explicitly set keep their text and order, and the body
    below the frontmatter is preserved byte for byte. A YAML round trip would
    reorder keys and reformat values, so the block is never re-serialized.
    """

    lines: list[str] = field(default_factory=list)
    body: str = ""
    bom: str = ""
    present: bool = False
    newline: str = "\n"

    @classmethod
    def parse(cls, text: str) -> "Frontmatter":
        match = _FRONTMATTER_RE.match(text)
        if not match:
            return cls(body=text)
        newline = "\r\n" if "\r\n" in match.group(0) else "\n"
        # Split on line feeds only. `str.splitlines` also breaks on U+2028 and
        # friends, which would let a pasted description spill into a new line
        # that then reads as another field.
        lines = [line.removesuffix("\r") for line in match.group(2).split("\n")][:-1]
        return cls(lines=lines, body=text[match.end():], bom=match.group(1),
                   present=True, newline=newline)

    def _span(self, key: str) -> tuple[int, int] | None:
        """Return the line range of a field, including its list items."""
        for i, line in enumerate(self.lines):
            match = _FIELD_RE.fullmatch(line.rstrip())
            if match and match.group(1) == key:
                end = i + 1
                while end < len(self.lines) and self.lines[end][:1] in (" ", "\t", "-"):
                    end += 1
                return i, end
        return None

    def keys(self) -> list[str]:
        found = []
        for line in self.lines:
            match = _FIELD_RE.fullmatch(line.rstrip())
            if match and line[:1] not in (" ", "\t", "-"):
                found.append(match.group(1))
        return found

    def get_list(self, key: str) -> list[str]:
        """Return a field's values: empty, a single value, or the list items."""
        span = self._span(key)
        if span is None:
            return []
        start, end = span
        inline = _FIELD_RE.fullmatch(self.lines[start].rstrip()).group(2).strip()
        if inline.startswith("[") and inline.endswith("]"):
            values = [parse_scalar(part) for part in inline[1:-1].split(",")]
        elif end > start + 1:
            values = [parse_scalar(line.strip()[1:]) for line in self.lines[start + 1:end]
                      if line.strip().startswith("-")]
        else:
            values = [parse_scalar(inline)]
        return [value for value in values if value is not None]

    def get(self, key: str) -> str | None:
        values = self.get_list(key)
        return values[0] if values else None

    def set(self, key: str, value: str | list[str] | None, raw: bool = False) -> None:
        """Set a field.

        None removes the field, a single value is written inline, and
        multiple values are written as a list. Pass `raw=True` to write the
        value verbatim, e.g. for the `null` keyword.
        """
        if isinstance(value, list) and len(value) == 1:
            value = value[0]
        if value is None:
            new: list[str] = []
        elif isinstance(value, list):
            new = [f"{key}:"] + [f"  - {format_scalar(item)}" for item in value]
        elif value == "":
            new = [f"{key}:"]
        else:
            new = [f"{key}: {value if raw else format_scalar(value)}"]
        span = self._span(key)
        if span is not None:
            self.lines[span[0]:span[1]] = new
            return
        at = self._insertion_point(key)
        self.lines[at:at] = new

    def _insertion_point(self, key: str) -> int:
        """Where a new field goes: right after the nearest known field that precedes it."""
        if key not in FIELD_ORDER:
            return len(self.lines)
        position = FIELD_ORDER.index(key)
        for earlier in reversed(FIELD_ORDER[:position]):
            if (span := self._span(earlier)) is not None:
                return span[1]
        for later in FIELD_ORDER[position + 1:]:
            if (span := self._span(later)) is not None:
                return span[0]
        return len(self.lines)

    def text(self) -> str:
        """The frontmatter block with `\n` line endings, for display."""
        return "".join(f"{line}\n" for line in ["---", *self.lines, "---"])

    def render(self) -> str:
        """The whole file, with the frontmatter in the file's own line endings."""
        return self.bom + self.text().replace("\n", self.newline) + self.body


def parse_scalar(raw: str) -> str | None:
    value = raw.strip()
    if len(value) >= 2 and value[0] == value[-1] == '"':
        try:
            return json.loads(value)
        except ValueError:
            return value[1:-1]
    if len(value) >= 2 and value[0] == value[-1] == "'":
        return value[1:-1].replace("''", "'")
    value = re.sub(r"\s+#.*$", "", value).strip()
    return None if value in ("", "null", "~") else value


def format_scalar(value: str) -> str:
    """Quote a value only if YAML would otherwise read it back differently."""
    is_plain = (
        value == value.strip()
        and not re.search(r": |\s#|[\n\"]", value)
        and not value.endswith(":")
        and value[:1] not in "!&*-?|>'%@`[]{},#"
        and value not in ("null", "~", "true", "false")
    )
    return value if is_plain else json.dumps(value, ensure_ascii=False)
