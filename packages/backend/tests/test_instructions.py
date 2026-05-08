"""Tests for instructions workspace scanning and merge pipeline."""

import json
import time

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

import config
from db import DatabaseManager
from instructions import (
    parse_frontmatter,
    scan_instructions,
    merge_duet_instructions,
    _extract_user_content,
    _parse_frontmatter_with_error,
    _read_bootstrapper_and_index,
    _merge_one_agent,
)
from mcp_handler import init_services, reset_services
from scanner import Scanner
from server import create_app
from services.entities import EntitiesService
from services.workspace import WorkspaceService
from tests.fixtures import DuetDataBuilder, ManifestBuilder


# === Unit tests: frontmatter parsing ===


class TestParseFrontmatter:
    """Tests for YAML frontmatter parsing."""

    def test_valid_frontmatter(self):
        text = '---\nname: test\ndescription: A test\n---\n\n# Body\n'
        result = parse_frontmatter(text)
        assert result == {"name": "test", "description": "A test"}

    def test_frontmatter_with_shortcuts(self):
        text = '---\nname: test\ndescription: A test\nshortcuts: ["!foo", "bar"]\n---\n'
        result = parse_frontmatter(text)
        assert result["shortcuts"] == ["!foo", "bar"]

    def test_frontmatter_with_trigger(self):
        text = '---\nname: test\ndescription: A test\ntrigger: "When X"\nnoTrigger: "When Y"\n---\n'
        result = parse_frontmatter(text)
        assert result["trigger"] == "When X"
        assert result["noTrigger"] == "When Y"

    def test_dashes_inside_value(self):
        """Regression: --- inside a YAML value must not be treated as closing delimiter."""
        text = '---\nname: test\ndescription: "alpha --- beta"\n---\n\n# Body\n'
        result = parse_frontmatter(text)
        assert result["name"] == "test"
        assert result["description"] == "alpha --- beta"

    def test_no_frontmatter(self):
        text = "# Just a heading\n\nSome content.\n"
        result = parse_frontmatter(text)
        assert result == {}

    def test_empty_frontmatter(self):
        text = "---\n---\n\n# Body\n"
        result = parse_frontmatter(text)
        assert result == {}

    def test_invalid_yaml(self):
        text = "---\n: bad: yaml: [[\n---\n"
        result = parse_frontmatter(text)
        assert result == {}

    def test_no_closing_delimiter(self):
        text = "---\nname: test\n"
        result = parse_frontmatter(text)
        assert result == {}


# === Unit tests: scan_instructions ===


class TestScanInstructions:
    """Tests for scanning instructions workspace."""

    def test_scan_with_valid_workspace(self, tmp_path):
        """Scans personas and skills from workspace with index.json."""
        # Create index.json
        index = {
            "personas": {"path": "personas"},
            "skill_folders": [
                {"name": "Tools", "path": "skills/tools"},
                {"name": "Modes", "path": "skills/modes"},
            ],
        }
        (tmp_path / "index.json").write_text(json.dumps(index), encoding="utf-8")

        # Create persona
        personas_dir = tmp_path / "personas"
        personas_dir.mkdir()
        (personas_dir / "socrates.md").write_text(
            '---\nname: socrates\ndescription: Research\nshortcuts: ["Сократ"]\n---\n# Socrates\n',
            encoding="utf-8",
        )

        # Create skill
        tools_dir = tmp_path / "skills" / "tools"
        tools_dir.mkdir(parents=True)
        (tools_dir / "checkpoint.md").write_text(
            '---\nname: checkpoint\ndescription: Save context\nshortcuts: ["!упакуй"]\n'
            'trigger: "User asks to save"\nnoTrigger: "Regular commit"\n---\n# Checkpoint\n',
            encoding="utf-8",
        )

        # Create empty modes dir (no files)
        modes_dir = tmp_path / "skills" / "modes"
        modes_dir.mkdir(parents=True)

        result = scan_instructions(tmp_path)

        assert result["basePath"] == str(tmp_path)
        assert len(result["personas"]) == 1
        assert result["personas"][0]["name"] == "socrates"
        assert result["personas"][0]["shortcuts"] == ["Сократ"]
        assert result["personas"][0]["path"] == "personas/socrates.md"

        assert len(result["skills"]) == 1
        assert result["skills"][0]["name"] == "checkpoint"
        assert result["skills"][0]["category"] == "Tools"
        assert result["skills"][0]["shortcuts"] == ["!упакуй"]
        assert result["skills"][0]["trigger"] == "User asks to save"
        assert result["skills"][0]["noTrigger"] == "Regular commit"

    def test_scan_missing_index(self, tmp_path):
        """Returns empty catalog when index.json is missing."""
        result = scan_instructions(tmp_path)
        assert result["personas"] == []
        assert result["skills"] == []

    def test_scan_skips_files_without_frontmatter(self, tmp_path):
        """Files without YAML frontmatter are skipped."""
        index = {"personas": {"path": "p"}, "skill_folders": []}
        (tmp_path / "index.json").write_text(json.dumps(index), encoding="utf-8")

        p_dir = tmp_path / "p"
        p_dir.mkdir()
        (p_dir / "no-fm.md").write_text("# No frontmatter\n", encoding="utf-8")

        result = scan_instructions(tmp_path)
        assert result["personas"] == []

    def test_scan_includes_missing_description(self, tmp_path):
        """Files with name but no description are included (description is optional)."""
        index = {"personas": {"path": "p"}, "skill_folders": []}
        (tmp_path / "index.json").write_text(json.dumps(index), encoding="utf-8")

        p_dir = tmp_path / "p"
        p_dir.mkdir()
        (p_dir / "no-desc.md").write_text(
            "---\nname: test\n---\n# Missing description\n", encoding="utf-8"
        )

        result = scan_instructions(tmp_path)
        assert len(result["personas"]) == 1
        assert result["personas"][0]["name"] == "test"
        assert result["personas"][0]["description"] == ""

    def test_scan_skips_nonexistent_folder(self, tmp_path):
        """Non-existent folders in index.json are skipped."""
        index = {
            "personas": {"path": "nonexistent"},
            "skill_folders": [{"name": "X", "path": "also/missing"}],
        }
        (tmp_path / "index.json").write_text(json.dumps(index), encoding="utf-8")

        result = scan_instructions(tmp_path)
        assert result["personas"] == []
        assert result["skills"] == []


# === Integration tests: orientation with instructions ===


@pytest.mark.asyncio
class TestOrientationInstructions:
    """Tests for instructions block in orientation response."""

    async def test_orientation_includes_instructions(self, tmp_path, monkeypatch):
        """Orientation response includes instructions catalog."""
        builder = DuetDataBuilder(tmp_path)
        builder.with_instructions()
        builder.add_root_context("Root")
        builder.add_repo("Product")
        duet_data = builder.build(monkeypatch)

        db = DatabaseManager(duet_data / "data" / "test.db")
        db.init()

        scanner = Scanner(db, repos_path=builder.get_repos_path())
        scanner.scan()

        workspace_service = WorkspaceService(db)
        entities_service = EntitiesService(db)
        init_services(workspace_service, entities_service, time.time())

        app = create_app()
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            repo_path = str(builder.get_repo_path("Product"))
            response = await client.post("/orientation", json={"workspace_paths": [repo_path]})

        reset_services()
        db.close()

        assert response.status_code == 200
        data = response.json()

        # Instructions catalog not in orientation response (moved to merge_instructions)
        assert "instructions" not in data

        # instructionsPath in duet_paths
        assert data["duet_paths"]["instructionsPath"] == str(tmp_path / "instructions")


# === Integration tests: multi-path resolution ===


@pytest.mark.asyncio
class TestMultiPathResolution:
    """Tests for multi-path entity resolution."""

    async def test_multi_path_picks_meta_context(self, tmp_path, monkeypatch):
        """When multiple contexts in paths, the meta-context wins."""
        builder = DuetDataBuilder(tmp_path)
        builder.with_instructions()
        builder.add_root_context("Regular", "Regular")
        builder.add_root_context("Meta", "Meta", meta=True)
        duet_data = builder.build(monkeypatch)

        db = DatabaseManager(duet_data / "data" / "test.db")
        db.init()

        scanner = Scanner(db, repos_path=builder.get_repos_path())
        scanner.scan()

        workspace_service = WorkspaceService(db)
        entities_service = EntitiesService(db)
        init_services(workspace_service, entities_service, time.time())

        app = create_app()
        transport = ASGITransport(app=app)

        regular_path = str(builder.get_root_context_path(0))
        meta_path = str(builder.get_root_context_path(1))
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            response = await client.post(
                "/orientation",
                json={"workspace_paths": [regular_path, meta_path]},
            )

        reset_services()
        db.close()

        assert response.status_code == 200
        data = response.json()
        # Meta-context should win over regular context
        assert data["context"]["chain"][0]["name"] == "Meta"
        assert data["workspace"]["type"] == "context_meta"


# === Tests for meta column in DB ===


class TestMetaContext:
    """Tests for `meta` field on context entities."""

    def test_scanner_stores_meta_field(self, tmp_path, monkeypatch):
        """Scanner reads `meta: true` from `context.json` and stores it in DB."""
        builder = DuetDataBuilder(tmp_path)
        builder.with_instructions()
        builder.add_root_context("Plain", "Plain")
        builder.add_root_context("Meta", "Meta", meta=True)
        duet_data = builder.build(monkeypatch)

        db = DatabaseManager(duet_data / "data" / "test.db")
        db.init()

        scanner = Scanner(db, repos_path=builder.get_repos_path())
        scanner.scan()

        plain = db.find_by_name("Plain")
        assert plain is not None
        assert plain.meta is False

        meta = db.find_by_name("Meta")
        assert meta is not None
        assert meta.meta is True

        meta_from_db = db.find_meta_context()
        assert meta_from_db is not None
        assert meta_from_db.name == "Meta"

        db.close()


# === Tests for bootstrapper merge ===


class TestExtractUserContent:
    """Tests for _extract_user_content."""

    def test_extracts_from_first_h2(self):
        text = "# Title\n\n## Section 1\nContent 1\n\n## Section 2\nContent 2\n"
        result = _extract_user_content(text)
        assert result.startswith("## Section 1")
        assert "Content 1" in result
        assert "## Section 2" in result
        assert "# Title" not in result

    def test_no_h1_still_works(self):
        text = "## Section 1\nContent\n"
        result = _extract_user_content(text)
        assert result == "## Section 1\nContent\n"

    def test_content_between_h1_and_h2_raises(self):
        text = "# Title\nSome rogue content\n## Section\n"
        with pytest.raises(ValueError, match="Content found between H1 and first H2"):
            _extract_user_content(text)

    def test_no_h2_raises(self):
        text = "# Title\nJust content no sections\n"
        with pytest.raises(ValueError, match="No H2"):
            _extract_user_content(text)

    def test_empty_lines_between_h1_h2_ok(self):
        """Empty lines between H1 and H2 are not content."""
        text = "# Title\n\n\n## Section\nContent\n"
        result = _extract_user_content(text)
        assert result.startswith("## Section")


# === Tests for frontmatter error reporting ===


class TestParseFrontmatterWithError:
    """Tests for _parse_frontmatter_with_error."""

    def test_valid_returns_none_error(self):
        text = '---\nname: test\ndescription: A test\n---\n'
        data, error = _parse_frontmatter_with_error(text)
        assert data == {"name": "test", "description": "A test"}
        assert error is None

    def test_no_frontmatter_returns_reason(self):
        text = "# Just content\n"
        data, error = _parse_frontmatter_with_error(text)
        assert data == {}
        assert error == "no_frontmatter"

    def test_invalid_yaml_returns_reason(self):
        text = "---\n: bad: yaml: [[\n---\n"
        data, error = _parse_frontmatter_with_error(text)
        assert data == {}
        assert error == "invalid_yaml"

    def test_too_large_returns_reason(self):
        big = "x" * 5000
        text = f"---\nname: {big}\n---\n"
        data, error = _parse_frontmatter_with_error(text)
        assert data == {}
        assert error == "frontmatter_too_large"


# === Tests for merge_duet_instructions (full pipeline) ===


def _make_instructions(
    tmp_path,
    skills=None,
    agents=None,
    agents_index=None,
):
    """Helper: create minimal instructions workspace under the new agents schema.

    Args:
        skills: dict {filename_stem: full_md_text} placed in skills/tools/.
        agents: dict {agent_name: full_md_text} placed in agents/<name>.md.
                Default: a single 'executor' with a minimal valid body.
        agents_index: optional override for index.json.agents map; defaults to
                      mapping each key in `agents` to agents/<name>.md.

    Returns:
        Path to instructions workspace root.
    """
    instr_path = tmp_path / "instructions"
    instr_path.mkdir(exist_ok=True)

    skill_folders_config = []
    if skills:
        tools_dir = instr_path / "skills" / "tools"
        tools_dir.mkdir(parents=True, exist_ok=True)
        for name, fm_text in skills.items():
            (tools_dir / f"{name}.md").write_text(fm_text, encoding="utf-8")
        skill_folders_config = [{"name": "Tools", "path": "skills/tools"}]

    personas_dir = instr_path / "personas"
    personas_dir.mkdir(exist_ok=True)

    if agents is None:
        agents = {"executor": "# Executor\n\n## L7+\nBe excellent\n"}

    agents_dir = instr_path / "agents"
    agents_dir.mkdir(exist_ok=True)
    for agent_name, body in agents.items():
        (agents_dir / f"{agent_name}.md").write_text(body, encoding="utf-8")

    if agents_index is None:
        agents_index = {name: f"agents/{name}.md" for name in agents}

    index = {
        "agents": agents_index,
        "personas": {"path": "personas"},
        "skill_folders": skill_folders_config,
    }
    (instr_path / "index.json").write_text(json.dumps(index), encoding="utf-8")

    return instr_path


def _make_bootstrapper(tmp_path):
    """Helper: create bootstrapper.md with both markers."""
    bootstrapper = tmp_path / "bootstrapper.md"
    bootstrapper.write_text(
        "# Platform\n\n## Instructions\n\n<!-- INSERT SKILLS TABLE -->\n\n"
        "## User\n\n<!-- INSERT USER CORE INSTRUCTIONS -->\n",
        encoding="utf-8",
    )
    return bootstrapper


def _output_dir(tmp_path) -> "Path":
    """Helper: ephemeral output directory for merge_duet_instructions."""
    out = tmp_path / "duetdata"
    out.mkdir(exist_ok=True)
    return out


EXEC_BODY = "# Executor\n\n## L7+\nBe excellent\n"
VIZIR_BODY = "# Vizir\n\n## Loop\nDelegate, monitor, archive\n"


class TestMergeDuetInstructions:
    """Tests for merge_duet_instructions full multi-agent pipeline."""

    # --- B1: happy path ---
    def test_success_writes_one_file_per_agent(self, tmp_path):
        bootstrapper = _make_bootstrapper(tmp_path)
        instr_path = _make_instructions(
            tmp_path,
            skills={
                "commit": '---\nname: commit\ndescription: Generate commit\nshortcuts: ["!коммит"]\ntrigger: "User asks to commit"\n---\n# Commit\n',
            },
            agents={"executor": EXEC_BODY, "vizir": VIZIR_BODY},
        )
        output_dir = _output_dir(tmp_path)
        errors_file = tmp_path / "data" / "errors.json"

        result = merge_duet_instructions(bootstrapper, instr_path, output_dir, errors_file)

        assert result["status"] == "ok"
        assert set(result["paths"].keys()) == {"executor", "vizir"}
        assert result["errors"] == []

        exec_path = output_dir / "duet-executor.md"
        vizir_path = output_dir / "duet-vizir.md"
        assert exec_path.exists()
        assert vizir_path.exists()
        assert result["paths"]["executor"] == str(exec_path)
        assert result["paths"]["vizir"] == str(vizir_path)

        exec_content = exec_path.read_text(encoding="utf-8")
        vizir_content = vizir_path.read_text(encoding="utf-8")

        # Each merged file contains its agent's body
        assert "## L7+" in exec_content and "Be excellent" in exec_content
        assert "## Loop" in vizir_content and "Delegate" in vizir_content

        # Markers replaced
        for content in (exec_content, vizir_content):
            assert "<!-- INSERT USER CORE INSTRUCTIONS -->" not in content
            assert "<!-- INSERT SKILLS TABLE -->" not in content

        # Skills table appears identically in both
        assert "commit" in exec_content and "commit" in vizir_content
        assert "!коммит" in exec_content and "!коммит" in vizir_content

        # And the bootstrapper-derived structural lines are identical between both
        # files (sanity: skills table + bootstrapper portion is shared exactly).
        # The agent bodies differ, but the rest of the file does not.
        # Pull text up to the agent body (after `## Instructions` block).
        # Simpler: check skills-row identity.
        skills_row = "| commit"
        assert exec_content.count(skills_row) == vizir_content.count(skills_row) == 1

    # --- B2: bootstrapper missing ---
    def test_bootstrapper_not_found(self, tmp_path):
        instr_path = _make_instructions(tmp_path)
        output_dir = _output_dir(tmp_path)
        errors_file = tmp_path / "data" / "errors.json"

        bogus_bootstrapper = tmp_path / "no-such-bootstrapper.md"
        result = merge_duet_instructions(bogus_bootstrapper, instr_path, output_dir, errors_file)

        assert result["status"] == "error"
        assert result["paths"] == {}
        assert len(result["errors"]) == 1
        assert result["errors"][0]["reason_code"] == "bootstrapper_not_found"
        # No agent files written
        assert not (output_dir / "duet-executor.md").exists()

    # --- B3: bootstrapper missing USER CORE marker ---
    def test_bootstrapper_missing_marker(self, tmp_path):
        bootstrapper = tmp_path / "bootstrapper.md"
        bootstrapper.write_text(
            "# Platform\n## Instructions\n<!-- INSERT SKILLS TABLE -->\n## User\n# no user core marker\n",
            encoding="utf-8",
        )
        instr_path = _make_instructions(tmp_path)
        output_dir = _output_dir(tmp_path)
        errors_file = tmp_path / "data" / "errors.json"

        result = merge_duet_instructions(bootstrapper, instr_path, output_dir, errors_file)

        assert result["status"] == "error"
        assert result["errors"][0]["reason_code"] == "bootstrapper_missing_marker"

    # --- B4: index.json missing ---
    def test_missing_index_json(self, tmp_path):
        bootstrapper = _make_bootstrapper(tmp_path)
        instr_path = tmp_path / "instructions"
        instr_path.mkdir()
        # no index.json
        output_dir = _output_dir(tmp_path)
        errors_file = tmp_path / "data" / "errors.json"

        result = merge_duet_instructions(bootstrapper, instr_path, output_dir, errors_file)

        assert result["status"] == "error"
        assert result["errors"][0]["reason_code"] == "index_not_found"
        assert result["errors"][0]["path"] == "index.json"

    # --- B4b: index.json invalid ---
    def test_invalid_index_json(self, tmp_path):
        bootstrapper = _make_bootstrapper(tmp_path)
        instr_path = tmp_path / "instructions"
        instr_path.mkdir()
        (instr_path / "index.json").write_text("{ not valid json!!", encoding="utf-8")
        output_dir = _output_dir(tmp_path)
        errors_file = tmp_path / "data" / "errors.json"

        result = merge_duet_instructions(bootstrapper, instr_path, output_dir, errors_file)
        assert result["status"] == "error"
        assert result["errors"][0]["reason_code"] == "index_invalid"

    # --- B5: index.json without `agents` field ---
    def test_index_missing_agents(self, tmp_path):
        bootstrapper = _make_bootstrapper(tmp_path)
        instr_path = tmp_path / "instructions"
        instr_path.mkdir()
        (instr_path / "index.json").write_text(
            json.dumps({"personas": {"path": "p"}, "skill_folders": []}),
            encoding="utf-8",
        )
        output_dir = _output_dir(tmp_path)
        errors_file = tmp_path / "data" / "errors.json"

        result = merge_duet_instructions(bootstrapper, instr_path, output_dir, errors_file)

        assert result["status"] == "error"
        assert result["errors"][0]["reason_code"] == "index_missing_field"
        assert "agents" in result["errors"][0]["description"]

    # --- B5b: agents present but empty dict ---
    def test_index_empty_agents(self, tmp_path):
        bootstrapper = _make_bootstrapper(tmp_path)
        instr_path = tmp_path / "instructions"
        instr_path.mkdir()
        (instr_path / "index.json").write_text(
            json.dumps({"agents": {}, "personas": {"path": "p"}, "skill_folders": []}),
            encoding="utf-8",
        )
        output_dir = _output_dir(tmp_path)
        errors_file = tmp_path / "data" / "errors.json"

        result = merge_duet_instructions(bootstrapper, instr_path, output_dir, errors_file)
        assert result["status"] == "error"
        assert result["errors"][0]["reason_code"] == "index_missing_field"

    # --- B6: one agent file is missing — strict mode: status=error,
    #         other agents merge anyway (partial paths in result).
    def test_one_agent_file_missing(self, tmp_path):
        bootstrapper = _make_bootstrapper(tmp_path)
        # vizir declared but file missing on disk
        instr_path = _make_instructions(
            tmp_path,
            agents={"executor": EXEC_BODY},
            agents_index={
                "executor": "agents/executor.md",
                "vizir": "agents/vizir.md",
            },
        )
        output_dir = _output_dir(tmp_path)
        errors_file = tmp_path / "data" / "errors.json"

        result = merge_duet_instructions(bootstrapper, instr_path, output_dir, errors_file)

        # Strict: missing one agent ⇒ status=error
        assert result["status"] == "error"
        assert "executor" in result["paths"]
        assert "vizir" not in result["paths"]
        codes = {e["reason_code"] for e in result["errors"]}
        assert "agent_file_not_found" in codes
        # The successful agent still got written
        assert (output_dir / "duet-executor.md").exists()
        assert not (output_dir / "duet-vizir.md").exists()

    # --- B7: agent file with no H2 ---
    def test_agent_no_h2(self, tmp_path):
        bootstrapper = _make_bootstrapper(tmp_path)
        instr_path = _make_instructions(
            tmp_path,
            agents={"executor": "# Title\nJust content no sections\n"},
        )
        output_dir = _output_dir(tmp_path)
        errors_file = tmp_path / "data" / "errors.json"

        result = merge_duet_instructions(bootstrapper, instr_path, output_dir, errors_file)

        assert result["status"] == "error"
        assert result["errors"][0]["path"] == "agents/executor.md"
        assert result["errors"][0]["reason_code"] == "no_h2_found"

    # --- B8: content between H1 and first H2 ---
    def test_agent_content_between_h1_h2(self, tmp_path):
        bootstrapper = _make_bootstrapper(tmp_path)
        instr_path = _make_instructions(
            tmp_path,
            agents={"executor": "# Title\nrogue content\n## Section\nbody\n"},
        )
        output_dir = _output_dir(tmp_path)
        errors_file = tmp_path / "data" / "errors.json"

        result = merge_duet_instructions(bootstrapper, instr_path, output_dir, errors_file)

        assert result["status"] == "error"
        assert result["errors"][0]["path"] == "agents/executor.md"
        assert result["errors"][0]["reason_code"] == "content_between_h1_h2"

    # --- B9: skills table is identical across agents ---
    def test_skills_table_identical_across_agents(self, tmp_path):
        bootstrapper = _make_bootstrapper(tmp_path)
        instr_path = _make_instructions(
            tmp_path,
            skills={
                "alpha": '---\nname: alpha\ndescription: A skill\nshortcuts: ["!a"]\n---\n# Alpha\n',
            },
            agents={"executor": EXEC_BODY, "vizir": VIZIR_BODY},
        )
        output_dir = _output_dir(tmp_path)
        errors_file = tmp_path / "data" / "errors.json"

        merge_duet_instructions(bootstrapper, instr_path, output_dir, errors_file)

        exec_text = (output_dir / "duet-executor.md").read_text(encoding="utf-8")
        vizir_text = (output_dir / "duet-vizir.md").read_text(encoding="utf-8")

        skills_row = "| alpha | !a | skills/tools/alpha.md | A skill | — | — |"
        assert skills_row in exec_text
        assert skills_row in vizir_text

    # --- B10: bootstrapper read once even with many agents ---
    def test_bootstrapper_read_once(self, tmp_path, monkeypatch):
        bootstrapper = _make_bootstrapper(tmp_path)
        instr_path = _make_instructions(
            tmp_path,
            agents={
                "executor": EXEC_BODY,
                "vizir": VIZIR_BODY,
                "third": "# Third\n\n## Body\nx\n",
            },
        )
        output_dir = _output_dir(tmp_path)
        errors_file = tmp_path / "data" / "errors.json"

        from pathlib import Path as _Path

        original_read_text = _Path.read_text
        bootstrapper_reads = {"count": 0}

        def counting_read_text(self, *args, **kwargs):
            if self == bootstrapper:
                bootstrapper_reads["count"] += 1
            return original_read_text(self, *args, **kwargs)

        monkeypatch.setattr(_Path, "read_text", counting_read_text)

        merge_duet_instructions(bootstrapper, instr_path, output_dir, errors_file)

        assert bootstrapper_reads["count"] == 1, (
            f"Bootstrapper should be read once for N agents, got {bootstrapper_reads['count']}"
        )

    # --- B11: extract_user_content applied to each agent independently ---
    def test_each_agent_body_extracted_independently(self, tmp_path):
        bootstrapper = _make_bootstrapper(tmp_path)
        instr_path = _make_instructions(
            tmp_path,
            agents={
                "executor": "# Executor\n\n## SectionA\nFor executor only\n",
                "vizir": "# Vizir\n\n## SectionB\nFor vizir only\n",
            },
        )
        output_dir = _output_dir(tmp_path)
        errors_file = tmp_path / "data" / "errors.json"

        merge_duet_instructions(bootstrapper, instr_path, output_dir, errors_file)

        exec_text = (output_dir / "duet-executor.md").read_text(encoding="utf-8")
        vizir_text = (output_dir / "duet-vizir.md").read_text(encoding="utf-8")

        assert "## SectionA" in exec_text and "For executor only" in exec_text
        assert "## SectionA" not in vizir_text and "For executor only" not in vizir_text
        assert "## SectionB" in vizir_text and "For vizir only" in vizir_text
        assert "## SectionB" not in exec_text and "For vizir only" not in exec_text

        # Neither file contains the H1 of the other (or its own — H1 stripped)
        assert "# Executor" not in exec_text
        assert "# Vizir" not in vizir_text

    # --- B12: validation errors aggregate across skills + version_suffix; status still ok if all agents merged ---
    def test_validation_errors_dont_block_status_ok(self, tmp_path):
        bootstrapper = _make_bootstrapper(tmp_path)
        instr_path = _make_instructions(
            tmp_path,
            skills={
                "good": '---\nname: good\ndescription: Good\n---\n# Good\n',
                "bad": "# No frontmatter\n",
                "incomplete": "---\nname: incomplete\n---\n# missing description\n",
            },
            agents={"executor": EXEC_BODY, "vizir": VIZIR_BODY},
        )
        output_dir = _output_dir(tmp_path)
        errors_file = tmp_path / "data" / "errors.json"

        result = merge_duet_instructions(bootstrapper, instr_path, output_dir, errors_file)

        # Status ok despite validation warnings
        assert result["status"] == "ok"
        assert set(result["paths"].keys()) == {"executor", "vizir"}
        codes = {e["reason_code"] for e in result["errors"]}
        assert "no_frontmatter" in codes
        assert "missing_description" in codes

    # --- Errors JSON file written ---
    def test_errors_json_persisted(self, tmp_path):
        bootstrapper = _make_bootstrapper(tmp_path)
        instr_path = _make_instructions(
            tmp_path,
            skills={"broken": "---\n: bad yaml [[\n---\n"},
        )
        output_dir = _output_dir(tmp_path)
        errors_file = tmp_path / "data" / "errors.json"

        merge_duet_instructions(bootstrapper, instr_path, output_dir, errors_file)

        errors_data = json.loads(errors_file.read_text(encoding="utf-8"))
        assert any(e["reason_code"] == "invalid_yaml" for e in errors_data)

    # --- Skills table column format unchanged ---
    def test_skills_table_format(self, tmp_path):
        bootstrapper = _make_bootstrapper(tmp_path)
        instr_path = _make_instructions(
            tmp_path,
            skills={
                "alpha": '---\nname: alpha\ndescription: Alpha skill\nshortcuts: ["!a", "!b"]\n---\n# Alpha\n',
                "beta": '---\nname: beta\ndescription: Beta skill\ntrigger: "When X happens"\n---\n# Beta\n',
            },
        )
        output_dir = _output_dir(tmp_path)
        errors_file = tmp_path / "data" / "errors.json"

        merge_duet_instructions(bootstrapper, instr_path, output_dir, errors_file)

        content = (output_dir / "duet-executor.md").read_text(encoding="utf-8")
        assert "| Name | Shortcuts | Path | Description | Trigger | noTrigger |" in content
        assert "| alpha | !a, !b | skills/tools/alpha.md | Alpha skill | — | — |" in content
        assert "| beta | — | skills/tools/beta.md | Beta skill | When X happens | — |" in content


class TestMergeOneAgent:
    """Direct tests for the per-agent merge primitive."""

    def test_returns_merged_text(self, tmp_path):
        instr = _make_instructions(tmp_path, agents={"executor": EXEC_BODY})
        merged, err = _merge_one_agent(
            bootstrapper_text="# B\n## I\n<!-- INSERT SKILLS TABLE -->\n## U\n<!-- INSERT USER CORE INSTRUCTIONS -->\n",
            skills_table="<table>",
            instructions_path=instr,
            agent_name="executor",
            agent_rel_path="agents/executor.md",
        )
        assert err is None
        assert merged is not None
        assert "## L7+" in merged
        assert "<table>" in merged

    def test_missing_file_returns_error(self, tmp_path):
        instr = tmp_path / "instructions"
        instr.mkdir()
        merged, err = _merge_one_agent(
            bootstrapper_text="<!-- INSERT USER CORE INSTRUCTIONS -->\n",
            skills_table="",
            instructions_path=instr,
            agent_name="ghost",
            agent_rel_path="agents/ghost.md",
        )
        assert merged is None
        assert err is not None
        assert err["reason_code"] == "agent_file_not_found"
        assert err["path"] == "agents/ghost.md"
        assert "ghost" in err["description"]


class TestAgentPathSafety:
    """Path-traversal protection on user-controlled `agents` entries in index.json."""

    def test_absolute_path_rejected(self, tmp_path):
        bootstrapper = _make_bootstrapper(tmp_path)
        instr_path = _make_instructions(
            tmp_path,
            agents={"executor": EXEC_BODY},
            agents_index={"executor": "/etc/passwd"},
        )
        output_dir = _output_dir(tmp_path)
        errors_file = tmp_path / "data" / "errors.json"

        result = merge_duet_instructions(bootstrapper, instr_path, output_dir, errors_file)

        assert result["status"] == "error"
        assert any(
            e["reason_code"] == "agent_file_not_found" and "unsafe" in e["description"]
            for e in result["errors"]
        )
        assert "executor" not in result["paths"]

    def test_dotdot_escape_rejected(self, tmp_path):
        bootstrapper = _make_bootstrapper(tmp_path)
        instr_path = _make_instructions(
            tmp_path,
            agents={"executor": EXEC_BODY},
            agents_index={"executor": "../../sensitive.md"},
        )
        output_dir = _output_dir(tmp_path)
        errors_file = tmp_path / "data" / "errors.json"

        # Even if a file exists at that resolved location, we refuse it.
        sibling = tmp_path / "sensitive.md"
        sibling.write_text("# secret\n## body\n", encoding="utf-8")

        result = merge_duet_instructions(bootstrapper, instr_path, output_dir, errors_file)

        assert result["status"] == "error"
        assert any(
            e["reason_code"] == "agent_file_not_found" and "unsafe" in e["description"]
            for e in result["errors"]
        )

    def test_safe_relative_subdir_accepted(self, tmp_path):
        """Nested paths within instructions root remain valid."""
        bootstrapper = _make_bootstrapper(tmp_path)
        instr_path = tmp_path / "instructions"
        instr_path.mkdir()
        nested = instr_path / "agents" / "nested"
        nested.mkdir(parents=True)
        (nested / "exec.md").write_text(EXEC_BODY, encoding="utf-8")
        personas = instr_path / "personas"
        personas.mkdir()
        (instr_path / "index.json").write_text(
            json.dumps({
                "agents": {"executor": "agents/nested/exec.md"},
                "personas": {"path": "personas"},
                "skill_folders": [],
            }),
            encoding="utf-8",
        )
        output_dir = _output_dir(tmp_path)
        errors_file = tmp_path / "data" / "errors.json"

        result = merge_duet_instructions(bootstrapper, instr_path, output_dir, errors_file)
        assert result["status"] == "ok"
        assert "executor" in result["paths"]


class TestReadBootstrapperAndIndex:
    """Direct tests for the shared-input reader."""

    def test_happy(self, tmp_path):
        bootstrapper = _make_bootstrapper(tmp_path)
        instr = _make_instructions(tmp_path)
        text, idx, errs = _read_bootstrapper_and_index(bootstrapper, instr)
        assert text is not None
        assert idx is not None
        assert errs == []

    def test_bootstrapper_missing(self, tmp_path):
        instr = _make_instructions(tmp_path)
        text, idx, errs = _read_bootstrapper_and_index(tmp_path / "nope.md", instr)
        assert text is None and idx is None
        assert errs[0]["reason_code"] == "bootstrapper_not_found"
