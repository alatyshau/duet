"""Unit tests for `services/deploy_instructions.py`.

Covers the two components a context can declare:
- `skills`  → mirrored into `.claude/skills/<name>/` (Claude Code) and
  `.agents/skills/<name>/` (Kimi Code), both Duet-managed with
  backup-before-prune into `<target>/.pruned/`.
- `instructions` → `.claude/CLAUDE.md` / `.kimi-code/AGENTS.md` /
  `.agents/rules/gemini.md` composed from per-client templates, always
  generated, read-only, with `.bak` safety; legacy root-level files with the
  Duet banner are removed.
- `system_prompt` → one output-style source wired into Claude Code
  (`.claude/output-styles/` + `outputStyle`), Codex (`model_instructions_file`)
  and Kimi Code (`.kimi-code/agents/agent.md`, `override: true`); key-wise edits
  of the shared config files, banner-guarded withdrawal.

The functions take explicit args (no DuetData fixture needed). A fake
`backend_dir` with the three templates keeps the tests hermetic.
"""

from __future__ import annotations

import json
import os
import shutil
import stat
import tomllib
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
    # SKILL.md is the one file that is not a byte copy: it opens with the
    # provenance banner naming the declared @-path, then the source body.
    assert (out / "SKILL.md").read_text(encoding="utf-8") == (
        f"<!-- {GENERATED_BANNER} from @Src/alpha — edit the source, not this file -->\n\n# alpha"
    )
    assert (out / "nested" / "f.bin").read_bytes() == b"\x00\x01\x02"


def test_skills_banner_goes_after_frontmatter(ctx, backend_dir, sources):
    # Claude Code parses `name` / `description` from the frontmatter at the top
    # of SKILL.md, so the banner must not push the frontmatter down.
    d = _make_skill(sources, "alpha", with_manifest=False)
    (d / "SKILL.md").write_text("---\nname: alpha\n---\n\n# alpha\n", encoding="utf-8")
    deploy_instructions(ctx, _manifest(skills=["@Src/alpha"]), None, _ctx_folders(sources), backend_dir)
    out = (ctx / ".claude" / "skills" / "alpha" / "SKILL.md").read_text(encoding="utf-8")
    assert out == (
        "---\nname: alpha\n---\n"
        f"<!-- {GENERATED_BANNER} from @Src/alpha — edit the source, not this file -->\n\n# alpha\n"
    )


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
    assert out.read_text(encoding="utf-8").endswith("\n\n# alpha v2")


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
    assert out.read_text(encoding="utf-8").endswith("\n\n# alpha v2")


def _mode(path: Path) -> int:
    return stat.S_IMODE(path.stat().st_mode)


def test_skills_deployed_files_are_readonly(ctx, backend_dir, sources):
    # The whole tree is Duet-managed, so a hand edit here would be reverted on
    # the next deploy: say so through the mode, as instructions/style files do.
    _make_skill(sources, "alpha")
    (sources / "alpha" / "references").mkdir()
    (sources / "alpha" / "references" / "notes.md").write_text("x", encoding="utf-8")
    deploy_instructions(ctx, _manifest(skills=["@Src/alpha"]), None, _ctx_folders(sources), backend_dir)

    for target in (".claude", ".agents"):
        root = ctx / target / "skills" / "alpha"
        assert _mode(root / "SKILL.md") == 0o444
        assert _mode(root / "references" / "notes.md") == 0o444
        # Directories stay writable — the prune pass has to be able to unlink.
        assert _mode(root / "references") & stat.S_IWUSR


def test_skills_executable_source_stays_executable(ctx, backend_dir, sources):
    # A skill may ship scripts meant to be run directly (anthropic-skills does),
    # so the x-bit is the one thing carried over from the source.
    _make_skill(sources, "alpha")
    script = sources / "alpha" / "scripts" / "run.py"
    script.parent.mkdir()
    script.write_text("#!/usr/bin/env python3\n", encoding="utf-8")
    script.chmod(0o755)
    deploy_instructions(ctx, _manifest(skills=["@Src/alpha"]), None, _ctx_folders(sources), backend_dir)

    for target in (".claude", ".agents"):
        out = ctx / target / "skills" / "alpha" / "scripts" / "run.py"
        assert _mode(out) == 0o555
        assert os.access(out, os.X_OK)


def test_skills_mode_is_fixed_without_rewriting_the_file(ctx, backend_dir, sources):
    # Catch-up deploy over a tree deployed by an older version: the bytes are
    # already right, so only the mode changes — no new Drive revision (same
    # inode, since a rewrite would go temp-file + rename).
    _make_skill(sources, "alpha")
    deploy_instructions(ctx, _manifest(skills=["@Src/alpha"]), None, _ctx_folders(sources), backend_dir)
    out = ctx / ".claude" / "skills" / "alpha" / "SKILL.md"
    out.chmod(0o600)
    before = out.stat().st_ino

    deploy_instructions(ctx, _manifest(skills=["@Src/alpha"]), None, _ctx_folders(sources), backend_dir)
    assert _mode(out) == 0o444
    assert out.stat().st_ino == before


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
    assert (out / "SKILL.md").read_text(encoding="utf-8").endswith("\n\n# alpha")


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


# --------------------------------------------------------------------------- #
# system_prompt
# --------------------------------------------------------------------------- #

STYLE_REL = ".claude/output-styles/game-master.md"
SETTINGS_REL = ".claude/settings.json"
CODEX_REL = ".codex/config.toml"
KIMI_REL = ".kimi-code/agents/agent.md"
STYLE_SOURCE = (
    "---\n"
    "name: game-master\n"
    "description: Ведущий семейной игры\n"
    "---\n"
    "\n"
    "Ты ведёшь игру.\n"
)
SP = "@Src/styles/game-master.md"


def _deploy_sp(ctx, backend_dir, sources, entry=SP):
    return deploy_instructions(
        ctx, _manifest(system_prompt=entry), None, _ctx_folders(sources), backend_dir
    )


def _withdraw_sp(ctx, backend_dir, sources):
    return deploy_instructions(ctx, _manifest(), None, _ctx_folders(sources), backend_dir)


def _style_source(sources: Path, text: str = STYLE_SOURCE, name: str = "game-master.md") -> None:
    (sources / "styles").mkdir(parents=True, exist_ok=True)
    (sources / "styles" / name).write_text(text, encoding="utf-8")


def _kimi_frontmatter(ctx: Path) -> dict:
    import yaml

    text = (ctx / KIMI_REL).read_text(encoding="utf-8")
    assert text.startswith("---\n")
    return yaml.safe_load(text.split("---\n")[1])


def test_system_prompt_absent_is_noop(ctx, backend_dir, sources):
    report = _withdraw_sp(ctx, backend_dir, sources)
    assert report["deployed"]["system_prompt_written"] == []
    assert report["deployed"]["system_prompt_withdrawn"] == []
    for rel in (STYLE_REL, SETTINGS_REL, CODEX_REL, KIMI_REL):
        assert not (ctx / rel).exists()


def test_system_prompt_claude_style_copy(ctx, backend_dir, sources):
    _style_source(sources)
    report = _deploy_sp(ctx, backend_dir, sources)
    assert set(report["deployed"]["system_prompt_written"]) == {
        STYLE_REL, SETTINGS_REL, CODEX_REL, KIMI_REL,
    }
    text = (ctx / STYLE_REL).read_text(encoding="utf-8")
    # frontmatter at byte 0, banner right after it, body untouched
    assert text.startswith("---\nname: game-master\n")
    head, _, rest = text.partition("description: Ведущий семейной игры\n---\n")
    assert rest.startswith("<!-- " + GENERATED_BANNER)
    assert rest.endswith("\n\nТы ведёшь игру.\n")
    assert stat.S_IMODE(os.stat(ctx / STYLE_REL).st_mode) == 0o444
    assert json.loads((ctx / SETTINGS_REL).read_text(encoding="utf-8")) == {
        "outputStyle": "game-master"
    }


def test_system_prompt_codex_points_at_claude_copy(ctx, backend_dir, sources):
    _style_source(sources)
    _deploy_sp(ctx, backend_dir, sources)
    text = (ctx / CODEX_REL).read_text(encoding="utf-8")
    assert tomllib.loads(text) == {"model_instructions_file": "../.claude/output-styles/game-master.md"}
    assert (ctx / ".codex" / "../.claude/output-styles/game-master.md").resolve().is_file()
    assert GENERATED_BANNER in text


def test_system_prompt_kimi_agent_overrides_main_agent(ctx, backend_dir, sources):
    _style_source(sources)
    _deploy_sp(ctx, backend_dir, sources)
    assert _kimi_frontmatter(ctx) == {
        "name": "agent", "description": "Ведущий семейной игры", "override": True,
    }
    text = (ctx / KIMI_REL).read_text(encoding="utf-8")
    assert GENERATED_BANNER in text
    assert "Ты ведёшь игру." in text
    # the style is not a Kimi agent file: its own frontmatter must not leak in
    assert "name: game-master" not in text
    # owns the prompt but keeps the workspace-instructions / skills injections
    assert "${agents_md}" in text and "${skills_section}" in text
    assert "${base_prompt}" not in text
    assert stat.S_IMODE(os.stat(ctx / KIMI_REL).st_mode) == 0o444


def test_system_prompt_keep_coding_instructions_embeds_kimi_default(ctx, backend_dir, sources):
    _style_source(sources, STYLE_SOURCE.replace(
        "description: Ведущий семейной игры\n",
        "description: Ведущий семейной игры\nkeep-coding-instructions: true\n",
    ))
    _deploy_sp(ctx, backend_dir, sources)
    text = (ctx / KIMI_REL).read_text(encoding="utf-8")
    assert "${base_prompt}" in text
    assert "${agents_md}" not in text
    # Claude gets the flag through the verbatim frontmatter
    assert "keep-coding-instructions: true" in (ctx / STYLE_REL).read_text(encoding="utf-8")


def test_system_prompt_name_from_frontmatter_beats_file_stem(ctx, backend_dir, sources):
    _style_source(sources, STYLE_SOURCE.replace("name: game-master", "name: gm"), name="other.md")
    _deploy_sp(ctx, backend_dir, sources, entry="@Src/styles/other.md")
    # file name, `name:` and `outputStyle` all agree
    assert (ctx / ".claude/output-styles/gm.md").is_file()
    assert not (ctx / ".claude/output-styles/other.md").exists()
    assert json.loads((ctx / SETTINGS_REL).read_text(encoding="utf-8"))["outputStyle"] == "gm"
    assert "output-styles/gm.md" in (ctx / CODEX_REL).read_text(encoding="utf-8")


def test_system_prompt_without_frontmatter_uses_stem(ctx, backend_dir, sources):
    _style_source(sources, "Just a body.\n")
    _deploy_sp(ctx, backend_dir, sources)
    text = (ctx / STYLE_REL).read_text(encoding="utf-8")
    assert text.startswith("<!-- " + GENERATED_BANNER)
    assert text.endswith("Just a body.\n")
    assert json.loads((ctx / SETTINGS_REL).read_text(encoding="utf-8"))["outputStyle"] == "game-master"
    # Kimi requires a description; falls back to the name
    assert _kimi_frontmatter(ctx)["description"] == "game-master"


def test_system_prompt_redeploy_touches_nothing(ctx, backend_dir, sources):
    _style_source(sources)
    _deploy_sp(ctx, backend_dir, sources)
    files = [ctx / r for r in (STYLE_REL, SETTINGS_REL, CODEX_REL, KIMI_REL)]
    before = [f.stat().st_mtime_ns for f in files]
    _deploy_sp(ctx, backend_dir, sources)
    assert [f.stat().st_mtime_ns for f in files] == before
    assert not list(ctx.rglob("*.tmp"))


def test_system_prompt_source_edit_propagates(ctx, backend_dir, sources):
    _style_source(sources)
    _deploy_sp(ctx, backend_dir, sources)
    _style_source(sources, STYLE_SOURCE.replace("Ты ведёшь игру.", "Ты ведёшь другую игру."))
    _deploy_sp(ctx, backend_dir, sources)
    assert "другую" in (ctx / STYLE_REL).read_text(encoding="utf-8")
    assert "другую" in (ctx / KIMI_REL).read_text(encoding="utf-8")


def test_system_prompt_backs_up_handwritten_style(ctx, backend_dir, sources):
    _style_source(sources)
    (ctx / STYLE_REL).parent.mkdir(parents=True)
    (ctx / STYLE_REL).write_text("hand-made copy", encoding="utf-8")
    _deploy_sp(ctx, backend_dir, sources)
    assert (ctx / (STYLE_REL + ".bak")).read_text(encoding="utf-8") == "hand-made copy"
    assert GENERATED_BANNER in (ctx / STYLE_REL).read_text(encoding="utf-8")


def test_system_prompt_backs_up_handwritten_kimi_agent(ctx, backend_dir, sources):
    _style_source(sources)
    (ctx / KIMI_REL).parent.mkdir(parents=True)
    (ctx / KIMI_REL).write_text("mine", encoding="utf-8")
    _deploy_sp(ctx, backend_dir, sources)
    assert (ctx / (KIMI_REL + ".bak")).read_text(encoding="utf-8") == "mine"


# --- shared config files: key-wise edits -------------------------------------

def test_system_prompt_settings_keeps_other_keys(ctx, backend_dir, sources):
    _style_source(sources)
    (ctx / ".claude").mkdir()
    (ctx / SETTINGS_REL).write_text(
        json.dumps({"permissions": {"allow": ["Bash(ls)"]}, "outputStyle": "old"}), encoding="utf-8"
    )
    _deploy_sp(ctx, backend_dir, sources)
    assert json.loads((ctx / SETTINGS_REL).read_text(encoding="utf-8")) == {
        "permissions": {"allow": ["Bash(ls)"]}, "outputStyle": "game-master",
    }


def test_system_prompt_shared_configs_get_a_plain_mode_when_created(ctx, backend_dir, sources):
    # These two are the user's files, not ours — created as ordinary readable
    # files, never narrowed to the 0600 `mkstemp` hands out.
    _style_source(sources)
    _deploy_sp(ctx, backend_dir, sources)
    assert _mode(ctx / SETTINGS_REL) == 0o644
    assert _mode(ctx / CODEX_REL) == 0o644


def test_system_prompt_shared_configs_keep_the_mode_the_user_set(ctx, backend_dir, sources):
    # The mode of a co-owned file is as much the user's as the keys Duet leaves
    # alone: a key-wise edit must not reset it. 0640 is deliberately a mode
    # neither `mkstemp` (0600) nor the create default (0644) would produce, so
    # this fails if the mode is ever forced instead of preserved.
    _style_source(sources)
    (ctx / ".claude").mkdir()
    (ctx / SETTINGS_REL).write_text(json.dumps({"outputStyle": "old"}), encoding="utf-8")
    (ctx / SETTINGS_REL).chmod(0o640)
    (ctx / ".codex").mkdir()
    (ctx / CODEX_REL).write_text('model = "gpt-5"\n', encoding="utf-8")
    (ctx / CODEX_REL).chmod(0o640)

    _deploy_sp(ctx, backend_dir, sources)
    assert json.loads((ctx / SETTINGS_REL).read_text(encoding="utf-8"))["outputStyle"] == "game-master"
    assert _mode(ctx / SETTINGS_REL) == 0o640
    assert "model_instructions_file" in tomllib.loads((ctx / CODEX_REL).read_text(encoding="utf-8"))
    assert _mode(ctx / CODEX_REL) == 0o640


def test_system_prompt_invalid_settings_json_left_untouched(ctx, backend_dir, sources):
    _style_source(sources)
    (ctx / ".claude").mkdir()
    (ctx / SETTINGS_REL).write_text("{ not json", encoding="utf-8")
    report = _deploy_sp(ctx, backend_dir, sources)
    assert (ctx / SETTINGS_REL).read_text(encoding="utf-8") == "{ not json"
    assert SETTINGS_REL not in report["deployed"]["system_prompt_written"]
    assert any("settings.json" in w for w in report["warnings"])
    # the other legs still deploy
    assert (ctx / KIMI_REL).is_file()


def test_system_prompt_codex_replaces_handwritten_line_keeps_rest(ctx, backend_dir, sources):
    _style_source(sources)
    (ctx / ".codex").mkdir()
    (ctx / CODEX_REL).write_text(
        '# my codex\nmodel = "gpt-5"\nmodel_instructions_file = "elsewhere.md"\n\n'
        '[mcp_servers.x]\nurl = "http://localhost:1"\n',
        encoding="utf-8",
    )
    _deploy_sp(ctx, backend_dir, sources)
    text = (ctx / CODEX_REL).read_text(encoding="utf-8")
    assert text.startswith("# my codex\nmodel = \"gpt-5\"\n")
    assert text.endswith('[mcp_servers.x]\nurl = "http://localhost:1"\n')
    assert tomllib.loads(text) == {
        "model": "gpt-5",
        "model_instructions_file": "../.claude/output-styles/game-master.md",
        "mcp_servers": {"x": {"url": "http://localhost:1"}},
    }
    assert text.count("model_instructions_file") == 1


def test_system_prompt_codex_key_inserted_before_first_table(ctx, backend_dir, sources):
    _style_source(sources)
    (ctx / ".codex").mkdir()
    (ctx / CODEX_REL).write_text('[mcp_servers.x]\nurl = "u"\n', encoding="utf-8")
    _deploy_sp(ctx, backend_dir, sources)
    text = (ctx / CODEX_REL).read_text(encoding="utf-8")
    assert text.index("model_instructions_file") < text.index("[mcp_servers.x]")
    # top-level, not swallowed into the table
    assert "model_instructions_file" in tomllib.loads(text)


def test_system_prompt_codex_unsafe_layout_left_untouched(ctx, backend_dir, sources):
    _style_source(sources)
    (ctx / ".codex").mkdir()
    # a bracketed line inside a multi-line array looks like a table header
    original = 'extra = [\n  [1, 2],\n]\n'
    (ctx / CODEX_REL).write_text(original, encoding="utf-8")
    report = _deploy_sp(ctx, backend_dir, sources)
    assert (ctx / CODEX_REL).read_text(encoding="utf-8") == original
    assert CODEX_REL not in report["deployed"]["system_prompt_written"]
    assert any("config.toml" in w for w in report["warnings"])


def test_system_prompt_invalid_codex_toml_left_untouched(ctx, backend_dir, sources):
    _style_source(sources)
    (ctx / ".codex").mkdir()
    (ctx / CODEX_REL).write_text("= broken", encoding="utf-8")
    report = _deploy_sp(ctx, backend_dir, sources)
    assert (ctx / CODEX_REL).read_text(encoding="utf-8") == "= broken"
    assert any("config.toml" in w for w in report["warnings"])


# --- source problems ---------------------------------------------------------

def test_system_prompt_unresolvable_warns_and_leaves_deployment(ctx, backend_dir, sources):
    _style_source(sources)
    _deploy_sp(ctx, backend_dir, sources)
    report = _deploy_sp(ctx, backend_dir, sources, entry="@Src/styles/gone.md")
    assert any("system_prompt" in w for w in report["warnings"])
    assert report["deployed"]["system_prompt_written"] == []
    assert report["deployed"]["system_prompt_withdrawn"] == []
    for rel in (STYLE_REL, SETTINGS_REL, CODEX_REL, KIMI_REL):
        assert (ctx / rel).is_file()


def test_system_prompt_bad_frontmatter_or_empty_body_skipped(ctx, backend_dir, sources):
    _style_source(sources, "---\nname: [unclosed\n---\nbody\n", name="bad.md")
    report = _deploy_sp(ctx, backend_dir, sources, entry="@Src/styles/bad.md")
    assert any("frontmatter" in w for w in report["warnings"])
    _style_source(sources, "---\nname: e\n---\n\n", name="empty.md")
    report = _deploy_sp(ctx, backend_dir, sources, entry="@Src/styles/empty.md")
    assert any("empty" in w for w in report["warnings"])
    assert not (ctx / KIMI_REL).exists()


def test_system_prompt_unsafe_style_name_skipped(ctx, backend_dir, sources):
    _style_source(sources, STYLE_SOURCE.replace("name: game-master", "name: ../evil"))
    report = _deploy_sp(ctx, backend_dir, sources)
    assert any("style name" in w for w in report["warnings"])
    assert not (ctx / ".claude/output-styles").exists()
    assert not (ctx / KIMI_REL).exists()


# --- rename & withdrawal -----------------------------------------------------

def test_system_prompt_rename_prunes_stale_generated_style_only(ctx, backend_dir, sources):
    _style_source(sources)
    _deploy_sp(ctx, backend_dir, sources)
    (ctx / ".claude/output-styles/mine.md").write_text("hand-written", encoding="utf-8")
    _style_source(sources, STYLE_SOURCE.replace("name: game-master", "name: gm2"))
    _deploy_sp(ctx, backend_dir, sources)
    assert not (ctx / STYLE_REL).exists()
    assert (ctx / ".claude/output-styles/gm2.md").is_file()
    assert (ctx / ".claude/output-styles/mine.md").read_text(encoding="utf-8") == "hand-written"
    assert json.loads((ctx / SETTINGS_REL).read_text(encoding="utf-8"))["outputStyle"] == "gm2"
    assert "output-styles/gm2.md" in (ctx / CODEX_REL).read_text(encoding="utf-8")


def test_system_prompt_withdrawal_removes_everything_of_ours(ctx, backend_dir, sources):
    _style_source(sources)
    _deploy_sp(ctx, backend_dir, sources)
    report = _withdraw_sp(ctx, backend_dir, sources)
    assert set(report["deployed"]["system_prompt_withdrawn"]) == {
        STYLE_REL, SETTINGS_REL, CODEX_REL, KIMI_REL,
    }
    # settings.json / config.toml existed only for our keys → gone; so is .codex/
    for rel in (STYLE_REL, SETTINGS_REL, CODEX_REL, KIMI_REL):
        assert not (ctx / rel).exists()
    assert not (ctx / ".codex").exists()


def test_system_prompt_withdrawal_keeps_users_keys(ctx, backend_dir, sources):
    _style_source(sources)
    (ctx / ".claude").mkdir()
    (ctx / SETTINGS_REL).write_text(json.dumps({"env": {"A": "1"}}), encoding="utf-8")
    (ctx / ".codex").mkdir()
    (ctx / CODEX_REL).write_text('model = "gpt-5"\n\n[mcp_servers.x]\nurl = "u"\n', encoding="utf-8")
    original_codex = (ctx / CODEX_REL).read_text(encoding="utf-8")
    _deploy_sp(ctx, backend_dir, sources)
    _withdraw_sp(ctx, backend_dir, sources)
    assert json.loads((ctx / SETTINGS_REL).read_text(encoding="utf-8")) == {"env": {"A": "1"}}
    assert (ctx / CODEX_REL).read_text(encoding="utf-8") == original_codex


def test_system_prompt_withdrawal_round_trips_codex_table_only_file(ctx, backend_dir, sources):
    _style_source(sources)
    (ctx / ".codex").mkdir()
    original = '[mcp_servers.x]\nurl = "u"\n'
    (ctx / CODEX_REL).write_text(original, encoding="utf-8")
    _deploy_sp(ctx, backend_dir, sources)
    _withdraw_sp(ctx, backend_dir, sources)
    assert (ctx / CODEX_REL).read_text(encoding="utf-8") == original


def test_system_prompt_withdrawal_never_touches_handwritten(ctx, backend_dir, sources):
    (ctx / ".claude/output-styles").mkdir(parents=True)
    (ctx / ".claude/output-styles/mine.md").write_text("hand-written", encoding="utf-8")
    (ctx / SETTINGS_REL).write_text(json.dumps({"outputStyle": "mine"}), encoding="utf-8")
    (ctx / ".codex").mkdir()
    (ctx / CODEX_REL).write_text('model_instructions_file = "mine.md"\n', encoding="utf-8")
    (ctx / KIMI_REL).parent.mkdir(parents=True)
    (ctx / KIMI_REL).write_text("hand-written agent", encoding="utf-8")

    report = _withdraw_sp(ctx, backend_dir, sources)

    assert report["deployed"]["system_prompt_withdrawn"] == []
    assert (ctx / ".claude/output-styles/mine.md").read_text(encoding="utf-8") == "hand-written"
    assert json.loads((ctx / SETTINGS_REL).read_text(encoding="utf-8")) == {"outputStyle": "mine"}
    assert (ctx / CODEX_REL).read_text(encoding="utf-8") == 'model_instructions_file = "mine.md"\n'
    assert (ctx / KIMI_REL).read_text(encoding="utf-8") == "hand-written agent"


def test_system_prompt_withdrawal_keeps_outputstyle_not_naming_our_file(ctx, backend_dir, sources):
    _style_source(sources)
    _deploy_sp(ctx, backend_dir, sources)
    # user switched to a style of their own after our deploy
    (ctx / SETTINGS_REL).write_text(json.dumps({"outputStyle": "mine"}), encoding="utf-8")
    _withdraw_sp(ctx, backend_dir, sources)
    assert json.loads((ctx / SETTINGS_REL).read_text(encoding="utf-8")) == {"outputStyle": "mine"}
    assert not (ctx / STYLE_REL).exists()
