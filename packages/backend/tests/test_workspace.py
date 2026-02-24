"""Tests for WorkspaceService - resolve_entity and get_workspace_info."""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

import config
from db import DatabaseManager
from scanner import Scanner
from services.workspace import WorkspaceService

from tests.fixtures import DuetDataBuilder, ManifestBuilder, HierarchyBuilder


class TestResolveEntity:
    """Tests for WorkspaceService._resolve_entity method."""

    def test_resolve_from_repos_simple(
        self, tmp_path: Path, db: DatabaseManager, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Resolves entity from repos path by product name."""
        # Setup: Create DuetData with repos and business with product
        builder = DuetDataBuilder(tmp_path)
        builder.add_business("Business")
        builder.add_repo("Duet", components=["extension", "backend"])
        duet_data = builder.build(monkeypatch)

        # Create product in business that matches repo name
        biz_path = builder.get_business_path(0)
        product_path = biz_path / "Duet"
        product_path.mkdir()
        ManifestBuilder.product(product_path, "Duet", git_url="https://github.com/...")
        scanner = Scanner(db, repos_path=builder.get_repos_path())
        scanner.scan()

        # Test
        service = WorkspaceService(db)
        repo_workspace = str(builder.get_repo_path("Duet"))

        entity = service._resolve_entity(repo_workspace)

        assert entity is not None
        assert entity.name == "Duet"
        assert entity.type == "product"

    def test_resolve_from_repos_with_subpath(
        self, tmp_path: Path, db: DatabaseManager, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Resolves entity from repos subpath (e.g., /repos/Duet.git/packages/ext)."""
        builder = DuetDataBuilder(tmp_path)
        builder.add_business("Business")
        builder.add_repo("Duet", components=["extension"])
        duet_data = builder.build(monkeypatch)

        # Create product
        biz_path = builder.get_business_path(0)
        product_path = biz_path / "Duet"
        product_path.mkdir()
        ManifestBuilder.product(product_path, "Duet")
        scanner = Scanner(db, repos_path=builder.get_repos_path())
        scanner.scan()

        service = WorkspaceService(db)
        # Subpath inside repo
        subpath = str(builder.get_repo_path("Duet") / "packages" / "extension")

        entity = service._resolve_entity(subpath)

        assert entity is not None
        assert entity.name == "Duet"
        assert entity.type == "product"

    def test_resolve_from_repos_strips_git_suffix(
        self, tmp_path: Path, db: DatabaseManager, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Strips .git suffix when resolving from repos."""
        builder = DuetDataBuilder(tmp_path)
        builder.add_business("Business")
        builder.add_repo("MyProduct", components=[])
        duet_data = builder.build(monkeypatch)

        biz_path = builder.get_business_path(0)
        product_path = biz_path / "MyProduct"
        product_path.mkdir()
        ManifestBuilder.product(product_path, "MyProduct")
        scanner = Scanner(db, repos_path=builder.get_repos_path())
        scanner.scan()

        service = WorkspaceService(db)
        # Path with .git suffix
        workspace = str(builder.get_repos_path() / "MyProduct.git")

        entity = service._resolve_entity(workspace)

        assert entity is not None
        assert entity.name == "MyProduct"

    def test_resolve_from_drive_simple(
        self, tmp_path: Path, db: DatabaseManager, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Resolves entity from Google Drive path."""
        builder = DuetDataBuilder(tmp_path)
        builder.add_business("Business")
        duet_data = builder.build(monkeypatch)

        biz_path = builder.get_business_path(0)

        # Create stream and product inside business
        stream_path = biz_path / "Stream"
        stream_path.mkdir()
        ManifestBuilder.stream(stream_path, "Stream")

        product_path = stream_path / "Product"
        product_path.mkdir()
        ManifestBuilder.product(product_path, "Product")
        scanner = Scanner(db)
        scanner.scan()

        service = WorkspaceService(db)

        # Resolve product path
        entity = service._resolve_entity(str(product_path))

        assert entity is not None
        assert entity.name == "Product"
        assert entity.type == "product"

    def test_resolve_from_drive_finds_closest(
        self, tmp_path: Path, db: DatabaseManager, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Finds closest (deepest) entity when resolving from drive."""
        builder = DuetDataBuilder(tmp_path)
        builder.add_business("Business")
        duet_data = builder.build(monkeypatch)

        biz_path = builder.get_business_path(0)
        stream_path = biz_path / "Stream"
        stream_path.mkdir()
        ManifestBuilder.stream(stream_path, "Stream")
        scanner = Scanner(db)
        scanner.scan()

        service = WorkspaceService(db)

        # Path deeper than stream (no entity there)
        deep_path = str(stream_path / "some" / "deep" / "folder")

        entity = service._resolve_entity(deep_path)

        # Should find Stream as closest ancestor
        assert entity is not None
        assert entity.name == "Stream"
        assert entity.type == "stream"

    def test_resolve_unknown_path_returns_none(
        self, tmp_path: Path, db: DatabaseManager, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Returns None for paths not in business_folders or repos."""
        builder = DuetDataBuilder(tmp_path)
        builder.add_business("Business")
        duet_data = builder.build(monkeypatch)
        scanner = Scanner(db)
        scanner.scan()

        service = WorkspaceService(db)

        # Random path not in any known location
        entity = service._resolve_entity("/some/random/path")

        assert entity is None

    def test_resolve_business_root(
        self, tmp_path: Path, db: DatabaseManager, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Resolves entity when path is exactly the business folder."""
        builder = DuetDataBuilder(tmp_path)
        builder.add_business("MyBusiness")
        duet_data = builder.build(monkeypatch)
        scanner = Scanner(db)
        scanner.scan()

        service = WorkspaceService(db)
        entity = service._resolve_entity(str(builder.get_business_path(0)))

        assert entity is not None
        assert entity.name == "MyBusiness"
        assert entity.type == "business"


class TestStripRepoSuffixes:
    """Tests for WorkspaceService._strip_repo_suffixes method."""

    def test_strips_git_suffix(self, db: DatabaseManager) -> None:
        """Strips .git suffix."""
        service = WorkspaceService(db)
        assert service._strip_repo_suffixes("Duet.git") == "Duet"

    def test_strips_worktree_suffix(self, db: DatabaseManager) -> None:
        """Strips .wt-* worktree suffix."""
        service = WorkspaceService(db)
        assert service._strip_repo_suffixes("Duet.wt-feature") == "Duet"
        assert service._strip_repo_suffixes("Duet.wt-feature-123") == "Duet"

    def test_no_suffix(self, db: DatabaseManager) -> None:
        """Returns as-is when no suffix."""
        service = WorkspaceService(db)
        assert service._strip_repo_suffixes("Duet") == "Duet"


class TestGetWorkspaceInfo:
    """Tests for WorkspaceService.get_workspace_info method (v2 format)."""

    def test_returns_duet_paths_without_workspace_path(
        self, tmp_path: Path, db: DatabaseManager, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Returns duet_paths and status=unknown without workspace_path."""
        builder = DuetDataBuilder(tmp_path)
        duet_data = builder.build(monkeypatch)

        service = WorkspaceService(db)
        result = service.get_workspace_info()

        assert result["status"] == "unknown"
        assert result["reason"] == "no_workspace_path"
        # duet_paths always present
        assert "duet_paths" in result
        assert "duetDataPath" in result["duet_paths"]
        assert "machineConfig" in result["duet_paths"]
        assert "instructionsPath" in result["duet_paths"]
        # No workspace-specific fields
        assert "context" not in result
        assert "workspace_paths" not in result

    def test_returns_context_for_repos_path(
        self, tmp_path: Path, db: DatabaseManager, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Returns context with chain when workspace_path is in repos."""
        builder = DuetDataBuilder(tmp_path)
        builder.add_business("Business")
        builder.add_repo("Duet", components=["extension", "backend"])
        duet_data = builder.build(monkeypatch)

        biz_path = builder.get_business_path(0)
        stream_path = biz_path / "Stream"
        stream_path.mkdir()
        ManifestBuilder.stream(stream_path, "Stream")

        product_path = stream_path / "Duet"
        product_path.mkdir()
        ManifestBuilder.product(product_path, "Duet")
        scanner = Scanner(db, repos_path=builder.get_repos_path())
        scanner.scan()

        service = WorkspaceService(db)
        repo_path = str(builder.get_repo_path("Duet"))

        result = service.get_workspace_info(repo_path)

        # Status found
        assert result["status"] == "found"
        assert "reason" not in result

        # Context with chain
        context = result["context"]
        assert len(context["chain"]) == 3
        assert context["chain"][0]["name"] == "Business"
        assert context["chain"][0]["type"] == "business"
        assert context["chain"][1]["name"] == "Stream"
        assert context["chain"][1]["type"] == "stream"
        assert context["chain"][2]["name"] == "Duet"
        assert context["chain"][2]["type"] == "product"

        # Chain items have no id or path
        assert "id" not in context["chain"][0]
        assert "path" not in context["chain"][0]

        # Breadcrumb
        assert context["breadcrumb"] == "Business / Stream / Duet"

    def test_returns_components_for_product(
        self, tmp_path: Path, db: DatabaseManager, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Returns components when workspace is a product with packages/."""
        builder = DuetDataBuilder(tmp_path)
        builder.add_business("Business")
        builder.add_repo("Duet", components=["extension", "backend"])
        duet_data = builder.build(monkeypatch)

        biz_path = builder.get_business_path(0)
        product_path = biz_path / "Duet"
        product_path.mkdir()
        ManifestBuilder.product(product_path, "Duet")
        scanner = Scanner(db, repos_path=builder.get_repos_path())
        scanner.scan()

        service = WorkspaceService(db)
        repo_path = str(builder.get_repo_path("Duet"))

        result = service.get_workspace_info(repo_path)

        # Should have components from repos/Duet.git/packages/
        assert len(result["components"]) == 2
        names = {c["name"] for c in result["components"]}
        assert names == {"extension", "backend"}

    def test_status_unknown_for_unknown_path(
        self, tmp_path: Path, db: DatabaseManager, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Returns status=unknown for unknown workspace path."""
        builder = DuetDataBuilder(tmp_path)
        builder.add_business("Business")
        duet_data = builder.build(monkeypatch)
        scanner = Scanner(db)
        scanner.scan()

        service = WorkspaceService(db)

        result = service.get_workspace_info("/unknown/path")

        assert result["status"] == "unknown"
        assert result["reason"] == "path_not_in_hierarchy"
        assert "context" not in result
        assert "workspace_paths" not in result

    def test_status_entity_not_in_db(
        self, tmp_path: Path, db: DatabaseManager, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Returns entity_not_in_db when path is in hierarchy but entity not found."""
        builder = DuetDataBuilder(tmp_path)
        builder.add_business("Business")
        duet_data = builder.build(monkeypatch)
        # Don't scan -- DB is empty

        service = WorkspaceService(db)
        biz_path = str(builder.get_business_path(0))

        result = service.get_workspace_info(biz_path)

        assert result["status"] == "unknown"
        assert result["reason"] == "entity_not_in_db"

    def test_status_found_has_no_reason(
        self, tmp_path: Path, db: DatabaseManager, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Status 'found' does not include reason field."""
        builder = DuetDataBuilder(tmp_path)
        builder.add_business("Business")
        duet_data = builder.build(monkeypatch)
        scanner = Scanner(db)
        scanner.scan()

        service = WorkspaceService(db)
        biz_path = str(builder.get_business_path(0))

        result = service.get_workspace_info(biz_path)

        assert result["status"] == "found"
        assert "reason" not in result

    def test_workspace_type_product_with_git(
        self, tmp_path: Path, db: DatabaseManager, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Product with git_url -> workspace_type = product_folder_with_git_repo."""
        builder = DuetDataBuilder(tmp_path)
        builder.add_business("Business")
        builder.add_repo("Duet", components=[])
        duet_data = builder.build(monkeypatch)

        biz_path = builder.get_business_path(0)
        product_path = biz_path / "Duet"
        product_path.mkdir()
        ManifestBuilder.product(product_path, "Duet", git_url="https://github.com/...")
        scanner = Scanner(db, repos_path=builder.get_repos_path())
        scanner.scan()

        service = WorkspaceService(db)
        repo_path = str(builder.get_repo_path("Duet"))

        result = service.get_workspace_info(repo_path)

        ws = result["workspace_paths"]
        assert ws["workspace_type"] == "product_folder_with_git_repo"
        assert ws["main_folder"] == str(builder.get_repo_path("Duet"))
        # projects_folder is on drive
        assert "projects_folder" in ws
        assert ws["projects_folder"] == str(product_path / "projects")

    def test_workspace_type_business(
        self, tmp_path: Path, db: DatabaseManager, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Business -> workspace_type = business_folder, no projects_folder."""
        builder = DuetDataBuilder(tmp_path)
        builder.add_business("Business")
        duet_data = builder.build(monkeypatch)
        scanner = Scanner(db)
        scanner.scan()

        service = WorkspaceService(db)
        biz_path = str(builder.get_business_path(0))

        result = service.get_workspace_info(biz_path)

        ws = result["workspace_paths"]
        assert ws["workspace_type"] == "business_folder"
        assert "projects_folder" not in ws

    def test_workspace_type_stream(
        self, tmp_path: Path, db: DatabaseManager, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Stream -> workspace_type = stream_folder, has projects_folder."""
        builder = DuetDataBuilder(tmp_path)
        builder.add_business("Business")
        duet_data = builder.build(monkeypatch)

        biz_path = builder.get_business_path(0)
        stream_path = biz_path / "Stream"
        stream_path.mkdir()
        ManifestBuilder.stream(stream_path, "Stream")
        scanner = Scanner(db)
        scanner.scan()

        service = WorkspaceService(db)

        result = service.get_workspace_info(str(stream_path))

        ws = result["workspace_paths"]
        assert ws["workspace_type"] == "stream_folder"
        assert ws["projects_folder"] == str(stream_path / "projects")

    def test_workspace_type_project(
        self, tmp_path: Path, db: DatabaseManager, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Project -> workspace_type = project_folder, no projects_folder."""
        builder = DuetDataBuilder(tmp_path)
        builder.add_business("Business")
        duet_data = builder.build(monkeypatch)

        # Create project inside business/projects/
        biz_path = builder.get_business_path(0)
        projects_dir = biz_path / "projects"
        projects_dir.mkdir()
        project_path = projects_dir / "WIP_my_project"
        project_path.mkdir()

        scanner = Scanner(db)
        scanner.scan()

        service = WorkspaceService(db)
        result = service.get_workspace_info(str(project_path))

        assert result["status"] == "found"
        ws = result["workspace_paths"]
        assert ws["workspace_type"] == "project_folder"
        assert "projects_folder" not in ws

        # Chain includes business and project
        chain = result["context"]["chain"]
        assert chain[0]["type"] == "business"
        assert chain[-1]["type"] == "project"

    def test_workspace_type_product_without_git(
        self, tmp_path: Path, db: DatabaseManager, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Product without git_url -> workspace_type = product_folder."""
        builder = DuetDataBuilder(tmp_path)
        builder.add_business("Business")
        duet_data = builder.build(monkeypatch)

        biz_path = builder.get_business_path(0)
        product_path = biz_path / "Duet"
        product_path.mkdir()
        ManifestBuilder.product(product_path, "Duet")  # no git_url
        scanner = Scanner(db)
        scanner.scan()

        service = WorkspaceService(db)
        result = service.get_workspace_info(str(product_path))

        ws = result["workspace_paths"]
        assert ws["workspace_type"] == "product_folder"
        assert ws["main_folder"] == str(product_path)

    def test_components_absent_for_business(
        self, tmp_path: Path, db: DatabaseManager, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """components field absent when workspace is business (no product in chain)."""
        builder = DuetDataBuilder(tmp_path)
        builder.add_business("Business")
        duet_data = builder.build(monkeypatch)
        scanner = Scanner(db)
        scanner.scan()

        service = WorkspaceService(db)
        result = service.get_workspace_info(str(builder.get_business_path(0)))

        assert result["status"] == "found"
        assert "components" not in result

    def test_components_absent_for_stream(
        self, tmp_path: Path, db: DatabaseManager, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """components field absent when workspace is stream (no product in chain)."""
        builder = DuetDataBuilder(tmp_path)
        builder.add_business("Business")
        duet_data = builder.build(monkeypatch)

        biz_path = builder.get_business_path(0)
        stream_path = biz_path / "Stream"
        stream_path.mkdir()
        ManifestBuilder.stream(stream_path, "Stream")
        scanner = Scanner(db)
        scanner.scan()

        service = WorkspaceService(db)
        result = service.get_workspace_info(str(stream_path))

        assert result["status"] == "found"
        assert "components" not in result

    def test_key_files_with_only_readme(
        self, tmp_path: Path, db: DatabaseManager, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """key_files includes only readme when spec is absent."""
        builder = DuetDataBuilder(tmp_path)
        builder.add_business("Business")
        duet_data = builder.build(monkeypatch)

        biz_path = builder.get_business_path(0)
        (biz_path / "README.md").write_text("# Business", encoding="utf-8")
        scanner = Scanner(db)
        scanner.scan()

        service = WorkspaceService(db)
        result = service.get_workspace_info(str(biz_path))

        assert "key_files" in result
        assert "readme" in result["key_files"]
        assert "spec" not in result["key_files"]

    def test_key_files_with_only_spec(
        self, tmp_path: Path, db: DatabaseManager, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """key_files includes only spec when readme is absent."""
        builder = DuetDataBuilder(tmp_path)
        builder.add_business("Business")
        duet_data = builder.build(monkeypatch)

        biz_path = builder.get_business_path(0)
        spec_dir = biz_path / "spec"
        spec_dir.mkdir()
        (spec_dir / "BUSINESS.md").write_text("# Business", encoding="utf-8")
        scanner = Scanner(db)
        scanner.scan()

        service = WorkspaceService(db)
        result = service.get_workspace_info(str(biz_path))

        assert "key_files" in result
        assert "spec" in result["key_files"]
        assert "readme" not in result["key_files"]

    def test_key_files_with_spec_and_readme(
        self, tmp_path: Path, db: DatabaseManager, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """key_files includes spec and readme when they exist."""
        builder = DuetDataBuilder(tmp_path)
        builder.add_business("Business")
        builder.add_repo("Duet", components=[])
        duet_data = builder.build(monkeypatch)

        biz_path = builder.get_business_path(0)
        product_path = biz_path / "Duet"
        product_path.mkdir()
        ManifestBuilder.product(product_path, "Duet", git_url="https://...")
        scanner = Scanner(db, repos_path=builder.get_repos_path())
        scanner.scan()

        # Create spec and readme in repo
        repo_path = builder.get_repo_path("Duet")
        spec_dir = repo_path / "spec"
        spec_dir.mkdir()
        (spec_dir / "PRODUCT.md").write_text("# Duet\n\nSome description.", encoding="utf-8")
        (repo_path / "README.md").write_text("# Duet\n\nReadme text.", encoding="utf-8")

        service = WorkspaceService(db)
        result = service.get_workspace_info(str(repo_path))

        assert "key_files" in result
        assert result["key_files"]["spec"] == str(spec_dir / "PRODUCT.md")
        assert result["key_files"]["readme"] == str(repo_path / "README.md")

    def test_key_files_absent_when_no_files(
        self, tmp_path: Path, db: DatabaseManager, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """key_files absent when neither spec nor readme exist."""
        builder = DuetDataBuilder(tmp_path)
        builder.add_business("Business")
        duet_data = builder.build(monkeypatch)
        scanner = Scanner(db)
        scanner.scan()

        service = WorkspaceService(db)
        biz_path = str(builder.get_business_path(0))

        result = service.get_workspace_info(biz_path)

        assert "key_files" not in result

    def test_chain_includes_description_from_readme(
        self, tmp_path: Path, db: DatabaseManager, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Chain entities include description from README.md."""
        builder = DuetDataBuilder(tmp_path)
        builder.add_business("Business")
        duet_data = builder.build(monkeypatch)

        biz_path = builder.get_business_path(0)
        # Write README with description
        (biz_path / "README.md").write_text(
            "# Business\n\nThis is the business description.",
            encoding="utf-8",
        )
        scanner = Scanner(db)
        scanner.scan()

        service = WorkspaceService(db)
        result = service.get_workspace_info(str(biz_path))

        chain = result["context"]["chain"]
        assert chain[0]["description"] == "This is the business description."

    def test_chain_omits_description_when_no_readme(
        self, tmp_path: Path, db: DatabaseManager, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Chain entities have no description field when README is absent."""
        builder = DuetDataBuilder(tmp_path)
        builder.add_business("Business")
        duet_data = builder.build(monkeypatch)
        scanner = Scanner(db)
        scanner.scan()

        service = WorkspaceService(db)
        result = service.get_workspace_info(str(builder.get_business_path(0)))

        chain = result["context"]["chain"]
        assert "description" not in chain[0]

    def test_components_with_spec_and_description(
        self, tmp_path: Path, db: DatabaseManager, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Components include spec path and description from COMPONENT.md."""
        builder = DuetDataBuilder(tmp_path)
        builder.add_business("Business")
        builder.add_repo("Duet", components=["backend"])
        duet_data = builder.build(monkeypatch)

        biz_path = builder.get_business_path(0)
        product_path = biz_path / "Duet"
        product_path.mkdir()
        ManifestBuilder.product(product_path, "Duet")
        scanner = Scanner(db, repos_path=builder.get_repos_path())
        scanner.scan()

        # Create COMPONENT.md in backend spec/
        repo_path = builder.get_repo_path("Duet")
        spec_dir = repo_path / "packages" / "backend" / "spec"
        spec_dir.mkdir(parents=True)
        (spec_dir / "COMPONENT.md").write_text(
            "# Backend\n\nPython HTTP backend for Duet.",
            encoding="utf-8",
        )

        service = WorkspaceService(db)
        result = service.get_workspace_info(str(repo_path))

        assert len(result["components"]) == 1
        comp = result["components"][0]
        assert comp["name"] == "backend"
        assert comp["spec"] == "packages/backend/spec/COMPONENT.md"
        assert comp["description"] == "Python HTTP backend for Duet."

    def test_spec_fallback_chain(
        self, tmp_path: Path, db: DatabaseManager, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Spec fallback: ARCHITECTURE.md found when COMPONENT.md absent."""
        builder = DuetDataBuilder(tmp_path)
        builder.add_business("Business")
        builder.add_repo("Duet", components=["ext"])
        duet_data = builder.build(monkeypatch)

        biz_path = builder.get_business_path(0)
        product_path = biz_path / "Duet"
        product_path.mkdir()
        ManifestBuilder.product(product_path, "Duet")
        scanner = Scanner(db, repos_path=builder.get_repos_path())
        scanner.scan()

        # Only ARCHITECTURE.md, no COMPONENT.md
        repo_path = builder.get_repo_path("Duet")
        spec_dir = repo_path / "packages" / "ext" / "spec"
        spec_dir.mkdir(parents=True)
        (spec_dir / "ARCHITECTURE.md").write_text(
            "# Architecture\n\n## Overview\n\nSome arch.",
            encoding="utf-8",
        )

        service = WorkspaceService(db)
        result = service.get_workspace_info(str(repo_path))

        comp = result["components"][0]
        assert comp["spec"] == "packages/ext/spec/ARCHITECTURE.md"
        # Description = H1 text (since next content is ## not paragraph)
        assert comp["description"] == "Architecture"


class TestScannerRelativePaths:
    """Tests that Scanner stores relative paths in drive_path.

    Path format: {business_folder_name}/{relative_path}
    This ensures uniqueness across multiple business_folders.
    """

    def test_business_has_folder_name_path(
        self, tmp_path: Path, db: DatabaseManager, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Business entity has drive_path = folder name (for uniqueness)."""
        builder = DuetDataBuilder(tmp_path)
        builder.add_business("MyBusiness")
        duet_data = builder.build(monkeypatch)
        scanner = Scanner(db)
        scanner.scan()

        business = db.find_by_name("MyBusiness")
        assert business is not None
        # drive_path = business folder name
        assert business.drive_path == "MyBusiness"

    def test_stream_has_relative_path_with_prefix(
        self, tmp_path: Path, db: DatabaseManager, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Stream entity has path: {business_folder_name}/{stream_name}."""
        builder = DuetDataBuilder(tmp_path)
        builder.add_business("Business")
        duet_data = builder.build(monkeypatch)

        biz_path = builder.get_business_path(0)
        stream_path = biz_path / "MyStream"
        stream_path.mkdir()
        ManifestBuilder.stream(stream_path, "MyStream")
        scanner = Scanner(db)
        scanner.scan()

        stream = db.find_by_name("MyStream")
        assert stream is not None
        # drive_path = {business_folder_name}/{stream_name}
        assert stream.drive_path == "Business/MyStream"

    def test_deep_path_is_relative_with_prefix(
        self, tmp_path: Path, db: DatabaseManager, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Deep nested entity has path: {business_folder_name}/Stream1/Stream2/Product."""
        builder = DuetDataBuilder(tmp_path)
        builder.add_business("Business")
        duet_data = builder.build(monkeypatch)

        biz_path = builder.get_business_path(0)

        # Create: Business/Stream1/Stream2/Product
        stream1_path = biz_path / "Stream1"
        stream1_path.mkdir()
        ManifestBuilder.stream(stream1_path, "Stream1")

        stream2_path = stream1_path / "Stream2"
        stream2_path.mkdir()
        ManifestBuilder.stream(stream2_path, "Stream2")

        product_path = stream2_path / "Product"
        product_path.mkdir()
        ManifestBuilder.product(product_path, "Product")
        scanner = Scanner(db)
        scanner.scan()

        product = db.find_by_name("Product")
        assert product is not None
        assert product.drive_path == "Business/Stream1/Stream2/Product"

    def test_project_from_drive_has_relative_path_with_prefix(
        self, tmp_path: Path, db: DatabaseManager, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Project from drive has path: {business_folder_name}/Product/projects/MyProject."""
        builder = DuetDataBuilder(tmp_path)
        builder.add_business("Business")
        duet_data = builder.build(monkeypatch)

        biz_path = builder.get_business_path(0)
        product_path = biz_path / "Product"
        product_path.mkdir()
        ManifestBuilder.product(product_path, "Product")

        projects_path = product_path / "projects"
        projects_path.mkdir()
        (projects_path / "MyProject").mkdir()
        scanner = Scanner(db)
        scanner.scan()

        project = db.find_by_name("MyProject")
        assert project is not None
        assert project.drive_path == "Business/Product/projects/MyProject"

    def test_project_from_repos_has_relative_path(
        self, tmp_path: Path, db: DatabaseManager, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Project from repos has path relative to repos_path."""
        builder = DuetDataBuilder(tmp_path)
        builder.add_business("Business")
        builder.add_repo("Duet", components=[])
        duet_data = builder.build(monkeypatch)

        # Create product in business
        biz_path = builder.get_business_path(0)
        product_path = biz_path / "Duet"
        product_path.mkdir()
        ManifestBuilder.product(product_path, "Duet")

        # Create project in repos
        repo_path = builder.get_repo_path("Duet")
        projects_path = repo_path / "projects"
        projects_path.mkdir()
        (projects_path / "260117_design").mkdir()
        scanner = Scanner(db, repos_path=builder.get_repos_path())
        scanner.scan()

        project = db.find_by_name("260117_design")
        assert project is not None
        # Path relative to repos_path
        assert project.drive_path == "Duet.git/projects/260117_design"

    def test_multiple_business_folders_unique_paths(
        self, tmp_path: Path, db: DatabaseManager, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Multiple business_folders have unique drive_paths."""
        # Create two business folders manually
        biz1_path = tmp_path / "Business1"
        biz1_path.mkdir()
        ManifestBuilder.business(biz1_path, "Business1")

        biz2_path = tmp_path / "Business2"
        biz2_path.mkdir()
        ManifestBuilder.business(biz2_path, "Business2")

        # Create config with both business folders
        builder = DuetDataBuilder(tmp_path)
        builder.with_business_folders([str(biz1_path), str(biz2_path)])
        duet_data = builder.build(monkeypatch)
        scanner = Scanner(db)
        scanner.scan()

        biz1 = db.find_by_name("Business1")
        biz2 = db.find_by_name("Business2")

        assert biz1 is not None
        assert biz2 is not None
        # Each has unique drive_path = folder name
        assert biz1.drive_path == "Business1"
        assert biz2.drive_path == "Business2"
