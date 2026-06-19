"""Unit tests for the `@<name>/<rest>` path resolver (`services/at_paths.py`).

The resolver maps deployment declarations (`skills` / `instructions` / `memory`)
to absolute paths over two roots: git repos under `<DuetData>/repos` (by repo
dir name) and context folders on Drive (by context name).
"""

from __future__ import annotations

from pathlib import Path

import pytest

from services.at_paths import resolve_at_path


@pytest.fixture
def roots(tmp_path: Path) -> tuple[Path, dict[str, str]]:
    """A repos dir with one repo + a context-folders map with one context."""
    repos = tmp_path / "repos"
    (repos / "anthropic-skills.git" / "a").mkdir(parents=True)
    (repos / "anthropic-skills.git" / "file.txt").write_text("x", encoding="utf-8")

    ctx = tmp_path / "drive" / "DuetLab"
    ctx.mkdir(parents=True)
    (ctx / "README.md").write_text("readme", encoding="utf-8")

    return repos, {"DuetLab": str(ctx)}


def test_resolves_repo_by_dir_name(roots):
    repos, ctx_folders = roots
    out = resolve_at_path("@anthropic-skills.git/a", repos, ctx_folders)
    assert out == (repos / "anthropic-skills.git" / "a").resolve()


def test_resolves_context_folder_by_name(roots):
    repos, ctx_folders = roots
    out = resolve_at_path("@DuetLab/README.md", repos, ctx_folders)
    assert out == Path(ctx_folders["DuetLab"], "README.md").resolve()


def test_bare_head_resolves_to_root(roots):
    repos, ctx_folders = roots
    assert resolve_at_path("@DuetLab", repos, ctx_folders) == Path(ctx_folders["DuetLab"]).resolve()
    assert resolve_at_path("@anthropic-skills.git", repos, ctx_folders) == (repos / "anthropic-skills.git").resolve()


def test_repo_takes_precedence_over_context(tmp_path: Path):
    # A name existing both as a repo dir and a context name → repo wins.
    repos = tmp_path / "repos"
    (repos / "shared").mkdir(parents=True)
    ctx = tmp_path / "ctx_shared"
    ctx.mkdir()
    out = resolve_at_path("@shared/x", repos, {"shared": str(ctx)})
    assert out == (repos / "shared" / "x").resolve()


@pytest.mark.parametrize("bad", ["", "no-prefix", "@", "@/abs", "@/", "DuetLab/x"])
def test_malformed_returns_none(bad, roots):
    repos, ctx_folders = roots
    assert resolve_at_path(bad, repos, ctx_folders) is None


def test_unknown_head_returns_none(roots):
    repos, ctx_folders = roots
    assert resolve_at_path("@nope/x", repos, ctx_folders) is None


def test_traversal_escape_rejected(roots):
    repos, ctx_folders = roots
    # `..` that climbs out of the matched root must be rejected.
    assert resolve_at_path("@DuetLab/../secret", repos, ctx_folders) is None
    assert resolve_at_path("@anthropic-skills.git/../../etc", repos, ctx_folders) is None


def test_traversal_inside_root_allowed(roots):
    repos, ctx_folders = roots
    # `..` that stays within the root resolves fine.
    out = resolve_at_path("@anthropic-skills.git/a/../file.txt", repos, ctx_folders)
    assert out == (repos / "anthropic-skills.git" / "file.txt").resolve()


def test_no_repos_path_falls_back_to_context(roots):
    _, ctx_folders = roots
    out = resolve_at_path("@DuetLab/README.md", None, ctx_folders)
    assert out == Path(ctx_folders["DuetLab"], "README.md").resolve()
