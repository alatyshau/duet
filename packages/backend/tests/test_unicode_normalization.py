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


# Test strings with Cyrillic 'й' (most common NFD/NFC difference on macOS)
NFC_NAME = "Андрей"  # Composed form (Python literal)
NFD_NAME = unicodedata.normalize("NFD", "Андрей")  # Decomposed form (macOS)


class TestNormalizePath:
    """Unit tests for normalize_path function."""

    def test_nfc_unchanged(self) -> None:
        """NFC input returns unchanged."""
        result = normalize_path(NFC_NAME)
        assert result == NFC_NAME
        assert unicodedata.is_normalized("NFC", result)

    def test_nfd_converted_to_nfc(self) -> None:
        """NFD input is converted to NFC."""
        result = normalize_path(NFD_NAME)
        assert result == NFC_NAME
        assert unicodedata.is_normalized("NFC", result)

    def test_path_with_nfd_segments(self) -> None:
        """Full path with NFD segments is normalized."""
        nfd_path = f"/Users/test/!СЕМЬЯ/ЗОЖ/{NFD_NAME}"
        result = normalize_path(nfd_path)
        assert unicodedata.is_normalized("NFC", result)
        assert NFC_NAME in result

    def test_ascii_unchanged(self) -> None:
        """ASCII-only paths pass through unchanged."""
        path = "/Users/test/Business/Stream/Product"
        assert normalize_path(path) == path


class TestScannerNormalization:
    """Tests that Scanner normalizes paths to NFC."""

    def test_scanner_normalizes_cyrillic_folder_names(
        self, tmp_path: Path, db: DatabaseManager
    ) -> None:
        """Scanner normalizes Cyrillic folder names from NFD to NFC."""
        # Create business folder with NFD name (simulating macOS)
        # Note: On most systems, mkdir will normalize to NFC anyway,
        # but we test the Scanner's _to_relative_path method directly
        builder = DuetDataBuilder(tmp_path)
        builder.add_business("Business")
        duet_data = builder.build()

        biz_path = builder.get_business_path(0)

        # Create stream with a name that contains 'й'
        stream_path = biz_path / "Андрей"
        stream_path.mkdir()
        ManifestBuilder.stream(stream_path, "Андрей")

        config.init(duet_data)
        scanner = Scanner(db)
        scanner.scan()

        # Verify entity is stored with NFC path
        entity = db.find_by_name("Андрей")
        assert entity is not None
        assert unicodedata.is_normalized("NFC", entity.drive_path)

    def test_scanner_to_relative_path_normalizes(
        self, tmp_path: Path, db: DatabaseManager
    ) -> None:
        """Scanner._to_relative_path normalizes to NFC."""
        builder = DuetDataBuilder(tmp_path)
        builder.add_business("Business")
        duet_data = builder.build()

        config.init(duet_data)
        scanner = Scanner(db)

        # Set up scanner's business folder context
        biz_path = builder.get_business_path(0)
        scanner._current_business_folder = biz_path

        # Create NFD path (simulating macOS readdir)
        nfd_path = biz_path / NFD_NAME
        result = scanner._to_relative_path(nfd_path)

        # Result should be NFC normalized
        assert unicodedata.is_normalized("NFC", result)
        assert NFC_NAME in result


class TestWorkspaceServiceNormalization:
    """Tests that WorkspaceService handles NFD input paths."""

    def test_resolve_entity_with_nfd_path(
        self, tmp_path: Path, db: DatabaseManager
    ) -> None:
        """WorkspaceService resolves entity when given NFD path."""
        builder = DuetDataBuilder(tmp_path)
        builder.add_business("СЕМЬЯ")
        duet_data = builder.build()

        biz_path = builder.get_business_path(0)

        # Create hierarchy: СЕМЬЯ/ЗОЖ/Андрей
        stream_path = biz_path / "ЗОЖ"
        stream_path.mkdir()
        ManifestBuilder.stream(stream_path, "ЗОЖ")

        product_path = stream_path / "Андрей"
        product_path.mkdir()
        ManifestBuilder.product(product_path, "Андрей")

        config.init(duet_data)
        scanner = Scanner(db)
        scanner.scan()

        service = WorkspaceService(db)

        # Query with NFD path (simulating HTTP request with NFD encoding)
        nfd_product_path = unicodedata.normalize("NFD", str(product_path))
        entity = service._resolve_entity(nfd_product_path)

        assert entity is not None
        assert entity.name == "Андрей"
        assert entity.type == "product"

    def test_resolve_entity_with_nfc_path(
        self, tmp_path: Path, db: DatabaseManager
    ) -> None:
        """WorkspaceService resolves entity when given NFC path."""
        builder = DuetDataBuilder(tmp_path)
        builder.add_business("СЕМЬЯ")
        duet_data = builder.build()

        biz_path = builder.get_business_path(0)

        stream_path = biz_path / "ЗОЖ"
        stream_path.mkdir()
        ManifestBuilder.stream(stream_path, "ЗОЖ")

        product_path = stream_path / "Андрей"
        product_path.mkdir()
        ManifestBuilder.product(product_path, "Андрей")

        config.init(duet_data)
        scanner = Scanner(db)
        scanner.scan()

        service = WorkspaceService(db)

        # Query with NFC path (normal Python string)
        entity = service._resolve_entity(str(product_path))

        assert entity is not None
        assert entity.name == "Андрей"
        assert entity.type == "product"

    def test_get_workspace_info_with_nfd_path(
        self, tmp_path: Path, db: DatabaseManager
    ) -> None:
        """get_workspace_info works with NFD workspace_path."""
        builder = DuetDataBuilder(tmp_path)
        builder.add_business("СЕМЬЯ")
        duet_data = builder.build()

        biz_path = builder.get_business_path(0)

        stream_path = biz_path / "ЗОЖ"
        stream_path.mkdir()
        ManifestBuilder.stream(stream_path, "ЗОЖ")

        product_path = stream_path / "Андрей"
        product_path.mkdir()
        ManifestBuilder.product(product_path, "Андрей")

        config.init(duet_data)
        scanner = Scanner(db)
        scanner.scan()

        service = WorkspaceService(db)

        # Query with NFD path
        nfd_path = unicodedata.normalize("NFD", str(product_path))
        result = service.get_workspace_info(nfd_path)

        # Should return chain: СЕМЬЯ -> ЗОЖ -> Андрей
        assert result["status"] == "found"
        assert len(result["chain"]) == 3
        assert result["chain"][0]["name"] == "СЕМЬЯ"
        assert result["chain"][1]["name"] == "ЗОЖ"
        assert result["chain"][2]["name"] == "Андрей"


class TestConfigNormalization:
    """Tests that config normalizes business_folders."""

    def test_get_business_folders_normalizes_nfd(self, tmp_path: Path) -> None:
        """get_business_folders normalizes NFD paths to NFC."""
        # Create config with NFD paths
        nfd_folder = unicodedata.normalize("NFD", "/Users/test/!СЕМЬЯ")
        config_data = {
            "version": "1.0.0",
            "port": 19680,
            "business_folders": [nfd_folder],
            "timestampTZ": {"id": "M", "value": "Europe/Minsk"},
        }

        # Write config
        builder = DuetDataBuilder(tmp_path)
        duet_data = builder.build()
        config_path = duet_data / "config.json"

        import json
        with open(config_path, "w", encoding="utf-8") as f:
            json.dump(config_data, f)

        config.init(duet_data)
        folders = config.get_business_folders()

        # Should be NFC normalized
        assert len(folders) == 1
        assert unicodedata.is_normalized("NFC", folders[0])


class TestDbFindClosestEntity:
    """Tests for DB.find_closest_entity with normalization."""

    def test_find_closest_entity_nfc_query_nfc_db(
        self, tmp_path: Path, db: DatabaseManager
    ) -> None:
        """find_closest_entity works when both query and DB are NFC."""
        builder = DuetDataBuilder(tmp_path)
        builder.add_business("СЕМЬЯ")
        duet_data = builder.build()

        biz_path = builder.get_business_path(0)
        product_path = biz_path / "Андрей"
        product_path.mkdir()
        ManifestBuilder.product(product_path, "Андрей")

        config.init(duet_data)
        scanner = Scanner(db)
        scanner.scan()

        # Query with NFC
        entity = db.find_closest_entity("СЕМЬЯ/Андрей")

        assert entity is not None
        assert entity.name == "Андрей"

    def test_find_closest_entity_deep_path(
        self, tmp_path: Path, db: DatabaseManager
    ) -> None:
        """find_closest_entity finds deepest ancestor for paths inside product."""
        builder = DuetDataBuilder(tmp_path)
        builder.add_business("СЕМЬЯ")
        duet_data = builder.build()

        biz_path = builder.get_business_path(0)
        product_path = biz_path / "Андрей"
        product_path.mkdir()
        ManifestBuilder.product(product_path, "Андрей")

        config.init(duet_data)
        scanner = Scanner(db)
        scanner.scan()

        # Query with path deeper than product
        entity = db.find_closest_entity("СЕМЬЯ/Андрей/some/deep/folder")

        assert entity is not None
        assert entity.name == "Андрей"
