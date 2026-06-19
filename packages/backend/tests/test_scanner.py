"""Tests for scanner.py — strict v3 reader, multi-repo contexts."""

import json
from pathlib import Path

import pytest

import sys
sys.path.insert(0, str(Path(__file__).parent.parent))

from db import DatabaseManager
from scanner import Scanner

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
        """Scans full hierarchy: root → mid → context-with-git_repos."""
        root_path = tmp_path / "Root"
        root_path.mkdir()
        ManifestBuilder.context(root_path, "Root")

        mid_path = root_path / "Mid"
        mid_path.mkdir()
        ManifestBuilder.context(mid_path, "Mid")

        product_path = mid_path / "Product"
        product_path.mkdir()
        ManifestBuilder.context(
            product_path, "Product",
            git_repos={"Product": "https://example.com/p.git"},
        )

        monkeypatch.setattr(
            "scanner.get_root_context_folders",
            lambda: [str(root_path)]
        )

        scanner = Scanner(db, repos_path=tmp_path / "repos")
        result = scanner.scan()

        # 3 contexts + 1 product_repo for the git-backed context
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
        assert product_repo is not None
        assert product_repo.type == "product_repo"
        assert product_repo.parent_id == product.id
        assert product_repo.git_url == "https://example.com/p.git"

    def test_scan_multi_repo_context_registers_n_product_repos(
        self, db: DatabaseManager, tmp_path: Path, monkeypatch
    ) -> None:
        """A context with two `git_repos` aliases yields two product_repo children."""
        root_path = tmp_path / "Lab"
        root_path.mkdir()
        ManifestBuilder.context(
            root_path, "Lab",
            git_repos={
                "Duet": "https://github.com/owner/duet.git",
                "Duet-Instructions": "https://github.com/owner/duet-instructions.git",
            },
        )

        monkeypatch.setattr(
            "scanner.get_root_context_folders",
            lambda: [str(root_path)]
        )

        result = Scanner(db).scan()
        assert result["status"] == "completed"
        # 1 context + 2 product_repos
        assert result["entities_count"] == 3

        lab = db.find_by_name("Lab")
        duet = db.find_by_name("Duet.git")
        di = db.find_by_name("Duet-Instructions.git")

        assert lab is not None
        for repo, expected_url in (
            (duet, "https://github.com/owner/duet.git"),
            (di, "https://github.com/owner/duet-instructions.git"),
        ):
            assert repo is not None
            assert repo.type == "product_repo"
            assert repo.parent_id == lab.id
            assert repo.git_url == expected_url

    def test_multi_repo_context_recurses_drive_children(
        self, db: DatabaseManager, tmp_path: Path, monkeypatch
    ) -> None:
        """A context with `git_repos` still scans Drive child contexts."""
        root_path = tmp_path / "Lab"
        root_path.mkdir()
        ManifestBuilder.context(
            root_path, "Lab",
            git_repos={"Duet": "https://duet.git"},
        )

        # Nested folder that *would* register if recursion happened.
        deep = root_path / "DeepChild"
        deep.mkdir()
        ManifestBuilder.context(deep, "DeepChild")

        monkeypatch.setattr(
            "scanner.get_root_context_folders",
            lambda: [str(root_path)]
        )

        Scanner(db).scan()
        lab = db.find_by_name("Lab")
        deep_child = db.find_by_name("DeepChild")
        duet_repo = db.find_by_name("Duet.git")

        assert lab is not None
        assert deep_child is not None
        assert deep_child.type == "context"
        assert deep_child.parent_id == lab.id
        assert duet_repo is not None
        assert duet_repo.type == "product_repo"
        assert duet_repo.parent_id == lab.id

    def test_context_with_git_recurses_drive_children(
        self, db: DatabaseManager, tmp_path: Path, monkeypatch
    ) -> None:
        """Single-repo `git_repos` context also scans Drive child contexts."""
        root_path = tmp_path / "Root"
        root_path.mkdir()
        ManifestBuilder.context(root_path, "Root")

        product_path = root_path / "Product"
        product_path.mkdir()
        ManifestBuilder.context(
            product_path, "Product",
            git_repos={"Product": "https://example.com/p.git"},
        )

        deep = product_path / "DeepChild"
        deep.mkdir()
        ManifestBuilder.context(deep, "DeepChild")

        monkeypatch.setattr(
            "scanner.get_root_context_folders",
            lambda: [str(root_path)]
        )

        Scanner(db).scan()

        product = db.find_by_name("Product")
        deep_child = db.find_by_name("DeepChild")
        product_repo = db.find_by_name("Product.git")

        assert product is not None
        assert deep_child is not None
        assert deep_child.type == "context"
        assert deep_child.parent_id == product.id
        assert product_repo is not None
        assert product_repo.type == "product_repo"
        assert product_repo.parent_id == product.id

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
        ManifestBuilder.context(
            product_path, "Product",
            git_repos={"Product": "https://example.com/p.git"},
        )

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
        """Manifest with `version: 4` but missing `name` must not register
        a context under the folder name. Strict reader rejects malformed
        shape with `invalid_manifest`; scanner skips.
        """
        ctx_path = tmp_path / "MyFolder"
        ctx_path.mkdir()
        (ctx_path / "context.json").write_text(
            json.dumps({"version": 4}),  # no `name`
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
        """`version != 3` produces unrecognized_manifest_version warning, no entity created."""
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
            product_path, "DeepProduct",
            git_repos={"DeepProduct": "https://example.com/d.git"},
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

        p1 = root_path / "Inner"
        p1.mkdir()
        ManifestBuilder.context(
            p1, "Inner",
            git_repos={"Lib": "https://github.com/test/lib"},
        )

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
