"""Tests for WorkspaceService — business resolution and the orientation answer."""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

from db import DatabaseManager
from scanner import Scanner
from services.workspace import (
    INSIDE_REPO,
    NOT_REGISTERED,
    OUTSIDE_DUET,
    WorkspaceService,
)

from tests.fixtures import DuetDataBuilder, ManifestBuilder


def _lab(tmp_path: Path, db: DatabaseManager, monkeypatch, **lab_manifest):
    """Venture `Root` with one business `Lab` under it; returns (builder, service, lab)."""
    builder = DuetDataBuilder(tmp_path)
    builder.add_root_context("Root")
    builder.add_repo("Duet")
    builder.build(monkeypatch)
    lab = builder.get_root_context_path(0) / "Lab"
    lab.mkdir()
    ManifestBuilder.context(lab, "Lab", **lab_manifest)
    Scanner(db, repos_path=builder.get_repos_path()).scan()
    return builder, WorkspaceService(db), lab


class TestResolveBusiness:
    """resolve_business: the nearest business up the tree, from a business folder only."""

    def test_business_folder_itself(self, tmp_path, db, monkeypatch) -> None:
        _, service, lab = _lab(tmp_path, db, monkeypatch)
        entity = service.resolve_business(str(lab))
        assert entity is not None and entity.name == "Lab"

    def test_venture_folder(self, tmp_path, db, monkeypatch) -> None:
        builder, service, _ = _lab(tmp_path, db, monkeypatch)
        entity = service.resolve_business(str(builder.get_root_context_path(0)))
        assert entity is not None and entity.name == "Root"

    def test_deeper_folder_leads_to_nearest_business(self, tmp_path, db, monkeypatch) -> None:
        """A ticket folder or a direction without a manifest leads to its business."""
        _, service, lab = _lab(tmp_path, db, monkeypatch)
        ticket = lab / "work" / "LAB001_Task"
        ticket.mkdir(parents=True)
        entity = service.resolve_business(str(ticket))
        assert entity is not None and entity.name == "Lab"

    def test_nested_business_wins_over_its_parent(self, tmp_path, db, monkeypatch) -> None:
        builder = DuetDataBuilder(tmp_path)
        builder.add_root_context("Root")
        builder.build(monkeypatch)
        lab = builder.get_root_context_path(0) / "Lab"
        inherited = lab / "Research" / "Igor"
        autonomous = lab / "Research" / "Genesis"
        inherited.mkdir(parents=True)
        autonomous.mkdir(parents=True)
        ManifestBuilder.context(lab, "Lab")
        ManifestBuilder.context(autonomous, "Genesis")
        Scanner(db).scan()
        service = WorkspaceService(db)

        assert service.resolve_business(str(inherited)).name == "Lab"
        assert service.resolve_business(str(autonomous)).name == "Genesis"

    def test_repo_folder_chooses_no_business(self, tmp_path, db, monkeypatch) -> None:
        builder, service, _ = _lab(
            tmp_path, db, monkeypatch, git_repos={"Duet": "https://github.com/x/duet"}
        )
        assert service.resolve_business(str(builder.get_repo_path("Duet"))) is None
        assert service.resolve_business(str(builder.get_repo_path("Duet") / "packages")) is None

    def test_folder_outside_duet(self, tmp_path, db, monkeypatch) -> None:
        _, service, _ = _lab(tmp_path, db, monkeypatch)
        assert service.resolve_business("/some/random/path") is None

    def test_sibling_with_shared_name_prefix_is_not_matched(
        self, tmp_path, db, monkeypatch
    ) -> None:
        """`Root2/…` must not resolve to venture `Root`, nor `Lab2` to `Lab`."""
        builder, service, lab = _lab(tmp_path, db, monkeypatch)
        root = builder.get_root_context_path(0)
        sibling_root = root.parent / "Root2" / "deep"
        sibling_root.mkdir(parents=True)
        sibling_lab = root / "Lab2"
        sibling_lab.mkdir()

        assert service.resolve_business(str(sibling_root)) is None
        assert service.resolve_business(str(sibling_lab)).name == "Root"


class TestOrientationBusiness:
    """The answer for a business folder: Paths, then Next immediate steps."""

    def test_business_with_venture_and_repos(self, tmp_path, db, monkeypatch) -> None:
        builder, service, lab = _lab(
            tmp_path, db, monkeypatch,
            git_repos={"duet-work": "https://github.com/x/duet-work", "Duet": "https://github.com/x/duet"},
            reference_repos={"cookbook": "https://github.com/x/cookbook"},
        )
        root = builder.get_root_context_path(0)
        (root / "INDEX.md").write_text("# Root", encoding="utf-8")
        (lab / "INDEX.md").write_text("# Lab", encoding="utf-8")
        (lab / "README.md").write_text("# Lab readme", encoding="utf-8")
        repos = builder.get_repos_path()
        duet_data = builder.duet_data_path.resolve()

        assert service.get_orientation(str(lab)) == (
            "**Paths:**\n"
            f"* `@DuetData` (path to DuetData): `{duet_data}`\n"
            f"* `@Lab` (active business folder): `{lab}`\n"
            f"* `@Root` (parent venture folder): `{root}`\n"
            f"* `@duet-work.git` (git-repo): `{repos / 'duet-work.git'}`\n"
            f"* `@Duet.git` (git-repo): `{repos / 'Duet.git'}`\n"
            f"* `@cookbook.git` (reference repo, read-only): `{repos / 'cookbook.git'}`\n"
            "\n"
            "**Next immediate steps:**\n"
            f"* Read venture entry point: `{root / 'INDEX.md'}`\n"
            f"* Read business entry point: `{lab / 'INDEX.md'}`"
        )

    def test_readme_only_business_has_no_entry_point(self, tmp_path, db, monkeypatch):
        _, service, lab = _lab(tmp_path, db, monkeypatch)
        (lab / "README.md").write_text("# Legacy business entry", encoding="utf-8")
        assert "Next immediate steps" not in service.get_orientation(str(lab))

    def test_ticket_code_is_given_when_the_business_declares_one(
        self, tmp_path, db, monkeypatch
    ) -> None:
        builder, service, lab = _lab(tmp_path, db, monkeypatch, ticket_code="LAB")
        root = builder.get_root_context_path(0)
        duet_data = builder.duet_data_path.resolve()

        assert service.get_orientation(str(lab)) == (
            "**Paths:**\n"
            f"* `@DuetData` (path to DuetData): `{duet_data}`\n"
            f"* `@Lab` (active business folder): `{lab}`\n"
            f"* `@Root` (parent venture folder): `{root}`\n"
            "\n"
            "**Ticket code:** `LAB`"
        )

    def test_no_ticket_code_line_without_a_code(self, tmp_path, db, monkeypatch) -> None:
        _, service, lab = _lab(tmp_path, db, monkeypatch)
        assert "Ticket code" not in service.get_orientation(str(lab))

    def test_venture(self, tmp_path, db, monkeypatch) -> None:
        builder, service, _ = _lab(tmp_path, db, monkeypatch)
        root = builder.get_root_context_path(0)
        (root / "INDEX.md").write_text("# Root", encoding="utf-8")
        duet_data = builder.duet_data_path.resolve()

        assert service.get_orientation(str(root)) == (
            "**Paths:**\n"
            f"* `@DuetData` (path to DuetData): `{duet_data}`\n"
            f"* `@Root` (active venture folder): `{root}`\n"
            "\n"
            "**Next immediate steps:**\n"
            f"* Read venture entry point: `{root / 'INDEX.md'}`"
        )

    def test_meta_venture_lists_the_other_ventures(self, tmp_path, db, monkeypatch) -> None:
        builder = DuetDataBuilder(tmp_path)
        builder.add_root_context("Base")
        builder.add_root_context("Lab")
        builder.add_root_context("Family")
        builder.build(monkeypatch)
        base, lab, family = (builder.get_root_context_path(i) for i in range(3))
        ManifestBuilder.context(base, "Base", meta=True)
        (base / "INDEX.md").write_text("# Base", encoding="utf-8")
        (lab / "INDEX.md").write_text("# Lab", encoding="utf-8")
        ticket = base / "work" / "SYS001_Ticket"
        ticket.mkdir(parents=True)
        Scanner(db, repos_path=builder.get_repos_path()).scan()
        service = WorkspaceService(db)
        duet_data = builder.duet_data_path.resolve()

        expected = (
            "**Paths:**\n"
            f"* `@DuetData` (path to DuetData): `{duet_data}`\n"
            f"* `@Base` (active venture folder): `{base}`\n"
            "\n"
            "**Other Ventures** (this venture is meta: it manages others):\n"
            f"* `@Lab`: `{lab}` — entry point `INDEX.md`\n"
            f"* `@Family`: `{family}` — no entry point\n"
            "\n"
            "**Next immediate steps:**\n"
            f"* Read venture entry point: `{base / 'INDEX.md'}`"
        )
        assert service.get_orientation(str(base)) == expected
        # A ticket folder of the meta venture is the meta venture
        assert service.get_orientation(str(ticket)) == expected
        # The other ventures get no such section
        assert "Other Ventures" not in service.get_orientation(str(lab))

    def test_business_under_a_meta_venture_gets_no_list(self, tmp_path, db, monkeypatch) -> None:
        builder = DuetDataBuilder(tmp_path)
        builder.add_root_context("Base")
        builder.add_root_context("Lab")
        builder.build(monkeypatch)
        base = builder.get_root_context_path(0)
        ManifestBuilder.context(base, "Base", meta=True)
        news = base / "News"
        news.mkdir()
        ManifestBuilder.context(news, "News")
        Scanner(db, repos_path=builder.get_repos_path()).scan()

        assert "Other Ventures" not in WorkspaceService(db).get_orientation(str(news))

    def test_intermediate_parents_are_not_listed(self, tmp_path, db, monkeypatch) -> None:
        builder, _, lab = _lab(tmp_path, db, monkeypatch)
        deep = lab / "Deep"
        deep.mkdir()
        ManifestBuilder.context(deep, "Deep")
        Scanner(db, repos_path=builder.get_repos_path()).scan()

        answer = WorkspaceService(db).get_orientation(str(deep))

        assert "`@Deep` (active business folder)" in answer
        assert "`@Root` (parent venture folder)" in answer
        assert "@Lab" not in answer

    def test_folder_inside_business_gives_the_same_answer(self, tmp_path, db, monkeypatch) -> None:
        _, service, lab = _lab(tmp_path, db, monkeypatch)
        ticket = lab / "work" / "LAB001_Task"
        ticket.mkdir(parents=True)
        assert service.get_orientation(str(ticket)) == service.get_orientation(str(lab))

    def test_no_entry_point_means_no_step(self, tmp_path, db, monkeypatch) -> None:
        """Neither the venture nor the business has INDEX.md or README.md."""
        _, service, lab = _lab(tmp_path, db, monkeypatch)
        answer = service.get_orientation(str(lab))
        assert "Next immediate steps" not in answer
        assert answer.startswith("**Paths:**")

    def test_index_is_the_entry_point_without_readme(self, tmp_path, db, monkeypatch) -> None:
        _, service, lab = _lab(tmp_path, db, monkeypatch)
        (lab / "INDEX.md").write_text("# Lab", encoding="utf-8")
        answer = service.get_orientation(str(lab))
        assert f"* Read business entry point: `{lab / 'INDEX.md'}`" in answer
        assert "venture entry point" not in answer

    def test_declared_repo_is_listed_without_a_clone(self, tmp_path, db, monkeypatch) -> None:
        builder, service, lab = _lab(
            tmp_path, db, monkeypatch, git_repos={"NotCloned": "https://github.com/x/nc"}
        )
        expected = builder.get_repos_path() / "NotCloned.git"
        assert not expected.exists()
        assert f"* `@NotCloned.git` (git-repo): `{expected}`" in service.get_orientation(str(lab))

    def test_name_comes_from_manifest_not_folder(self, tmp_path, db, monkeypatch) -> None:
        builder = DuetDataBuilder(tmp_path)
        builder.add_root_context("Venture", folder_name="!Venture")
        builder.build(monkeypatch)
        Scanner(db).scan()
        root = builder.get_root_context_path(0)

        answer = WorkspaceService(db).get_orientation(str(root))

        assert f"* `@Venture` (active venture folder): `{root}`" in answer

class TestOrientationRepo:
    """The answer for a folder inside DuetData/repos."""

    def test_repo_declared_by_several_businesses(self, tmp_path, db, monkeypatch) -> None:
        builder, service, lab = _lab(
            tmp_path, db, monkeypatch, git_repos={"Duet": "https://github.com/x/duet"}
        )
        root = builder.get_root_context_path(0)
        other = root / "Other"
        reader = root / "Reader"
        other.mkdir()
        reader.mkdir()
        ManifestBuilder.context(other, "Other", git_repos={"Duet": "https://github.com/x/duet"})
        ManifestBuilder.context(reader, "Reader", reference_repos={"Duet": "https://github.com/x/duet"})
        result = Scanner(db, repos_path=builder.get_repos_path()).scan()
        assert result["errors"] == []
        repo = builder.get_repo_path("Duet")
        (repo / "README.md").write_text("# Duet", encoding="utf-8")
        duet_data = builder.duet_data_path.resolve()

        assert service.get_orientation(str(repo / "packages" / "backend")) == (
            "Not a business folder: this path is inside a git-repo.\n"
            "\n"
            "**Paths:**\n"
            f"* `@DuetData` (path to DuetData): `{duet_data}`\n"
            f"* `@Duet.git` (git-repo): `{repo}`\n"
            "\n"
            "**Declared by:**\n"
            f"* `@Lab` (business folder): `{lab}`\n"
            f"* `@Other` (business folder): `{other}`\n"
            f"* `@Reader` (business folder, read-only reference): `{reader}`\n"
            "\n"
            "**Next immediate steps:**\n"
            f"* Read git-repo entry point: `{repo / 'README.md'}`"
        )

    def test_repo_nobody_declares_and_without_readme(self, tmp_path, db, monkeypatch) -> None:
        builder, service, _ = _lab(tmp_path, db, monkeypatch)
        repo = builder.get_repo_path("Duet")
        answer = service.get_orientation(str(repo))

        assert answer.startswith(INSIDE_REPO)
        assert answer.endswith("**Declared by:**\nno business declares this repo")
        assert "Next immediate steps" not in answer

    def test_worktree_folder_stands_for_its_repo(self, tmp_path, db, monkeypatch) -> None:
        builder, service, _ = _lab(
            tmp_path, db, monkeypatch, git_repos={"Duet": "https://github.com/x/duet"}
        )
        worktree = builder.get_repos_path() / "Duet.wt-1"
        worktree.mkdir()
        answer = service.get_orientation(str(worktree))
        assert f"* `@Duet.git` (git-repo): `{builder.get_repo_path('Duet')}`" in answer
        assert "`@Lab` (business folder)" in answer


class TestOrientationOutside:
    """Folders that belong to no business and no repo."""

    def test_folder_outside_duet(self, tmp_path, db, monkeypatch) -> None:
        _, service, _ = _lab(tmp_path, db, monkeypatch)
        assert service.get_orientation("/some/random/path") == OUTSIDE_DUET
        assert OUTSIDE_DUET == "Not a business folder: this path is outside Duet."

    def test_repos_folder_itself(self, tmp_path, db, monkeypatch) -> None:
        builder, service, _ = _lab(tmp_path, db, monkeypatch)
        assert service.get_orientation(str(builder.get_repos_path())) == OUTSIDE_DUET

    def test_venture_folder_not_registered(self, tmp_path, db, monkeypatch) -> None:
        """Inside a venture folder, but the scan has not registered it yet."""
        builder = DuetDataBuilder(tmp_path)
        builder.add_root_context("Root")
        builder.build(monkeypatch)
        root = builder.get_root_context_path(0)
        assert WorkspaceService(db).get_orientation(str(root)) == NOT_REGISTERED


class TestScannerRelativePaths:
    """Tests that Scanner stores relative paths in drive_path."""

    def test_root_has_folder_name_path(
        self, tmp_path: Path, db: DatabaseManager, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        builder = DuetDataBuilder(tmp_path)
        builder.add_root_context("MyRoot")
        builder.build(monkeypatch)
        Scanner(db).scan()

        root = db.find_by_name("MyRoot")
        assert root is not None
        assert root.drive_path == "MyRoot"

    def test_nested_has_relative_path_with_prefix(
        self, tmp_path: Path, db: DatabaseManager, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        builder = DuetDataBuilder(tmp_path)
        builder.add_root_context("Root")
        builder.build(monkeypatch)

        root_path = builder.get_root_context_path(0)
        mid_path = root_path / "MyMid"
        mid_path.mkdir()
        ManifestBuilder.context(mid_path, "MyMid")
        Scanner(db).scan()

        mid = db.find_by_name("MyMid")
        assert mid is not None
        assert mid.drive_path == "Root/MyMid"

    def test_deep_path_is_relative_with_prefix(
        self, tmp_path: Path, db: DatabaseManager, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        builder = DuetDataBuilder(tmp_path)
        builder.add_root_context("Root")
        builder.build(monkeypatch)

        root_path = builder.get_root_context_path(0)

        s1_path = root_path / "Mid1"
        s1_path.mkdir()
        ManifestBuilder.context(s1_path, "Mid1")

        s2_path = s1_path / "Mid2"
        s2_path.mkdir()
        ManifestBuilder.context(s2_path, "Mid2")

        product_path = s2_path / "Product"
        product_path.mkdir()
        ManifestBuilder.context(product_path, "Product")
        Scanner(db).scan()

        product = db.find_by_name("Product")
        assert product is not None
        assert product.drive_path == "Root/Mid1/Mid2/Product"

    def test_multiple_root_contexts_unique_paths(
        self, tmp_path: Path, db: DatabaseManager, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        ctx1_path = tmp_path / "Ctx1"
        ctx1_path.mkdir()
        ManifestBuilder.context(ctx1_path, "Ctx1")

        ctx2_path = tmp_path / "Ctx2"
        ctx2_path.mkdir()
        ManifestBuilder.context(ctx2_path, "Ctx2")

        builder = DuetDataBuilder(tmp_path)
        builder.with_root_context_folders([str(ctx1_path), str(ctx2_path)])
        builder.build(monkeypatch)
        Scanner(db).scan()

        c1 = db.find_by_name("Ctx1")
        c2 = db.find_by_name("Ctx2")

        assert c1 is not None
        assert c2 is not None
        assert c1.drive_path == "Ctx1"
        assert c2.drive_path == "Ctx2"

    def test_product_repo_entity_created(
        self, tmp_path: Path, db: DatabaseManager, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        builder = DuetDataBuilder(tmp_path)
        builder.add_root_context("Root")
        builder.add_repo("Duet", components=[])
        builder.build(monkeypatch)

        root_path = builder.get_root_context_path(0)
        product_path = root_path / "Duet"
        product_path.mkdir()
        ManifestBuilder.context(product_path, "Duet", git_url="https://...")
        Scanner(db, repos_path=builder.get_repos_path()).scan()

        product = db.find_by_name("Duet")
        assert product is not None
        assert product.type == "context"

        repo = db.find_by_name("Duet.git")
        assert repo is not None
        assert repo.type == "product_repo"
        assert repo.parent_id == product.id

    def test_reference_repo_entity_created(
        self, tmp_path: Path, db: DatabaseManager, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        builder = DuetDataBuilder(tmp_path)
        builder.add_root_context("Root")
        builder.build(monkeypatch)

        root_path = builder.get_root_context_path(0)
        ctx_path = root_path / "Sub"
        ctx_path.mkdir()
        ManifestBuilder.context(
            ctx_path, "Sub",
            reference_repos={"cookbook": "https://github.com/anthropics/cookbook.git"},
        )
        Scanner(db).scan()

        ref = db.find_by_name("cookbook.git")
        assert ref is not None
        assert ref.type == "reference_repo"
        assert ref.git_url == "https://github.com/anthropics/cookbook.git"

class TestResolveBusinesses:
    """_resolve_businesses: one business for a window with several folders."""

    def _two_roots(self, tmp_path, db, monkeypatch, meta: bool):
        builder = DuetDataBuilder(tmp_path)
        builder.add_root_context("Regular")
        builder.add_root_context("Meta", meta=meta)
        builder.add_repo("Duet")
        builder.build(monkeypatch)
        Scanner(db, repos_path=builder.get_repos_path()).scan()
        regular = str(builder.get_root_context_path(0))
        other = str(builder.get_root_context_path(1))
        return builder, WorkspaceService(db), regular, other

    def test_meta_wins_over_first_come(self, tmp_path, db, monkeypatch) -> None:
        _, service, regular, meta = self._two_roots(tmp_path, db, monkeypatch, meta=True)
        assert service._resolve_businesses([regular, meta]).name == "Meta"

    def test_first_come_without_meta(self, tmp_path, db, monkeypatch) -> None:
        _, service, a, b = self._two_roots(tmp_path, db, monkeypatch, meta=False)
        assert service._resolve_businesses([a, b]).name == "Regular"
        assert service._resolve_businesses([b, a]).name == "Meta"

    def test_repo_folder_is_skipped(self, tmp_path, db, monkeypatch) -> None:
        builder, service, regular, _ = self._two_roots(tmp_path, db, monkeypatch, meta=False)
        repo = str(builder.get_repo_path("Duet"))
        assert service._resolve_businesses([repo, regular]).name == "Regular"
        assert service._resolve_businesses([repo]) is None

    def test_none_when_nothing_resolves(self, db) -> None:
        assert WorkspaceService(db)._resolve_businesses(["/nowhere/at/all"]) is None
        assert WorkspaceService(db)._resolve_businesses([]) is None


class TestDeployInstructionsService:
    """Tests for WorkspaceService.deploy_instructions — context resolution + report."""

    def test_unknown_when_no_paths(self, tmp_path, db, monkeypatch):
        service = WorkspaceService(db)
        result = service.deploy_instructions([])
        assert result == {"status": "unknown", "reason": "no_owning_context"}

    def test_deploys_for_resolved_context(self, tmp_path, db, monkeypatch):
        builder = DuetDataBuilder(tmp_path)
        builder.add_root_context("Root")
        builder.build(monkeypatch)
        root_path = builder.get_root_context_path(0)
        ctx_path = root_path / "Proj"
        ctx_path.mkdir()
        skill = ctx_path / "_src" / "myskill"
        skill.mkdir(parents=True)
        (skill / "SKILL.md").write_text("# myskill", encoding="utf-8")
        ManifestBuilder.context(ctx_path, "Proj", skills=["@Proj/_src/myskill"], instructions=[])
        Scanner(db, repos_path=builder.get_repos_path()).scan()

        service = WorkspaceService(db)
        result = service.deploy_instructions([str(ctx_path)])

        assert result["status"] == "ok"
        assert "myskill" in result["deployed"]["skills_deployed"]
        assert (ctx_path / ".claude" / "skills" / "myskill" / "SKILL.md").is_file()
        # instructions always generated from the real per-client templates
        assert (ctx_path / ".claude" / "CLAUDE.md").is_file()
        assert (ctx_path / ".kimi-code" / "AGENTS.md").is_file()
        assert (ctx_path / ".agents" / "rules" / "gemini.md").is_file()

    def test_repo_folder_chooses_no_business(self, tmp_path, db, monkeypatch):
        """A window with only a repo folder deploys nothing: the repo may be shared."""
        builder, service, _ = _lab(
            tmp_path, db, monkeypatch, git_repos={"Duet": "https://github.com/x/duet"}
        )
        result = service.deploy_instructions([str(builder.get_repo_path("Duet"))])
        assert result == {"status": "unknown", "reason": "no_owning_context"}


class TestOrientationMcpTool:
    """The MCP tool takes one folder and returns the service's text unchanged."""

    def test_tool_returns_text(self, tmp_path, db, monkeypatch) -> None:
        import time

        from mcp_handler import init_services, orientation, reset_services
        from services.entities import EntitiesService

        _, service, lab = _lab(tmp_path, db, monkeypatch)
        init_services(service, EntitiesService(db), time.time())
        try:
            assert orientation(str(lab)) == service.get_orientation(str(lab))
            assert orientation("/some/random/path") == OUTSIDE_DUET
        finally:
            reset_services()

    @pytest.mark.parametrize("path", ["", "work/DUE013", "~/DuetData"])
    def test_tool_refuses_a_path_that_is_not_absolute(self, path) -> None:
        # A relative path would be resolved against the backend's own folder.
        from mcp.shared.exceptions import McpError

        from mcp_handler import orientation

        with pytest.raises(McpError):
            orientation(path)
