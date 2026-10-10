"""Unit tests for the alpha-path grammar (`services/at_paths.py`).

The module owns the form of `@<head>/<rest>`, the two roots a head can stand
for (git repos under `<DuetData>/repos` by dir name, context folders on Drive
by context name) and the containment check. `resolve_at_path` maps deployment
declarations (`skills` / `system_prompt`) over it; the `resolve_paths`
tool stands on the same functions (see `test_resolve_paths.py`).
"""

from __future__ import annotations

from pathlib import Path

import pytest

from services.at_paths import AtPath, AtPathError, parse_at_path, resolve_at_path


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


@pytest.mark.parametrize("address", [
    "@DuetLab/../secret",
    "@anthropic-skills.git/../../etc",
    "@anthropic-skills.git/a/../file.txt",  # stays inside the root, still refused
    "@DuetLab/./README.md",
    "@..",
    "@../data/entities.db",
    "@.",
    "@./anthropic-skills.git",
    "@DuetLab/a\\..\\b",  # a backslash separates segments on every OS
])
def test_dot_segments_refused(address, roots):
    repos, ctx_folders = roots
    assert resolve_at_path(address, repos, ctx_folders) is None
    with pytest.raises(AtPathError) as refused:
        parse_at_path(address)
    assert refused.value.code == "dot_segment"


def test_symlink_out_of_the_root_refused(roots, tmp_path: Path):
    repos, ctx_folders = roots
    outside = tmp_path / "outside"
    outside.mkdir()
    (repos / "anthropic-skills.git" / "link").symlink_to(outside, target_is_directory=True)
    assert resolve_at_path("@anthropic-skills.git/link", repos, ctx_folders) is None


def test_separators_and_empty_segments(roots):
    repos, ctx_folders = roots
    expected = (repos / "anthropic-skills.git" / "a").resolve()
    for address in ("@anthropic-skills.git/a/", "@anthropic-skills.git//a",
                    "@anthropic-skills.git\\a", "  @anthropic-skills.git/a  "):
        assert resolve_at_path(address, repos, ctx_folders) == expected, address


def test_head_matches_in_nfc(roots, tmp_path: Path):
    import unicodedata

    repos, _ = roots
    ctx = tmp_path / "drive" / "Семейный ЛикБез"
    ctx.mkdir(parents=True)
    name = "Семейный ЛикБез"
    nfd = unicodedata.normalize("NFD", name)
    assert nfd != name
    assert resolve_at_path(f"@{nfd}/x", repos, {name: str(ctx)}) == (ctx / "x").resolve()
    assert resolve_at_path(f"@{name}/x", repos, {nfd: str(ctx)}) == (ctx / "x").resolve()


def test_parse_splits_head_and_rest():
    assert parse_at_path("@DuetLab") == AtPath("DuetLab", "")
    assert parse_at_path("@DuetLab/work/DUE009") == AtPath("DuetLab", "work/DUE009")
    assert parse_at_path("@DUE009/Решения.md") == AtPath("DUE009", "Решения.md")


@pytest.mark.parametrize("bad", ["", "no-prefix", "@", "@/abs", "@/", "@\\x", "DuetLab/x"])
def test_parse_refuses_malformed(bad):
    with pytest.raises(AtPathError) as refused:
        parse_at_path(bad)
    assert refused.value.code == "not_alpha_path"


def test_no_repos_path_falls_back_to_context(roots):
    _, ctx_folders = roots
    out = resolve_at_path("@DuetLab/README.md", None, ctx_folders)
    assert out == Path(ctx_folders["DuetLab"], "README.md").resolve()
