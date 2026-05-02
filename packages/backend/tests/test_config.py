"""Tests for config.py - Configuration management (new architecture).

New architecture:
- ~/.org.ve68.duet (pointer) → duetDataPath, duetConfigPath, machine
- DuetConfig/settings.json → business_folders (@aliases), timestampTZ
- DuetConfig/{machine}.json → port, @alias mappings
"""

import json
from pathlib import Path

import pytest

import sys
sys.path.insert(0, str(Path(__file__).parent.parent))

import config
from tests.fixtures import DuetDataBuilder


class TestPathGetters:
    """Tests for path getter functions."""

    def test_get_duet_data_path(self, duet_data: Path) -> None:
        """get_duet_data_path() returns path from pointer."""
        assert config.get_duet_data_path() == duet_data

    def test_get_duet_config_path(
        self, duet_data: Path, duet_data_builder: DuetDataBuilder, tmp_path: Path
    ) -> None:
        """get_duet_config_path() returns path from pointer."""
        # duet_data fixture uses DuetDataBuilder internally
        # DuetConfig is at tmp_path/DuetConfig
        expected = tmp_path / "DuetConfig"
        assert config.get_duet_config_path() == expected

    def test_get_machine(self, duet_data: Path) -> None:
        """get_machine() returns machine identifier from pointer."""
        # Default machine in DuetDataBuilder is "test_machine"
        assert config.get_machine() == "test_machine"

    def test_get_db_path(self, duet_data: Path) -> None:
        """get_db_path() returns correct path."""
        assert config.get_db_path() == duet_data / "data" / "entities.db"

    def test_get_instructions_path(self, tmp_path: Path, monkeypatch) -> None:
        """get_instructions_path() reads from machine.json."""
        builder = DuetDataBuilder(tmp_path)
        builder.with_instructions()
        builder.build(monkeypatch)
        result = config.get_instructions_path()
        assert result == tmp_path / "instructions"
        assert result.exists()

    def test_get_instructions_path_missing(self, tmp_path: Path, monkeypatch) -> None:
        """get_instructions_path() raises ConfigError when not configured."""
        builder = DuetDataBuilder(tmp_path)
        builder.without_instructions()
        builder.build(monkeypatch)
        with pytest.raises(config.ConfigError, match="instructionsPath not set"):
            config.get_instructions_path()

    def test_get_log_path(self, duet_data: Path) -> None:
        """get_log_path() returns correct path."""
        assert config.get_log_path() == duet_data / "backend.log"

    def test_get_repos_path_exists(self, duet_data: Path) -> None:
        """get_repos_path() returns path if repos/ exists."""
        repos_path = duet_data / "repos"
        repos_path.mkdir()
        assert config.get_repos_path() == repos_path

    def test_get_repos_path_not_exists(self, duet_data: Path) -> None:
        """get_repos_path() returns None if repos/ doesn't exist."""
        assert config.get_repos_path() is None


class TestReadSettings:
    """Tests for read_settings()."""

    def test_reads_settings(self, duet_data: Path, tmp_path: Path) -> None:
        """read_settings() reads settings.json from DuetConfig."""
        result = config.read_settings()
        assert "business_folders" in result
        assert "timestampTZ" in result

    def test_raises_if_settings_not_found(
        self, duet_data: Path, tmp_path: Path
    ) -> None:
        """read_settings() raises ConfigError if settings.json not found."""
        # Remove settings.json
        settings_path = tmp_path / "DuetConfig" / "settings.json"
        settings_path.unlink()
        config.reset_cache()

        with pytest.raises(config.ConfigError, match="Settings file not found"):
            config.read_settings()

    def test_raises_on_invalid_json(
        self, duet_data: Path, tmp_path: Path
    ) -> None:
        """read_settings() raises ConfigError on invalid JSON."""
        settings_path = tmp_path / "DuetConfig" / "settings.json"
        settings_path.write_text("{ invalid json }")
        config.reset_cache()

        with pytest.raises(config.ConfigError, match="Invalid JSON"):
            config.read_settings()


class TestReadMachineConfig:
    """Tests for read_machine_config()."""

    def test_reads_machine_config(self, duet_data: Path) -> None:
        """read_machine_config() reads {machine}.json from DuetConfig."""
        result = config.read_machine_config()
        assert "port" in result

    def test_raises_if_machine_config_not_found(
        self, duet_data: Path, tmp_path: Path
    ) -> None:
        """read_machine_config() raises ConfigError if file not found."""
        # Remove machine config
        machine_config_path = tmp_path / "DuetConfig" / "test_machine.json"
        machine_config_path.unlink()
        config.reset_cache()

        with pytest.raises(config.ConfigError, match="Machine config not found"):
            config.read_machine_config()


class TestGetPort:
    """Tests for get_port()."""

    def test_returns_port(self, duet_data: Path) -> None:
        """get_port() returns port from machine config."""
        # Default port in DuetDataBuilder is 19680
        assert config.get_port() == 19680

    def test_custom_port(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """get_port() returns custom port."""
        builder = DuetDataBuilder(tmp_path)
        builder.with_port(12345)
        builder.build()
        monkeypatch.setenv("DUET_POINTER_FILE", str(builder.pointer_path))
        config.reset_cache()

        assert config.get_port() == 12345

    def test_raises_if_port_not_set(
        self, duet_data: Path, tmp_path: Path
    ) -> None:
        """get_port() raises ConfigError if port not set."""
        # Rewrite machine config without port
        machine_config_path = tmp_path / "DuetConfig" / "test_machine.json"
        machine_config_path.write_text(json.dumps({}))
        config.reset_cache()

        with pytest.raises(config.ConfigError, match="Port not set"):
            config.get_port()

    def test_raises_if_port_invalid_type(
        self, duet_data: Path, tmp_path: Path
    ) -> None:
        """get_port() raises ConfigError if port is not integer."""
        machine_config_path = tmp_path / "DuetConfig" / "test_machine.json"
        machine_config_path.write_text(json.dumps({"port": "19680"}))
        config.reset_cache()

        with pytest.raises(config.ConfigError, match="must be an integer"):
            config.get_port()


class TestGetTimezone:
    """Tests for get_timezone()."""

    def test_returns_timezone(self, duet_data: Path) -> None:
        """get_timezone() returns timezone from settings."""
        # Default timezone in DuetDataBuilder is {"id": "Z", "value": "UTC"}
        result = config.get_timezone()
        assert result["id"] == "Z"
        assert result["value"] == "UTC"

    def test_custom_timezone(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """get_timezone() returns custom timezone."""
        builder = DuetDataBuilder(tmp_path)
        builder.with_timezone("M", "Europe/Moscow")
        builder.build()
        monkeypatch.setenv("DUET_POINTER_FILE", str(builder.pointer_path))
        config.reset_cache()

        result = config.get_timezone()
        assert result["id"] == "M"
        assert result["value"] == "Europe/Moscow"

    def test_raises_if_not_set(
        self, duet_data: Path, tmp_path: Path
    ) -> None:
        """get_timezone() raises ConfigError if timestampTZ not set."""
        settings_path = tmp_path / "DuetConfig" / "settings.json"
        settings_path.write_text(json.dumps({"business_folders": []}))
        config.reset_cache()

        with pytest.raises(config.ConfigError, match="timestampTZ not set"):
            config.get_timezone()

    def test_raises_if_invalid_type(
        self, duet_data: Path, tmp_path: Path
    ) -> None:
        """get_timezone() raises ConfigError if timestampTZ is not dict."""
        settings_path = tmp_path / "DuetConfig" / "settings.json"
        settings_path.write_text(json.dumps({
            "business_folders": [],
            "timestampTZ": "UTC"  # Should be dict
        }))
        config.reset_cache()

        with pytest.raises(config.ConfigError, match="must be a dict"):
            config.get_timezone()

    def test_raises_if_missing_keys(
        self, duet_data: Path, tmp_path: Path
    ) -> None:
        """get_timezone() raises ConfigError if missing id/value keys."""
        settings_path = tmp_path / "DuetConfig" / "settings.json"
        settings_path.write_text(json.dumps({
            "business_folders": [],
            "timestampTZ": {"id": "M"}  # Missing 'value'
        }))
        config.reset_cache()

        with pytest.raises(config.ConfigError, match="must have 'id' and 'value'"):
            config.get_timezone()


class TestGetBusinessFolders:
    """Tests for get_business_folders()."""

    def test_returns_empty_list(self, duet_data: Path) -> None:
        """get_business_folders() returns empty list by default."""
        assert config.get_business_folders() == []

    def test_resolves_aliases(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """get_business_folders() resolves @aliases to absolute paths."""
        builder = DuetDataBuilder(tmp_path)
        builder.add_alias("@БАЗА", str(tmp_path / "БАЗА"))
        builder.add_alias("@МетаЛаб", str(tmp_path / "МетаЛаб"))
        builder.with_business_folders(["@БАЗА", "@МетаЛаб"])
        builder.build()
        monkeypatch.setenv("DUET_POINTER_FILE", str(builder.pointer_path))
        config.reset_cache()

        result = config.get_business_folders()
        assert result == [str(tmp_path / "БАЗА"), str(tmp_path / "МетаЛаб")]

    def test_raises_if_not_set(
        self, duet_data: Path, tmp_path: Path
    ) -> None:
        """get_business_folders() raises ConfigError if not set."""
        settings_path = tmp_path / "DuetConfig" / "settings.json"
        settings_path.write_text(json.dumps({
            "timestampTZ": {"id": "Z", "value": "UTC"}
        }))
        config.reset_cache()

        with pytest.raises(config.ConfigError, match="business_folders not set"):
            config.get_business_folders()

    def test_raises_if_invalid_type(
        self, duet_data: Path, tmp_path: Path
    ) -> None:
        """get_business_folders() raises ConfigError if not a list."""
        settings_path = tmp_path / "DuetConfig" / "settings.json"
        settings_path.write_text(json.dumps({
            "timestampTZ": {"id": "Z", "value": "UTC"},
            "business_folders": "@БАЗА"  # Should be list
        }))
        config.reset_cache()

        with pytest.raises(config.ConfigError, match="must be a list"):
            config.get_business_folders()

    def test_raises_on_unknown_alias(
        self, duet_data: Path, tmp_path: Path
    ) -> None:
        """get_business_folders() raises ConfigError if alias not found."""
        settings_path = tmp_path / "DuetConfig" / "settings.json"
        settings_path.write_text(json.dumps({
            "timestampTZ": {"id": "Z", "value": "UTC"},
            "business_folders": ["@Unknown"]
        }))
        config.reset_cache()

        with pytest.raises(config.ConfigError, match="Failed to resolve"):
            config.get_business_folders()


class TestAddBusinessFolder:
    """Tests for add_business_folder() — duplicate detection across separators."""

    def test_strips_trailing_posix_slash_for_dedup(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Adding "/foo/" when "/foo" exists is detected as duplicate."""
        biz_path = tmp_path / "Biz"
        biz_path.mkdir()
        (biz_path / "business.json").write_text('{"name":"Biz"}')

        builder = DuetDataBuilder(tmp_path)
        builder.add_alias("@Biz", str(biz_path))
        builder.with_business_folders(["@Biz"])
        builder.build()
        monkeypatch.setenv("DUET_POINTER_FILE", str(builder.pointer_path))
        config.reset_cache()

        # Try to add the same folder with trailing slash — should be detected as dup
        result = config.add_business_folder(str(biz_path) + "/")
        assert result["status"] == "exists"

    def test_strips_trailing_windows_backslash_for_dedup(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Adding "C:\\foo\\" when "C:\\foo" exists is detected as duplicate.

        Old code did rstrip("/") — Windows trailing backslash stayed,
        duplicate detection failed.
        """
        biz_path = tmp_path / "Biz"
        biz_path.mkdir()
        (biz_path / "business.json").write_text('{"name":"Biz"}')

        builder = DuetDataBuilder(tmp_path)
        builder.add_alias("@Biz", str(biz_path))
        builder.with_business_folders(["@Biz"])
        builder.build()
        monkeypatch.setenv("DUET_POINTER_FILE", str(builder.pointer_path))
        config.reset_cache()

        # Trailing backslash — emulates Windows-style path tail
        result = config.add_business_folder(str(biz_path) + "\\")
        assert result["status"] == "exists"


class TestGetVersion:
    """Tests for get_version()."""

    def test_returns_version(self, duet_data: Path) -> None:
        """get_version() returns version from VERSION file."""
        # Default version in DuetDataBuilder is "test"
        assert config.get_version() == "test"

    def test_custom_version(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """get_version() returns custom version."""
        builder = DuetDataBuilder(tmp_path)
        builder.with_version("1.2.3")
        builder.build()
        monkeypatch.setenv("DUET_POINTER_FILE", str(builder.pointer_path))
        config.reset_cache()

        assert config.get_version() == "1.2.3"

    def test_raises_if_version_file_missing(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """get_version() raises ConfigError if VERSION file missing."""
        builder = DuetDataBuilder(tmp_path)
        builder.with_version(None)  # Don't create VERSION file
        builder.build()
        monkeypatch.setenv("DUET_POINTER_FILE", str(builder.pointer_path))
        config.reset_cache()

        with pytest.raises(config.ConfigError, match="VERSION file not found"):
            config.get_version()


class TestGetAliases:
    """Tests for get_aliases()."""

    def test_returns_aliases(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """get_aliases() returns all @aliases from machine config."""
        builder = DuetDataBuilder(tmp_path)
        builder.add_alias("@БАЗА", "/path/to/база")
        builder.add_alias("@DuetData", "/path/to/data")
        builder.build()
        monkeypatch.setenv("DUET_POINTER_FILE", str(builder.pointer_path))
        config.reset_cache()

        result = config.get_aliases()
        assert "@БАЗА" in result
        assert "@DuetData" in result
        assert result["@БАЗА"] == "/path/to/база"


class TestResolveAlias:
    """Tests for resolve_alias()."""

    def test_resolves_alias(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """resolve_alias() resolves @alias to path."""
        builder = DuetDataBuilder(tmp_path)
        builder.add_alias("@БАЗА", "/path/to/база")
        builder.build()
        monkeypatch.setenv("DUET_POINTER_FILE", str(builder.pointer_path))
        config.reset_cache()

        assert config.resolve_alias("@БАЗА") == "/path/to/база"
        assert config.resolve_alias("@БАЗА/sub") == "/path/to/база/sub"

    def test_returns_absolute_unchanged(self, duet_data: Path) -> None:
        """resolve_alias() returns absolute paths unchanged."""
        assert config.resolve_alias("/absolute/path") == "/absolute/path"

    def test_raises_on_unknown_alias(self, duet_data: Path) -> None:
        """resolve_alias() raises ConfigError on unknown alias."""
        with pytest.raises(config.ConfigError, match="Failed to resolve"):
            config.resolve_alias("@Unknown")


class TestResetCache:
    """Tests for reset_cache()."""

    def test_resets_pointer_cache(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """reset_cache() clears cached pointer data."""
        # Build first setup
        builder1 = DuetDataBuilder(tmp_path / "setup1")
        builder1.with_port(11111)
        builder1.build()
        monkeypatch.setenv("DUET_POINTER_FILE", str(builder1.pointer_path))
        config.reset_cache()

        assert config.get_port() == 11111

        # Build second setup
        builder2 = DuetDataBuilder(tmp_path / "setup2")
        builder2.with_port(22222)
        builder2.build()
        monkeypatch.setenv("DUET_POINTER_FILE", str(builder2.pointer_path))

        # Without reset, still returns old value
        assert config.get_port() == 11111

        # After reset, returns new value
        config.reset_cache()
        assert config.get_port() == 22222
