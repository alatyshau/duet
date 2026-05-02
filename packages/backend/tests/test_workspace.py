"""Tests for WorkspaceService - resolve_entity and get_orientation."""

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
        builder = DuetDataBuilder(tmp_path)
        builder.add_business("Business")
        builder.add_repo("Duet", components=["extension", "backend"])
        duet_data = builder.build(monkeypatch)

        biz_path = builder.get_business_path(0)
        product_path = biz_path / "Duet"
        product_path.mkdir()
        ManifestBuilder.product(product_path, "Duet", git_url="https://github.com/...")
        scanner = Scanner(db, repos_path=builder.get_repos_path())
        scanner.scan()

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

        biz_path = builder.get_business_path(0)
        product_path = biz_path / "Duet"
        product_path.mkdir()
        ManifestBuilder.product(product_path, "Duet", git_url="https://...")
        scanner = Scanner(db, repos_path=builder.get_repos_path())
        scanner.scan()

        service = WorkspaceService(db)
        subpath = str(builder.get_repo_path("Duet") / "packages" / "extension")

        entity = service._resolve_entity(subpath)

        assert entity is not None
        assert entity.name == "Duet"
        assert entity.type == "product"

    def test_resolve_from_repos_via_product_repo(
        self, tmp_path: Path, db: DatabaseManager, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Resolves entity via product_repo entity (direct DB lookup by Duet.git name)."""
        builder = DuetDataBuilder(tmp_path)
        builder.add_business("Business")
        builder.add_repo("MyProduct", components=[])
        duet_data = builder.build(monkeypatch)

        biz_path = builder.get_business_path(0)
        product_path = biz_path / "MyProduct"
        product_path.mkdir()
        ManifestBuilder.product(product_path, "MyProduct", git_url="https://...")
        scanner = Scanner(db, repos_path=builder.get_repos_path())
        scanner.scan()

        # Verify product_repo entity exists
        repo_entity = db.find_by_name("MyProduct.git")
        assert repo_entity is not None
        assert repo_entity.type == "product_repo"

        service = WorkspaceService(db)
        workspace = str(builder.get_repos_path() / "MyProduct.git")

        entity = service._resolve_entity(workspace)

        assert entity is not None
        assert entity.name == "MyProduct"
        assert entity.type == "product"

    def test_resolve_from_drive_simple(
        self, tmp_path: Path, db: DatabaseManager, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Resolves entity from Google Drive path."""
        builder = DuetDataBuilder(tmp_path)
        builder.add_business("Business")
        duet_data = builder.build(monkeypatch)

        biz_path = builder.get_business_path(0)

        stream_path = biz_path / "Stream"
        stream_path.mkdir()
        ManifestBuilder.stream(stream_path, "Stream")

        product_path = stream_path / "Product"
        product_path.mkdir()
        ManifestBuilder.product(product_path, "Product")
        scanner = Scanner(db)
        scanner.scan()

        service = WorkspaceService(db)

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

        deep_path = str(stream_path / "some" / "deep" / "folder")

        entity = service._resolve_entity(deep_path)

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

    def test_resolve_does_not_match_sibling_with_shared_prefix(
        self, tmp_path: Path, db: DatabaseManager, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Path inside `Baza2` must not match business_folder `Baza`.

        Regression: a naive `path.startswith(folder)` (no separator) would
        treat `/root/Baza2/sub` as inside `/root/Baza`. The fix uses
        `Path.relative_to`, which correctly rejects this.
        """
        builder = DuetDataBuilder(tmp_path)
        builder.add_business("Baza")
        builder.add_business("Baza2")
        duet_data = builder.build(monkeypatch)
        scanner = Scanner(db)
        scanner.scan()

        # Subpath inside Baza2 — must resolve to Baza2, not Baza
        baza2_subpath = builder.get_business_path(1) / "subdir"
        baza2_subpath.mkdir()

        service = WorkspaceService(db)
        entity = service._resolve_entity(str(baza2_subpath))

        assert entity is not None
        assert entity.name == "Baza2", (
            f"Expected to resolve into Baza2, got {entity.name!r} — "
            "likely a regression to naive prefix matching"
        )

    def test_is_path_in_hierarchy_does_not_match_sibling_prefix(
        self, tmp_path: Path, db: DatabaseManager, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """`_is_path_in_hierarchy` must not give false positives on prefix collisions.

        If business_folders contains `/root/Baza` only, then `/root/Baza2`
        is NOT in the hierarchy. The naive `+ "/"` check happened to handle
        this on POSIX (because `/Baza/` is not a prefix of `/Baza2`), but
        the fix via `relative_to` makes the intent explicit and OS-independent.
        """
        builder = DuetDataBuilder(tmp_path)
        builder.add_business("Baza")  # only Baza is registered
        duet_data = builder.build(monkeypatch)

        # Baza2 exists on disk but is NOT in business_folders
        sibling = tmp_path / "Baza2"
        sibling.mkdir()

        service = WorkspaceService(db)
        assert service._is_path_in_hierarchy(str(sibling)) is False
        assert service._is_path_in_hierarchy(str(sibling / "deep")) is False
        # Sanity: actual Baza is in hierarchy
        assert service._is_path_in_hierarchy(
            str(builder.get_business_path(0))
        ) is True


class TestGetOrientation:
    """Tests for WorkspaceService.get_orientation method."""

    def test_returns_duet_paths_without_workspace_path(
        self, tmp_path: Path, db: DatabaseManager, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Returns duet_paths and workspace.type=unknown without workspace_path."""
        builder = DuetDataBuilder(tmp_path)
        duet_data = builder.build(monkeypatch)

        service = WorkspaceService(db)
        result = service.get_orientation()

        assert result["workspace"]["type"] == "unknown"
        assert result["workspace"]["reason"] == "no_workspace_path"
        assert "duet_paths" in result
        assert "duetDataPath" in result["duet_paths"]
        assert "machineConfig" in result["duet_paths"]
        assert "context" not in result

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
        ManifestBuilder.product(product_path, "Duet", git_url="https://github.com/...")
        scanner = Scanner(db, repos_path=builder.get_repos_path())
        scanner.scan()

        service = WorkspaceService(db)
        repo_path = str(builder.get_repo_path("Duet"))

        result = service.get_orientation(repo_path)

        # Workspace resolved
        assert result["workspace"]["type"] == "product_in_git"

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
        ManifestBuilder.product(product_path, "Duet", git_url="https://...")
        scanner = Scanner(db, repos_path=builder.get_repos_path())
        scanner.scan()

        service = WorkspaceService(db)
        repo_path = str(builder.get_repo_path("Duet"))

        result = service.get_orientation(repo_path)

        assert len(result["components"]) == 2
        names = {c["name"] for c in result["components"]}
        assert names == {"extension", "backend"}

    def test_unknown_for_unknown_path(
        self, tmp_path: Path, db: DatabaseManager, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Returns workspace.type=unknown for unknown workspace path."""
        builder = DuetDataBuilder(tmp_path)
        builder.add_business("Business")
        duet_data = builder.build(monkeypatch)
        scanner = Scanner(db)
        scanner.scan()

        service = WorkspaceService(db)

        result = service.get_orientation("/unknown/path")

        assert result["workspace"]["type"] == "unknown"
        assert result["workspace"]["reason"] == "path_not_in_hierarchy"
        assert "context" not in result

    def test_entity_not_in_db(
        self, tmp_path: Path, db: DatabaseManager, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Returns entity_not_in_db when path is in hierarchy but entity not found."""
        builder = DuetDataBuilder(tmp_path)
        builder.add_business("Business")
        duet_data = builder.build(monkeypatch)
        # Don't scan -- DB is empty

        service = WorkspaceService(db)
        biz_path = str(builder.get_business_path(0))

        result = service.get_orientation(biz_path)

        assert result["workspace"]["type"] == "unknown"
        assert result["workspace"]["reason"] == "entity_not_in_db"

    def test_workspace_type_product_in_git(
        self, tmp_path: Path, db: DatabaseManager, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Product with git_url -> workspace.type = product_in_git with git_folder and drive_folder."""
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

        result = service.get_orientation(repo_path)

        ws = result["workspace"]
        assert ws["type"] == "product_in_git"
        assert ws["git_folder"] == str(builder.get_repo_path("Duet"))
        assert ws["drive_folder"] == str(product_path)
        assert "topology" in ws
        assert "Product with git repo" in ws["topology"]

    def test_workspace_type_business(
        self, tmp_path: Path, db: DatabaseManager, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Business -> workspace.type = business with drive_folder."""
        builder = DuetDataBuilder(tmp_path)
        builder.add_business("Business")
        duet_data = builder.build(monkeypatch)
        scanner = Scanner(db)
        scanner.scan()

        service = WorkspaceService(db)
        biz_path = str(builder.get_business_path(0))

        result = service.get_orientation(biz_path)

        ws = result["workspace"]
        assert ws["type"] == "business"
        assert ws["drive_folder"] == str(builder.get_business_path(0))
        assert "topology" in ws

    def test_workspace_type_stream(
        self, tmp_path: Path, db: DatabaseManager, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Stream -> workspace.type = stream with drive_folder."""
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

        result = service.get_orientation(str(stream_path))

        ws = result["workspace"]
        assert ws["type"] == "stream"
        assert ws["drive_folder"] == str(stream_path)

    def test_workspace_type_product_on_drive(
        self, tmp_path: Path, db: DatabaseManager, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Product without git_url -> workspace.type = product_on_drive."""
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
        result = service.get_orientation(str(product_path))

        ws = result["workspace"]
        assert ws["type"] == "product_on_drive"
        assert ws["drive_folder"] == str(product_path)

    def test_workspace_type_root_business(
        self, tmp_path: Path, db: DatabaseManager, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Root business -> workspace.type = root_business with business_folders map."""
        builder = DuetDataBuilder(tmp_path)
        builder.add_business("RootBiz", "RootBiz", root=True)
        builder.add_business("OtherBiz", "OtherBiz")
        duet_data = builder.build(monkeypatch)
        scanner = Scanner(db)
        scanner.scan()

        service = WorkspaceService(db)
        result = service.get_orientation(str(builder.get_business_path(0)))

        ws = result["workspace"]
        assert ws["type"] == "root_business"
        assert "root_business_folder" in ws
        assert "business_folders" in ws
        assert "duet_data_folder" in ws
        assert "RootBiz" in ws["business_folders"]
        assert "OtherBiz" in ws["business_folders"]

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
        result = service.get_orientation(str(builder.get_business_path(0)))

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
        result = service.get_orientation(str(stream_path))

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
        result = service.get_orientation(str(biz_path))

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
        result = service.get_orientation(str(biz_path))

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

        repo_path = builder.get_repo_path("Duet")
        spec_dir = repo_path / "spec"
        spec_dir.mkdir()
        (spec_dir / "PRODUCT.md").write_text("# Duet\n\nSome description.", encoding="utf-8")
        (repo_path / "README.md").write_text("# Duet\n\nReadme text.", encoding="utf-8")

        service = WorkspaceService(db)
        result = service.get_orientation(str(repo_path))

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

        result = service.get_orientation(biz_path)

        assert "key_files" not in result

    def test_chain_includes_description_from_readme(
        self, tmp_path: Path, db: DatabaseManager, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Chain entities include description from README.md."""
        builder = DuetDataBuilder(tmp_path)
        builder.add_business("Business")
        duet_data = builder.build(monkeypatch)

        biz_path = builder.get_business_path(0)
        (biz_path / "README.md").write_text(
            "# Business\n\nThis is the business description.",
            encoding="utf-8",
        )
        scanner = Scanner(db)
        scanner.scan()

        service = WorkspaceService(db)
        result = service.get_orientation(str(biz_path))

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
        result = service.get_orientation(str(builder.get_business_path(0)))

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
        ManifestBuilder.product(product_path, "Duet", git_url="https://...")
        scanner = Scanner(db, repos_path=builder.get_repos_path())
        scanner.scan()

        repo_path = builder.get_repo_path("Duet")
        spec_dir = repo_path / "packages" / "backend" / "spec"
        spec_dir.mkdir(parents=True)
        (spec_dir / "COMPONENT.md").write_text(
            "# Backend\n\nPython HTTP backend for Duet.",
            encoding="utf-8",
        )

        service = WorkspaceService(db)
        result = service.get_orientation(str(repo_path))

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
        ManifestBuilder.product(product_path, "Duet", git_url="https://...")
        scanner = Scanner(db, repos_path=builder.get_repos_path())
        scanner.scan()

        repo_path = builder.get_repo_path("Duet")
        spec_dir = repo_path / "packages" / "ext" / "spec"
        spec_dir.mkdir(parents=True)
        (spec_dir / "ARCHITECTURE.md").write_text(
            "# Architecture\n\n## Overview\n\nSome arch.",
            encoding="utf-8",
        )

        service = WorkspaceService(db)
        result = service.get_orientation(str(repo_path))

        comp = result["components"][0]
        assert comp["spec"] == "packages/ext/spec/ARCHITECTURE.md"
        assert comp["description"] == "Architecture"

    def test_topology_includes_reference_repos_addon(
        self, tmp_path: Path, db: DatabaseManager, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Topology includes reference repos addon when reference_repos exist."""
        builder = DuetDataBuilder(tmp_path)
        builder.add_business("Business")
        builder.add_repo("Duet", components=[])
        duet_data = builder.build(monkeypatch)

        biz_path = builder.get_business_path(0)
        product_path = biz_path / "Duet"
        product_path.mkdir()
        ManifestBuilder.product(
            product_path, "Duet", git_url="https://...",
            reference_repos={"cookbook": "https://github.com/anthropics/cookbook.git"},
        )

        # Create the reference repo clone
        (builder.get_repos_path() / "cookbook.git").mkdir(parents=True)

        scanner = Scanner(db, repos_path=builder.get_repos_path())
        scanner.scan()

        service = WorkspaceService(db)
        result = service.get_orientation(str(builder.get_repo_path("Duet")))

        ws = result["workspace"]
        assert ws["type"] == "product_in_git"
        assert "reference_repos" in ws
        assert "cookbook.git" in ws["reference_repos"]
        assert "read-only clones" in ws["topology"]


class TestScannerRelativePaths:
    """Tests that Scanner stores relative paths in drive_path."""

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
        assert stream.drive_path == "Business/MyStream"

    def test_deep_path_is_relative_with_prefix(
        self, tmp_path: Path, db: DatabaseManager, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Deep nested entity has path: {business_folder_name}/Stream1/Stream2/Product."""
        builder = DuetDataBuilder(tmp_path)
        builder.add_business("Business")
        duet_data = builder.build(monkeypatch)

        biz_path = builder.get_business_path(0)

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

    def test_multiple_business_folders_unique_paths(
        self, tmp_path: Path, db: DatabaseManager, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Multiple business_folders have unique drive_paths."""
        biz1_path = tmp_path / "Business1"
        biz1_path.mkdir()
        ManifestBuilder.business(biz1_path, "Business1")

        biz2_path = tmp_path / "Business2"
        biz2_path.mkdir()
        ManifestBuilder.business(biz2_path, "Business2")

        builder = DuetDataBuilder(tmp_path)
        builder.with_business_folders([str(biz1_path), str(biz2_path)])
        duet_data = builder.build(monkeypatch)
        scanner = Scanner(db)
        scanner.scan()

        biz1 = db.find_by_name("Business1")
        biz2 = db.find_by_name("Business2")

        assert biz1 is not None
        assert biz2 is not None
        assert biz1.drive_path == "Business1"
        assert biz2.drive_path == "Business2"

    def test_product_repo_entity_created(
        self, tmp_path: Path, db: DatabaseManager, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Scanner creates product_repo entity for product with git_url."""
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

        # Product entity exists
        product = db.find_by_name("Duet")
        assert product is not None
        assert product.type == "product"

        # product_repo entity also exists
        repo = db.find_by_name("Duet.git")
        assert repo is not None
        assert repo.type == "product_repo"
        assert repo.parent_id == product.id

    def test_reference_repo_entity_created(
        self, tmp_path: Path, db: DatabaseManager, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Scanner creates reference_repo entity from manifest reference_repos."""
        builder = DuetDataBuilder(tmp_path)
        builder.add_business("Business")
        duet_data = builder.build(monkeypatch)

        biz_path = builder.get_business_path(0)
        product_path = biz_path / "Product"
        product_path.mkdir()
        ManifestBuilder.product(
            product_path, "Product",
            reference_repos={"cookbook": "https://github.com/anthropics/cookbook.git"},
        )
        scanner = Scanner(db)
        scanner.scan()

        ref = db.find_by_name("cookbook.git")
        assert ref is not None
        assert ref.type == "reference_repo"
        assert ref.git_url == "https://github.com/anthropics/cookbook.git"

