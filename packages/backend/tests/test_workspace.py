"""Tests for WorkspaceService — _resolve_entity and get_orientation."""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

from db import DatabaseManager
from scanner import Scanner
from services.workspace import WorkspaceService

from tests.fixtures import DuetDataBuilder, ManifestBuilder


class TestResolveEntity:
    """Tests for WorkspaceService._resolve_entity method."""

    def test_resolve_from_repos_simple(
        self, tmp_path: Path, db: DatabaseManager, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        builder = DuetDataBuilder(tmp_path)
        builder.add_root_context("Root")
        builder.add_repo("Duet", components=["extension", "backend"])
        builder.build(monkeypatch)

        root_path = builder.get_root_context_path(0)
        product_path = root_path / "Duet"
        product_path.mkdir()
        ManifestBuilder.context(product_path, "Duet", git_url="https://github.com/...")
        Scanner(db, repos_path=builder.get_repos_path()).scan()

        service = WorkspaceService(db)
        repo_workspace = str(builder.get_repo_path("Duet"))

        entity = service._resolve_entity(repo_workspace)

        assert entity is not None
        assert entity.name == "Duet"
        assert entity.type == "context"
        assert entity.git_url is not None

    def test_resolve_from_repos_with_subpath(
        self, tmp_path: Path, db: DatabaseManager, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        builder = DuetDataBuilder(tmp_path)
        builder.add_root_context("Root")
        builder.add_repo("Duet", components=["extension"])
        builder.build(monkeypatch)

        root_path = builder.get_root_context_path(0)
        product_path = root_path / "Duet"
        product_path.mkdir()
        ManifestBuilder.context(product_path, "Duet", git_url="https://...")
        Scanner(db, repos_path=builder.get_repos_path()).scan()

        service = WorkspaceService(db)
        subpath = str(builder.get_repo_path("Duet") / "packages" / "extension")

        entity = service._resolve_entity(subpath)

        assert entity is not None
        assert entity.name == "Duet"

    def test_resolve_from_repos_via_product_repo(
        self, tmp_path: Path, db: DatabaseManager, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Resolves entity via product_repo entity (DB lookup by Duet.git name)."""
        builder = DuetDataBuilder(tmp_path)
        builder.add_root_context("Root")
        builder.add_repo("MyProduct", components=[])
        builder.build(monkeypatch)

        root_path = builder.get_root_context_path(0)
        product_path = root_path / "MyProduct"
        product_path.mkdir()
        ManifestBuilder.context(product_path, "MyProduct", git_url="https://...")
        Scanner(db, repos_path=builder.get_repos_path()).scan()

        repo_entity = db.find_by_name("MyProduct.git")
        assert repo_entity is not None
        assert repo_entity.type == "product_repo"

        service = WorkspaceService(db)
        workspace = str(builder.get_repos_path() / "MyProduct.git")

        entity = service._resolve_entity(workspace)

        assert entity is not None
        assert entity.name == "MyProduct"
        assert entity.type == "context"

    def test_resolve_from_drive_simple(
        self, tmp_path: Path, db: DatabaseManager, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        builder = DuetDataBuilder(tmp_path)
        builder.add_root_context("Root")
        builder.build(monkeypatch)

        root_path = builder.get_root_context_path(0)

        mid_path = root_path / "Mid"
        mid_path.mkdir()
        ManifestBuilder.context(mid_path, "Mid")

        product_path = mid_path / "Product"
        product_path.mkdir()
        ManifestBuilder.context(product_path, "Product")
        Scanner(db).scan()

        service = WorkspaceService(db)

        entity = service._resolve_entity(str(product_path))

        assert entity is not None
        assert entity.name == "Product"

    def test_resolve_from_drive_finds_closest(
        self, tmp_path: Path, db: DatabaseManager, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        builder = DuetDataBuilder(tmp_path)
        builder.add_root_context("Root")
        builder.build(monkeypatch)

        root_path = builder.get_root_context_path(0)
        mid_path = root_path / "Mid"
        mid_path.mkdir()
        ManifestBuilder.context(mid_path, "Mid")
        Scanner(db).scan()

        service = WorkspaceService(db)

        deep_path = str(mid_path / "some" / "deep" / "folder")

        entity = service._resolve_entity(deep_path)

        assert entity is not None
        assert entity.name == "Mid"

    def test_resolve_unknown_path_returns_none(
        self, tmp_path: Path, db: DatabaseManager, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        builder = DuetDataBuilder(tmp_path)
        builder.add_root_context("Root")
        builder.build(monkeypatch)
        Scanner(db).scan()

        service = WorkspaceService(db)
        assert service._resolve_entity("/some/random/path") is None

    def test_resolve_root_context(
        self, tmp_path: Path, db: DatabaseManager, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        builder = DuetDataBuilder(tmp_path)
        builder.add_root_context("MyContext")
        builder.build(monkeypatch)
        Scanner(db).scan()

        service = WorkspaceService(db)
        entity = service._resolve_entity(str(builder.get_root_context_path(0)))

        assert entity is not None
        assert entity.name == "MyContext"
        assert entity.type == "context"

    def test_resolve_does_not_match_sibling_with_shared_prefix(
        self, tmp_path: Path, db: DatabaseManager, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        builder = DuetDataBuilder(tmp_path)
        builder.add_root_context("Baza")
        builder.add_root_context("Baza2")
        builder.build(monkeypatch)
        Scanner(db).scan()

        baza2_subpath = builder.get_root_context_path(1) / "subdir"
        baza2_subpath.mkdir()

        service = WorkspaceService(db)
        entity = service._resolve_entity(str(baza2_subpath))

        assert entity is not None
        assert entity.name == "Baza2"

    def test_resolve_does_not_match_sibling_relative_prefix(
        self, tmp_path: Path, db: DatabaseManager, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """A path under unmanifested `Root/AlphaBeta` must resolve to the
        closest registered ancestor (Root), not to sibling `Root/Alpha`.

        Regression for naive `instr(path, drive_path) = 1` in
        `find_closest_entity` which matched any string-prefix.
        """
        builder = DuetDataBuilder(tmp_path)
        builder.add_root_context("Root")
        builder.build(monkeypatch)

        root_path = builder.get_root_context_path(0)

        alpha_path = root_path / "Alpha"
        alpha_path.mkdir()
        ManifestBuilder.context(alpha_path, "Alpha")

        # AlphaBeta — folder exists but no manifest, so it's not an entity.
        alpha_beta_path = root_path / "AlphaBeta"
        alpha_beta_path.mkdir()
        nested = alpha_beta_path / "sub"
        nested.mkdir()

        Scanner(db).scan()

        service = WorkspaceService(db)
        entity = service._resolve_entity(str(nested))

        assert entity is not None
        assert entity.name == "Root", (
            f"Expected to resolve into Root, got {entity.name!r} — "
            "regression to naive prefix matching in find_closest_entity"
        )

    def test_is_path_in_hierarchy_does_not_match_sibling_prefix(
        self, tmp_path: Path, db: DatabaseManager, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        builder = DuetDataBuilder(tmp_path)
        builder.add_root_context("Baza")
        builder.build(monkeypatch)

        sibling = tmp_path / "Baza2"
        sibling.mkdir()

        service = WorkspaceService(db)
        assert service._is_path_in_hierarchy(str(sibling)) is False
        assert service._is_path_in_hierarchy(str(sibling / "deep")) is False
        assert service._is_path_in_hierarchy(
            str(builder.get_root_context_path(0))
        ) is True


class TestGetOrientation:
    """Tests for WorkspaceService.get_orientation method."""

    def test_returns_duet_paths_without_workspace_path(
        self, tmp_path: Path, db: DatabaseManager, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        builder = DuetDataBuilder(tmp_path)
        builder.build(monkeypatch)

        result = WorkspaceService(db).get_orientation()

        assert result["workspace"]["type"] == "unknown"
        assert result["workspace"]["reason"] == "no_workspace_path"
        assert "duet_paths" in result
        assert "duetDataPath" in result["duet_paths"]
        assert "machineConfig" in result["duet_paths"]
        assert "context" not in result

    def test_returns_context_for_repos_path(
        self, tmp_path: Path, db: DatabaseManager, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        builder = DuetDataBuilder(tmp_path)
        builder.add_root_context("Root")
        builder.add_repo("Duet", components=["extension", "backend"])
        builder.build(monkeypatch)

        root_path = builder.get_root_context_path(0)
        mid_path = root_path / "Mid"
        mid_path.mkdir()
        ManifestBuilder.context(mid_path, "Mid")

        product_path = mid_path / "Duet"
        product_path.mkdir()
        ManifestBuilder.context(product_path, "Duet", git_url="https://github.com/...")
        Scanner(db, repos_path=builder.get_repos_path()).scan()

        repo_path = str(builder.get_repo_path("Duet"))
        result = WorkspaceService(db).get_orientation(repo_path)

        assert result["workspace"]["type"] == "context_with_products_in_git"

        context = result["context"]
        assert len(context["chain"]) == 3
        assert context["chain"][0]["name"] == "Root"
        assert context["chain"][0]["type"] == "context"
        assert context["chain"][1]["name"] == "Mid"
        assert context["chain"][2]["name"] == "Duet"

        assert "id" not in context["chain"][0]
        assert "path" not in context["chain"][0]

        assert context["breadcrumb"] == "Root / Mid / Duet"

    def test_returns_components_for_terminal_context(
        self, tmp_path: Path, db: DatabaseManager, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        builder = DuetDataBuilder(tmp_path)
        builder.add_root_context("Root")
        builder.add_repo("Duet", components=["extension", "backend"])
        builder.build(monkeypatch)

        root_path = builder.get_root_context_path(0)
        product_path = root_path / "Duet"
        product_path.mkdir()
        ManifestBuilder.context(product_path, "Duet", git_url="https://...")
        Scanner(db, repos_path=builder.get_repos_path()).scan()

        repo_path = str(builder.get_repo_path("Duet"))
        result = WorkspaceService(db).get_orientation(repo_path)

        assert len(result["components"]) == 2
        names = {c["name"] for c in result["components"]}
        assert names == {"extension", "backend"}

    def test_unknown_for_unknown_path(
        self, tmp_path: Path, db: DatabaseManager, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        builder = DuetDataBuilder(tmp_path)
        builder.add_root_context("Root")
        builder.build(monkeypatch)
        Scanner(db).scan()

        result = WorkspaceService(db).get_orientation("/unknown/path")

        assert result["workspace"]["type"] == "unknown"
        assert result["workspace"]["reason"] == "path_not_in_hierarchy"
        assert "context" not in result

    def test_entity_not_in_db(
        self, tmp_path: Path, db: DatabaseManager, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        builder = DuetDataBuilder(tmp_path)
        builder.add_root_context("Root")
        builder.build(monkeypatch)
        # Don't scan -- DB is empty

        root_path = str(builder.get_root_context_path(0))
        result = WorkspaceService(db).get_orientation(root_path)

        assert result["workspace"]["type"] == "unknown"
        assert result["workspace"]["reason"] == "entity_not_in_db"

    def test_workspace_type_context_with_products_in_git(
        self, tmp_path: Path, db: DatabaseManager, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        builder = DuetDataBuilder(tmp_path)
        builder.add_root_context("Root")
        builder.add_repo("Duet", components=[])
        builder.build(monkeypatch)

        root_path = builder.get_root_context_path(0)
        product_path = root_path / "Duet"
        product_path.mkdir()
        ManifestBuilder.context(product_path, "Duet", git_url="https://github.com/...")
        Scanner(db, repos_path=builder.get_repos_path()).scan()

        repo_path = str(builder.get_repo_path("Duet"))
        result = WorkspaceService(db).get_orientation(repo_path)

        ws = result["workspace"]
        assert ws["type"] == "context_with_products_in_git"
        assert ws["git_folder"] == str(builder.get_repo_path("Duet"))
        assert ws["drive_folder"] == str(product_path)
        assert "topology" in ws
        assert "git repo" in ws["topology"]

    def test_workspace_type_context_root(
        self, tmp_path: Path, db: DatabaseManager, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Root context (no git_url, not meta) → workspace.type = context."""
        builder = DuetDataBuilder(tmp_path)
        builder.add_root_context("Plain")
        builder.build(monkeypatch)
        Scanner(db).scan()

        result = WorkspaceService(db).get_orientation(
            str(builder.get_root_context_path(0))
        )

        ws = result["workspace"]
        assert ws["type"] == "context"
        assert ws["drive_folder"] == str(builder.get_root_context_path(0))
        assert "topology" in ws

    def test_workspace_type_intermediate_context(
        self, tmp_path: Path, db: DatabaseManager, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        builder = DuetDataBuilder(tmp_path)
        builder.add_root_context("Root")
        builder.build(monkeypatch)

        root_path = builder.get_root_context_path(0)
        mid_path = root_path / "Mid"
        mid_path.mkdir()
        ManifestBuilder.context(mid_path, "Mid")
        Scanner(db).scan()

        result = WorkspaceService(db).get_orientation(str(mid_path))

        ws = result["workspace"]
        assert ws["type"] == "context"
        assert ws["drive_folder"] == str(mid_path)

    def test_workspace_type_terminal_drive_only_when_no_git_clone(
        self, tmp_path: Path, db: DatabaseManager, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """A context with `git_url` but no clone on disk still reports
        context_with_products_in_git but git_folder is omitted."""
        builder = DuetDataBuilder(tmp_path)
        builder.add_root_context("Root")
        builder.build(monkeypatch)

        root_path = builder.get_root_context_path(0)
        product_path = root_path / "Duet"
        product_path.mkdir()
        ManifestBuilder.context(product_path, "Duet", git_url="https://...")
        Scanner(db).scan()

        result = WorkspaceService(db).get_orientation(str(product_path))

        ws = result["workspace"]
        assert ws["type"] == "context_with_products_in_git"
        assert ws["drive_folder"] == str(product_path)

    def test_workspace_type_meta_context(
        self, tmp_path: Path, db: DatabaseManager, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Meta-context → workspace.type = context_meta with root_context_folders map."""
        builder = DuetDataBuilder(tmp_path)
        builder.add_root_context("MetaCtx", "MetaCtx", meta=True)
        builder.add_root_context("Other", "Other")
        builder.build(monkeypatch)
        Scanner(db).scan()

        result = WorkspaceService(db).get_orientation(
            str(builder.get_root_context_path(0))
        )

        ws = result["workspace"]
        assert ws["type"] == "context_meta"
        assert "meta_context_folder" in ws
        assert "root_context_folders" in ws
        assert "duet_data_folder" in ws
        assert "MetaCtx" in ws["root_context_folders"]
        assert "Other" in ws["root_context_folders"]

    def test_components_absent_for_intermediate_context(
        self, tmp_path: Path, db: DatabaseManager, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        builder = DuetDataBuilder(tmp_path)
        builder.add_root_context("Root")
        builder.build(monkeypatch)
        Scanner(db).scan()

        result = WorkspaceService(db).get_orientation(
            str(builder.get_root_context_path(0))
        )

        assert "components" not in result

    def test_key_files_with_only_readme(
        self, tmp_path: Path, db: DatabaseManager, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        builder = DuetDataBuilder(tmp_path)
        builder.add_root_context("Root")
        builder.build(monkeypatch)

        root_path = builder.get_root_context_path(0)
        (root_path / "README.md").write_text("# Root", encoding="utf-8")
        Scanner(db).scan()

        result = WorkspaceService(db).get_orientation(str(root_path))

        assert "key_files" in result
        assert "readme" in result["key_files"]
        assert "spec" not in result["key_files"]

    def test_key_files_with_only_spec(
        self, tmp_path: Path, db: DatabaseManager, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        builder = DuetDataBuilder(tmp_path)
        builder.add_root_context("Root")
        builder.build(monkeypatch)

        root_path = builder.get_root_context_path(0)
        spec_dir = root_path / "spec"
        spec_dir.mkdir()
        (spec_dir / "CONTEXT.md").write_text("# Root\n\nSome desc.", encoding="utf-8")
        Scanner(db).scan()

        result = WorkspaceService(db).get_orientation(str(root_path))

        assert "key_files" in result
        assert "spec" in result["key_files"]
        assert "readme" not in result["key_files"]

    def test_key_files_with_spec_and_readme(
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

        repo_path = builder.get_repo_path("Duet")
        spec_dir = repo_path / "spec"
        spec_dir.mkdir()
        (spec_dir / "PRODUCT.md").write_text("# Duet\n\nProduct desc.", encoding="utf-8")
        (repo_path / "README.md").write_text("# Duet\n\nReadme text.", encoding="utf-8")

        result = WorkspaceService(db).get_orientation(str(repo_path))

        assert "key_files" in result
        assert result["key_files"]["spec"] == str(spec_dir / "PRODUCT.md")
        assert result["key_files"]["readme"] == str(repo_path / "README.md")

    def test_key_files_absent_when_no_files(
        self, tmp_path: Path, db: DatabaseManager, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        builder = DuetDataBuilder(tmp_path)
        builder.add_root_context("Root")
        builder.build(monkeypatch)
        Scanner(db).scan()

        result = WorkspaceService(db).get_orientation(
            str(builder.get_root_context_path(0))
        )

        assert "key_files" not in result

    def test_chain_description_priority_manifest_over_readme(
        self, tmp_path: Path, db: DatabaseManager, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Manifest's `description` field wins over README first sentence."""
        builder = DuetDataBuilder(tmp_path)
        builder.add_root_context("Root")
        builder.build(monkeypatch)

        root_path = builder.get_root_context_path(0)
        # Rewrite manifest with description
        ManifestBuilder.context(
            root_path, "Root",
            description="Manifest-supplied description.",
        )
        (root_path / "README.md").write_text(
            "# Root\n\nReadme description.",
            encoding="utf-8",
        )
        Scanner(db).scan()

        result = WorkspaceService(db).get_orientation(str(root_path))

        chain = result["context"]["chain"]
        assert chain[0]["description"] == "Manifest-supplied description."

    def test_chain_description_falls_back_to_readme(
        self, tmp_path: Path, db: DatabaseManager, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        builder = DuetDataBuilder(tmp_path)
        builder.add_root_context("Root")
        builder.build(monkeypatch)

        root_path = builder.get_root_context_path(0)
        (root_path / "README.md").write_text(
            "# Root\n\nReadme-supplied description.",
            encoding="utf-8",
        )
        Scanner(db).scan()

        result = WorkspaceService(db).get_orientation(str(root_path))

        chain = result["context"]["chain"]
        assert chain[0]["description"] == "Readme-supplied description."

    def test_chain_omits_description_when_neither_present(
        self, tmp_path: Path, db: DatabaseManager, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        builder = DuetDataBuilder(tmp_path)
        builder.add_root_context("Root")
        builder.build(monkeypatch)
        Scanner(db).scan()

        result = WorkspaceService(db).get_orientation(
            str(builder.get_root_context_path(0))
        )

        chain = result["context"]["chain"]
        assert "description" not in chain[0]

    def test_components_with_spec_and_description(
        self, tmp_path: Path, db: DatabaseManager, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        builder = DuetDataBuilder(tmp_path)
        builder.add_root_context("Root")
        builder.add_repo("Duet", components=["backend"])
        builder.build(monkeypatch)

        root_path = builder.get_root_context_path(0)
        product_path = root_path / "Duet"
        product_path.mkdir()
        ManifestBuilder.context(product_path, "Duet", git_url="https://...")
        Scanner(db, repos_path=builder.get_repos_path()).scan()

        repo_path = builder.get_repo_path("Duet")
        spec_dir = repo_path / "packages" / "backend" / "spec"
        spec_dir.mkdir(parents=True)
        (spec_dir / "COMPONENT.md").write_text(
            "# Backend\n\nPython HTTP backend for Duet.",
            encoding="utf-8",
        )

        result = WorkspaceService(db).get_orientation(str(repo_path))

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
        builder.add_root_context("Root")
        builder.add_repo("Duet", components=["ext"])
        builder.build(monkeypatch)

        root_path = builder.get_root_context_path(0)
        product_path = root_path / "Duet"
        product_path.mkdir()
        ManifestBuilder.context(product_path, "Duet", git_url="https://...")
        Scanner(db, repos_path=builder.get_repos_path()).scan()

        repo_path = builder.get_repo_path("Duet")
        spec_dir = repo_path / "packages" / "ext" / "spec"
        spec_dir.mkdir(parents=True)
        (spec_dir / "ARCHITECTURE.md").write_text(
            "# Architecture\n\n## Overview\n\nSome arch.",
            encoding="utf-8",
        )

        result = WorkspaceService(db).get_orientation(str(repo_path))

        comp = result["components"][0]
        assert comp["spec"] == "packages/ext/spec/ARCHITECTURE.md"
        assert comp["description"] == "Architecture"

    def test_topology_includes_reference_repos_addon(
        self, tmp_path: Path, db: DatabaseManager, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        builder = DuetDataBuilder(tmp_path)
        builder.add_root_context("Root")
        builder.add_repo("Duet", components=[])
        builder.build(monkeypatch)

        root_path = builder.get_root_context_path(0)
        product_path = root_path / "Duet"
        product_path.mkdir()
        ManifestBuilder.context(
            product_path, "Duet", git_url="https://...",
            reference_repos={"cookbook": "https://github.com/anthropics/cookbook.git"},
        )

        (builder.get_repos_path() / "cookbook.git").mkdir(parents=True)

        Scanner(db, repos_path=builder.get_repos_path()).scan()

        result = WorkspaceService(db).get_orientation(
            str(builder.get_repo_path("Duet"))
        )

        ws = result["workspace"]
        assert ws["type"] == "context_with_products_in_git"
        assert "reference_repos" in ws
        assert "cookbook.git" in ws["reference_repos"]
        assert "read-only clones" in ws["topology"]


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
        assert product.git_url == "https://..."

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


class TestResolveMultiPath:
    """_resolve_multi_path: meta wins, missing-meta is a hard error (Host invariant)."""

    def test_meta_wins_over_first_come(
        self, tmp_path: Path, db: DatabaseManager, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        builder = DuetDataBuilder(tmp_path)
        builder.add_root_context("Regular")
        builder.add_root_context("Meta", meta=True)
        builder.build(monkeypatch)
        Scanner(db).scan()

        regular = str(builder.get_root_context_path(0))
        meta = str(builder.get_root_context_path(1))

        result = WorkspaceService(db)._resolve_multi_path([regular, meta])
        assert result is not None
        assert result.name == "Meta"

    def test_first_come_when_meta_not_in_paths(
        self, tmp_path: Path, db: DatabaseManager, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Meta exists in DB but is not among requested paths → first-come fallback is OK."""
        builder = DuetDataBuilder(tmp_path)
        builder.add_root_context("Meta", meta=True)
        builder.add_root_context("RegularA")
        builder.add_root_context("RegularB")
        builder.build(monkeypatch)
        Scanner(db).scan()

        a = str(builder.get_root_context_path(1))
        b = str(builder.get_root_context_path(2))

        result = WorkspaceService(db)._resolve_multi_path([a, b])
        assert result is not None
        assert result.name == "RegularA"

    def test_first_come_when_meta_missing_in_db(
        self, tmp_path: Path, db: DatabaseManager, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """DB temporarily has no meta-context (e.g. between a Host meta-flag write and
        the next Backend scan, or after a manual manifest edit). Backend picks the first
        resolved entity — Host's startup/save sweep is the place that restores `meta`
        on the first folder and shows red on the wizard if it can't.
        """
        builder = DuetDataBuilder(tmp_path)
        builder.add_root_context("Solo")  # no meta=True anywhere
        builder.build(monkeypatch)
        Scanner(db).scan()

        path = str(builder.get_root_context_path(0))
        result = WorkspaceService(db)._resolve_multi_path([path])
        assert result is not None
        assert result.name == "Solo"

    def test_returns_none_when_no_entities_resolve(
        self, tmp_path: Path, db: DatabaseManager, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Empty workspace_paths or all paths outside hierarchy → None (no invariant check)."""
        builder = DuetDataBuilder(tmp_path)
        builder.add_root_context("Solo")
        builder.build(monkeypatch)
        Scanner(db).scan()

        result = WorkspaceService(db)._resolve_multi_path(["/nowhere/at/all"])
        assert result is None
