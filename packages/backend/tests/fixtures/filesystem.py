"""Filesystem fixtures for tests.

Provides builders for creating DuetData directory structures
and `context.json` v2 manifests in temporary directories.

Architecture mirrors production:
- Pointer file (~/.org.ve68.duet) → points to DuetData and DuetConfig
- DuetData/ → local cache (entities.db, repos/, logs)
- DuetConfig/ → cloud-synced config (settings.json with `root_context_folders`,
  {machine}.json)
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    pass


class ManifestBuilder:
    """Builder for creating `context.json` v3 manifests.

    Usage:
        ManifestBuilder.context(path, "Duet", git_repos={"Duet": "https://..."})
        ManifestBuilder.context(path, "БАЗА", meta=True)
        # Backwards-compat sugar: single-repo terminal context.
        ManifestBuilder.context(path, "Duet", git_url="https://...")
        # ↳ writes git_repos={"Duet": "https://..."} under the hood.
    """

    @staticmethod
    def _write(path: Path, data: dict) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)

    @classmethod
    def context(
        cls,
        folder: Path,
        name: str,
        icon: str | None = None,
        git_repos: dict[str, str] | None = None,
        git_url: str | None = None,
        meta: bool = False,
        reference_repos: dict[str, str] | None = None,
        description: str | None = None,
        version: int = 3,
        **extra,
    ) -> Path:
        """Create `context.json` v3 manifest at `folder`.

        `git_url=` is single-repo sugar for `git_repos={name: git_url}`,
        kept so older single-repo test scenarios stay legible. Pass
        `version` only to test version mismatch behavior.
        """
        if git_repos is None and git_url is not None:
            git_repos = {name: git_url}
        if icon is None:
            icon = "📦" if git_repos else "📁"
        data: dict = {"version": version, "name": name, "icon": icon}
        if meta:
            data["meta"] = True
        if git_repos is not None:
            data["git_repos"] = git_repos
        if reference_repos is not None:
            data["reference_repos"] = reference_repos
        if description is not None:
            data["description"] = description
        data.update(extra)
        path = folder / "context.json"
        cls._write(path, data)
        return path


class DuetDataBuilder:
    """Builder for creating DuetData + DuetConfig + pointer for tests.

    Creates:
    - DuetData/ (tmp_path/DuetData)
        - ai-instructions/
        - data/
        - repos/ (optional)
        - backend/VERSION (optional)
    - DuetConfig/ (tmp_path/DuetConfig)
        - settings.json
        - {machine}.json
    - pointer file (tmp_path/.org.ve68.duet)
    """

    DEFAULT_MACHINE = "test_machine"

    DEFAULT_SETTINGS = {
        "root_context_folders": [],
        "timestampTZ": {"id": "Z", "value": "UTC"},
    }

    DEFAULT_MACHINE_CONFIG = {
        "port": 19680,
    }

    def __init__(self, root: Path):
        self.root = root
        self._machine = self.DEFAULT_MACHINE
        self._settings = self.DEFAULT_SETTINGS.copy()
        self._machine_config = self.DEFAULT_MACHINE_CONFIG.copy()
        self._version: str | None = "test"
        # (name, folder_name, extra_manifest_kwargs)
        self._contexts: list[tuple[str, str, dict]] = []
        self._root_context_folders: list[Path] = []
        self._repos: list[tuple[str, list[str]]] = []
        self._aliases: dict[str, str] = {}
        self._instructions_path: Path | None = root / "instructions"

    @property
    def duet_data_path(self) -> Path:
        return self.root / "DuetData"

    @property
    def duet_config_path(self) -> Path:
        return self.root / "DuetConfig"

    @property
    def pointer_path(self) -> Path:
        return self.root / ".org.ve68.duet"

    def with_machine(self, machine: str) -> "DuetDataBuilder":
        self._machine = machine
        return self

    def with_version(self, version: str | None) -> "DuetDataBuilder":
        self._version = version
        return self

    def with_port(self, port: int) -> "DuetDataBuilder":
        self._machine_config["port"] = port
        return self

    def with_timezone(self, tz_id: str, tz_value: str) -> "DuetDataBuilder":
        self._settings["timestampTZ"] = {"id": tz_id, "value": tz_value}
        return self

    def with_root_context_folders(self, folders: list[str]) -> "DuetDataBuilder":
        """Set root_context_folders in settings (as @aliases or absolute paths)."""
        self._settings["root_context_folders"] = folders
        return self

    def add_alias(self, alias: str, path: str) -> "DuetDataBuilder":
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

    def add_root_context(
        self,
        name: str,
        folder_name: str | None = None,
        meta: bool = False,
    ) -> "DuetDataBuilder":
        """Add a root context folder to be created with a `context.json` v2.

        Args:
            name: Context name (for manifest)
            folder_name: Folder name (defaults to name)
            meta: Whether this is the meta-context
        """
        extra: dict = {}
        if meta:
            extra["meta"] = True
        self._contexts.append((name, folder_name or name, extra))
        return self

    def add_repo(
        self, name: str, components: list[str] | None = None
    ) -> "DuetDataBuilder":
        """Add a repo to repos/ directory."""
        self._repos.append((name, components or []))
        return self

    def build(self, monkeypatch=None) -> Path:
        """Build the DuetData + DuetConfig + pointer structure and return DuetData path."""
        (self.duet_data_path / "ai-instructions").mkdir(parents=True, exist_ok=True)
        (self.duet_data_path / "data").mkdir(parents=True, exist_ok=True)

        if self._version is not None:
            version_path = self.duet_data_path / "backend" / "VERSION"
            version_path.parent.mkdir(parents=True, exist_ok=True)
            version_path.write_text(self._version)

        if self._instructions_path:
            self._instructions_path.mkdir(parents=True, exist_ok=True)
            index_data = {
                "personas": {"path": "personas"},
                "skill_folders": [
                    {"name": "Tools", "path": "skills/tools"}
                ]
            }
            (self._instructions_path / "index.json").write_text(
                json.dumps(index_data, indent=2), encoding="utf-8"
            )
            personas_dir = self._instructions_path / "personas"
            personas_dir.mkdir(parents=True, exist_ok=True)
            (personas_dir / "test-persona.md").write_text(
                "---\nname: test-persona\ndescription: A test persona\n"
                "shortcuts: [\"тест\"]\n---\n\n# Test Persona\n",
                encoding="utf-8",
            )
            skills_dir = self._instructions_path / "skills" / "tools"
            skills_dir.mkdir(parents=True, exist_ok=True)
            (skills_dir / "test-skill.md").write_text(
                "---\nname: test-skill\ndescription: A test skill\n"
                "shortcuts: [\"!тест\"]\ntrigger: \"User asks for test\"\n"
                "noTrigger: \"Not a test\"\n---\n\n# Test Skill\n",
                encoding="utf-8",
            )
            self._machine_config["instructionsPath"] = str(self._instructions_path)

        for name, folder_name, extra in self._contexts:
            ctx_path = self.root / folder_name
            ctx_path.mkdir(parents=True, exist_ok=True)
            ManifestBuilder.context(ctx_path, name, **extra)
            self._root_context_folders.append(ctx_path)

            alias = f"@{folder_name}"
            self._aliases[alias] = str(ctx_path)

        if self._repos:
            repos_path = self.duet_data_path / "repos"
            repos_path.mkdir(parents=True, exist_ok=True)
            for name, components in self._repos:
                repo_path = repos_path / f"{name}.git"
                repo_path.mkdir(parents=True, exist_ok=True)
                if components:
                    packages_path = repo_path / "packages"
                    packages_path.mkdir(parents=True, exist_ok=True)
                    for comp_name in components:
                        comp_path = packages_path / comp_name
                        comp_path.mkdir(parents=True, exist_ok=True)

        if self._root_context_folders:
            self._settings["root_context_folders"] = [
                f"@{p.name}" for p in self._root_context_folders
            ]

        self.duet_config_path.mkdir(parents=True, exist_ok=True)

        settings_path = self.duet_config_path / "settings.json"
        with open(settings_path, "w", encoding="utf-8") as f:
            json.dump(self._settings, f, ensure_ascii=False, indent=2)

        machine_config = {**self._machine_config, **self._aliases}
        machine_config_path = self.duet_config_path / f"{self._machine}.json"
        with open(machine_config_path, "w", encoding="utf-8") as f:
            json.dump(machine_config, f, ensure_ascii=False, indent=2)

        pointer_data = {
            "machine": self._machine,
            "duetDataPath": str(self.duet_data_path),
            "duetConfigPath": str(self.duet_config_path),
        }
        with open(self.pointer_path, "w", encoding="utf-8") as f:
            json.dump(pointer_data, f, ensure_ascii=False, indent=2)

        if monkeypatch is not None:
            import config
            monkeypatch.setenv("DUET_POINTER_FILE", str(self.pointer_path))
            config.reset_cache()

        return self.duet_data_path

    def get_root_context_path(self, index: int = 0) -> Path:
        if index < len(self._root_context_folders):
            return self._root_context_folders[index]
        raise IndexError(f"No root context folder at index {index}")

    def get_repo_path(self, name: str) -> Path:
        return self.duet_data_path / "repos" / f"{name}.git"

    def get_repos_path(self) -> Path:
        return self.duet_data_path / "repos"


class HierarchyBuilder:
    """Builder for creating context hierarchies in filesystem.

    Creates folder structure with `context.json` v2 manifests for testing scanner.

    Usage:
        builder = HierarchyBuilder(root_context_path, "RootCtx")
        builder.add_child("Mid").add_child("Product", git_url="https://...")
        builder.build()
    """

    def __init__(self, root: Path, name: str | None = None, **manifest_kwargs):
        self.root = root
        self.name = name
        self._children: list["HierarchyBuilder"] = []
        self._manifest_kwargs = manifest_kwargs

    def add_child(self, name: str, **manifest_kwargs) -> "HierarchyBuilder":
        """Add a nested context."""
        child = HierarchyBuilder(self.root / name, name, **manifest_kwargs)
        self._children.append(child)
        return child

    def build(self) -> Path:
        self.root.mkdir(parents=True, exist_ok=True)
        ManifestBuilder.context(self.root, self.name or self.root.name, **self._manifest_kwargs)
        for child in self._children:
            child.build()
        return self.root
