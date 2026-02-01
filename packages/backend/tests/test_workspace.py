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
        self, tmp_path: Path, db: DatabaseManager
    ) -> None:
        """Resolves entity from repos path by product name."""
        # Setup: Create DuetData with repos and business with product
        builder = DuetDataBuilder(tmp_path)
        builder.add_business("Business")
        builder.add_repo("Duet", components=["extension", "backend"])
        duet_data = builder.build()

        # Create product in business that matches repo name
        biz_path = builder.get_business_path(0)
        product_path = biz_path / "Duet"
        product_path.mkdir()
        ManifestBuilder.product(product_path, "Duet", git_url="https://github.com/...")

        # Re-init config and scan
        config.init(duet_data)
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
        self, tmp_path: Path, db: DatabaseManager
    ) -> None:
        """Resolves entity from repos subpath (e.g., /repos/Duet.git/packages/ext)."""
        builder = DuetDataBuilder(tmp_path)
        builder.add_business("Business")
        builder.add_repo("Duet", components=["extension"])
        duet_data = builder.build()

        # Create product
        biz_path = builder.get_business_path(0)
        product_path = biz_path / "Duet"
        product_path.mkdir()
        ManifestBuilder.product(product_path, "Duet")

        config.init(duet_data)
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
        self, tmp_path: Path, db: DatabaseManager
    ) -> None:
        """Strips .git suffix when resolving from repos."""
        builder = DuetDataBuilder(tmp_path)
        builder.add_business("Business")
        builder.add_repo("MyProduct", components=[])
        duet_data = builder.build()

        biz_path = builder.get_business_path(0)
        product_path = biz_path / "MyProduct"
        product_path.mkdir()
        ManifestBuilder.product(product_path, "MyProduct")

        config.init(duet_data)
        scanner = Scanner(db, repos_path=builder.get_repos_path())
        scanner.scan()

        service = WorkspaceService(db)
        # Path with .git suffix
        workspace = str(builder.get_repos_path() / "MyProduct.git")

        entity = service._resolve_entity(workspace)

        assert entity is not None
        assert entity.name == "MyProduct"

    def test_resolve_from_drive_simple(
        self, tmp_path: Path, db: DatabaseManager
    ) -> None:
        """Resolves entity from Google Drive path."""
        builder = DuetDataBuilder(tmp_path)
        builder.add_business("Business")
        duet_data = builder.build()

        biz_path = builder.get_business_path(0)

        # Create stream and product inside business
        stream_path = biz_path / "Stream"
        stream_path.mkdir()
        ManifestBuilder.stream(stream_path, "Stream")

        product_path = stream_path / "Product"
        product_path.mkdir()
        ManifestBuilder.product(product_path, "Product")

        config.init(duet_data)
        scanner = Scanner(db)
        scanner.scan()

        service = WorkspaceService(db)

        # Resolve product path
        entity = service._resolve_entity(str(product_path))

        assert entity is not None
        assert entity.name == "Product"
        assert entity.type == "product"

    def test_resolve_from_drive_finds_closest(
        self, tmp_path: Path, db: DatabaseManager
    ) -> None:
        """Finds closest (deepest) entity when resolving from drive."""
        builder = DuetDataBuilder(tmp_path)
        builder.add_business("Business")
        duet_data = builder.build()

        biz_path = builder.get_business_path(0)
        stream_path = biz_path / "Stream"
        stream_path.mkdir()
        ManifestBuilder.stream(stream_path, "Stream")

        config.init(duet_data)
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
        self, tmp_path: Path, db: DatabaseManager
    ) -> None:
        """Returns None for paths not in business_folders or repos."""
        builder = DuetDataBuilder(tmp_path)
        builder.add_business("Business")
        duet_data = builder.build()

        config.init(duet_data)
        scanner = Scanner(db)
        scanner.scan()

        service = WorkspaceService(db)

        # Random path not in any known location
        entity = service._resolve_entity("/some/random/path")

        assert entity is None

    def test_resolve_business_root(
        self, tmp_path: Path, db: DatabaseManager
    ) -> None:
        """Resolves entity when path is exactly the business folder."""
        builder = DuetDataBuilder(tmp_path)
        builder.add_business("MyBusiness")
        duet_data = builder.build()

        config.init(duet_data)
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
    """Tests for WorkspaceService.get_workspace_info method."""

    def test_returns_base_info_without_path(
        self, tmp_path: Path, db: DatabaseManager
    ) -> None:
        """Returns duetDataPath and instructionsPath without workspace_path."""
        builder = DuetDataBuilder(tmp_path)
        duet_data = builder.build()

        config.init(duet_data)

        service = WorkspaceService(db)
        result = service.get_workspace_info()

        assert "duetDataPath" in result
        assert "instructionsPath" in result
        assert result["chain"] == []
        assert result["components"] == []
        assert result["status"] == "unknown"
        assert result["reason"] == "no_workspace_path"

    def test_returns_chain_for_repos_path(
        self, tmp_path: Path, db: DatabaseManager
    ) -> None:
        """Returns chain when workspace_path is in repos."""
        builder = DuetDataBuilder(tmp_path)
        builder.add_business("Business")
        builder.add_repo("Duet", components=["extension", "backend"])
        duet_data = builder.build()

        biz_path = builder.get_business_path(0)
        stream_path = biz_path / "Stream"
        stream_path.mkdir()
        ManifestBuilder.stream(stream_path, "Stream")

        product_path = stream_path / "Duet"
        product_path.mkdir()
        ManifestBuilder.product(product_path, "Duet")

        config.init(duet_data)
        scanner = Scanner(db, repos_path=builder.get_repos_path())
        scanner.scan()

        service = WorkspaceService(db)
        repo_path = str(builder.get_repo_path("Duet"))

        result = service.get_workspace_info(repo_path)

        # Should have chain: Business -> Stream -> Duet
        assert len(result["chain"]) == 3
        assert result["chain"][0]["name"] == "Business"
        assert result["chain"][0]["type"] == "business"
        assert result["chain"][1]["name"] == "Stream"
        assert result["chain"][1]["type"] == "stream"
        assert result["chain"][2]["name"] == "Duet"
        assert result["chain"][2]["type"] == "product"
        assert result["status"] == "found"
        assert "reason" not in result

    def test_returns_components_for_product(
        self, tmp_path: Path, db: DatabaseManager
    ) -> None:
        """Returns components when workspace is a product with packages/."""
        builder = DuetDataBuilder(tmp_path)
        builder.add_business("Business")
        builder.add_repo("Duet", components=["extension", "backend"])
        duet_data = builder.build()

        biz_path = builder.get_business_path(0)
        product_path = biz_path / "Duet"
        product_path.mkdir()
        ManifestBuilder.product(product_path, "Duet")

        config.init(duet_data)
        scanner = Scanner(db, repos_path=builder.get_repos_path())
        scanner.scan()

        service = WorkspaceService(db)
        repo_path = str(builder.get_repo_path("Duet"))

        result = service.get_workspace_info(repo_path)

        # Should have components from repos/Duet.git/packages/
        assert len(result["components"]) == 2
        names = {c["name"] for c in result["components"]}
        assert names == {"extension", "backend"}

    def test_returns_empty_chain_for_unknown_path(
        self, tmp_path: Path, db: DatabaseManager
    ) -> None:
        """Returns empty chain for unknown workspace path."""
        builder = DuetDataBuilder(tmp_path)
        builder.add_business("Business")
        duet_data = builder.build()

        config.init(duet_data)
        scanner = Scanner(db)
        scanner.scan()

        service = WorkspaceService(db)

        result = service.get_workspace_info("/unknown/path")

        assert result["chain"] == []
        assert result["components"] == []
        assert result["status"] == "unknown"
        assert result["reason"] == "path_not_in_hierarchy"

    def test_status_entity_not_in_db(
        self, tmp_path: Path, db: DatabaseManager
    ) -> None:
        """Returns entity_not_in_db when path is in hierarchy but entity not found."""
        builder = DuetDataBuilder(tmp_path)
        builder.add_business("Business")
        duet_data = builder.build()

        config.init(duet_data)
        # Don't scan — DB is empty

        service = WorkspaceService(db)
        biz_path = str(builder.get_business_path(0))

        result = service.get_workspace_info(biz_path)

        assert result["chain"] == []
        assert result["status"] == "unknown"
        assert result["reason"] == "entity_not_in_db"

    def test_status_found_has_no_reason(
        self, tmp_path: Path, db: DatabaseManager
    ) -> None:
        """Status 'found' does not include reason field."""
        builder = DuetDataBuilder(tmp_path)
        builder.add_business("Business")
        duet_data = builder.build()

        config.init(duet_data)
        scanner = Scanner(db)
        scanner.scan()

        service = WorkspaceService(db)
        biz_path = str(builder.get_business_path(0))

        result = service.get_workspace_info(biz_path)

        assert result["status"] == "found"
        assert "reason" not in result


class TestScannerRelativePaths:
    """Tests that Scanner stores relative paths in drive_path.

    Path format: {business_folder_name}/{relative_path}
    This ensures uniqueness across multiple business_folders.
    """

    def test_business_has_folder_name_path(
        self, tmp_path: Path, db: DatabaseManager
    ) -> None:
        """Business entity has drive_path = folder name (for uniqueness)."""
        builder = DuetDataBuilder(tmp_path)
        builder.add_business("MyBusiness")
        duet_data = builder.build()

        config.init(duet_data)
        scanner = Scanner(db)
        scanner.scan()

        business = db.find_by_name("MyBusiness")
        assert business is not None
        # drive_path = business folder name
        assert business.drive_path == "MyBusiness"

    def test_stream_has_relative_path_with_prefix(
        self, tmp_path: Path, db: DatabaseManager
    ) -> None:
        """Stream entity has path: {business_folder_name}/{stream_name}."""
        builder = DuetDataBuilder(tmp_path)
        builder.add_business("Business")
        duet_data = builder.build()

        biz_path = builder.get_business_path(0)
        stream_path = biz_path / "MyStream"
        stream_path.mkdir()
        ManifestBuilder.stream(stream_path, "MyStream")

        config.init(duet_data)
        scanner = Scanner(db)
        scanner.scan()

        stream = db.find_by_name("MyStream")
        assert stream is not None
        # drive_path = {business_folder_name}/{stream_name}
        assert stream.drive_path == "Business/MyStream"

    def test_deep_path_is_relative_with_prefix(
        self, tmp_path: Path, db: DatabaseManager
    ) -> None:
        """Deep nested entity has path: {business_folder_name}/Stream1/Stream2/Product."""
        builder = DuetDataBuilder(tmp_path)
        builder.add_business("Business")
        duet_data = builder.build()

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

        config.init(duet_data)
        scanner = Scanner(db)
        scanner.scan()

        product = db.find_by_name("Product")
        assert product is not None
        assert product.drive_path == "Business/Stream1/Stream2/Product"

    def test_project_from_drive_has_relative_path_with_prefix(
        self, tmp_path: Path, db: DatabaseManager
    ) -> None:
        """Project from drive has path: {business_folder_name}/Product/projects/MyProject."""
        builder = DuetDataBuilder(tmp_path)
        builder.add_business("Business")
        duet_data = builder.build()

        biz_path = builder.get_business_path(0)
        product_path = biz_path / "Product"
        product_path.mkdir()
        ManifestBuilder.product(product_path, "Product")

        projects_path = product_path / "projects"
        projects_path.mkdir()
        (projects_path / "MyProject").mkdir()

        config.init(duet_data)
        scanner = Scanner(db)
        scanner.scan()

        project = db.find_by_name("MyProject")
        assert project is not None
        assert project.drive_path == "Business/Product/projects/MyProject"

    def test_project_from_repos_has_relative_path(
        self, tmp_path: Path, db: DatabaseManager
    ) -> None:
        """Project from repos has path relative to repos_path."""
        builder = DuetDataBuilder(tmp_path)
        builder.add_business("Business")
        builder.add_repo("Duet", components=[])
        duet_data = builder.build()

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

        config.init(duet_data)
        scanner = Scanner(db, repos_path=builder.get_repos_path())
        scanner.scan()

        project = db.find_by_name("260117_design")
        assert project is not None
        # Path relative to repos_path
        assert project.drive_path == "Duet.git/projects/260117_design"

    def test_multiple_business_folders_unique_paths(
        self, tmp_path: Path, db: DatabaseManager
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
        duet_data = builder.build()

        config.init(duet_data)
        scanner = Scanner(db)
        scanner.scan()

        biz1 = db.find_by_name("Business1")
        biz2 = db.find_by_name("Business2")

        assert biz1 is not None
        assert biz2 is not None
        # Each has unique drive_path = folder name
        assert biz1.drive_path == "Business1"
        assert biz2.drive_path == "Business2"
