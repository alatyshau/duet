"""Unit tests for `services/deploy_instructions.py`.

Covers the two components a context can declare:
- `skills`  → mirrored into `.claude/skills/<name>/` (Claude Code) and
  `.agents/skills/<name>/` (Kimi Code), both Duet-managed with
  backup-before-prune into `<target>/.pruned/`.
- `instructions` → `.claude/CLAUDE.md` / `.kimi-code/AGENTS.md` /
  `.agents/rules/gemini.md` composed from per-client templates, always
  generated, read-only, with `.bak` safety; legacy root-level files with the
  Duet banner are removed.

The functions take explicit args (no DuetData fixture needed). A fake
`backend_dir` with the three templates keeps the tests hermetic.
"""

from __future__ import annotations

import os
import shutil
import stat
import unicodedata
from pathlib import Path

import pytest

from services.deploy_instructions import (
    GENERATED_BANNER,
    INSERT_MARKER,
    PRUNED_DIR,
    _mirror_key,
    _mirror_tree_bytes,
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


# Per-client instruction targets inside the context folder (mirror of
# INSTRUCTION_TEMPLATES keys in services/deploy_instructions.py).
CLAUDE_TARGET = ".claude/CLAUDE.md"
AGENTS_TARGET = ".kimi-code/AGENTS.md"
GEMINI_TARGET = ".agents/rules/gemini.md"
ALL_TARGETS = (CLAUDE_TARGET, AGENTS_TARGET, GEMINI_TARGET)


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
# skills — incremental mirroring
#
# The destination is the user's Drive folder, where deleting a file means
# "moved to Drive trash" and deploy runs on every window open. A redeploy that
# rebuilt the tree filled the trash with every skill, many times a day.
# --------------------------------------------------------------------------- #

def _tree_identity(root: Path) -> dict[str, tuple[int, int, int]]:
    """inode + mtime_ns + size per file. A rewrite lands on a new inode (the
    write goes temp-file + rename), so this catches a touch even when the
    filesystem's mtime resolution is coarse."""
    out: dict[str, tuple[int, int, int]] = {}
    for f in sorted(root.rglob("*")):
        if f.is_file():
            st = f.stat()
            out[str(f.relative_to(root))] = (st.st_ino, st.st_mtime_ns, st.st_size)
    return out


def test_skills_redeploy_touches_nothing(ctx, backend_dir, sources):
    # The point of the whole exercise: an unchanged source must produce zero
    # writes and zero deletions on the second deploy.
    _make_skill(sources, "alpha")
    (sources / "alpha" / "nested").mkdir()
    (sources / "alpha" / "nested" / "f.bin").write_bytes(b"\x00\x01\x02")
    deploy_instructions(ctx, _manifest(skills=["@Src/alpha"]), None, _ctx_folders(sources), backend_dir)

    before = _tree_identity(ctx / ".claude" / "skills")
    assert before  # guard against asserting over an empty tree
    deploy_instructions(ctx, _manifest(skills=["@Src/alpha"]), None, _ctx_folders(sources), backend_dir)
    assert _tree_identity(ctx / ".claude" / "skills") == before


def test_skills_redeploy_rewrites_only_the_changed_file(ctx, backend_dir, sources):
    _make_skill(sources, "alpha")
    (sources / "alpha" / "other.md").write_text("stable", encoding="utf-8")
    deploy_instructions(ctx, _manifest(skills=["@Src/alpha"]), None, _ctx_folders(sources), backend_dir)
    before = _tree_identity(ctx / ".claude" / "skills")

    (sources / "alpha" / "SKILL.md").write_text("# alpha v2", encoding="utf-8")
    deploy_instructions(ctx, _manifest(skills=["@Src/alpha"]), None, _ctx_folders(sources), backend_dir)

    after = _tree_identity(ctx / ".claude" / "skills")
    changed = {k for k in before if before[k] != after[k]}
    assert changed == {str(Path("alpha") / "SKILL.md")}
    out = ctx / ".claude" / "skills" / "alpha" / "SKILL.md"
    assert out.read_text(encoding="utf-8") == "# alpha v2"


def test_skills_redeploy_drops_what_the_source_removed(ctx, backend_dir, sources):
    _make_skill(sources, "alpha")
    (sources / "alpha" / "gone").mkdir()
    (sources / "alpha" / "gone" / "f.md").write_text("x", encoding="utf-8")
    deploy_instructions(ctx, _manifest(skills=["@Src/alpha"]), None, _ctx_folders(sources), backend_dir)
    assert (ctx / ".claude" / "skills" / "alpha" / "gone" / "f.md").is_file()

    shutil.rmtree(sources / "alpha" / "gone")
    deploy_instructions(ctx, _manifest(skills=["@Src/alpha"]), None, _ctx_folders(sources), backend_dir)
    assert not (ctx / ".claude" / "skills" / "alpha" / "gone").exists()
    assert (ctx / ".claude" / "skills" / "alpha" / "SKILL.md").is_file()


def test_skills_redeploy_leaves_no_temp_files(ctx, backend_dir, sources):
    # The write is temp-file + rename; nothing may survive a successful deploy.
    _make_skill(sources, "alpha")
    deploy_instructions(ctx, _manifest(skills=["@Src/alpha"]), None, _ctx_folders(sources), backend_dir)
    assert not [f for f in (ctx / ".claude" / "skills").rglob("*") if f.name.startswith(".duet-")]


def test_skills_mirror_survives_readonly_destination_file(ctx, backend_dir, sources):
    # A rename over a read-only target needs no chmod; the old code never hit
    # this because it deleted the tree first.
    _make_skill(sources, "alpha")
    deploy_instructions(ctx, _manifest(skills=["@Src/alpha"]), None, _ctx_folders(sources), backend_dir)
    out = ctx / ".claude" / "skills" / "alpha" / "SKILL.md"
    out.chmod(0o444)

    (sources / "alpha" / "SKILL.md").write_text("# alpha v2", encoding="utf-8")
    deploy_instructions(ctx, _manifest(skills=["@Src/alpha"]), None, _ctx_folders(sources), backend_dir)
    assert out.read_text(encoding="utf-8") == "# alpha v2"


def test_skills_mirror_handles_type_flips(ctx, backend_dir, sources):
    # file → dir and dir → file in the source, both directions in one deploy.
    src = _make_skill(sources, "alpha")
    (src / "flip_to_dir").write_text("i am a file", encoding="utf-8")
    (src / "flip_to_file").mkdir()
    (src / "flip_to_file" / "inner.md").write_text("inner", encoding="utf-8")
    deploy_instructions(ctx, _manifest(skills=["@Src/alpha"]), None, _ctx_folders(sources), backend_dir)

    (src / "flip_to_dir").unlink()
    (src / "flip_to_dir").mkdir()
    (src / "flip_to_dir" / "inner.md").write_text("now a dir", encoding="utf-8")
    shutil.rmtree(src / "flip_to_file")
    (src / "flip_to_file").write_text("now a file", encoding="utf-8")
    deploy_instructions(ctx, _manifest(skills=["@Src/alpha"]), None, _ctx_folders(sources), backend_dir)

    out = ctx / ".claude" / "skills" / "alpha"
    assert (out / "flip_to_dir" / "inner.md").read_text(encoding="utf-8") == "now a dir"
    assert (out / "flip_to_file").read_text(encoding="utf-8") == "now a file"


def test_mirror_no_op_when_source_is_missing_or_empty(tmp_path):
    # The prune pass deletes inside the user's Drive folder. A source that is
    # gone or empty must never be read as "the destination should be emptied".
    dst = tmp_path / "dst"
    dst.mkdir()
    (dst / "SKILL.md").write_text("precious", encoding="utf-8")

    _mirror_tree_bytes(tmp_path / "does-not-exist", dst)
    assert (dst / "SKILL.md").read_text(encoding="utf-8") == "precious"

    empty = tmp_path / "empty"
    empty.mkdir()
    _mirror_tree_bytes(empty, dst)
    assert (dst / "SKILL.md").read_text(encoding="utf-8") == "precious"


def test_mirror_key_folds_case_and_unicode_form():
    # Drive's macOS folder is case-insensitive and may return a different
    # Unicode normal form than the source repo stores. Both must compare equal,
    # or the prune pass would delete the file pass 1 has just written.
    assert _mirror_key(Path("README.md")) == _mirror_key(Path("readme.md"))
    nfc = unicodedata.normalize("NFC", "ré/sumé.md")
    nfd = unicodedata.normalize("NFD", "ré/sumé.md")
    assert nfc != nfd  # the two spellings really are different strings
    assert _mirror_key(Path(nfc)) == _mirror_key(Path(nfd))


def test_skills_redeploy_is_stable_for_non_ascii_names(ctx, backend_dir, sources):
    src = _make_skill(sources, "alpha")
    (src / unicodedata.normalize("NFC", "résumé.md")).write_text("x", encoding="utf-8")
    deploy_instructions(ctx, _manifest(skills=["@Src/alpha"]), None, _ctx_folders(sources), backend_dir)

    before = _tree_identity(ctx / ".claude" / "skills")
    assert len(before) == 2
    deploy_instructions(ctx, _manifest(skills=["@Src/alpha"]), None, _ctx_folders(sources), backend_dir)
    assert _tree_identity(ctx / ".claude" / "skills") == before


# --------------------------------------------------------------------------- #
# skills — `.agents/skills/` mirror (Kimi Code)
# --------------------------------------------------------------------------- #

def test_skills_deploy_also_mirrors_to_agents_dir(ctx, backend_dir, sources):
    _make_skill(sources, "alpha")
    report = deploy_instructions(ctx, _manifest(skills=["@Src/alpha"]), None, _ctx_folders(sources), backend_dir)
    assert report["deployed"]["agents_skills_deployed"] == ["alpha"]
    out = ctx / ".agents" / "skills" / "alpha"
    assert (out / "SKILL.md").read_text(encoding="utf-8") == "# alpha"


def test_skills_prune_backs_up_ghost_in_agents_dir(ctx, backend_dir, sources):
    # A ghost skill in `.agents/skills/` is moved into its own `.pruned/`.
    ghost = ctx / ".agents" / "skills" / "ghost"
    ghost.mkdir(parents=True)
    (ghost / "SKILL.md").write_text("hand-made", encoding="utf-8")
    report = deploy_instructions(ctx, _manifest(skills=[]), None, _ctx_folders(sources), backend_dir)
    assert report["deployed"]["agents_skills_pruned"] == ["ghost"]
    assert not ghost.exists()
    backup = ctx / ".agents" / "skills" / PRUNED_DIR / "ghost" / "SKILL.md"
    assert backup.read_text(encoding="utf-8") == "hand-made"


def test_skills_absent_is_noop_for_agents_dir(ctx, backend_dir, sources):
    # Pre-existing hand-placed skill dir must be left untouched when key absent.
    existing = ctx / ".agents" / "skills" / "hand"
    existing.mkdir(parents=True)
    report = deploy_instructions(ctx, _manifest(skills=None), None, _ctx_folders(sources), backend_dir)
    assert report["deployed"]["agents_skills_deployed"] == []
    assert report["deployed"]["agents_skills_pruned"] == []
    assert existing.is_dir()


# --------------------------------------------------------------------------- #
# instructions
# --------------------------------------------------------------------------- #

def test_instructions_always_generates_three(ctx, backend_dir, sources):
    report = deploy_instructions(ctx, _manifest(instructions=None), None, _ctx_folders(sources), backend_dir)
    assert set(report["deployed"]["instructions_written"]) == set(ALL_TARGETS)
    for name in ALL_TARGETS:
        text = (ctx / name).read_text(encoding="utf-8")
        assert GENERATED_BANNER in text
        assert INSERT_MARKER not in text  # marker replaced (with empty body)


def test_instructions_composes_user_body(ctx, backend_dir, sources):
    sources.mkdir(parents=True)
    (sources / "one.md").write_text("BODY ONE", encoding="utf-8")
    (sources / "two.md").write_text("BODY TWO", encoding="utf-8")
    cf = _ctx_folders(sources)
    deploy_instructions(ctx, _manifest(instructions=["@Src/one.md", "@Src/two.md"]), None, cf, backend_dir)
    text = (ctx / CLAUDE_TARGET).read_text(encoding="utf-8")
    assert "BODY ONE\n\nBODY TWO" in text


def test_instructions_written_readonly(ctx, backend_dir, sources):
    deploy_instructions(ctx, _manifest(instructions=[]), None, _ctx_folders(sources), backend_dir)
    mode = stat.S_IMODE(os.stat(ctx / CLAUDE_TARGET).st_mode)
    assert mode == 0o444


def test_instructions_regenerates_over_readonly(ctx, backend_dir, sources):
    # Second deploy must succeed over the read-only file from the first.
    deploy_instructions(ctx, _manifest(instructions=[]), None, _ctx_folders(sources), backend_dir)
    report = deploy_instructions(ctx, _manifest(instructions=[]), None, _ctx_folders(sources), backend_dir)
    assert CLAUDE_TARGET in report["deployed"]["instructions_written"]


def test_instructions_backs_up_handwritten(ctx, backend_dir, sources):
    # A hand-written .claude/CLAUDE.md (no banner) is backed up before first overwrite.
    target = ctx / CLAUDE_TARGET
    target.parent.mkdir(parents=True)
    target.write_text("my own notes", encoding="utf-8")
    deploy_instructions(ctx, _manifest(instructions=[]), None, _ctx_folders(sources), backend_dir)
    assert (ctx / ".claude" / "CLAUDE.md.bak").read_text(encoding="utf-8") == "my own notes"
    assert GENERATED_BANNER in target.read_text(encoding="utf-8")


def test_instructions_backup_not_overwritten(ctx, backend_dir, sources):
    target = ctx / CLAUDE_TARGET
    target.parent.mkdir(parents=True)
    target.write_text("earliest", encoding="utf-8")
    deploy_instructions(ctx, _manifest(instructions=[]), None, _ctx_folders(sources), backend_dir)
    # Second deploy: file now carries the banner → no new backup, earliest kept.
    deploy_instructions(ctx, _manifest(instructions=[]), None, _ctx_folders(sources), backend_dir)
    assert (ctx / ".claude" / "CLAUDE.md.bak").read_text(encoding="utf-8") == "earliest"


def test_instructions_generated_file_not_backed_up(ctx, backend_dir, sources):
    deploy_instructions(ctx, _manifest(instructions=[]), None, _ctx_folders(sources), backend_dir)
    # Re-deploy over our own generated file → never produces a .bak.
    deploy_instructions(ctx, _manifest(instructions=[]), None, _ctx_folders(sources), backend_dir)
    assert not (ctx / ".claude" / "CLAUDE.md.bak").exists()


def test_instructions_legacy_root_files_removed(ctx, backend_dir, sources):
    # Pre-dot-folder layout: Duet-generated (banner, read-only) files at the
    # context root are removed on deploy.
    for name in ("CLAUDE.md", "AGENTS.md", "GEMINI.md"):
        f = ctx / name
        f.write_text(f"<!-- {GENERATED_BANNER} -->\nold", encoding="utf-8")
        os.chmod(f, 0o444)
    report = deploy_instructions(ctx, _manifest(instructions=[]), None, _ctx_folders(sources), backend_dir)
    assert set(report["deployed"]["instructions_legacy_removed"]) == {"CLAUDE.md", "AGENTS.md", "GEMINI.md"}
    for name in ("CLAUDE.md", "AGENTS.md", "GEMINI.md"):
        assert not (ctx / name).exists()
    for name in ALL_TARGETS:
        assert (ctx / name).is_file()


def test_instructions_legacy_handwritten_root_files_stay(ctx, backend_dir, sources):
    # A hand-written root CLAUDE.md (no banner) is NOT Duet-managed → kept.
    (ctx / "CLAUDE.md").write_text("my own root notes", encoding="utf-8")
    report = deploy_instructions(ctx, _manifest(instructions=[]), None, _ctx_folders(sources), backend_dir)
    assert report["deployed"]["instructions_legacy_removed"] == []
    assert (ctx / "CLAUDE.md").read_text(encoding="utf-8") == "my own root notes"


def test_instructions_unresolvable_source_warns(ctx, backend_dir, sources):
    report = deploy_instructions(ctx, _manifest(instructions=["@Nope/x.md"]), None, _ctx_folders(sources), backend_dir)
    assert any("unresolvable or not a file" in w for w in report["warnings"])


def test_no_stray_temp_files(ctx, backend_dir, sources):
    deploy_instructions(ctx, _manifest(instructions=[]), None, _ctx_folders(sources), backend_dir)
    assert not list(ctx.rglob("*.tmp"))
