"""Tests for EntitiesService.get_contexts — v3 contract.

§7.2 added two fields to the /contexts response for context entities:
- `git_repos` — alias→URL map (live from manifest); `null` when absent.
- `description` — chain-item description (manifest > README first sentence).

`reference_repos` was already there.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from db import DatabaseManager
from scanner import Scanner
from services.entities import EntitiesService

from tests.fixtures import DuetDataBuilder, ManifestBuilder


class TestContextsReturnsGitRepos:
    def test_contexts_returns_git_repos_map(
        self, tmp_path: Path, db: DatabaseManager, monkeypatch
    ) -> None:
        builder = DuetDataBuilder(tmp_path)
        builder.add_root_context("Root")
        builder.build(monkeypatch)

        root_path = builder.get_root_context_path(0)
        lab_path = root_path / "DuetLab"
        lab_path.mkdir()
        ManifestBuilder.context(
            lab_path, "DuetLab",
            git_repos={
                "Duet": "https://duet.git",
                "Duet-Instructions": "https://duet-instructions.git",
            },
        )
        Scanner(db, repos_path=builder.get_repos_path()).scan()

        contexts = EntitiesService(db).get_contexts()
        lab = next(c for c in contexts if c["name"] == "DuetLab")

        assert lab["git_repos"] == {
            "Duet": "https://duet.git",
            "Duet-Instructions": "https://duet-instructions.git",
        }

    def test_contexts_git_repos_null_when_absent(
        self, tmp_path: Path, db: DatabaseManager, monkeypatch
    ) -> None:
        builder = DuetDataBuilder(tmp_path)
        builder.add_root_context("Plain")
        builder.build(monkeypatch)
        Scanner(db).scan()

        contexts = EntitiesService(db).get_contexts()
        plain = next(c for c in contexts if c["name"] == "Plain")
        assert plain["git_repos"] is None


class TestContextsIncludesDescription:
    def test_contexts_chain_includes_description_from_manifest(
        self, tmp_path: Path, db: DatabaseManager, monkeypatch
    ) -> None:
        builder = DuetDataBuilder(tmp_path)
        builder.add_root_context("Root")
        builder.build(monkeypatch)

        root_path = builder.get_root_context_path(0)
        ManifestBuilder.context(
            root_path, "Root",
            description="Manifest-supplied description.",
        )
        Scanner(db).scan()

        contexts = EntitiesService(db).get_contexts()
        root = next(c for c in contexts if c["name"] == "Root")
        assert root["description"] == "Manifest-supplied description."

    def test_contexts_chain_falls_back_to_readme(
        self, tmp_path: Path, db: DatabaseManager, monkeypatch
    ) -> None:
        builder = DuetDataBuilder(tmp_path)
        builder.add_root_context("Root")
        builder.build(monkeypatch)

        root_path = builder.get_root_context_path(0)
        (root_path / "README.md").write_text(
            "# Root\n\nReadme description.",
            encoding="utf-8",
        )
        Scanner(db).scan()

        contexts = EntitiesService(db).get_contexts()
        root = next(c for c in contexts if c["name"] == "Root")
        assert root["description"] == "Readme description."

    def test_contexts_description_null_when_neither_present(
        self, tmp_path: Path, db: DatabaseManager, monkeypatch
    ) -> None:
        builder = DuetDataBuilder(tmp_path)
        builder.add_root_context("Root")
        builder.build(monkeypatch)
        Scanner(db).scan()

        contexts = EntitiesService(db).get_contexts()
        root = next(c for c in contexts if c["name"] == "Root")
        assert root["description"] is None
