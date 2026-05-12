"""Tests for WorkspaceService — entity resolution and orientation shape."""

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
        """Resolves entity via product_repo entity (DB lookup by `<alias>.git`)."""
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

        assert result["workspace"]["kind"] == "unknown"
        assert result["workspace"]["reason"] == "no_workspace_path"
        assert "duet_paths" in result
        assert "duetDataPath" in result["duet_paths"]
        assert "machineConfig" in result["duet_paths"]
        assert "context" not in result
        assert "products" not in result

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

        assert result["workspace"]["kind"] == "context"

        context = result["context"]
        assert len(context["chain"]) == 3
        assert context["chain"][0]["name"] == "Root"
        assert context["chain"][0]["type"] == "context"
        assert context["chain"][1]["name"] == "Mid"
        assert context["chain"][2]["name"] == "Duet"

        # icon is always present — mirrors ContextEntity.icon. Scanner default
        # for a terminal context (has git_repos) is "📦".
        for item in context["chain"]:
            assert "icon" in item
            assert isinstance(item["icon"], str)
            assert item["icon"] != ""

        assert context["breadcrumb"] == "Root / Mid / Duet"

    def test_unknown_for_unknown_path(
        self, tmp_path: Path, db: DatabaseManager, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        builder = DuetDataBuilder(tmp_path)
        builder.add_root_context("Root")
        builder.build(monkeypatch)
        Scanner(db).scan()

        result = WorkspaceService(db).get_orientation("/unknown/path")

        assert result["workspace"]["kind"] == "unknown"
        assert result["workspace"]["reason"] == "path_not_in_hierarchy"
        assert "context" not in result
        assert "products" not in result

    def test_entity_not_in_db(
        self, tmp_path: Path, db: DatabaseManager, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        builder = DuetDataBuilder(tmp_path)
        builder.add_root_context("Root")
        builder.build(monkeypatch)
        # Don't scan -- DB is empty

        root_path = str(builder.get_root_context_path(0))
        result = WorkspaceService(db).get_orientation(root_path)

        assert result["workspace"]["kind"] == "unknown"
        assert result["workspace"]["reason"] == "entity_not_in_db"


class TestOrientationWorkspaceShape:
    """Tests for orientation `workspace` block (§3.1) and top-level `products`."""

    def test_orientation_workspace_shape(
        self, tmp_path: Path, db: DatabaseManager, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """workspace has the four canonical fields and no legacy fields."""
        builder = DuetDataBuilder(tmp_path)
        builder.add_root_context("Root")
        builder.add_repo("Duet", components=[])
        builder.build(monkeypatch)

        root_path = builder.get_root_context_path(0)
        product_path = root_path / "Duet"
        product_path.mkdir()
        ManifestBuilder.context(product_path, "Duet", git_url="https://...")
        Scanner(db, repos_path=builder.get_repos_path()).scan()

        result = WorkspaceService(db).get_orientation(
            str(builder.get_repo_path("Duet"))
        )

        ws = result["workspace"]
        assert ws["kind"] == "context"
        assert ws["context_name"] == "Duet"
        assert ws["context_folder"] == str(product_path)
        assert ws["git_folders"] == {"Duet": str(builder.get_repo_path("Duet"))}

        # Legacy fields are gone
        assert "type" not in ws
        assert "topology" not in ws
        assert "git_folder" not in ws
        assert "drive_folder" not in ws

    def test_orientation_products_top_level(
        self, tmp_path: Path, db: DatabaseManager, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """products[] is at top level, not inside workspace."""
        builder = DuetDataBuilder(tmp_path)
        builder.add_root_context("Root")
        builder.add_repo("Duet", components=["backend"])
        builder.build(monkeypatch)

        root_path = builder.get_root_context_path(0)
        product_path = root_path / "Duet"
        product_path.mkdir()
        ManifestBuilder.context(product_path, "Duet", git_url="https://...")
        Scanner(db, repos_path=builder.get_repos_path()).scan()

        result = WorkspaceService(db).get_orientation(
            str(builder.get_repo_path("Duet"))
        )

        assert "products" in result
        assert isinstance(result["products"], list)
        # products is NOT inside workspace
        assert "products" not in result["workspace"]

    def test_orientation_no_top_level_components(
        self, tmp_path: Path, db: DatabaseManager, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """The legacy flat `components[]` at top level is gone."""
        builder = DuetDataBuilder(tmp_path)
        builder.add_root_context("Root")
        builder.add_repo("Duet", components=["backend"])
        builder.build(monkeypatch)

        root_path = builder.get_root_context_path(0)
        product_path = root_path / "Duet"
        product_path.mkdir()
        ManifestBuilder.context(product_path, "Duet", git_url="https://...")
        Scanner(db, repos_path=builder.get_repos_path()).scan()

        result = WorkspaceService(db).get_orientation(
            str(builder.get_repo_path("Duet"))
        )

        assert "components" not in result

    def test_orientation_no_top_level_key_files(
        self, tmp_path: Path, db: DatabaseManager, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """The legacy `key_files` at top level is gone."""
        builder = DuetDataBuilder(tmp_path)
        builder.add_root_context("Root")
        builder.add_repo("Duet", components=[])
        builder.build(monkeypatch)

        root_path = builder.get_root_context_path(0)
        product_path = root_path / "Duet"
        product_path.mkdir()
        ManifestBuilder.context(product_path, "Duet", git_url="https://...")
        repo_path = builder.get_repo_path("Duet")
        spec_dir = repo_path / "spec"
        spec_dir.mkdir()
        (spec_dir / "PRODUCT.md").write_text("# Duet\n\nThe product.")
        Scanner(db, repos_path=builder.get_repos_path()).scan()

        result = WorkspaceService(db).get_orientation(str(repo_path))

        assert "key_files" not in result

    def test_path_contract_absolute_in_workspace(
        self, tmp_path: Path, db: DatabaseManager, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """`context_folder` and `git_folders[*]` are absolute paths."""
        builder = DuetDataBuilder(tmp_path)
        builder.add_root_context("Root")
        builder.add_repo("Duet", components=[])
        builder.build(monkeypatch)

        root_path = builder.get_root_context_path(0)
        product_path = root_path / "Duet"
        product_path.mkdir()
        ManifestBuilder.context(product_path, "Duet", git_url="https://...")
        Scanner(db, repos_path=builder.get_repos_path()).scan()

        result = WorkspaceService(db).get_orientation(
            str(builder.get_repo_path("Duet"))
        )

        ws = result["workspace"]
        assert Path(ws["context_folder"]).is_absolute()
        for path in ws["git_folders"].values():
            assert Path(path).is_absolute()

    def test_path_contract_at_ref_for_products(
        self, tmp_path: Path, db: DatabaseManager, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """`product.path` is an @-ref."""
        builder = DuetDataBuilder(tmp_path)
        builder.add_root_context("Root")
        builder.add_repo("Duet", components=[])
        builder.build(monkeypatch)

        root_path = builder.get_root_context_path(0)
        product_path = root_path / "Duet"
        product_path.mkdir()
        ManifestBuilder.context(product_path, "Duet", git_url="https://...")
        Scanner(db, repos_path=builder.get_repos_path()).scan()

        result = WorkspaceService(db).get_orientation(
            str(builder.get_repo_path("Duet"))
        )

        for product in result["products"]:
            assert product["path"].startswith("@"), product["path"]

    def test_path_contract_relative_for_components(
        self, tmp_path: Path, db: DatabaseManager, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """`component.path` is relative (no `/` prefix, no `@` prefix)."""
        builder = DuetDataBuilder(tmp_path)
        builder.add_root_context("Root")
        builder.add_repo("Duet", components=["backend", "extension"])
        builder.build(monkeypatch)

        root_path = builder.get_root_context_path(0)
        product_path = root_path / "Duet"
        product_path.mkdir()
        ManifestBuilder.context(product_path, "Duet", git_url="https://...")
        Scanner(db, repos_path=builder.get_repos_path()).scan()

        repo_path = builder.get_repo_path("Duet")
        for pkg in ("backend", "extension"):
            (repo_path / "packages" / pkg / "spec").mkdir(parents=True)
            (repo_path / "packages" / pkg / "spec" / "COMPONENT.md").write_text(
                f"# {pkg}\n\nA component."
            )

        result = WorkspaceService(db).get_orientation(str(repo_path))

        products = result["products"]
        assert products
        for product in products:
            for comp in product.get("components", []):
                assert not comp["path"].startswith("/"), comp["path"]
                assert not comp["path"].startswith("@"), comp["path"]


class TestOrientationGitFolders:
    """git_folders behavior across single-repo and multi-repo contexts."""

    def test_single_repo_git_folders_present(
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

        result = WorkspaceService(db).get_orientation(
            str(builder.get_repo_path("Duet"))
        )

        assert result["workspace"]["git_folders"] == {
            "Duet": str(builder.get_repo_path("Duet"))
        }

    def test_multi_repo_git_folders_present(
        self, tmp_path: Path, db: DatabaseManager, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """A context with two git_repos surfaces both aliases in git_folders
        in manifest order."""
        builder = DuetDataBuilder(tmp_path)
        builder.add_root_context("Root")
        builder.add_repo("Duet", components=[])
        builder.add_repo("Duet-Instructions", components=[])
        builder.build(monkeypatch)

        root_path = builder.get_root_context_path(0)
        lab_path = root_path / "DuetLab"
        lab_path.mkdir()
        ManifestBuilder.context(
            lab_path, "DuetLab",
            git_repos={
                "Duet": "https://duet.git",
                "Duet-Instructions": "https://duet-instructions.git",
            },
        )
        Scanner(db, repos_path=builder.get_repos_path()).scan()

        result = WorkspaceService(db).get_orientation(
            str(builder.get_repo_path("Duet"))
        )

        ws = result["workspace"]
        assert ws["context_name"] == "DuetLab"
        # Order matches manifest insertion order
        assert list(ws["git_folders"]) == ["Duet", "Duet-Instructions"]
        assert ws["git_folders"]["Duet"] == str(builder.get_repo_path("Duet"))
        assert ws["git_folders"]["Duet-Instructions"] == str(
            builder.get_repo_path("Duet-Instructions")
        )

    def test_intermediate_context_empty_git_folders(
        self, tmp_path: Path, db: DatabaseManager, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        builder = DuetDataBuilder(tmp_path)
        builder.add_root_context("Root")
        builder.build(monkeypatch)
        Scanner(db).scan()

        result = WorkspaceService(db).get_orientation(
            str(builder.get_root_context_path(0))
        )

        ws = result["workspace"]
        assert ws["kind"] == "context"
        assert ws["git_folders"] == {}

    def test_git_folders_include_declared_aliases_even_without_clone(
        self, tmp_path: Path, db: DatabaseManager, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """A declared `git_repos` alias whose clone is missing still surfaces
        in `git_folders` with its expected path. Rule A in §2.2 is
        unconditional — a declared product is a product regardless of
        on-disk state. Consumers (Extension) decide whether to clone by
        checking `Path(git_folders[alias]).exists()`.
        """
        builder = DuetDataBuilder(tmp_path)
        builder.add_root_context("Root")
        # An unrelated repo exists, so repos/ is created. The "Missing"
        # alias under test is the second one and has no clone.
        builder.add_repo("Other", components=[])
        builder.build(monkeypatch)

        root_path = builder.get_root_context_path(0)
        lab_path = root_path / "Lab"
        lab_path.mkdir()
        ManifestBuilder.context(
            lab_path, "Lab",
            git_repos={
                "Other": "https://example.com/other.git",
                "Missing": "https://example.com/missing.git",
            },
        )
        Scanner(db, repos_path=builder.get_repos_path()).scan()

        result = WorkspaceService(db).get_orientation(str(lab_path))

        ws = result["workspace"]
        assert "Missing" in ws["git_folders"]
        expected = builder.get_repos_path() / "Missing.git"
        assert ws["git_folders"]["Missing"] == str(expected)
        # Clone doesn't actually exist on disk
        assert not expected.exists()

        # And the product is still emitted (rule A unconditional)
        products = result["products"]
        assert [p["name"] for p in products] == ["Other.git", "Missing.git"]
        missing = products[1]
        assert missing["path"] == "@Missing.git"
        # No spec / no description / no components when clone is missing
        assert "spec" not in missing
        assert "description" not in missing
        assert missing["components"] == []


class TestOrientationMetaContext:
    """Meta-context retains its addon fields on top of the canonical four."""

    def test_meta_context_addons(
        self, tmp_path: Path, db: DatabaseManager, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        builder = DuetDataBuilder(tmp_path)
        builder.add_root_context("MetaCtx", "MetaCtx", meta=True)
        builder.add_root_context("Other", "Other")
        builder.build(monkeypatch)
        Scanner(db).scan()

        result = WorkspaceService(db).get_orientation(
            str(builder.get_root_context_path(0))
        )

        ws = result["workspace"]
        assert ws["kind"] == "context"
        assert ws["context_name"] == "MetaCtx"
        assert "root_context_folders" in ws
        assert "duet_data_folder" in ws
        assert "MetaCtx" in ws["root_context_folders"]
        assert "Other" in ws["root_context_folders"]


class TestOrientationProducts:
    """Top-level products[] block (§3.2)."""

    def test_single_git_product_with_components(
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
        (repo_path / "spec").mkdir()
        (repo_path / "spec" / "PRODUCT.md").write_text(
            "# Duet\n\nA platform.", encoding="utf-8",
        )
        (repo_path / "packages" / "backend" / "spec").mkdir(parents=True)
        (repo_path / "packages" / "backend" / "spec" / "COMPONENT.md").write_text(
            "# Backend\n\nPython HTTP API.", encoding="utf-8",
        )

        result = WorkspaceService(db).get_orientation(str(repo_path))

        products = result["products"]
        assert len(products) == 1
        duet = products[0]
        assert duet["name"] == "Duet.git"
        assert duet["path"] == "@Duet.git"
        assert duet["spec"] == "spec/PRODUCT.md"
        assert duet["description"] == "A platform."

        comps = duet["components"]
        assert len(comps) == 1
        be = comps[0]
        assert be["name"] == "backend"
        assert be["path"] == "packages/backend"
        assert be["spec"] == "spec/COMPONENT.md"
        assert be["description"] == "Python HTTP API."

    def test_multi_git_products_in_manifest_order(
        self, tmp_path: Path, db: DatabaseManager, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """DuetLab-style multi-repo context surfaces both products in manifest order."""
        builder = DuetDataBuilder(tmp_path)
        builder.add_root_context("Root")
        builder.add_repo("Duet", components=[])
        builder.add_repo("Duet-Instructions", components=[])
        builder.build(monkeypatch)

        root_path = builder.get_root_context_path(0)
        lab_path = root_path / "DuetLab"
        lab_path.mkdir()
        ManifestBuilder.context(
            lab_path, "DuetLab",
            git_repos={
                "Duet": "https://duet.git",
                "Duet-Instructions": "https://duet-instructions.git",
            },
        )
        Scanner(db, repos_path=builder.get_repos_path()).scan()

        result = WorkspaceService(db).get_orientation(
            str(builder.get_repo_path("Duet"))
        )

        products = result["products"]
        assert [p["name"] for p in products] == ["Duet.git", "Duet-Instructions.git"]
        assert [p["path"] for p in products] == ["@Duet.git", "@Duet-Instructions.git"]

    def test_no_products_when_intermediate_context(
        self, tmp_path: Path, db: DatabaseManager, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        builder = DuetDataBuilder(tmp_path)
        builder.add_root_context("Root")
        builder.build(monkeypatch)
        Scanner(db).scan()

        result = WorkspaceService(db).get_orientation(
            str(builder.get_root_context_path(0))
        )

        assert result["products"] == []


class TestOrientationContextChain:
    """`context.chain[*]` description priority + structure."""

    def test_chain_description_priority_manifest_over_readme(
        self, tmp_path: Path, db: DatabaseManager, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Manifest's `description` field wins over README first sentence."""
        builder = DuetDataBuilder(tmp_path)
        builder.add_root_context("Root")
        builder.build(monkeypatch)

        root_path = builder.get_root_context_path(0)
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

    def test_chain_passes_manifest_icon_through(
        self, tmp_path: Path, db: DatabaseManager, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """`chain[*].icon` mirrors `Entity.icon` from the manifest."""
        builder = DuetDataBuilder(tmp_path)
        builder.add_root_context("Root")
        builder.build(monkeypatch)

        root_path = builder.get_root_context_path(0)
        ManifestBuilder.context(root_path, "Root", icon="🎭")
        Scanner(db).scan()

        result = WorkspaceService(db).get_orientation(str(root_path))

        chain = result["context"]["chain"]
        assert chain[0]["icon"] == "🎭"

    def test_chain_uses_scanner_default_icon_when_manifest_has_none(
        self, tmp_path: Path, db: DatabaseManager, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Scanner default `📁` (intermediate) is preserved through orientation."""
        builder = DuetDataBuilder(tmp_path)
        builder.add_root_context("Root")
        builder.build(monkeypatch)
        Scanner(db).scan()

        result = WorkspaceService(db).get_orientation(
            str(builder.get_root_context_path(0))
        )

        chain = result["context"]["chain"]
        assert chain[0]["icon"] == "📁"


class TestOrientationReferenceRepos:
    """`workspace.reference_repos` addon survives the new shape."""

    def test_reference_repos_addon(
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
        assert ws["kind"] == "context"
        assert "reference_repos" in ws
        assert "cookbook.git" in ws["reference_repos"]


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


class TestResolveMultiPath:
    """_resolve_multi_path: meta wins, multi-repo paths unify to one owner."""

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
        builder = DuetDataBuilder(tmp_path)
        builder.add_root_context("Solo")
        builder.build(monkeypatch)
        Scanner(db).scan()

        path = str(builder.get_root_context_path(0))
        result = WorkspaceService(db)._resolve_multi_path([path])
        assert result is not None
        assert result.name == "Solo"

    def test_returns_none_when_no_entities_resolve(
        self, tmp_path: Path, db: DatabaseManager, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        builder = DuetDataBuilder(tmp_path)
        builder.add_root_context("Solo")
        builder.build(monkeypatch)
        Scanner(db).scan()

        result = WorkspaceService(db)._resolve_multi_path(["/nowhere/at/all"])
        assert result is None

    def test_resolve_multi_path_unifies_to_owner(
        self, tmp_path: Path, db: DatabaseManager, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """DuetLab scenario: opening `[repos/Duet.git, repos/Duet-Instructions.git,
        DuetLab Drive]` simultaneously must resolve to the single DuetLab context.

        Each `repos/<alias>.git` path goes through its `product_repo` entity
        whose parent is the owning context — all three paths converge on DuetLab.
        """
        builder = DuetDataBuilder(tmp_path)
        builder.add_root_context("Root")
        builder.add_repo("Duet", components=[])
        builder.add_repo("Duet-Instructions", components=[])
        builder.build(monkeypatch)

        root_path = builder.get_root_context_path(0)
        lab_path = root_path / "DuetLab"
        lab_path.mkdir()
        ManifestBuilder.context(
            lab_path, "DuetLab",
            git_repos={
                "Duet": "https://duet.git",
                "Duet-Instructions": "https://duet-instructions.git",
            },
        )
        Scanner(db, repos_path=builder.get_repos_path()).scan()

        service = WorkspaceService(db)
        paths = [
            str(builder.get_repo_path("Duet")),
            str(builder.get_repo_path("Duet-Instructions")),
            str(lab_path),
        ]
        # Each path independently must resolve to the same owning context —
        # this is what makes "unification" non-trivial. A simpler test where
        # the first path already resolves correctly wouldn't catch
        # regressions in path 2 (or in `_resolve_from_repos` for a different
        # alias). Pin the per-path contract first.
        ids = [service._resolve_entity(p) for p in paths]
        assert all(e is not None for e in ids)
        assert all(e.name == "DuetLab" for e in ids), (
            f"Per-path resolution diverged: {[e.name for e in ids]}"
        )

        result = service._resolve_multi_path(paths)
        assert result is not None
        assert result.name == "DuetLab"
