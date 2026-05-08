"""Tests for Unicode normalization (NFC/NFD handling).

macOS filesystem stores filenames in NFD (decomposed) form.
HTTP requests and Python literals use NFC (composed) form.
These tests verify that the system handles both correctly.

Key insight: The character 'й' can be represented as:
- NFC: U+0439 (single code point)
- NFD: U+0438 + U+0306 ('и' + combining breve)

Without normalization, string comparison fails even though
the strings look identical visually.
"""

import sys
import unicodedata
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

import config
from db import DatabaseManager
from normalization import normalize_path
from scanner import Scanner
from services.workspace import WorkspaceService

from tests.fixtures import DuetDataBuilder, ManifestBuilder


# Cyrillic 'й' (most common NFD/NFC difference on macOS).
NFC_NAME = "Андрей"  # Composed form (Python literal)
NFD_NAME = unicodedata.normalize("NFD", "Андрей")  # Decomposed form (macOS)


class TestNormalizePath:
    """Unit tests for normalize_path function."""

    def test_nfc_unchanged(self) -> None:
        result = normalize_path(NFC_NAME)
        assert result == NFC_NAME
        assert unicodedata.is_normalized("NFC", result)

    def test_nfd_converted_to_nfc(self) -> None:
        result = normalize_path(NFD_NAME)
        assert result == NFC_NAME
        assert unicodedata.is_normalized("NFC", result)

    def test_path_with_nfd_segments(self) -> None:
        nfd_path = f"/Users/test/!СЕМЬЯ/ЗОЖ/{NFD_NAME}"
        result = normalize_path(nfd_path)
        assert unicodedata.is_normalized("NFC", result)
        assert NFC_NAME in result

    def test_ascii_unchanged(self) -> None:
        path = "/Users/test/Root/Mid/Product"
        assert normalize_path(path) == path


class TestScannerNormalization:
    """Tests that Scanner normalizes paths to NFC."""

    def test_scanner_normalizes_cyrillic_folder_names(
        self, tmp_path: Path, db: DatabaseManager, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        builder = DuetDataBuilder(tmp_path)
        builder.add_root_context("Root")
        builder.build(monkeypatch)

        root_path = builder.get_root_context_path(0)

        nested_path = root_path / "Андрей"
        nested_path.mkdir()
        ManifestBuilder.context(nested_path, "Андрей")
        Scanner(db).scan()

        entity = db.find_by_name("Андрей")
        assert entity is not None
        assert unicodedata.is_normalized("NFC", entity.drive_path)

    def test_scanner_to_relative_path_normalizes(
        self, tmp_path: Path, db: DatabaseManager, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        builder = DuetDataBuilder(tmp_path)
        builder.add_root_context("Root")
        builder.build(monkeypatch)
        scanner = Scanner(db)

        root_path = builder.get_root_context_path(0)
        scanner._current_root_folder = root_path

        nfd_path = root_path / NFD_NAME
        result = scanner._to_relative_path(nfd_path)

        assert unicodedata.is_normalized("NFC", result)
        assert NFC_NAME in result


class TestWorkspaceServiceNormalization:
    """Tests that WorkspaceService handles NFD input paths."""

    def test_resolve_entity_with_nfd_path(
        self, tmp_path: Path, db: DatabaseManager, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        builder = DuetDataBuilder(tmp_path)
        builder.add_root_context("СЕМЬЯ")
        builder.build(monkeypatch)

        root_path = builder.get_root_context_path(0)

        mid_path = root_path / "ЗОЖ"
        mid_path.mkdir()
        ManifestBuilder.context(mid_path, "ЗОЖ")

        product_path = mid_path / "Андрей"
        product_path.mkdir()
        ManifestBuilder.context(product_path, "Андрей")
        Scanner(db).scan()

        service = WorkspaceService(db)

        nfd_product_path = unicodedata.normalize("NFD", str(product_path))
        entity = service._resolve_entity(nfd_product_path)

        assert entity is not None
        assert entity.name == "Андрей"
        assert entity.type == "context"

    def test_resolve_entity_with_nfc_path(
        self, tmp_path: Path, db: DatabaseManager, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        builder = DuetDataBuilder(tmp_path)
        builder.add_root_context("СЕМЬЯ")
        builder.build(monkeypatch)

        root_path = builder.get_root_context_path(0)

        mid_path = root_path / "ЗОЖ"
        mid_path.mkdir()
        ManifestBuilder.context(mid_path, "ЗОЖ")

        product_path = mid_path / "Андрей"
        product_path.mkdir()
        ManifestBuilder.context(product_path, "Андрей")
        Scanner(db).scan()

        service = WorkspaceService(db)

        entity = service._resolve_entity(str(product_path))

        assert entity is not None
        assert entity.name == "Андрей"
        assert entity.type == "context"

    def test_get_orientation_with_nfd_path(
        self, tmp_path: Path, db: DatabaseManager, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        builder = DuetDataBuilder(tmp_path)
        builder.add_root_context("СЕМЬЯ")
        builder.build(monkeypatch)

        root_path = builder.get_root_context_path(0)

        mid_path = root_path / "ЗОЖ"
        mid_path.mkdir()
        ManifestBuilder.context(mid_path, "ЗОЖ")

        product_path = mid_path / "Андрей"
        product_path.mkdir()
        ManifestBuilder.context(product_path, "Андрей")
        Scanner(db).scan()

        service = WorkspaceService(db)

        nfd_path = unicodedata.normalize("NFD", str(product_path))
        result = service.get_orientation(nfd_path)

        assert result["workspace"]["type"] != "unknown"
        chain = result["context"]["chain"]
        assert len(chain) == 3
        assert chain[0]["name"] == "СЕМЬЯ"
        assert chain[1]["name"] == "ЗОЖ"
        assert chain[2]["name"] == "Андрей"


class TestConfigNormalization:
    """Tests that config normalizes root_context_folders."""

    def test_get_root_context_folders_normalizes_nfd(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """get_root_context_folders normalizes NFD paths to NFC."""
        nfd_path = unicodedata.normalize("NFD", "/Users/test/!СЕМЬЯ")

        builder = DuetDataBuilder(tmp_path)
        builder.add_alias("@СЕМЬЯ", nfd_path)
        builder.with_root_context_folders(["@СЕМЬЯ"])
        builder.build(monkeypatch)

        folders = config.get_root_context_folders()

        assert len(folders) == 1
        assert unicodedata.is_normalized("NFC", folders[0])


class TestDbFindClosestEntity:
    """Tests for DB.find_closest_entity with normalization."""

    def test_find_closest_entity_nfc_query_nfc_db(
        self, tmp_path: Path, db: DatabaseManager, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        builder = DuetDataBuilder(tmp_path)
        builder.add_root_context("СЕМЬЯ")
        builder.build(monkeypatch)

        root_path = builder.get_root_context_path(0)
        product_path = root_path / "Андрей"
        product_path.mkdir()
        ManifestBuilder.context(product_path, "Андрей")
        Scanner(db).scan()

        entity = db.find_closest_entity("СЕМЬЯ/Андрей")

        assert entity is not None
        assert entity.name == "Андрей"

    def test_find_closest_entity_deep_path(
        self, tmp_path: Path, db: DatabaseManager, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        builder = DuetDataBuilder(tmp_path)
        builder.add_root_context("СЕМЬЯ")
        builder.build(monkeypatch)

        root_path = builder.get_root_context_path(0)
        product_path = root_path / "Андрей"
        product_path.mkdir()
        ManifestBuilder.context(product_path, "Андрей")
        Scanner(db).scan()

        entity = db.find_closest_entity("СЕМЬЯ/Андрей/some/deep/folder")

        assert entity is not None
        assert entity.name == "Андрей"
