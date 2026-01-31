"""Tests for config.py - Configuration management."""

import json
from pathlib import Path

import pytest

import sys
sys.path.insert(0, str(Path(__file__).parent.parent))

import config


class TestConfigInit:
    """Tests for config initialization."""

    def test_init_sets_data_path(self, tmp_path: Path) -> None:
        """init() sets the data path."""
        config.init(tmp_path)
        assert config.get_duet_data_path() == tmp_path

    def test_get_duet_data_path_raises_if_not_initialized(self) -> None:
        """get_duet_data_path() raises if init() was not called."""
        # Reset global state
        config._data_path = None

        with pytest.raises(RuntimeError, match="Config not initialized"):
            config.get_duet_data_path()


class TestConfigPaths:
    """Tests for path getters."""

    def test_get_db_path(self, duet_data: Path) -> None:
        """get_db_path() returns correct path."""
        assert config.get_db_path() == duet_data / "data" / "entities.db"

    def test_get_pid_path(self, duet_data: Path) -> None:
        """get_pid_path() returns correct path."""
        assert config.get_pid_path() == duet_data / ".pid"

    def test_get_ai_kit_path(self, duet_data: Path) -> None:
        """get_ai_kit_path() returns correct path."""
        assert config.get_ai_kit_path() == duet_data / "ai-kit"

    def test_get_config_path(self, duet_data: Path) -> None:
        """get_config_path() returns correct path."""
        assert config.get_config_path() == duet_data / "config.json"


class TestReadDuetConfig:
    """Tests for read_config()."""

    def test_reads_version_from_config(self, duet_data: Path) -> None:
        """Reads version from config.json."""
        # duet_data fixture already creates config with version: "test"
        result = config.read_config()
        assert result["version"] == "test"

    def test_reads_port_from_config(self, duet_data: Path) -> None:
        """Reads port from config.json."""
        config_path = duet_data / "config.json"
        config_path.write_text(json.dumps({"version": "test", "port": 12345}))

        result = config.read_config()
        assert result["port"] == 12345

    def test_reads_business_folders_from_config(self, duet_data: Path) -> None:
        """Reads business_folders from config.json."""
        config_path = duet_data / "config.json"
        config_path.write_text(json.dumps({
            "version": "test",
            "business_folders": ["/path/to/business1", "/path/to/business2"]
        }))

        result = config.read_config()
        assert result["business_folders"] == ["/path/to/business1", "/path/to/business2"]

    def test_reads_timezone_from_config(self, duet_data: Path) -> None:
        """Reads timestampTZ from config.json."""
        config_path = duet_data / "config.json"
        config_path.write_text(json.dumps({
            "version": "test",
            "timestampTZ": {"id": "M", "value": "Europe/Moscow"}
        }))

        result = config.read_config()
        assert result["timestampTZ"] == {"id": "M", "value": "Europe/Moscow"}

    def test_invalid_port_returns_default(self, duet_data: Path) -> None:
        """Invalid port value returns default."""
        config_path = duet_data / "config.json"
        config_path.write_text(json.dumps({"version": "test", "port": "not_a_number"}))

        result = config.read_config()
        assert result["port"] == 19680

    def test_invalid_business_folders_returns_empty(self, duet_data: Path) -> None:
        """Invalid business_folders value returns empty list."""
        config_path = duet_data / "config.json"
        config_path.write_text(json.dumps({"version": "test", "business_folders": "not_a_list"}))

        result = config.read_config()
        assert result["business_folders"] == []

    def test_filters_non_string_business_folders(self, duet_data: Path) -> None:
        """Non-string items in business_folders are filtered out."""
        config_path = duet_data / "config.json"
        config_path.write_text(json.dumps({
            "version": "test",
            "business_folders": ["/valid/path", 123, None, "/another/valid"]
        }))

        result = config.read_config()
        assert result["business_folders"] == ["/valid/path", "/another/valid"]

    def test_corrupted_json_returns_defaults(self, duet_data: Path) -> None:
        """Corrupted JSON returns defaults."""
        config_path = duet_data / "config.json"
        config_path.write_text("{ invalid json }")

        result = config.read_config()
        assert result["port"] == 19680
        assert result["business_folders"] == []
        assert result["version"] is None  # No version in corrupted config


class TestTimezone:
    """Tests for timezone configuration."""

    def test_no_legacy_fallback(self, duet_data: Path) -> None:
        """No fallback to ai-kit/settings.json — returns default if not in config.json."""
        # No timestampTZ in config.json
        config_path = duet_data / "config.json"
        config_path.write_text(json.dumps({"version": "test", "port": 19680}))

        # Even if exists in legacy settings — it's ignored
        settings_path = duet_data / "ai-kit" / "settings.json"
        settings_path.write_text(json.dumps({
            "timestampTZ": {"id": "P", "value": "America/Los_Angeles"}
        }))

        result = config.read_config()
        # Returns default, NOT legacy value
        assert result["timestampTZ"] == {"id": "Z", "value": "UTC"}

    def test_reads_timezone_from_config(self, duet_data: Path) -> None:
        """Reads timestampTZ from config.json."""
        config_path = duet_data / "config.json"
        config_path.write_text(json.dumps({
            "version": "test",
            "timestampTZ": {"id": "M", "value": "Europe/Moscow"}
        }))

        result = config.read_config()
        assert result["timestampTZ"] == {"id": "M", "value": "Europe/Moscow"}

    def test_invalid_timezone_string_returns_default(self, duet_data: Path) -> None:
        """Invalid timestampTZ (string instead of dict) returns default."""
        config_path = duet_data / "config.json"
        config_path.write_text(json.dumps({
            "version": "test",
            "timestampTZ": "Europe/Moscow"  # Should be dict
        }))

        result = config.read_config()
        assert result["timestampTZ"] == {"id": "Z", "value": "UTC"}

    def test_invalid_timezone_missing_id_returns_default(self, duet_data: Path) -> None:
        """Invalid timestampTZ (missing 'id' key) returns default."""
        config_path = duet_data / "config.json"
        config_path.write_text(json.dumps({
            "version": "test",
            "timestampTZ": {"value": "Europe/Moscow"}  # Missing 'id'
        }))

        result = config.read_config()
        assert result["timestampTZ"] == {"id": "Z", "value": "UTC"}

    def test_invalid_timezone_missing_value_returns_default(self, duet_data: Path) -> None:
        """Invalid timestampTZ (missing 'value' key) returns default."""
        config_path = duet_data / "config.json"
        config_path.write_text(json.dumps({
            "version": "test",
            "timestampTZ": {"id": "M"}  # Missing 'value'
        }))

        result = config.read_config()
        assert result["timestampTZ"] == {"id": "Z", "value": "UTC"}


class TestGetVersion:
    """Tests for get_version()."""

    def test_get_version_returns_version(self, duet_data: Path) -> None:
        """get_version() returns version from config."""
        # duet_data fixture creates config with version: "test"
        assert config.get_version() == "test"

    def test_get_version_with_custom_version(self, duet_data: Path) -> None:
        """get_version() returns custom version from config."""
        config_path = duet_data / "config.json"
        config_path.write_text(json.dumps({"version": "1.2.3"}))

        assert config.get_version() == "1.2.3"

    def test_get_version_raises_if_not_set(self, duet_data: Path) -> None:
        """get_version() raises RuntimeError if version not set."""
        config_path = duet_data / "config.json"
        config_path.write_text(json.dumps({"port": 19680}))  # No version

        with pytest.raises(RuntimeError, match="Version not set"):
            config.get_version()

    def test_get_version_raises_if_empty_string(self, duet_data: Path) -> None:
        """get_version() raises RuntimeError if version is empty string."""
        config_path = duet_data / "config.json"
        config_path.write_text(json.dumps({"version": ""}))

        with pytest.raises(RuntimeError, match="Version not set"):
            config.get_version()


class TestHelperFunctions:
    """Tests for helper functions."""

    def test_get_port(self, duet_data: Path) -> None:
        """get_port() returns port from config."""
        config_path = duet_data / "config.json"
        config_path.write_text(json.dumps({"version": "test", "port": 54321}))

        assert config.get_port() == 54321

    def test_get_timezone(self, duet_data: Path) -> None:
        """get_timezone() returns timezone from config."""
        config_path = duet_data / "config.json"
        config_path.write_text(json.dumps({
            "version": "test",
            "timestampTZ": {"id": "J", "value": "Asia/Tokyo"}
        }))

        assert config.get_timezone() == {"id": "J", "value": "Asia/Tokyo"}

    def test_get_business_folders(self, duet_data: Path) -> None:
        """get_business_folders() returns folders from config."""
        config_path = duet_data / "config.json"
        config_path.write_text(json.dumps({
            "version": "test",
            "business_folders": ["/path/one", "/path/two"]
        }))

        assert config.get_business_folders() == ["/path/one", "/path/two"]

    def test_get_repos_path_exists(self, duet_data: Path) -> None:
        """get_repos_path() returns path if repos/ exists."""
        repos_path = duet_data / "repos"
        repos_path.mkdir()

        assert config.get_repos_path() == repos_path

    def test_get_repos_path_not_exists(self, duet_data: Path) -> None:
        """get_repos_path() returns None if repos/ doesn't exist."""
        assert config.get_repos_path() is None
