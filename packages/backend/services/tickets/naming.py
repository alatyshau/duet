"""Ticket names and numbers.

This is the one implementation of these rules. The extension's new-ticket
button calls the server instead of keeping its own copy, so a ticket gets the
same folder name and the same kind of number whoever creates it.
"""

from __future__ import annotations

import unicodedata

# The character after the business code determines the ticket kind.
KIND_BY_LETTER = {"": "project", "X": "program", "A": "process"}
LETTER_BY_KIND = {kind: letter for letter, kind in KIND_BY_LETTER.items()}


def humanize_name(raw: str) -> str:
    """Split a folder name into words: `IntentSwitcher` -> `Intent Switcher`.

    Mirrors `spaceIntentName` in the extension so both display the same name.
    """
    text = raw.replace("_", " ")
    out: list[str] = []
    for i, char in enumerate(text):
        if i and _category(char) == "Lu" and _category(text[i - 1]) in ("Ll", "Nd"):
            out.append(" ")
        out.append(char)
    text = "".join(out)
    out = []
    for i, char in enumerate(text):
        if (i and i + 1 < len(text) and _category(char) == "Lu"
                and _category(text[i - 1]) == "Lu" and _category(text[i + 1]) == "Ll"):
            out.append(" ")
        out.append(char)
    return " ".join("".join(out).split())


def to_pascal_case(raw: str) -> str:
    """Convert free-form text to a PascalCase folder name.

    `ui research` -> `UiResearch`, `duet work 2` -> `DuetWork2`. Letters and
    digits are kept, apostrophes are dropped, and anything else is a word
    break. Returns an empty string if the text has no letters or digits.
    The sample table in the tests came from the extension, which used to have its
    own copy of this function.
    """
    text = unicodedata.normalize("NFC", raw).replace("'", "").replace("’", "")
    words: list[str] = []
    current: list[str] = []
    for char in humanize_name(text) + " ":
        if _category(char)[0] in "LMN":
            current.append(char)
            continue
        # A lone combining mark is not a word.
        if any(_category(c)[0] in "LN" for c in current):
            words.append(current[0].upper() + "".join(current[1:]).lower())
        current = []
    return "".join(words)


def _category(char: str) -> str:
    return unicodedata.category(char)


def next_number(code: str, kind: str, taken: list[str]) -> str | None:
    """Return the next free number for a ticket kind, or None if none are left.

    Each kind has its own sequence: projects use `DUE001`-`DUE999`, programs
    `DUEX01`-`DUEX99`, processes `DUEA01`-`DUEA99`. The result is always one
    past the highest number in use; gaps are never reused.
    """
    letter = LETTER_BY_KIND[kind]
    width = 3 - len(letter)
    prefix = code + letter
    highest = 0
    for number in taken:
        tail = number[len(prefix):]
        if number.startswith(prefix) and len(number) == 6 and tail.isdigit():
            highest = max(highest, int(tail))
    if highest >= 10 ** width - 1:
        return None
    return f"{prefix}{highest + 1:0{width}d}"
