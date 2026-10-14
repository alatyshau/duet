"""Ticket names and numbers.

This is the one implementation of these rules. The extension's new-ticket
button calls the server instead of keeping its own copy, so a ticket gets the
same folder name and the same kind of number whoever creates it.
"""

from __future__ import annotations

import unicodedata

# The character after the business code determines the ticket's work type.
WORK_TYPE_BY_LETTER = {"": "project", "X": "program", "A": "routine"}
LETTER_BY_WORK_TYPE = {work_type: letter for letter, work_type in WORK_TYPE_BY_LETTER.items()}


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


def count_words(text: str) -> int:
    """Count the words of a name or a description, as a reader would.

    Words are what stands between spaces, and a word of one character isn't
    counted: `Shell — first commit` has three words, `Release 0.1.26` has
    two, `Button in the editor title` has five.
    """
    return sum(1 for word in unicodedata.normalize("NFC", text).split() if len(word) > 1)


def _category(char: str) -> str:
    return unicodedata.category(char)


def next_number(code: str, work_type: str, taken: list[str]) -> str | None:
    """Return the next free number for a work type, or None if none are left.

    Each work type has its own sequence: projects use `DUE001`-`DUE999`, programs
    `DUEX01`-`DUEX99`, routines `DUEA01`-`DUEA99`. The result is always one
    past the highest number in use; gaps are never reused.
    """
    letter = LETTER_BY_WORK_TYPE[work_type]
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
