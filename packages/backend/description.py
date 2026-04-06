"""Description extraction from markdown files and spec file resolution.

Used by workspace_info to populate description fields in chain entities
and components, and to locate spec files via fallback chains.
"""

import logging
import re
from pathlib import Path

logger = logging.getLogger(__name__)


# Spec file fallback chains per entity type
SPEC_FALLBACK: dict[str, list[str]] = {
    "product": [
        "PRODUCT.md", "COMPONENT.md", "ARCHITECTURE.md", "README.md", "INDEX.md",
    ],
    "stream": [
        "STREAM.md", "COMPONENT.md", "ARCHITECTURE.md", "README.md", "INDEX.md",
    ],
    "business": [
        "BUSINESS.md", "COMPONENT.md", "ARCHITECTURE.md", "README.md", "INDEX.md",
    ],
    "component": [
        "COMPONENT.md", "ARCHITECTURE.md", "README.md", "INDEX.md",
    ],
}


def extract_description(file_path: Path) -> str | None:
    """Extract description from a markdown file.

    Algorithm:
    1. Find first # heading (not ##)
    2. Skip empty lines after heading
    3. If next content is a plain paragraph -> first sentence of first line
    4. Else (##, table, list, code block, blockquote, etc.) -> H1 text itself
    5. File doesn't exist or no H1 -> None

    "Plain paragraph" = line starting with letter/digit/quote character.
    First sentence = text up to first `. `, `! `, `? ` or end of line.
    Only the first line of a multi-line paragraph is considered.
    """
    try:
        text = file_path.read_text(encoding="utf-8")
    except (FileNotFoundError, OSError):
        return None

    lines = text.splitlines()
    h1_text = None
    h1_index = None

    # Find first # heading (not ## or deeper)
    for i, line in enumerate(lines):
        stripped = line.strip()
        if stripped.startswith("# ") and not stripped.startswith("## "):
            h1_text = stripped[2:].strip()
            h1_index = i
            break

    if h1_text is None:
        return None

    # Find first non-empty line after H1
    for i in range(h1_index + 1, len(lines)):
        line = lines[i].strip()
        if not line:
            continue

        # Check if it's a plain paragraph (starts with letter/digit/quote/bracket)
        if re.match(
            r'^[a-zA-Z\u00C0-\u024F'       # Latin + extended Latin
            r'\u0400-\u04FF'                  # Cyrillic
            r'\u0600-\u06FF'                  # Arabic
            r'\u4E00-\u9FFF'                  # CJK
            r'0-9'                            # digits
            r'"\u201c\u201d\u00ab\u00bb'      # quotes: " " " « »
            r"'\u2018\u2019"                  # single quotes: ' '
            r'\[\('                           # brackets: [ (
            r']',
            line,
        ):
            return _extract_first_sentence(line)

        # Structural element -> use H1 text
        return h1_text

    # No content after H1
    return h1_text


def _extract_first_sentence(text: str) -> str:
    """Extract first sentence from text.

    Splits on sentence-ending punctuation (. ! ?) followed by space or end.
    ASCII sentence-enders only — sufficient for Latin/Cyrillic content.
    Note: splits on abbreviations like "Dr. " or "e.g. " — acceptable
    for README/spec descriptions which don't start with abbreviations.
    """
    # Limit input to prevent regex backtracking on very long lines
    text = text[:500]
    match = re.match(r'^(.+?[.!?])(?:\s|$)', text)
    if match:
        return match.group(1)
    # No sentence ending found -> return whole line
    return text.strip()


def find_spec_file(root_path: Path, entity_type: str) -> Path | None:
    """Find spec file using fallback chain for entity type.

    Searches spec/ directory under root_path for files in priority order.

    Args:
        root_path: Root directory of the entity.
        entity_type: One of: product, component, stream, business.

    Returns:
        Absolute path to first existing spec file, or None.
    """
    if entity_type not in SPEC_FALLBACK:
        logger.warning("Unknown entity_type %r in find_spec_file, using 'component' fallback", entity_type)
    chain = SPEC_FALLBACK.get(entity_type, SPEC_FALLBACK["component"])
    spec_dir = root_path / "spec"

    for filename in chain:
        spec_path = spec_dir / filename
        if spec_path.is_file():
            return spec_path

    return None
