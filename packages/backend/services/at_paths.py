"""The grammar of alpha paths, `@<head>/<rest>` — one owner for every resolver.

Two callers resolve alpha paths and both stand on this module:

- deployment declarations in `context.json` (`skills`, `instructions`,
  `memory`, `system_prompt`) through `resolve_at_path` below, which returns a
  path or ``None``;
- the `resolve_paths` MCP tool (`services/resolve_paths.py`), which adds ticket
  heads and explains every refusal. Ticket heads are not here: deploy
  declarations never accept them, and looking one up scans manifests and disk.

What an alpha path is, decided once:

- It starts with ``@``, followed by a head. The head is a **repo dir** under
  ``<DuetData>/repos`` (``@Duet.git``) or a **context name** as registered in
  Duet (``@DuetLab``); a repo wins when both exist.
- ``/`` and ``\\`` both separate segments, so one address means the same on
  every OS. Empty segments (``//``, a trailing ``/``) are dropped. Text is
  compared in NFC, because macOS hands out names in NFD.
- A ``.`` or ``..`` segment is refused anywhere, head or rest. Nobody writes
  one on purpose, and leaving it to ``Path.resolve()`` is how ``@..`` once
  reached the parent of the repos dir.
- The target must stay inside the base after ``resolve()``, which is what
  refuses a symlink pointing out of the root.

Resolution never reads or copies; callers decide what to do with the path.
"""

from __future__ import annotations

import re
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path

from normalization import normalize_path


AT_PREFIX = "@"

_SEPARATORS = re.compile(r"[\\/]")
_DOT_SEGMENTS = (".", "..")


class AtPathError(ValueError):
    """An alpha path that cannot be resolved by its form alone.

    `code` is stable and shared with the `resolve_paths` tool:
    ``not_alpha_path``, ``dot_segment`` or ``escapes_root``.
    """

    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


@dataclass(frozen=True)
class AtPath:
    head: str
    rest: str  # segments joined by "/"; empty for a bare head


def canonical_at_path(raw: str) -> str:
    """The address as it is compared and shown: trimmed, in NFC."""
    return normalize_path(raw.strip())


def parse_at_path(raw: str) -> AtPath:
    """Take `@<head>/<rest>` apart. Raises `AtPathError` for a bad form."""
    text = canonical_at_path(raw)
    if not text.startswith(AT_PREFIX):
        raise AtPathError("not_alpha_path")
    segments = _SEPARATORS.split(text[len(AT_PREFIX):])
    head, rest = segments[0], [s for s in segments[1:] if s]
    if not head:
        raise AtPathError("not_alpha_path")
    if any(s in _DOT_SEGMENTS for s in (head, *rest)):
        raise AtPathError("dot_segment")
    return AtPath(head=head, rest="/".join(rest))


def find_base(
    head: str,
    repos_path: Path | None,
    context_folders: Mapping[str, str | Path],
) -> Path | None:
    """The folder a head stands for, or ``None``.

    Args:
        head: A head already taken from `parse_at_path` (NFC, no separators).
        repos_path: ``<DuetData>/repos`` (or None if unset).
        context_folders: Context name → absolute Drive folder.

    A directory ``<repos_path>/<head>`` that exists is checked first, then a
    context named ``<head>``.
    """
    if repos_path is not None and (repos_path / head).is_dir():
        return (repos_path / head).resolve()
    for name, folder in context_folders.items():
        if normalize_path(name) == head:
            return Path(folder).resolve()
    return None


def join_under(base: Path, rest: str) -> Path:
    """``base/rest`` resolved. Raises `AtPathError` if it leaves `base`."""
    target = (base / rest).resolve() if rest else base
    try:
        target.relative_to(base)
    except ValueError:
        raise AtPathError("escapes_root") from None
    return target


def resolve_at_path(
    at_path: str,
    repos_path: Path | None,
    context_folders: Mapping[str, str | Path],
) -> Path | None:
    """Resolve ``@<head>/<rest>`` to an absolute path, or ``None`` if it is
    malformed or unresolvable. Deployment declarations use this form."""
    try:
        parsed = parse_at_path(at_path)
        base = find_base(parsed.head, repos_path, context_folders)
        return None if base is None else join_under(base, parsed.rest)
    except AtPathError:
        return None
