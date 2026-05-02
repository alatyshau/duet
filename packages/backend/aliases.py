"""Alias resolver for Duet backend.

Aliases are named paths with '@' prefix that resolve to absolute paths
through {machine}.json mapping.

Example:
    {machine}.json:
    {
        "@БАЗА": "/Users/starship/.../!БАЗА",
        "@Dropbox_Library": "/Users/starship/Dropbox/Library"
    }

    "@БАЗА/subfolder" → "/Users/starship/.../!БАЗА/subfolder"
"""

import os


class AliasNotFoundError(Exception):
    """Raised when alias is not found in machine config."""

    pass


class AliasResolver:
    """Resolves @aliases to absolute paths using machine config."""

    def __init__(self, machine_config: dict):
        """Initialize resolver with machine config.

        Args:
            machine_config: Contents of {machine}.json file.
                           Only keys starting with '@' are used as aliases.
        """
        # Extract only alias keys (starting with @)
        self.aliases: dict[str, str] = {
            k: v for k, v in machine_config.items() if k.startswith("@")
        }

    def resolve(self, path: str) -> str:
        """Resolve @alias path to absolute path.

        Args:
            path: Path that may contain @alias prefix.
                  Examples: "@БАЗА", "@БАЗА/subfolder", "/absolute/path"

        Returns:
            Resolved absolute path.

        Raises:
            AliasNotFoundError: If alias is not found in machine config.

        Examples:
            resolve("@БАЗА") → "/Users/.../!БАЗА"
            resolve("@БАЗА/subfolder") → "/Users/.../!БАЗА/subfolder"
            resolve("/absolute/path") → "/absolute/path" (unchanged)
        """
        if not path.startswith("@"):
            return path

        # Split "@БАЗА/subfolder" → ["@БАЗА", "subfolder"]
        parts = path.split("/", 1)
        alias = parts[0]

        if alias not in self.aliases:
            raise AliasNotFoundError(
                f"Alias '{alias}' not found in machine config. "
                f"Available aliases: {', '.join(sorted(self.aliases.keys()))}"
            )

        resolved = self.aliases[alias]

        # If there's a subpath, append it using OS-native separator
        if len(parts) > 1:
            return os.path.join(resolved, parts[1])

        return resolved

    def resolve_all(self, paths: list[str]) -> list[str]:
        """Resolve list of paths, collecting errors.

        Args:
            paths: List of paths that may contain @alias prefixes.

        Returns:
            List of resolved absolute paths.

        Raises:
            AliasNotFoundError: If any alias is not found (first error).
        """
        return [self.resolve(p) for p in paths]

    def get_aliases(self) -> dict[str, str]:
        """Get all aliases as dict.

        Returns:
            Copy of aliases dict.
        """
        return dict(self.aliases)

    def has_alias(self, alias: str) -> bool:
        """Check if alias exists.

        Args:
            alias: Alias name including '@' prefix.

        Returns:
            True if alias exists.
        """
        return alias in self.aliases
