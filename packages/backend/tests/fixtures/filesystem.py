"""Filesystem fixtures for tests.

Provides builders for creating DuetData directory structures
and manifest files in temporary directories.

New architecture:
- Pointer file (~/.org.ve68.duet) → points to DuetData and DuetConfig
- DuetData/ → local cache (entities.db, repos/, logs)
- DuetConfig/ → cloud-synced config (settings.json, {machine}.json)
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
    """Builder for creating DuetData + DuetConfig + pointer structure for tests.

    New architecture creates:
    - DuetData/ (tmp_path/DuetData)
        - ai-instructions/
        - data/
        - repos/ (optional)
        - backend/VERSION (optional)
    - DuetConfig/ (tmp_path/DuetConfig)
        - settings.json
        - {machine}.json
    - pointer file (tmp_path/.org.ve68.duet)

    Usage:
        # Basic usage
        builder = DuetDataBuilder(tmp_path)
        duet_data_path = builder.build()

        # With custom settings
        builder = DuetDataBuilder(tmp_path)
        builder.with_version("1.0.0")
        builder.with_port(19680)
        builder.add_alias("@БАЗА", "/path/to/база")
        duet_data_path = builder.build()

        # Create with hierarchy
        builder = DuetDataBuilder(tmp_path)
        builder.add_business("MyBusiness")
        duet_data_path = builder.build()
    """

    DEFAULT_MACHINE = "test_machine"

    DEFAULT_SETTINGS = {
        "business_folders": [],
        "timestampTZ": {"id": "Z", "value": "UTC"},
    }

    DEFAULT_MACHINE_CONFIG = {
        "port": 19680,
    }

    def __init__(self, root: Path):
        """Initialize builder with root path (usually tmp_path from pytest)."""
        self.root = root
        self._machine = self.DEFAULT_MACHINE
        self._settings = self.DEFAULT_SETTINGS.copy()
        self._machine_config = self.DEFAULT_MACHINE_CONFIG.copy()
        self._version: str | None = "test"
        self._hierarchies: list[tuple[str, str, dict]] = []  # (name, folder_name, extra)
        self._business_folders: list[Path] = []
        self._repos: list[tuple[str, list[str]]] = []  # (name, components)
        self._aliases: dict[str, str] = {}
        self._instructions_path: Path | None = root / "instructions"  # always created by default

    @property
    def duet_data_path(self) -> Path:
        """Get path to DuetData directory."""
        return self.root / "DuetData"

    @property
    def duet_config_path(self) -> Path:
        """Get path to DuetConfig directory."""
        return self.root / "DuetConfig"

    @property
    def pointer_path(self) -> Path:
        """Get path to pointer file."""
        return self.root / ".org.ve68.duet"

    def with_machine(self, machine: str) -> "DuetDataBuilder":
        """Set machine identifier."""
        self._machine = machine
        return self

    def with_version(self, version: str | None) -> "DuetDataBuilder":
        """Set version (written to DuetData/backend/VERSION)."""
        self._version = version
        return self

    def with_port(self, port: int) -> "DuetDataBuilder":
        """Set port in machine config."""
        self._machine_config["port"] = port
        return self

    def with_timezone(self, tz_id: str, tz_value: str) -> "DuetDataBuilder":
        """Set timezone in settings."""
        self._settings["timestampTZ"] = {"id": tz_id, "value": tz_value}
        return self

    def with_business_folders(self, folders: list[str]) -> "DuetDataBuilder":
        """Set business folders in settings (as @aliases or absolute paths)."""
        self._settings["business_folders"] = folders
        return self

    def add_alias(self, alias: str, path: str) -> "DuetDataBuilder":
        """Add @alias mapping to machine config."""
        self._aliases[alias] = path
        return self

    def with_instructions(self) -> "DuetDataBuilder":
        """Create instructions workspace with index.json and sample files.

        This is the default — called implicitly. Explicit call is a no-op.
        """
        self._instructions_path = self.root / "instructions"
        return self

    def without_instructions(self) -> "DuetDataBuilder":
        """Disable instructions workspace creation (for testing missing config)."""
        self._instructions_path = None
        return self

    def add_business(self, name: str, folder_name: str | None = None, root: bool = False) -> "DuetDataBuilder":
        """Add a business folder to be created.

        Args:
            name: Business name (for manifest)
            folder_name: Folder name (defaults to name)
            root: Whether this is the root business (meta-business)
        """
        extra = {"root": True} if root else {}
        self._hierarchies.append((name, folder_name or name, extra))
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

    def build(self, monkeypatch=None) -> Path:
        """Build the DuetData + DuetConfig + pointer structure and return DuetData path.

        Args:
            monkeypatch: Optional pytest monkeypatch fixture. If provided,
                        sets DUET_POINTER_FILE env and resets config cache.
        """
        # Create DuetData directories
        (self.duet_data_path / "ai-instructions").mkdir(parents=True, exist_ok=True)
        (self.duet_data_path / "data").mkdir(parents=True, exist_ok=True)

        # Create version file if specified
        if self._version is not None:
            version_path = self.duet_data_path / "backend" / "VERSION"
            version_path.parent.mkdir(parents=True, exist_ok=True)
            version_path.write_text(self._version)

        # Create instructions workspace if requested
        if self._instructions_path:
            self._instructions_path.mkdir(parents=True, exist_ok=True)
            # Create index.json
            index_data = {
                "personas": {"path": "personas"},
                "skill_folders": [
                    {"name": "Tools", "path": "skills/tools"}
                ]
            }
            (self._instructions_path / "index.json").write_text(
                json.dumps(index_data, indent=2), encoding="utf-8"
            )
            # Create personas dir with sample
            personas_dir = self._instructions_path / "personas"
            personas_dir.mkdir(parents=True, exist_ok=True)
            (personas_dir / "test-persona.md").write_text(
                "---\nname: test-persona\ndescription: A test persona\n"
                "shortcuts: [\"тест\"]\n---\n\n# Test Persona\n",
                encoding="utf-8",
            )
            # Create skills dir with sample
            skills_dir = self._instructions_path / "skills" / "tools"
            skills_dir.mkdir(parents=True, exist_ok=True)
            (skills_dir / "test-skill.md").write_text(
                "---\nname: test-skill\ndescription: A test skill\n"
                "shortcuts: [\"!тест\"]\ntrigger: \"User asks for test\"\n"
                "noTrigger: \"Not a test\"\n---\n\n# Test Skill\n",
                encoding="utf-8",
            )
            # Add to machine config
            self._machine_config["instructionsPath"] = str(self._instructions_path)

        # Create business folders if any
        for name, folder_name, extra in self._hierarchies:
            biz_path = self.root / folder_name
            biz_path.mkdir(parents=True, exist_ok=True)
            ManifestBuilder.business(biz_path, name, **extra)
            self._business_folders.append(biz_path)

            # Auto-create alias for business folder
            alias = f"@{folder_name}"
            self._aliases[alias] = str(biz_path)

        # Create repos if any
        if self._repos:
            repos_path = self.duet_data_path / "repos"
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

        # Update settings with business folder aliases
        if self._business_folders:
            self._settings["business_folders"] = [
                f"@{p.name}" for p in self._business_folders
            ]

        # Create DuetConfig directory
        self.duet_config_path.mkdir(parents=True, exist_ok=True)

        # Write settings.json
        settings_path = self.duet_config_path / "settings.json"
        with open(settings_path, "w", encoding="utf-8") as f:
            json.dump(self._settings, f, ensure_ascii=False, indent=2)

        # Merge aliases into machine config and write {machine}.json
        machine_config = {**self._machine_config, **self._aliases}
        machine_config_path = self.duet_config_path / f"{self._machine}.json"
        with open(machine_config_path, "w", encoding="utf-8") as f:
            json.dump(machine_config, f, ensure_ascii=False, indent=2)

        # Write pointer file
        pointer_data = {
            "machine": self._machine,
            "duetDataPath": str(self.duet_data_path),
            "duetConfigPath": str(self.duet_config_path),
        }
        with open(self.pointer_path, "w", encoding="utf-8") as f:
            json.dump(pointer_data, f, ensure_ascii=False, indent=2)

        # If monkeypatch provided, configure config module
        if monkeypatch is not None:
            import config
            monkeypatch.setenv("DUET_POINTER_FILE", str(self.pointer_path))
            config.reset_cache()

        return self.duet_data_path

    def get_business_path(self, index: int = 0) -> Path:
        """Get path to a created business folder by index."""
        if index < len(self._business_folders):
            return self._business_folders[index]
        raise IndexError(f"No business folder at index {index}")

    def get_repo_path(self, name: str) -> Path:
        """Get path to a created repo by name."""
        return self.duet_data_path / "repos" / f"{name}.git"

    def get_repos_path(self) -> Path:
        """Get path to repos/ directory."""
        return self.duet_data_path / "repos"


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

        # Build children
        for child in self._children:
            child.build()

        return self.root
