"""Tests for scanner.py - hierarchy scanner (strict v2 reader)."""

import json
from pathlib import Path

import pytest

import sys
sys.path.insert(0, str(Path(__file__).parent.parent))

from db import DatabaseManager
from scanner import Scanner, scan_components

from tests.fixtures import ManifestBuilder


class TestScanner:
    """Tests for Scanner class."""

    def test_scan_empty(self, db: DatabaseManager, monkeypatch) -> None:
        """Scanning with no root context folders returns empty."""
        monkeypatch.setattr(
            "scanner.get_root_context_folders",
            lambda: []
        )

        scanner = Scanner(db)
        result = scanner.scan()

        assert result["status"] == "completed"
        assert result["entities_count"] == 0

    def test_scan_root_context(self, db: DatabaseManager, tmp_path: Path, monkeypatch) -> None:
        """Scans a root context folder with manifest."""
        ctx_path = tmp_path / "MyContext"
        ctx_path.mkdir()
        ManifestBuilder.context(ctx_path, "My Context", icon="🏢")

        monkeypatch.setattr(
            "scanner.get_root_context_folders",
            lambda: [str(ctx_path)]
        )

        scanner = Scanner(db)
        result = scanner.scan()

        assert result["status"] == "completed"
        assert result["entities_count"] == 1

        entities = db.get_all_entities()
        assert len(entities) == 1
        assert entities[0].type == "context"
        assert entities[0].name == "My Context"
        assert entities[0].icon == "🏢"

    def test_scan_meta_context(self, db: DatabaseManager, tmp_path: Path, monkeypatch) -> None:
        """Scanner reads `meta: true` and stores it on the entity."""
        ctx_path = tmp_path / "Meta"
        ctx_path.mkdir()
        ManifestBuilder.context(ctx_path, "Meta", meta=True)

        monkeypatch.setattr(
            "scanner.get_root_context_folders",
            lambda: [str(ctx_path)]
        )

        Scanner(db).scan()

        meta = db.find_by_name("Meta")
        assert meta is not None
        assert meta.meta is True
        assert db.find_meta_context() == meta

    def test_scan_hierarchy(self, db: DatabaseManager, tmp_path: Path, monkeypatch) -> None:
        """Scans full hierarchy: root → mid → terminal-with-git."""
        root_path = tmp_path / "Root"
        root_path.mkdir()
        ManifestBuilder.context(root_path, "Root")

        mid_path = root_path / "Mid"
        mid_path.mkdir()
        ManifestBuilder.context(mid_path, "Mid")

        product_path = mid_path / "Product"
        product_path.mkdir()
        ManifestBuilder.context(product_path, "Product", git_url="https://example.com/p.git")

        monkeypatch.setattr(
            "scanner.get_root_context_folders",
            lambda: [str(root_path)]
        )

        scanner = Scanner(db, repos_path=tmp_path / "repos")
        result = scanner.scan()

        # 3 contexts + 1 product_repo for the terminal
        assert result["entities_count"] == 4

        contexts = db.get_contexts()
        names = {e.name for e in contexts}
        assert names == {"Root", "Mid", "Product"}

        root = db.find_by_name("Root")
        mid = db.find_by_name("Mid")
        product = db.find_by_name("Product")
        product_repo = db.find_by_name("Product.git")

        assert root.parent_id is None
        assert mid.parent_id == root.id
        assert product.parent_id == mid.id
        assert product.git_url == "https://example.com/p.git"
        assert product_repo is not None
        assert product_repo.type == "product_repo"
        assert product_repo.parent_id == product.id

    def test_terminal_with_git_does_not_recurse(
        self, db: DatabaseManager, tmp_path: Path, monkeypatch
    ) -> None:
        """Context with git_url is terminal — scanner stops, even if children have manifests."""
        root_path = tmp_path / "Root"
        root_path.mkdir()
        ManifestBuilder.context(root_path, "Root")

        product_path = root_path / "Product"
        product_path.mkdir()
        ManifestBuilder.context(product_path, "Product", git_url="https://example.com/p.git")

        # A folder inside the terminal that *would* be scanned if recursion happened.
        deep = product_path / "DeepChild"
        deep.mkdir()
        ManifestBuilder.context(deep, "DeepChild")

        monkeypatch.setattr(
            "scanner.get_root_context_folders",
            lambda: [str(root_path)]
        )

        Scanner(db).scan()

        assert db.find_by_name("DeepChild") is None

    def test_projects_folders_ignored(self, db: DatabaseManager, tmp_path: Path, monkeypatch) -> None:
        """projects/ subdirectories without manifest don't become entities."""
        root_path = tmp_path / "Root"
        root_path.mkdir()
        ManifestBuilder.context(root_path, "Root")

        # projects/ without manifest — scanner recurses but finds nothing
        projects_path = root_path / "projects"
        projects_path.mkdir()
        (projects_path / "ProjectA").mkdir()

        product_path = root_path / "Product"
        product_path.mkdir()
        ManifestBuilder.context(product_path, "Product", git_url="https://example.com/p.git")
        prod_projects = product_path / "projects"
        prod_projects.mkdir()
        (prod_projects / "ProjectB").mkdir()

        monkeypatch.setattr(
            "scanner.get_root_context_folders",
            lambda: [str(root_path)]
        )

        result = Scanner(db).scan()

        # Root + Product (context) + Product.git (product_repo)
        assert result["entities_count"] == 3
        contexts = db.get_contexts()
        assert {e.name for e in contexts} == {"Root", "Product"}

    def test_name_conflict_same_type(self, db: DatabaseManager, tmp_path: Path, monkeypatch) -> None:
        """Same-name contexts get suffix on the second-comer."""
        ctx1_path = tmp_path / "Ctx1"
        ctx1_path.mkdir()
        ManifestBuilder.context(ctx1_path, "SameName")

        ctx2_path = tmp_path / "Ctx2"
        ctx2_path.mkdir()
        ManifestBuilder.context(ctx2_path, "SameName")

        monkeypatch.setattr(
            "scanner.get_root_context_folders",
            lambda: [str(ctx1_path), str(ctx2_path)]
        )

        Scanner(db).scan()

        names = {e.name for e in db.get_all_entities()}
        assert "SameName" in names
        assert "SameName (1)" in names

    def test_deterministic_order(self, db: DatabaseManager, tmp_path: Path, monkeypatch) -> None:
        """Scan order is deterministic (sorted by name)."""
        root_path = tmp_path / "Root"
        root_path.mkdir()
        ManifestBuilder.context(root_path, "Root")

        for name in ["Zebra", "Apple", "Mango"]:
            p = root_path / name
            p.mkdir()
            ManifestBuilder.context(p, name)

        monkeypatch.setattr(
            "scanner.get_root_context_folders",
            lambda: [str(root_path)]
        )

        Scanner(db).scan()

        children = db.get_entities(parent_id=db.find_by_name("Root").id)
        names = [c.name for c in children]
        assert names == sorted(names)

    def test_skip_hidden_folders(self, db: DatabaseManager, tmp_path: Path, monkeypatch) -> None:
        """Hidden folders (starting with .) are skipped."""
        root_path = tmp_path / "Root"
        root_path.mkdir()
        ManifestBuilder.context(root_path, "Root")

        hidden_path = root_path / ".hidden"
        hidden_path.mkdir()
        ManifestBuilder.context(hidden_path, "Hidden")

        normal_path = root_path / "Normal"
        normal_path.mkdir()
        ManifestBuilder.context(normal_path, "Normal")

        monkeypatch.setattr(
            "scanner.get_root_context_folders",
            lambda: [str(root_path)]
        )

        Scanner(db).scan()

        names = {e.name for e in db.get_all_entities()}
        assert "Normal" in names
        assert "Hidden" not in names


class TestScannerEdgeCases:
    """Edge case tests for Scanner."""

    def test_scan_nonexistent_root_folder(self, db: DatabaseManager, monkeypatch) -> None:
        """Folder that doesn't exist on disk is skipped."""
        monkeypatch.setattr(
            "scanner.get_root_context_folders",
            lambda: ["/nonexistent/path/that/does/not/exist"]
        )

        result = Scanner(db).scan()

        assert result["status"] == "completed"
        assert result["entities_count"] == 0

    def test_root_folder_without_manifest_skipped(
        self, db: DatabaseManager, tmp_path: Path, monkeypatch
    ) -> None:
        """Root context folder without `context.json` is skipped silently.

        Backend is strict reader; Host owns creation of missing manifests.
        """
        ctx_path = tmp_path / "NoManifest"
        ctx_path.mkdir()

        monkeypatch.setattr(
            "scanner.get_root_context_folders",
            lambda: [str(ctx_path)]
        )

        result = Scanner(db).scan()

        assert result["status"] == "completed"
        assert result["entities_count"] == 0
        assert result["errors"] == []

    def test_invalid_json_manifest(
        self, db: DatabaseManager, tmp_path: Path, monkeypatch
    ) -> None:
        """Corrupt JSON in `context.json` produces invalid_manifest error."""
        ctx_path = tmp_path / "Bad"
        ctx_path.mkdir()
        (ctx_path / "context.json").write_text("{corrupt json!!!", encoding="utf-8")

        monkeypatch.setattr(
            "scanner.get_root_context_folders",
            lambda: [str(ctx_path)]
        )

        result = Scanner(db).scan()

        assert result["entities_count"] == 0
        invalid = [e for e in result["errors"] if e["reason_code"] == "invalid_manifest"]
        assert len(invalid) == 1

    def test_malformed_manifest_no_silent_repair(
        self, db: DatabaseManager, tmp_path: Path, monkeypatch
    ) -> None:
        """Manifest with `version: 2` but missing `name` must not register
        a context under the folder name. Strict reader rejects malformed
        shape with `invalid_manifest`; scanner skips.
        """
        ctx_path = tmp_path / "MyFolder"
        ctx_path.mkdir()
        (ctx_path / "context.json").write_text(
            json.dumps({"version": 2}),  # no `name`
            encoding="utf-8",
        )

        monkeypatch.setattr(
            "scanner.get_root_context_folders",
            lambda: [str(ctx_path)]
        )

        result = Scanner(db).scan()

        # No silent fall-back to folder name.
        assert db.find_by_name("MyFolder") is None
        assert result["entities_count"] == 0

        codes = {e["reason_code"] for e in result["errors"]}
        assert "invalid_manifest" in codes

    def test_unrecognized_version_skipped(
        self, db: DatabaseManager, tmp_path: Path, monkeypatch
    ) -> None:
        """`version != 2` produces unrecognized_manifest_version warning, no entity created."""
        ctx_path = tmp_path / "Future"
        ctx_path.mkdir()
        (ctx_path / "context.json").write_text(
            json.dumps({"version": 99, "name": "Future"}),
            encoding="utf-8",
        )

        monkeypatch.setattr(
            "scanner.get_root_context_folders",
            lambda: [str(ctx_path)]
        )

        result = Scanner(db).scan()

        assert result["entities_count"] == 0
        codes = {e["reason_code"] for e in result["errors"]}
        assert "unrecognized_manifest_version" in codes

    def test_scan_reentrancy_guard(self, db: DatabaseManager, monkeypatch) -> None:
        """scan() returns 'skipped' if already in progress."""
        monkeypatch.setattr(
            "scanner.get_root_context_folders",
            lambda: []
        )

        scanner = Scanner(db)
        scanner._scan_in_progress = True

        result = scanner.scan()

        assert result["status"] == "skipped"
        assert "already in progress" in result["reason"]

    def test_scan_intermediate_folder_without_manifest(
        self, db: DatabaseManager, tmp_path: Path, monkeypatch
    ) -> None:
        """Folder without any manifest recurses to find deeper contexts."""
        root_path = tmp_path / "Root"
        root_path.mkdir()
        ManifestBuilder.context(root_path, "Root")

        intermediate = root_path / "SomeFolder"
        intermediate.mkdir()
        product_path = intermediate / "DeepProduct"
        product_path.mkdir()
        ManifestBuilder.context(
            product_path, "DeepProduct", git_url="https://example.com/d.git",
        )

        monkeypatch.setattr(
            "scanner.get_root_context_folders",
            lambda: [str(root_path)]
        )

        result = Scanner(db).scan()

        # Root + DeepProduct + DeepProduct.git
        assert result["entities_count"] == 3
        deep = db.find_by_name("DeepProduct")
        assert deep is not None
        assert deep.type == "context"
        # Parent should be Root (intermediate folder is not an entity)
        assert deep.parent_id == db.find_by_name("Root").id


class TestScanErrors:
    """Tests for structured error collection during scan."""

    def test_name_collision_error(
        self, db: DatabaseManager, tmp_path: Path, monkeypatch
    ) -> None:
        root_path = tmp_path / "Root"
        root_path.mkdir()
        ManifestBuilder.context(root_path, "Root")

        s1 = root_path / "ChildA"
        s1.mkdir()
        ManifestBuilder.context(s1, "Conflict")
        s2 = root_path / "ChildB"
        s2.mkdir()
        ManifestBuilder.context(s2, "Conflict")

        monkeypatch.setattr(
            "scanner.get_root_context_folders",
            lambda: [str(root_path)]
        )

        result = Scanner(db).scan()

        collisions = [e for e in result["errors"] if e["reason_code"] == "name_collision"]
        assert len(collisions) == 1
        assert "Conflict" in collisions[0]["description"]

    def test_invalid_manifest_error(
        self, db: DatabaseManager, tmp_path: Path, monkeypatch
    ) -> None:
        root_path = tmp_path / "Root"
        root_path.mkdir()
        ManifestBuilder.context(root_path, "Root")

        bad_path = root_path / "Bad"
        bad_path.mkdir()
        (bad_path / "context.json").write_text("{not valid json!!!", encoding="utf-8")

        monkeypatch.setattr(
            "scanner.get_root_context_folders",
            lambda: [str(root_path)]
        )

        result = Scanner(db).scan()

        invalid_errors = [e for e in result["errors"] if e["reason_code"] == "invalid_manifest"]
        assert len(invalid_errors) == 1
        assert "context.json" in invalid_errors[0]["description"]

    def test_repo_collision_error(
        self, db: DatabaseManager, tmp_path: Path, monkeypatch
    ) -> None:
        """Product repo vs reference_repo name collision produces repo_collision."""
        root_path = tmp_path / "Root"
        root_path.mkdir()
        ManifestBuilder.context(
            root_path, "Root",
            reference_repos={"Lib": "https://github.com/test/lib-ref"},
        )

        p1 = root_path / "Lib"
        p1.mkdir()
        ManifestBuilder.context(p1, "Lib", git_url="https://github.com/test/lib")

        monkeypatch.setattr(
            "scanner.get_root_context_folders",
            lambda: [str(root_path)]
        )

        result = Scanner(db).scan()

        repo_errors = [e for e in result["errors"] if e["reason_code"] == "repo_collision"]
        assert len(repo_errors) >= 1
        assert "Lib.git" in repo_errors[0]["description"]
        # Error path points to the manifest for Fix button
        assert "context.json" in repo_errors[0]["path"]

    def test_errors_empty_on_clean_scan(
        self, db: DatabaseManager, tmp_path: Path, monkeypatch
    ) -> None:
        root_path = tmp_path / "Root"
        root_path.mkdir()
        ManifestBuilder.context(root_path, "Root")

        monkeypatch.setattr(
            "scanner.get_root_context_folders",
            lambda: [str(root_path)]
        )

        result = Scanner(db).scan()

        assert result["errors"] == []


class TestScanComponents:
    """Tests for scan_components() function."""

    def test_empty_when_no_packages(self, tmp_path: Path) -> None:
        product_path = tmp_path / "product"
        product_path.mkdir()

        result = scan_components(product_path)
        assert result == []

    def test_scans_packages_directory(self, tmp_path: Path) -> None:
        product_path = tmp_path / "product"
        packages_path = product_path / "packages"
        packages_path.mkdir(parents=True)

        (packages_path / "component-a").mkdir()
        (packages_path / "component-b").mkdir()

        result = scan_components(product_path)

        assert len(result) == 2
        names = {c["name"] for c in result}
        assert names == {"component-a", "component-b"}

    def test_detects_spec_file(self, tmp_path: Path) -> None:
        product_path = tmp_path / "product"
        packages_path = product_path / "packages"

        comp_with_spec = packages_path / "with-spec"
        comp_with_spec.mkdir(parents=True)
        spec_dir = comp_with_spec / "spec"
        spec_dir.mkdir()
        (spec_dir / "COMPONENT.md").write_text("# With Spec\n\nA component.")

        comp_without_spec = packages_path / "without-spec"
        comp_without_spec.mkdir(parents=True)

        result = scan_components(product_path)

        by_name = {c["name"]: c for c in result}
        assert "spec" in by_name["with-spec"]
        assert by_name["with-spec"]["description"] == "A component."
        assert "spec" not in by_name["without-spec"]

    def test_returns_relative_paths(self, tmp_path: Path) -> None:
        product_path = tmp_path / "product"
        packages_path = product_path / "packages"
        (packages_path / "my-component").mkdir(parents=True)

        result = scan_components(product_path)

        assert result[0]["path"] == "packages/my-component"

    def test_sorted_by_name(self, tmp_path: Path) -> None:
        product_path = tmp_path / "product"
        packages_path = product_path / "packages"
        packages_path.mkdir(parents=True)

        for name in ["zebra", "apple", "mango"]:
            (packages_path / name).mkdir()

        result = scan_components(product_path)
        names = [c["name"] for c in result]

        assert names == ["apple", "mango", "zebra"]

    def test_skips_files(self, tmp_path: Path) -> None:
        product_path = tmp_path / "product"
        packages_path = product_path / "packages"
        packages_path.mkdir(parents=True)

        (packages_path / "real-component").mkdir()
        (packages_path / "README.md").write_text("# Packages")

        result = scan_components(product_path)

        assert len(result) == 1
        assert result[0]["name"] == "real-component"

    def test_skips_hidden_directories(self, tmp_path: Path) -> None:
        product_path = tmp_path / "product"
        packages_path = product_path / "packages"
        packages_path.mkdir(parents=True)

        (packages_path / "visible-component").mkdir()
        (packages_path / ".hidden-component").mkdir()

        result = scan_components(product_path)

        assert len(result) == 1
        assert result[0]["name"] == "visible-component"

    def test_spec_without_description(self, tmp_path: Path) -> None:
        product_path = tmp_path / "product"
        packages_path = product_path / "packages"
        comp_path = packages_path / "my-comp"
        comp_path.mkdir(parents=True)
        spec_dir = comp_path / "spec"
        spec_dir.mkdir()
        (spec_dir / "COMPONENT.md").write_text("## No H1 heading\n\nSome text.")

        result = scan_components(product_path)

        assert len(result) == 1
        assert "spec" in result[0]
        assert "description" not in result[0]
