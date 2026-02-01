"""Filesystem fixtures for tests.

Provides builders for creating DuetData directory structures
and manifest files in temporary directories.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    pass


class ManifestBuilder:
    """Builder for creating manifest files (business.json, stream.json, etc.).

    Usage:
        ManifestBuilder.business(path, "My Business", "🏢")
        ManifestBuilder.product(path, "My Product", git_url="https://...")
    """

    @staticmethod
    def _write(path: Path, data: dict) -> None:
        """Write manifest data to file."""
        path.parent.mkdir(parents=True, exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)

    @classmethod
    def business(cls, folder: Path, name: str, icon: str = "🏢", **kwargs) -> Path:
        """Create business.json manifest."""
        path = folder / "business.json"
        cls._write(path, {"name": name, "icon": icon, **kwargs})
        return path

    @classmethod
    def stream(cls, folder: Path, name: str, icon: str = "🌊", **kwargs) -> Path:
        """Create stream.json manifest."""
        path = folder / "stream.json"
        cls._write(path, {"name": name, "icon": icon, **kwargs})
        return path

    @classmethod
    def product(cls, folder: Path, name: str, icon: str = "📦", git_url: str | None = None, **kwargs) -> Path:
        """Create product.json manifest."""
        data = {"name": name, "icon": icon, **kwargs}
        if git_url:
            data["git_url"] = git_url
        path = folder / "product.json"
        cls._write(path, data)
        return path


class DuetDataBuilder:
    """Builder for creating DuetData directory structure for tests.

    Creates the standard DuetData structure with:
    - ai-kit/ directory
    - data/ directory
    - repos/ directory (optional)
    - config.json with test configuration

    Usage:
        # Basic usage
        builder = DuetDataBuilder(tmp_path)
        duet_data_path = builder.build()

        # With custom config
        builder = DuetDataBuilder(tmp_path)
        builder.with_version("1.0.0")
        builder.with_business_folders(["/path/to/business"])
        duet_data_path = builder.build()

        # Create with hierarchy
        builder = DuetDataBuilder(tmp_path)
        builder.with_hierarchy("MyBusiness")
        duet_data_path = builder.build()

        # Create with repos
        builder = DuetDataBuilder(tmp_path)
        builder.add_repo("Duet")  # Creates repos/Duet.git/
        duet_data_path = builder.build()
    """

    DEFAULT_CONFIG = {
        "version": "test",
        "port": 19680,
        "business_folders": [],
        "timestampTZ": {"id": "Z", "value": "UTC"},
    }

    def __init__(self, root: Path):
        """Initialize builder with root path (usually tmp_path from pytest)."""
        self.root = root
        self._config = self.DEFAULT_CONFIG.copy()
        self._hierarchies: list[tuple[str, str]] = []  # (name, folder_name)
        self._business_folders: list[Path] = []
        self._repos: list[tuple[str, list[str]]] = []  # (name, components)

    def with_version(self, version: str) -> "DuetDataBuilder":
        """Set version in config."""
        self._config["version"] = version
        return self

    def with_port(self, port: int) -> "DuetDataBuilder":
        """Set port in config."""
        self._config["port"] = port
        return self

    def with_timezone(self, tz_id: str, tz_value: str) -> "DuetDataBuilder":
        """Set timezone in config."""
        self._config["timestampTZ"] = {"id": tz_id, "value": tz_value}
        return self

    def with_business_folders(self, folders: list[str]) -> "DuetDataBuilder":
        """Set business folders in config."""
        self._config["business_folders"] = folders
        return self

    def add_business(self, name: str, folder_name: str | None = None) -> "DuetDataBuilder":
        """Add a business folder to be created.

        Args:
            name: Business name (for manifest)
            folder_name: Folder name (defaults to name)
        """
        self._hierarchies.append((name, folder_name or name))
        return self

    def add_repo(
        self, name: str, components: list[str] | None = None
    ) -> "DuetDataBuilder":
        """Add a repo to repos/ directory.

        Args:
            name: Repo name (creates repos/{name}.git/)
            components: List of component names to create in packages/
        """
        self._repos.append((name, components or []))
        return self

    def build(self) -> Path:
        """Build the DuetData structure and return path."""
        # Create base directories
        (self.root / "ai-kit").mkdir(parents=True, exist_ok=True)
        (self.root / "data").mkdir(parents=True, exist_ok=True)

        # Create business folders if any
        for name, folder_name in self._hierarchies:
            biz_path = self.root / folder_name
            biz_path.mkdir(parents=True, exist_ok=True)
            ManifestBuilder.business(biz_path, name)
            self._business_folders.append(biz_path)

        # Create repos if any
        if self._repos:
            repos_path = self.root / "repos"
            repos_path.mkdir(parents=True, exist_ok=True)
            for name, components in self._repos:
                repo_path = repos_path / f"{name}.git"
                repo_path.mkdir(parents=True, exist_ok=True)
                # Create packages/ with components
                if components:
                    packages_path = repo_path / "packages"
                    packages_path.mkdir(parents=True, exist_ok=True)
                    for comp_name in components:
                        comp_path = packages_path / comp_name
                        comp_path.mkdir(parents=True, exist_ok=True)

        # Update config with business folder paths
        if self._business_folders:
            self._config["business_folders"] = [str(p) for p in self._business_folders]

        # Write config
        config_path = self.root / "config.json"
        with open(config_path, "w", encoding="utf-8") as f:
            json.dump(self._config, f, ensure_ascii=False, indent=2)

        return self.root

    def get_business_path(self, index: int = 0) -> Path:
        """Get path to a created business folder by index."""
        if index < len(self._business_folders):
            return self._business_folders[index]
        raise IndexError(f"No business folder at index {index}")

    def get_repo_path(self, name: str) -> Path:
        """Get path to a created repo by name."""
        return self.root / "repos" / f"{name}.git"

    def get_repos_path(self) -> Path:
        """Get path to repos/ directory."""
        return self.root / "repos"


class HierarchyBuilder:
    """Builder for creating entity hierarchies in filesystem.

    Creates folder structure with manifests for testing scanner.

    Usage:
        builder = HierarchyBuilder(business_path)
        builder.add_stream("Stream1")
        builder.add_stream("Stream2").add_product("Product2")
        builder.build()
    """

    def __init__(self, root: Path, name: str | None = None):
        """Initialize with root path and optional name."""
        self.root = root
        self.name = name
        self._children: list["HierarchyBuilder"] = []
        self._type: str = "business"
        self._projects: list[str] = []

    def add_stream(self, name: str) -> "HierarchyBuilder":
        """Add a stream child."""
        child = HierarchyBuilder(self.root / name, name)
        child._type = "stream"
        self._children.append(child)
        return child

    def add_product(self, name: str) -> "HierarchyBuilder":
        """Add a product child."""
        child = HierarchyBuilder(self.root / name, name)
        child._type = "product"
        self._children.append(child)
        return child

    def add_project(self, name: str) -> "HierarchyBuilder":
        """Add a project folder."""
        self._projects.append(name)
        return self

    def build(self) -> Path:
        """Build the hierarchy structure."""
        self.root.mkdir(parents=True, exist_ok=True)

        # Create manifest based on type
        if self._type == "business":
            ManifestBuilder.business(self.root, self.name or self.root.name)
        elif self._type == "stream":
            ManifestBuilder.stream(self.root, self.name or self.root.name)
        elif self._type == "product":
            ManifestBuilder.product(self.root, self.name or self.root.name)

        # Create projects folder if any
        if self._projects:
            projects_path = self.root / "projects"
            projects_path.mkdir(exist_ok=True)
            for project_name in self._projects:
                (projects_path / project_name).mkdir(exist_ok=True)

        # Build children
        for child in self._children:
            child.build()

        return self.root
