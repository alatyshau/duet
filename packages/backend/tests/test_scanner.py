"""Tests for scanner.py - Hierarchy scanner."""

from pathlib import Path

import pytest

import sys
sys.path.insert(0, str(Path(__file__).parent.parent))

from db import DatabaseManager
from scanner import Scanner, scan_components

from tests.fixtures import ManifestBuilder, HierarchyBuilder


class TestScanner:
    """Tests for Scanner class."""

    def test_scan_empty(self, db: DatabaseManager, monkeypatch) -> None:
        """Scanning with no business folders returns empty."""
        monkeypatch.setattr(
            "scanner.get_business_folders",
            lambda: []
        )

        scanner = Scanner(db)
        result = scanner.scan()

        assert result["status"] == "completed"
        assert result["entities_count"] == 0

    def test_scan_business(self, db: DatabaseManager, tmp_path: Path, monkeypatch) -> None:
        """Scans a business folder with manifest."""
        biz_path = tmp_path / "MyBusiness"
        biz_path.mkdir()
        ManifestBuilder.business(biz_path, "My Business", "🏢")

        monkeypatch.setattr(
            "scanner.get_business_folders",
            lambda: [str(biz_path)]
        )

        scanner = Scanner(db)
        result = scanner.scan()

        assert result["status"] == "completed"
        assert result["entities_count"] == 1

        entities = db.get_all_entities()
        assert len(entities) == 1
        assert entities[0].type == "business"
        assert entities[0].name == "My Business"
        assert entities[0].icon == "🏢"

    def test_scan_hierarchy(self, db: DatabaseManager, tmp_path: Path, monkeypatch) -> None:
        """Scans full hierarchy: business -> stream -> product."""
        biz_path = tmp_path / "Business"
        biz_path.mkdir()
        ManifestBuilder.business(biz_path, "Business", "🏢")

        stream_path = biz_path / "Stream"
        stream_path.mkdir()
        ManifestBuilder.stream(stream_path, "Stream", "🌊")

        product_path = stream_path / "Product"
        product_path.mkdir()
        ManifestBuilder.product(product_path, "Product", "📦")

        monkeypatch.setattr(
            "scanner.get_business_folders",
            lambda: [str(biz_path)]
        )

        scanner = Scanner(db)
        result = scanner.scan()

        assert result["entities_count"] == 3

        entities = db.get_all_entities()
        types = {e.type for e in entities}
        assert types == {"business", "stream", "product"}

        # Check hierarchy
        business = db.find_by_name("Business")
        stream = db.find_by_name("Stream")
        product = db.find_by_name("Product")

        assert business.parent_id is None
        assert stream.parent_id == business.id
        assert product.parent_id == stream.id

    def test_scan_projects(self, db: DatabaseManager, tmp_path: Path, monkeypatch) -> None:
        """Scans projects folder inside product."""
        biz_path = tmp_path / "Business"
        biz_path.mkdir()
        ManifestBuilder.business(biz_path, "Business", "🏢")

        product_path = biz_path / "Product"
        product_path.mkdir()
        ManifestBuilder.product(product_path, "Product", "📦")

        projects_path = product_path / "projects"
        projects_path.mkdir()
        (projects_path / "ProjectA").mkdir()
        (projects_path / "ProjectB").mkdir()

        monkeypatch.setattr(
            "scanner.get_business_folders",
            lambda: [str(biz_path)]
        )

        scanner = Scanner(db)
        result = scanner.scan()

        # business + product + 2 projects = 4
        assert result["entities_count"] == 4

        projects = [e for e in db.get_all_entities() if e.type == "project"]
        assert len(projects) == 2
        names = {p.name for p in projects}
        assert names == {"ProjectA", "ProjectB"}

    def test_name_conflict_same_type(self, db: DatabaseManager, tmp_path: Path, monkeypatch) -> None:
        """Same-type entities with same name get suffix."""
        biz1_path = tmp_path / "Biz1"
        biz1_path.mkdir()
        ManifestBuilder.business(biz1_path, "SameName", "🏢")

        biz2_path = tmp_path / "Biz2"
        biz2_path.mkdir()
        ManifestBuilder.business(biz2_path, "SameName", "🏢")

        monkeypatch.setattr(
            "scanner.get_business_folders",
            lambda: [str(biz1_path), str(biz2_path)]
        )

        scanner = Scanner(db)
        scanner.scan()

        entities = db.get_all_entities()
        names = {e.name for e in entities}
        assert "SameName" in names
        assert "SameName (1)" in names

    def test_name_conflict_priority(self, db: DatabaseManager, tmp_path: Path, monkeypatch) -> None:
        """Higher-priority type claims the name, lower gets suffix."""
        biz_path = tmp_path / "Business"
        biz_path.mkdir()
        ManifestBuilder.business(biz_path, "Business", "🏢")

        product_path = biz_path / "Shared"
        product_path.mkdir()
        ManifestBuilder.product(product_path, "Shared", "📦")

        biz2_path = tmp_path / "Shared"
        biz2_path.mkdir()
        ManifestBuilder.business(biz2_path, "Shared", "🏢")

        monkeypatch.setattr(
            "scanner.get_business_folders",
            lambda: [str(biz_path), str(biz2_path)]
        )

        scanner = Scanner(db)
        scanner.scan()

        # Business should have "Shared", product should have "Shared (1)"
        business = [e for e in db.get_all_entities() if e.type == "business" and "Shared" in e.name]
        product = [e for e in db.get_all_entities() if e.type == "product"]

        assert any(b.name == "Shared" for b in business)
        assert product[0].name == "Shared (1)"

    def test_self_healing_create_manifest(self, db: DatabaseManager, tmp_path: Path, monkeypatch) -> None:
        """Creates business.json if missing at root."""
        biz_path = tmp_path / "MyBusiness"
        biz_path.mkdir()

        monkeypatch.setattr(
            "scanner.get_business_folders",
            lambda: [str(biz_path)]
        )

        scanner = Scanner(db)
        scanner.scan()

        assert (biz_path / "business.json").exists()

        entities = db.get_all_entities()
        assert len(entities) == 1
        assert entities[0].name == "MyBusiness"

    def test_self_healing_rename_stream_to_business(self, db: DatabaseManager, tmp_path: Path, monkeypatch) -> None:
        """Renames stream.json to business.json at root."""
        biz_path = tmp_path / "MyBusiness"
        biz_path.mkdir()
        ManifestBuilder.stream(biz_path, "My Business", "🌊")

        monkeypatch.setattr(
            "scanner.get_business_folders",
            lambda: [str(biz_path)]
        )

        scanner = Scanner(db)
        scanner.scan()

        assert (biz_path / "business.json").exists()
        assert not (biz_path / "stream.json").exists()

    def test_self_healing_rename_business_to_stream(self, db: DatabaseManager, tmp_path: Path, monkeypatch) -> None:
        """Renames business.json to stream.json inside chain."""
        biz_path = tmp_path / "Business"
        biz_path.mkdir()
        ManifestBuilder.business(biz_path, "Business", "🏢")

        stream_path = biz_path / "Stream"
        stream_path.mkdir()
        # Wrong manifest type - should be stream.json
        ManifestBuilder.business(stream_path, "Stream", "🌊")

        monkeypatch.setattr(
            "scanner.get_business_folders",
            lambda: [str(biz_path)]
        )

        scanner = Scanner(db)
        scanner.scan()

        assert (stream_path / "stream.json").exists()
        assert not (stream_path / "business.json").exists()

    def test_deterministic_order(self, db: DatabaseManager, tmp_path: Path, monkeypatch) -> None:
        """Scan order is deterministic (sorted by name)."""
        biz_path = tmp_path / "Business"
        biz_path.mkdir()
        ManifestBuilder.business(biz_path, "Business", "🏢")

        for name in ["Zebra", "Apple", "Mango"]:
            p = biz_path / name
            p.mkdir()
            ManifestBuilder.stream(p, name, "🌊")

        monkeypatch.setattr(
            "scanner.get_business_folders",
            lambda: [str(biz_path)]
        )

        scanner = Scanner(db)
        scanner.scan()

        streams = [e for e in db.get_all_entities() if e.type == "stream"]
        names = [s.name for s in streams]

        assert names == sorted(names)

    def test_skip_hidden_folders(self, db: DatabaseManager, tmp_path: Path, monkeypatch) -> None:
        """Hidden folders (starting with .) are skipped."""
        biz_path = tmp_path / "Business"
        biz_path.mkdir()
        ManifestBuilder.business(biz_path, "Business", "🏢")

        hidden_path = biz_path / ".hidden"
        hidden_path.mkdir()
        ManifestBuilder.stream(hidden_path, "Hidden", "🌊")

        normal_path = biz_path / "Normal"
        normal_path.mkdir()
        ManifestBuilder.stream(normal_path, "Normal", "🌊")

        monkeypatch.setattr(
            "scanner.get_business_folders",
            lambda: [str(biz_path)]
        )

        scanner = Scanner(db)
        scanner.scan()

        entities = db.get_all_entities()
        names = {e.name for e in entities}

        assert "Normal" in names
        assert "Hidden" not in names


    def test_scan_project_with_manifest(self, db: DatabaseManager, tmp_path: Path, monkeypatch) -> None:
        """Reads project.json manifest: name, icon, status."""
        biz_path = tmp_path / "Business"
        biz_path.mkdir()
        ManifestBuilder.business(biz_path, "Business", "🏢")

        projects_path = biz_path / "projects"
        projects_path.mkdir()
        project_path = projects_path / "my_project"
        project_path.mkdir()
        ManifestBuilder.project(project_path, "My Project", icon="🎭", status="active")

        monkeypatch.setattr("scanner.get_business_folders", lambda: [str(biz_path)])

        scanner = Scanner(db)
        scanner.scan()

        project = db.find_by_name("My Project")
        assert project is not None
        assert project.icon == "🎭"
        assert project.status == "active"

    def test_scan_project_without_manifest(self, db: DatabaseManager, tmp_path: Path, monkeypatch) -> None:
        """Project without project.json gets defaults: 📋 icon, status=None."""
        biz_path = tmp_path / "Business"
        biz_path.mkdir()
        ManifestBuilder.business(biz_path, "Business", "🏢")

        projects_path = biz_path / "projects"
        projects_path.mkdir()
        (projects_path / "bare_project").mkdir()

        monkeypatch.setattr("scanner.get_business_folders", lambda: [str(biz_path)])

        scanner = Scanner(db)
        scanner.scan()

        project = db.find_by_name("bare_project")
        assert project is not None
        assert project.icon == "📋"
        assert project.status is None

    def test_scan_project_manifest_without_status(self, db: DatabaseManager, tmp_path: Path, monkeypatch) -> None:
        """project.json without status field → status=None."""
        biz_path = tmp_path / "Business"
        biz_path.mkdir()
        ManifestBuilder.business(biz_path, "Business", "🏢")

        projects_path = biz_path / "projects"
        projects_path.mkdir()
        project_path = projects_path / "named_project"
        project_path.mkdir()
        ManifestBuilder.project(project_path, "Named Project", icon="📝")

        monkeypatch.setattr("scanner.get_business_folders", lambda: [str(biz_path)])

        scanner = Scanner(db)
        scanner.scan()

        project = db.find_by_name("Named Project")
        assert project is not None
        assert project.icon == "📝"
        assert project.status is None


class TestScannerEdgeCases:
    """Edge case tests for Scanner — error handling branches."""

    def test_scan_nonexistent_business_folder(self, db: DatabaseManager, monkeypatch) -> None:
        """_scan_business skips folder that doesn't exist."""
        monkeypatch.setattr(
            "scanner.get_business_folders",
            lambda: ["/nonexistent/path/that/does/not/exist"]
        )

        scanner = Scanner(db)
        result = scanner.scan()

        assert result["status"] == "completed"
        assert result["entities_count"] == 0

    def test_read_manifest_json_decode_error(self, db: DatabaseManager, tmp_path: Path, monkeypatch) -> None:
        """_read_manifest returns None and calls on_error for corrupt JSON."""
        biz_path = tmp_path / "Business"
        biz_path.mkdir()
        (biz_path / "business.json").write_text("{corrupt json!!!")

        errors: list[str] = []
        monkeypatch.setattr(
            "scanner.get_business_folders",
            lambda: [str(biz_path)]
        )

        scanner = Scanner(db, on_error=errors.append)
        scanner.scan()

        assert len(errors) == 1
        assert "Failed to parse" in errors[0]
        # Self-healing should have created a fallback
        entities = db.get_all_entities()
        assert len(entities) == 1
        assert entities[0].name == "Business"

    def test_scan_reentrancy_guard(self, db: DatabaseManager, monkeypatch) -> None:
        """scan() returns 'skipped' if already in progress."""
        monkeypatch.setattr(
            "scanner.get_business_folders",
            lambda: []
        )

        scanner = Scanner(db)
        scanner._scan_in_progress = True

        result = scanner.scan()

        assert result["status"] == "skipped"
        assert "already in progress" in result["reason"]

    def test_scan_intermediate_folder_without_manifest(self, db: DatabaseManager, tmp_path: Path, monkeypatch) -> None:
        """Folder without any manifest recurses to find deeper items."""
        biz_path = tmp_path / "Business"
        biz_path.mkdir()
        ManifestBuilder.business(biz_path, "Business", "🏢")

        # Intermediate folder with no manifest
        intermediate = biz_path / "SomeFolder"
        intermediate.mkdir()
        # Product nested inside intermediate
        product_path = intermediate / "DeepProduct"
        product_path.mkdir()
        ManifestBuilder.product(product_path, "DeepProduct", "📦")

        monkeypatch.setattr(
            "scanner.get_business_folders",
            lambda: [str(biz_path)]
        )

        scanner = Scanner(db)
        result = scanner.scan()

        # business + product (intermediate is skipped, not an entity)
        assert result["entities_count"] == 2
        product = db.find_by_name("DeepProduct")
        assert product is not None
        assert product.type == "product"


class TestScanComponents:
    """Tests for scan_components() function."""

    def test_empty_when_no_packages(self, tmp_path: Path) -> None:
        """Returns empty list when no packages/ directory."""
        product_path = tmp_path / "product"
        product_path.mkdir()

        result = scan_components(product_path)
        assert result == []

    def test_scans_packages_directory(self, tmp_path: Path) -> None:
        """Scans packages/ directory for components."""
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
        """Detects spec when spec/ contains a recognized file."""
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
        """Returns relative paths in format packages/{name}."""
        product_path = tmp_path / "product"
        packages_path = product_path / "packages"
        (packages_path / "my-component").mkdir(parents=True)

        result = scan_components(product_path)

        assert result[0]["path"] == "packages/my-component"

    def test_sorted_by_name(self, tmp_path: Path) -> None:
        """Components are sorted by name."""
        product_path = tmp_path / "product"
        packages_path = product_path / "packages"
        packages_path.mkdir(parents=True)

        for name in ["zebra", "apple", "mango"]:
            (packages_path / name).mkdir()

        result = scan_components(product_path)
        names = [c["name"] for c in result]

        assert names == ["apple", "mango", "zebra"]

    def test_skips_files(self, tmp_path: Path) -> None:
        """Skips files in packages/, only directories."""
        product_path = tmp_path / "product"
        packages_path = product_path / "packages"
        packages_path.mkdir(parents=True)

        (packages_path / "real-component").mkdir()
        (packages_path / "README.md").write_text("# Packages")

        result = scan_components(product_path)

        assert len(result) == 1
        assert result[0]["name"] == "real-component"

    def test_skips_hidden_directories(self, tmp_path: Path) -> None:
        """Skips hidden directories (starting with .) in packages/."""
        product_path = tmp_path / "product"
        packages_path = product_path / "packages"
        packages_path.mkdir(parents=True)

        (packages_path / "visible-component").mkdir()
        (packages_path / ".hidden-component").mkdir()

        result = scan_components(product_path)

        assert len(result) == 1
        assert result[0]["name"] == "visible-component"

    def test_spec_without_description(self, tmp_path: Path) -> None:
        """Component has spec but no extractable description (no H1)."""
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
