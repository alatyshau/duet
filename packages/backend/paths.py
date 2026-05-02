"""Cross-platform path comparison utilities.

Backend resolves workspace paths against business_folders and repos_path
to classify them. The naive `str.startswith(base + "/")` check breaks on
Windows because `Path.resolve()` returns paths with `\\` separator —
the hardcoded `/` never matches a real subpath.

These helpers use `pathlib` semantics, which work on both Posix and
Windows filesystems.
"""

from pathlib import Path, PurePath


def is_path_inside(path: PurePath | str, base: PurePath | str) -> bool:
    """Check if path equals base or is contained within base.

    Cross-platform: works for both Posix and Windows path semantics.
    Comparison is purely structural — does not touch the filesystem.

    Args:
        path: Candidate path (Path-like or string).
        base: Base path to test against (Path-like or string).

    Returns:
        True if path == base or path is strictly inside base.

    Examples:
        >>> is_path_inside("/a/b/c", "/a/b")
        True
        >>> is_path_inside("/a/b", "/a/b")
        True
        >>> is_path_inside("/a/b", "/a/b/c")
        False
        >>> is_path_inside("/x", "/a")
        False
    """
    p = path if isinstance(path, PurePath) else Path(path)
    b = base if isinstance(base, PurePath) else Path(base)
    try:
        p.relative_to(b)
        return True
    except ValueError:
        return False
