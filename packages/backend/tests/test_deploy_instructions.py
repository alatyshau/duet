"""Unit tests for `services/deploy_instructions.py`.

Covers the two components a context can declare:
- `skills`  → mirrored into `.claude/skills/<name>/`, Duet-managed with
  backup-before-prune into `.claude/skills/.pruned/`.
- `instructions` → `CLAUDE.md` / `AGENTS.md` / `GEMINI.md` composed from
  per-client templates, always generated, read-only, with `.bak` safety.

The functions take explicit args (no DuetData fixture needed). A fake
`backend_dir` with the three templates keeps the tests hermetic.
"""

from __future__ import annotations

import os
import stat
from pathlib import Path

import pytest

from services.deploy_instructions import (
    GENERATED_BANNER,
    INSERT_MARKER,
    PRUNED_DIR,
    deploy_instructions,
)
from services.manifest import Manifest


# --------------------------------------------------------------------------- #
# helpers
# --------------------------------------------------------------------------- #

def _make_skill(root: Path, name: str, with_manifest: bool = True) -> Path:
    d = root / name
    d.mkdir(parents=True)
    if with_manifest:
        (d / "SKILL.md").write_text(f"# {name}", encoding="utf-8")
    return d


def _make_templates(backend_dir: Path) -> None:
    """Three per-client templates carrying the generated banner + insert marker."""
    backend_dir.mkdir(parents=True, exist_ok=True)
    for out_name, tpl in (
        ("CLAUDE.md", "CLAUDE_template.md"),
        ("AGENTS.md", "AGENTS_template.md"),
        ("GEMINI.md", "GEMINI_template.md"),
    ):
        (backend_dir / tpl).write_text(
            f"<!-- {GENERATED_BANNER} -->\n# {out_name}\n\n{INSERT_MARKER}\n",
            encoding="utf-8",
        )


def _manifest(**kw) -> Manifest:
    return Manifest(version=4, name="Ctx", icon=None, meta=False, **kw)


@pytest.fixture
def ctx(tmp_path: Path) -> Path:
    c = tmp_path / "context"
    c.mkdir()
    return c


@pytest.fixture
def backend_dir(tmp_path: Path) -> Path:
    b = tmp_path / "backend"
    _make_templates(b)
    return b


@pytest.fixture
def sources(tmp_path: Path) -> Path:
    """A context-folders root holding skill sources + instruction sources."""
    return tmp_path / "src"


def _ctx_folders(sources: Path) -> dict[str, str]:
    return {"Src": str(sources)}


# --------------------------------------------------------------------------- #
# skills
# --------------------------------------------------------------------------- #

def test_skills_absent_is_noop(ctx, backend_dir, sources):
    # Pre-existing hand-placed skill dir must be left untouched when key absent.
    existing = ctx / ".claude" / "skills" / "hand"
    existing.mkdir(parents=True)
    report = deploy_instructions(ctx, _manifest(skills=None), None, _ctx_folders(sources), backend_dir)
    assert report["deployed"]["skills_deployed"] == []
    assert report["deployed"]["skills_pruned"] == []
    assert existing.is_dir()


def test_skills_deploy_copies_tree(ctx, backend_dir, sources):
    _make_skill(sources, "alpha")
    (sources / "alpha" / "nested" / "f.bin").parent.mkdir(parents=True, exist_ok=True)
    (sources / "alpha" / "nested" / "f.bin").write_bytes(b"\x00\x01\x02")
    report = deploy_instructions(ctx, _manifest(skills=["@Src/alpha"]), None, _ctx_folders(sources), backend_dir)
    assert report["deployed"]["skills_deployed"] == ["alpha"]
    out = ctx / ".claude" / "skills" / "alpha"
    assert (out / "SKILL.md").read_text(encoding="utf-8") == "# alpha"
    assert (out / "nested" / "f.bin").read_bytes() == b"\x00\x01\x02"


def test_skills_missing_manifest_skipped(ctx, backend_dir, sources):
    _make_skill(sources, "nometa", with_manifest=False)
    report = deploy_instructions(ctx, _manifest(skills=["@Src/nometa"]), None, _ctx_folders(sources), backend_dir)
    assert report["deployed"]["skills_deployed"] == []
    assert any("missing SKILL.md" in w for w in report["warnings"])


def test_skills_unresolvable_skipped(ctx, backend_dir, sources):
    report = deploy_instructions(ctx, _manifest(skills=["@Nope/x"]), None, _ctx_folders(sources), backend_dir)
    assert report["deployed"]["skills_deployed"] == []
    assert any("invalid or unresolvable" in w for w in report["warnings"])


def test_skills_collision_skips_second(ctx, backend_dir, sources):
    _make_skill(sources / "a", "dup")
    _make_skill(sources / "b", "dup")
    cf = {"A": str(sources / "a"), "B": str(sources / "b")}
    report = deploy_instructions(ctx, _manifest(skills=["@A/dup", "@B/dup"]), None, cf, backend_dir)
    assert report["deployed"]["skills_deployed"] == ["dup"]
    assert any("collision" in w for w in report["warnings"])


def test_skills_reserved_pruned_name_skipped(ctx, backend_dir, sources):
    _make_skill(sources, PRUNED_DIR)
    report = deploy_instructions(ctx, _manifest(skills=[f"@Src/{PRUNED_DIR}"]), None, _ctx_folders(sources), backend_dir)
    assert report["deployed"]["skills_deployed"] == []
    assert any("reserved deploy-name" in w for w in report["warnings"])


def test_skills_prune_backs_up_ghost(ctx, backend_dir, sources):
    # A ghost skill (not declared) is moved into `.pruned/`, not destroyed.
    ghost = ctx / ".claude" / "skills" / "ghost"
    ghost.mkdir(parents=True)
    (ghost / "SKILL.md").write_text("hand-made", encoding="utf-8")
    report = deploy_instructions(ctx, _manifest(skills=[]), None, _ctx_folders(sources), backend_dir)
    assert report["deployed"]["skills_pruned"] == ["ghost"]
    assert not ghost.exists()
    backup = ctx / ".claude" / "skills" / PRUNED_DIR / "ghost" / "SKILL.md"
    assert backup.read_text(encoding="utf-8") == "hand-made"


def test_skills_pruned_dir_is_never_pruned(ctx, backend_dir, sources):
    # `.pruned/` must survive a deploy that prunes nothing else.
    pruned = ctx / ".claude" / "skills" / PRUNED_DIR / "old"
    pruned.mkdir(parents=True)
    _make_skill(sources, "keep")
    report = deploy_instructions(ctx, _manifest(skills=["@Src/keep"]), None, _ctx_folders(sources), backend_dir)
    assert report["deployed"]["skills_pruned"] == []
    assert pruned.is_dir()


def test_skills_reprune_overwrites_backup(ctx, backend_dir, sources):
    skills_root = ctx / ".claude" / "skills"
    # First prune: ghost v1 → backup.
    g = skills_root / "ghost"
    g.mkdir(parents=True)
    (g / "SKILL.md").write_text("v1", encoding="utf-8")
    deploy_instructions(ctx, _manifest(skills=[]), None, _ctx_folders(sources), backend_dir)
    # Hand-place ghost v2, prune again → backup replaced with the newest state.
    g.mkdir(parents=True)
    (g / "SKILL.md").write_text("v2", encoding="utf-8")
    deploy_instructions(ctx, _manifest(skills=[]), None, _ctx_folders(sources), backend_dir)
    assert (skills_root / PRUNED_DIR / "ghost" / "SKILL.md").read_text(encoding="utf-8") == "v2"


# --------------------------------------------------------------------------- #
# instructions
# --------------------------------------------------------------------------- #

def test_instructions_always_generates_three(ctx, backend_dir, sources):
    report = deploy_instructions(ctx, _manifest(instructions=None), None, _ctx_folders(sources), backend_dir)
    assert set(report["deployed"]["instructions_written"]) == {"CLAUDE.md", "AGENTS.md", "GEMINI.md"}
    for name in ("CLAUDE.md", "AGENTS.md", "GEMINI.md"):
        text = (ctx / name).read_text(encoding="utf-8")
        assert GENERATED_BANNER in text
        assert INSERT_MARKER not in text  # marker replaced (with empty body)


def test_instructions_composes_user_body(ctx, backend_dir, sources):
    sources.mkdir(parents=True)
    (sources / "one.md").write_text("BODY ONE", encoding="utf-8")
    (sources / "two.md").write_text("BODY TWO", encoding="utf-8")
    cf = _ctx_folders(sources)
    deploy_instructions(ctx, _manifest(instructions=["@Src/one.md", "@Src/two.md"]), None, cf, backend_dir)
    text = (ctx / "CLAUDE.md").read_text(encoding="utf-8")
    assert "BODY ONE\n\nBODY TWO" in text


def test_instructions_written_readonly(ctx, backend_dir, sources):
    deploy_instructions(ctx, _manifest(instructions=[]), None, _ctx_folders(sources), backend_dir)
    mode = stat.S_IMODE(os.stat(ctx / "CLAUDE.md").st_mode)
    assert mode == 0o444


def test_instructions_regenerates_over_readonly(ctx, backend_dir, sources):
    # Second deploy must succeed over the read-only file from the first.
    deploy_instructions(ctx, _manifest(instructions=[]), None, _ctx_folders(sources), backend_dir)
    report = deploy_instructions(ctx, _manifest(instructions=[]), None, _ctx_folders(sources), backend_dir)
    assert "CLAUDE.md" in report["deployed"]["instructions_written"]


def test_instructions_backs_up_handwritten(ctx, backend_dir, sources):
    # A hand-written CLAUDE.md (no banner) is backed up before first overwrite.
    (ctx / "CLAUDE.md").write_text("my own notes", encoding="utf-8")
    deploy_instructions(ctx, _manifest(instructions=[]), None, _ctx_folders(sources), backend_dir)
    assert (ctx / "CLAUDE.md.bak").read_text(encoding="utf-8") == "my own notes"
    assert GENERATED_BANNER in (ctx / "CLAUDE.md").read_text(encoding="utf-8")


def test_instructions_backup_not_overwritten(ctx, backend_dir, sources):
    (ctx / "CLAUDE.md").write_text("earliest", encoding="utf-8")
    deploy_instructions(ctx, _manifest(instructions=[]), None, _ctx_folders(sources), backend_dir)
    # Second deploy: file now carries the banner → no new backup, earliest kept.
    deploy_instructions(ctx, _manifest(instructions=[]), None, _ctx_folders(sources), backend_dir)
    assert (ctx / "CLAUDE.md.bak").read_text(encoding="utf-8") == "earliest"


def test_instructions_generated_file_not_backed_up(ctx, backend_dir, sources):
    deploy_instructions(ctx, _manifest(instructions=[]), None, _ctx_folders(sources), backend_dir)
    # Re-deploy over our own generated file → never produces a .bak.
    deploy_instructions(ctx, _manifest(instructions=[]), None, _ctx_folders(sources), backend_dir)
    assert not (ctx / "CLAUDE.md.bak").exists()


def test_instructions_unresolvable_source_warns(ctx, backend_dir, sources):
    report = deploy_instructions(ctx, _manifest(instructions=["@Nope/x.md"]), None, _ctx_folders(sources), backend_dir)
    assert any("unresolvable or not a file" in w for w in report["warnings"])


def test_no_stray_temp_files(ctx, backend_dir, sources):
    deploy_instructions(ctx, _manifest(instructions=[]), None, _ctx_folders(sources), backend_dir)
    assert not list(ctx.glob("*.tmp"))
