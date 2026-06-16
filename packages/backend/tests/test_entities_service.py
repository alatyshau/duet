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

    def test_contexts_includes_drive_child_below_git_repos_context(
        self, tmp_path: Path, db: DatabaseManager, monkeypatch
    ) -> None:
        builder = DuetDataBuilder(tmp_path)
        builder.add_root_context("Root")
        builder.build(monkeypatch)

        root_path = builder.get_root_context_path(0)
        onto_path = root_path / "OntoCore"
        onto_path.mkdir()
        ManifestBuilder.context(
            onto_path, "OntoCore",
            git_repos={"OntoCore": "https://ontocore.git"},
        )
        structs_path = onto_path / "OntoCoreStructs"
        structs_path.mkdir()
        ManifestBuilder.context(structs_path, "OntoCoreStructs")

        Scanner(db, repos_path=builder.get_repos_path()).scan()

        contexts = EntitiesService(db).get_contexts()
        onto = next(c for c in contexts if c["name"] == "OntoCore")
        structs = next(c for c in contexts if c["name"] == "OntoCoreStructs")

        assert structs["parent_id"] == onto["id"]
        assert structs["absolute_path"] == str(structs_path)
        assert structs["git_repos"] is None

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


class TestContextsCanonicalOrder:
    """`/contexts` order contract: roots follow settings.json config order;
    non-root siblings are alphabetical by name. Extension is a passive view
    that preserves this order."""

    def test_roots_follow_config_order(
        self, tmp_path: Path, db: DatabaseManager, monkeypatch
    ) -> None:
        # Declare three roots in a deliberately non-alphabetical order.
        # If sort were alphabetical, the order would be Альфа, БАЗА, Гамма.
        builder = DuetDataBuilder(tmp_path)
        builder.add_root_context("БАЗА", meta=True)
        builder.add_root_context("Гамма")
        builder.add_root_context("Альфа")
        builder.build(monkeypatch)
        Scanner(db).scan()

        contexts = EntitiesService(db).get_contexts()
        roots = [c["name"] for c in contexts if c["parent_id"] is None]
        assert roots == ["БАЗА", "Гамма", "Альфа"]

    def test_non_root_siblings_alphabetical(
        self, tmp_path: Path, db: DatabaseManager, monkeypatch
    ) -> None:
        builder = DuetDataBuilder(tmp_path)
        builder.add_root_context("Root")
        builder.build(monkeypatch)

        root_path = builder.get_root_context_path(0)
        for child_name in ["Янтарь", "Альбатрос", "Гроза"]:
            child_path = root_path / child_name
            child_path.mkdir()
            ManifestBuilder.context(child_path, child_name)
        Scanner(db).scan()

        contexts = EntitiesService(db).get_contexts()
        root = next(c for c in contexts if c["name"] == "Root")
        children = [
            c["name"] for c in contexts if c["parent_id"] == root["id"]
        ]
        assert children == ["Альбатрос", "Гроза", "Янтарь"]

    def test_backend_does_not_reorder_by_meta_flag(
        self, tmp_path: Path, db: DatabaseManager, monkeypatch
    ) -> None:
        # Host enforces the "position 0 = meta" invariant atomically when
        # the config is mutated. Backend is a strict reader and must not
        # apply a second-layer "meta-first" sort — if Host ever ships an
        # inconsistent state (mid-rollback, manual edit), the API must
        # surface the on-disk order verbatim so the user can see and
        # repair it. This test pins that contract by constructing a
        # deliberately inconsistent state (meta flag on the non-first
        # context) and asserting the response preserves config order.
        builder = DuetDataBuilder(tmp_path)
        builder.add_root_context("Альфа")
        builder.add_root_context("БАЗА", meta=True)
        builder.build(monkeypatch)
        Scanner(db).scan()

        contexts = EntitiesService(db).get_contexts()
        roots = [c["name"] for c in contexts if c["parent_id"] is None]
        assert roots == ["Альфа", "БАЗА"]


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
