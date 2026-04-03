"""Tests for instructions workspace scanning, multi-path resolution, and bootstrapper merge."""

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
    merge_bootstrapper,
    merge_duet_instructions,
    _extract_user_content,
    _parse_frontmatter_with_error,
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

    def test_scan_skips_missing_required_fields(self, tmp_path):
        """Files with frontmatter but missing name/description are skipped."""
        index = {"personas": {"path": "p"}, "skill_folders": []}
        (tmp_path / "index.json").write_text(json.dumps(index), encoding="utf-8")

        p_dir = tmp_path / "p"
        p_dir.mkdir()
        (p_dir / "no-desc.md").write_text(
            "---\nname: test\n---\n# Missing description\n", encoding="utf-8"
        )

        result = scan_instructions(tmp_path)
        assert result["personas"] == []

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
        builder.add_business("Business")
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

        # Instructions block present
        assert "instructions" in data
        instructions = data["instructions"]
        assert instructions["basePath"] == str(tmp_path / "instructions")

        # Personas
        assert len(instructions["personas"]) == 1
        assert instructions["personas"][0]["name"] == "test-persona"

        # Skills
        assert len(instructions["skills"]) == 1
        assert instructions["skills"][0]["name"] == "test-skill"
        assert instructions["skills"][0]["category"] == "Tools"

        # instructionsPath NOT in duet_paths anymore
        assert "instructionsPath" not in data["duet_paths"]


# === Integration tests: multi-path resolution ===


@pytest.mark.asyncio
class TestMultiPathResolution:
    """Tests for multi-path entity resolution."""

    async def test_multi_path_picks_root_business(self, tmp_path, monkeypatch):
        """When multiple businesses in paths, root=true business wins."""
        builder = DuetDataBuilder(tmp_path)
        builder.with_instructions()
        builder.add_business("RegularBiz", "RegularBiz")
        builder.add_business("RootBiz", "RootBiz", root=True)
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

        regular_path = str(builder.get_business_path(0))
        root_path = str(builder.get_business_path(1))
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            response = await client.post("/orientation", json={"workspace_paths": [regular_path, root_path]})

        reset_services()
        db.close()

        assert response.status_code == 200
        data = response.json()
        # Root business should win
        assert data["context"]["chain"][0]["name"] == "RootBiz"

    async def test_multi_path_picks_higher_priority_type(self, tmp_path, monkeypatch):
        """When mixed types in paths, higher priority type wins."""
        builder = DuetDataBuilder(tmp_path)
        builder.with_instructions()
        builder.add_business("Business")
        builder.add_repo("Product")
        duet_data = builder.build(monkeypatch)

        biz_path = builder.get_business_path(0)
        product_path = biz_path / "Product"
        product_path.mkdir()
        ManifestBuilder.product(product_path, "Product")

        db = DatabaseManager(duet_data / "data" / "test.db")
        db.init()

        scanner = Scanner(db, repos_path=builder.get_repos_path())
        scanner.scan()

        workspace_service = WorkspaceService(db)
        entities_service = EntitiesService(db)
        init_services(workspace_service, entities_service, time.time())

        app = create_app()
        transport = ASGITransport(app=app)

        biz_path_str = str(biz_path)
        repo_path = str(builder.get_repo_path("Product"))
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            response = await client.post("/orientation", json={"workspace_paths": [repo_path, biz_path_str]})

        reset_services()
        db.close()

        assert response.status_code == 200
        data = response.json()
        # Business should win over product (higher priority)
        assert data["context"]["chain"][0]["name"] == "Business"
        assert data["context"]["chain"][0]["type"] == "business"


# === Tests for root column in DB ===


class TestRootBusiness:
    """Tests for root field in entities."""

    def test_scanner_stores_root_field(self, tmp_path, monkeypatch):
        """Scanner reads root:true from business.json and stores in DB."""
        builder = DuetDataBuilder(tmp_path)
        builder.with_instructions()
        builder.add_business("NormalBiz", "NormalBiz")
        builder.add_business("RootBiz", "RootBiz", root=True)
        duet_data = builder.build(monkeypatch)

        db = DatabaseManager(duet_data / "data" / "test.db")
        db.init()

        scanner = Scanner(db, repos_path=builder.get_repos_path())
        scanner.scan()

        normal = db.find_by_name("NormalBiz")
        assert normal is not None
        assert normal.root is False

        root = db.find_by_name("RootBiz")
        assert root is not None
        assert root.root is True

        root_from_db = db.find_root_business()
        assert root_from_db is not None
        assert root_from_db.name == "RootBiz"

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


class TestMergeBootstrapper:
    """Tests for merge_bootstrapper."""

    def test_merge_produces_valid_output(self, tmp_path):
        """Bootstrapper + core_instructions merge correctly."""
        bootstrapper = tmp_path / "bootstrapper.md"
        bootstrapper.write_text(
            "# Platform\n\n## Orientation\nDuet stuff\n\n<!-- INSERT USER CORE INSTRUCTIONS -->\n",
            encoding="utf-8",
        )

        instr_path = tmp_path / "instructions"
        instr_path.mkdir()
        (instr_path / "index.json").write_text(
            json.dumps({"core_instructions": "core_instructions.md", "personas": {"path": "p"}, "skill_folders": []}),
            encoding="utf-8",
        )
        (instr_path / "core_instructions.md").write_text(
            "# My Rules\n\n## L7+\nBe excellent\n\n## SDD\nSpecs first\n",
            encoding="utf-8",
        )

        result = merge_bootstrapper(bootstrapper, instr_path)

        assert "# Platform" in result
        assert "## Orientation" in result
        assert "## L7+" in result
        assert "Be excellent" in result
        assert "## SDD" in result
        assert "<!-- INSERT USER CORE INSTRUCTIONS -->" not in result
        assert "# My Rules" not in result  # H1 stripped

    def test_missing_core_instructions_raises(self, tmp_path):
        bootstrapper = tmp_path / "bootstrapper.md"
        bootstrapper.write_text("<!-- INSERT USER CORE INSTRUCTIONS -->\n", encoding="utf-8")

        instr_path = tmp_path / "instructions"
        instr_path.mkdir()
        (instr_path / "index.json").write_text(
            json.dumps({"core_instructions": "missing.md"}),
            encoding="utf-8",
        )

        with pytest.raises(FileNotFoundError, match="core_instructions not found"):
            merge_bootstrapper(bootstrapper, instr_path)

    def test_missing_marker_raises(self, tmp_path):
        bootstrapper = tmp_path / "bootstrapper.md"
        bootstrapper.write_text("# No marker here\n", encoding="utf-8")

        instr_path = tmp_path / "instructions"
        instr_path.mkdir()
        (instr_path / "index.json").write_text(
            json.dumps({"core_instructions": "core.md"}),
            encoding="utf-8",
        )

        with pytest.raises(ValueError, match="Marker"):
            merge_bootstrapper(bootstrapper, instr_path)


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


def _make_instructions(tmp_path, skills=None, core_content=None):
    """Helper: create minimal instructions workspace."""
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

    index = {
        "core_instructions": "core_instructions.md",
        "personas": {"path": "personas"},
        "skill_folders": skill_folders_config,
    }
    (instr_path / "index.json").write_text(json.dumps(index), encoding="utf-8")

    core = core_content or "# My Rules\n\n## L7+\nBe excellent\n"
    (instr_path / "core_instructions.md").write_text(core, encoding="utf-8")

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


class TestMergeDuetInstructions:
    """Tests for merge_duet_instructions full pipeline."""

    def test_success_writes_files(self, tmp_path):
        bootstrapper = _make_bootstrapper(tmp_path)
        instr_path = _make_instructions(tmp_path, skills={
            "commit": '---\nname: commit\ndescription: Generate commit\nshortcuts: ["!коммит"]\ntrigger: "User asks to commit"\n---\n# Commit\n',
        })
        output = tmp_path / "duet-instructions.md"
        errors_file = tmp_path / "data" / "errors.json"

        result = merge_duet_instructions(bootstrapper, instr_path, output, errors_file)

        assert result["status"] == "ok"
        assert result["path"] == str(output)
        assert result["errors"] == []
        assert output.exists()
        assert errors_file.exists()

        content = output.read_text(encoding="utf-8")
        assert "## L7+" in content
        assert "Be excellent" in content
        assert "commit" in content
        assert "!коммит" in content
        assert "<!-- INSERT USER CORE INSTRUCTIONS -->" not in content
        assert "<!-- INSERT SKILLS TABLE -->" not in content

    def test_collects_validation_errors(self, tmp_path):
        bootstrapper = _make_bootstrapper(tmp_path)
        instr_path = _make_instructions(tmp_path, skills={
            "good": '---\nname: good\ndescription: Good skill\n---\n# Good\n',
            "bad": '# No frontmatter at all\n',
            "incomplete": '---\nname: incomplete\n---\n# Missing description\n',
        })
        output = tmp_path / "duet-instructions.md"
        errors_file = tmp_path / "data" / "errors.json"

        result = merge_duet_instructions(bootstrapper, instr_path, output, errors_file)

        assert result["status"] == "ok"
        assert len(result["errors"]) == 2

        reason_codes = {e["reason_code"] for e in result["errors"]}
        assert "no_frontmatter" in reason_codes
        assert "missing_fields" in reason_codes

        # Good skill still in output
        content = output.read_text(encoding="utf-8")
        assert "good" in content

    def test_content_between_h1_h2_error(self, tmp_path):
        bootstrapper = _make_bootstrapper(tmp_path)
        instr_path = _make_instructions(
            tmp_path,
            core_content="# Title\nRogue content here\n## Section\n",
        )
        output = tmp_path / "duet-instructions.md"
        errors_file = tmp_path / "data" / "errors.json"

        result = merge_duet_instructions(bootstrapper, instr_path, output, errors_file)

        assert result["status"] == "error"
        assert result["path"] is None
        assert len(result["errors"]) == 1
        assert result["errors"][0]["reason_code"] == "content_between_h1_h2"
        assert result["errors"][0]["path"] == "core_instructions.md"
        assert not output.exists()

    def test_invalid_index_json_error(self, tmp_path):
        """Broken index.json reports index.json as path, not core_instructions.md."""
        bootstrapper = _make_bootstrapper(tmp_path)
        instr_path = tmp_path / "instructions"
        instr_path.mkdir(exist_ok=True)
        (instr_path / "index.json").write_text("{not valid json!!!", encoding="utf-8")
        output = tmp_path / "duet-instructions.md"
        errors_file = tmp_path / "data" / "errors.json"

        result = merge_duet_instructions(bootstrapper, instr_path, output, errors_file)

        assert result["status"] == "error"
        assert len(result["errors"]) == 1
        assert result["errors"][0]["path"] == "index.json"
        assert result["errors"][0]["reason_code"] == "index_invalid"

    def test_missing_index_json_error(self, tmp_path):
        """Missing index.json reports index.json as path."""
        bootstrapper = _make_bootstrapper(tmp_path)
        instr_path = tmp_path / "instructions"
        instr_path.mkdir(exist_ok=True)
        # No index.json at all
        output = tmp_path / "duet-instructions.md"
        errors_file = tmp_path / "data" / "errors.json"

        result = merge_duet_instructions(bootstrapper, instr_path, output, errors_file)

        assert result["status"] == "error"
        assert result["errors"][0]["path"] == "index.json"
        assert result["errors"][0]["reason_code"] == "index_not_found"

    def test_missing_core_instructions_error(self, tmp_path):
        """Missing core_instructions.md reports the configured filename."""
        bootstrapper = _make_bootstrapper(tmp_path)
        instr_path = tmp_path / "instructions"
        instr_path.mkdir(exist_ok=True)
        (instr_path / "index.json").write_text(
            json.dumps({"core_instructions": "my_rules.md", "personas": {"path": "p"}, "skill_folders": []}),
            encoding="utf-8",
        )
        output = tmp_path / "duet-instructions.md"
        errors_file = tmp_path / "data" / "errors.json"

        result = merge_duet_instructions(bootstrapper, instr_path, output, errors_file)

        assert result["status"] == "error"
        assert result["errors"][0]["path"] == "my_rules.md"
        assert result["errors"][0]["reason_code"] == "core_instructions_not_found"

    def test_no_h2_in_core_instructions_error(self, tmp_path):
        """core_instructions without H2 reports the file path."""
        bootstrapper = _make_bootstrapper(tmp_path)
        instr_path = _make_instructions(
            tmp_path,
            core_content="# Title\nJust content, no sections at all\n",
        )
        output = tmp_path / "duet-instructions.md"
        errors_file = tmp_path / "data" / "errors.json"

        result = merge_duet_instructions(bootstrapper, instr_path, output, errors_file)

        assert result["status"] == "error"
        assert result["errors"][0]["path"] == "core_instructions.md"
        assert result["errors"][0]["reason_code"] == "no_h2_found"

    def test_errors_json_written(self, tmp_path):
        bootstrapper = _make_bootstrapper(tmp_path)
        instr_path = _make_instructions(tmp_path, skills={
            "broken": '---\n: bad yaml [[\n---\n',
        })
        output = tmp_path / "duet-instructions.md"
        errors_file = tmp_path / "data" / "errors.json"

        merge_duet_instructions(bootstrapper, instr_path, output, errors_file)

        errors_data = json.loads(errors_file.read_text(encoding="utf-8"))
        assert len(errors_data) == 1
        assert errors_data[0]["reason_code"] == "invalid_yaml"

    def test_skills_table_format(self, tmp_path):
        bootstrapper = _make_bootstrapper(tmp_path)
        instr_path = _make_instructions(tmp_path, skills={
            "alpha": '---\nname: alpha\ndescription: Alpha skill\nshortcuts: ["!a", "!b"]\n---\n# Alpha\n',
            "beta": '---\nname: beta\ndescription: Beta skill\ntrigger: "When X happens"\n---\n# Beta\n',
        })
        output = tmp_path / "duet-instructions.md"
        errors_file = tmp_path / "data" / "errors.json"

        merge_duet_instructions(bootstrapper, instr_path, output, errors_file)

        content = output.read_text(encoding="utf-8")
        assert "| Name | Shortcuts | Trigger |" in content
        assert "| alpha | !a, !b |" in content
        assert '| beta | — | When X happens |' in content
