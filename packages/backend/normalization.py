"""Unicode normalization utilities.

macOS filesystem (APFS/HFS+) stores filenames in NFD (decomposed) form,
while HTTP requests and Python string literals use NFC (composed) form.

Example:
    NFD: 'й' = 'и' + combining breve (2 code points, 4 UTF-8 bytes)
    NFC: 'й' = single code point (1 code point, 2 UTF-8 bytes)

This module provides boundary normalization to NFC (W3C recommendation).
All paths stored in DB and used for comparison should be in NFC.

Usage:
    from normalization import normalize_path

    # At system boundaries:
    drive_path = normalize_path(path_from_filesystem)  # Scanner
    search_path = normalize_path(path_from_http)       # WorkspaceService
"""

import unicodedata


def normalize_path(path: str) -> str:
    """Normalize path to NFC form.

    NFC (Canonical Decomposition, followed by Canonical Composition)
    is the W3C recommendation for text on the web.

    Args:
        path: Path string, possibly in NFD form (from macOS filesystem).

    Returns:
        Path in NFC form.
    """
    return unicodedata.normalize("NFC", path)
