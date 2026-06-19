"""Resolution of `@<name>/<rest>` paths used in `context.json` deployment
declarations (`skills`, `instructions`, `memory`).

The `@` alias space is the union of two roots the backend already owns:

- **git repos** cloned under ``<DuetData>/repos`` — referenced by the repo
  directory name, e.g. ``@anthropic-skills.git/...``, ``@Duet-Instructions.git/...``.
- **context folders** on Drive — referenced by the context name,
  e.g. ``@DuetLab/...`` resolves to that context's own Drive folder.

Resolution is path-based; ``..``-traversal that escapes the resolved root is
rejected. Resolution never reads or copies — callers decide what to do with the
returned absolute path.
"""

from __future__ import annotations

from pathlib import Path


AT_PREFIX = "@"


def resolve_at_path(
    at_path: str,
    repos_path: Path | None,
    context_folders: dict[str, str],
) -> Path | None:
    """Resolve ``@<head>/<rest>`` to an absolute path, or ``None`` if malformed
    or unresolvable.

    Args:
        at_path: The ``@``-prefixed declaration string.
        repos_path: ``<DuetData>/repos`` (or None if unset).
        context_folders: Map of context name → absolute Drive folder.

    Resolution order for ``<head>``:
        1. A directory ``<repos_path>/<head>`` that exists → repo root.
        2. Otherwise a context named ``<head>`` → its Drive folder.

    Defensive: rejects entries that don't start with ``@``, have an empty body,
    an absolute ``/...`` body, or resolve outside the matched root (``..`` escape).
    """
    if not at_path.startswith(AT_PREFIX):
        return None
    body = at_path[len(AT_PREFIX):]
    if not body or body.startswith("/"):
        return None

    head, _, rest = body.partition("/")

    base: Path | None = None
    if repos_path is not None:
        candidate = repos_path / head
        if candidate.is_dir():
            base = candidate.resolve()
    if base is None and head in context_folders:
        base = Path(context_folders[head]).resolve()
    if base is None:
        return None

    target = (base / rest).resolve() if rest else base
    try:
        target.relative_to(base)
    except ValueError:
        return None
    return target
