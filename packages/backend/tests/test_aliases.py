"""Tests for aliases.py - Alias resolver."""

from pathlib import Path

import pytest

import sys
sys.path.insert(0, str(Path(__file__).parent.parent))

from aliases import AliasNotFoundError, AliasResolver


class TestAliasResolver:
    """Tests for AliasResolver class."""

    @pytest.fixture
    def resolver(self) -> AliasResolver:
        """Create resolver with sample machine config."""
        return AliasResolver({
            "@БАЗА": "/Users/starship/Drive/!БАЗА",
            "@МетаЛаб": "/Users/starship/Drive/!МетаЛаб",
            "@DuetData": "/Users/starship/DuetData",
            "@Dropbox": "/Users/starship/Dropbox",
            "port": 19680,  # Non-alias field, should be ignored
        })

    def test_resolve_simple_alias(self, resolver: AliasResolver) -> None:
        """Resolves simple alias without subpath."""
        assert resolver.resolve("@БАЗА") == "/Users/starship/Drive/!БАЗА"

    def test_resolve_alias_with_subpath(self, resolver: AliasResolver) -> None:
        """Resolves alias with subpath."""
        assert (
            resolver.resolve("@БАЗА/subfolder")
            == "/Users/starship/Drive/!БАЗА/subfolder"
        )

    def test_resolve_alias_with_deep_subpath(self, resolver: AliasResolver) -> None:
        """Resolves alias with deep subpath."""
        assert (
            resolver.resolve("@МетаЛаб/deep/nested/path")
            == "/Users/starship/Drive/!МетаЛаб/deep/nested/path"
        )

    def test_resolve_absolute_path_unchanged(self, resolver: AliasResolver) -> None:
        """Absolute paths without @ prefix are returned unchanged."""
        assert resolver.resolve("/absolute/path") == "/absolute/path"

    def test_resolve_relative_path_unchanged(self, resolver: AliasResolver) -> None:
        """Relative paths without @ prefix are returned unchanged."""
        assert resolver.resolve("relative/path") == "relative/path"

    def test_raises_on_unknown_alias(self, resolver: AliasResolver) -> None:
        """Raises AliasNotFoundError for unknown alias."""
        with pytest.raises(AliasNotFoundError, match="@Unknown"):
            resolver.resolve("@Unknown")

    def test_error_message_shows_available_aliases(
        self, resolver: AliasResolver
    ) -> None:
        """Error message shows available aliases."""
        with pytest.raises(AliasNotFoundError) as exc_info:
            resolver.resolve("@Unknown")

        error_msg = str(exc_info.value)
        assert "@БАЗА" in error_msg
        assert "@МетаЛаб" in error_msg

    def test_resolve_all_success(self, resolver: AliasResolver) -> None:
        """resolve_all resolves list of paths."""
        paths = ["@БАЗА", "@МетаЛаб/sub", "/absolute"]
        result = resolver.resolve_all(paths)

        assert result == [
            "/Users/starship/Drive/!БАЗА",
            "/Users/starship/Drive/!МетаЛаб/sub",
            "/absolute",
        ]

    def test_resolve_all_raises_on_first_error(
        self, resolver: AliasResolver
    ) -> None:
        """resolve_all raises on first error."""
        with pytest.raises(AliasNotFoundError, match="@Unknown"):
            resolver.resolve_all(["@БАЗА", "@Unknown", "@Another"])

    def test_get_aliases(self, resolver: AliasResolver) -> None:
        """get_aliases returns copy of aliases dict."""
        aliases = resolver.get_aliases()

        assert "@БАЗА" in aliases
        assert "@МетаЛаб" in aliases
        assert "@DuetData" in aliases
        assert "@Dropbox" in aliases
        # Non-alias keys should be excluded
        assert "port" not in aliases

    def test_get_aliases_returns_copy(self, resolver: AliasResolver) -> None:
        """get_aliases returns a copy, not the internal dict."""
        aliases1 = resolver.get_aliases()
        aliases1["@New"] = "/new/path"

        aliases2 = resolver.get_aliases()
        assert "@New" not in aliases2

    def test_has_alias_true(self, resolver: AliasResolver) -> None:
        """has_alias returns True for existing alias."""
        assert resolver.has_alias("@БАЗА") is True
        assert resolver.has_alias("@МетаЛаб") is True

    def test_has_alias_false(self, resolver: AliasResolver) -> None:
        """has_alias returns False for non-existing alias."""
        assert resolver.has_alias("@Unknown") is False
        assert resolver.has_alias("БАЗА") is False  # Missing @

    def test_ignores_non_alias_keys(self) -> None:
        """Only keys starting with @ are treated as aliases."""
        resolver = AliasResolver({
            "@Valid": "/valid/path",
            "invalid": "/invalid/path",
            "port": 19680,
            "business_folders": ["/some/path"],
        })

        assert resolver.has_alias("@Valid") is True
        assert resolver.has_alias("invalid") is False
        assert len(resolver.get_aliases()) == 1


class TestAliasResolverEdgeCases:
    """Edge case tests for AliasResolver."""

    def test_empty_config(self) -> None:
        """Works with empty config (no aliases)."""
        resolver = AliasResolver({})

        assert resolver.get_aliases() == {}
        assert resolver.has_alias("@Any") is False
        assert resolver.resolve("/absolute") == "/absolute"

    def test_unicode_alias(self) -> None:
        """Handles unicode aliases correctly."""
        resolver = AliasResolver({
            "@СЕМЬЯ": "/Users/test/Family",
            "@日本語": "/Users/test/Japanese",
        })

        assert resolver.resolve("@СЕМЬЯ") == "/Users/test/Family"
        assert resolver.resolve("@日本語") == "/Users/test/Japanese"

    def test_alias_with_spaces_in_path(self) -> None:
        """Handles paths with spaces."""
        resolver = AliasResolver({
            "@My Folder": "/Users/test/My Folder",
        })

        assert resolver.resolve("@My Folder") == "/Users/test/My Folder"
        assert resolver.resolve("@My Folder/sub") == "/Users/test/My Folder/sub"

    def test_subpath_with_special_chars(self) -> None:
        """Handles subpaths with special characters."""
        resolver = AliasResolver({"@Base": "/base"})

        # Multiple slashes in subpath
        assert resolver.resolve("@Base/a/b/c") == "/base/a/b/c"
