"""Unit tests for `services.manifest.read_manifest` — strict v4 reader.

Backend is the strict reader: any malformed shape (missing required `name`,
wrong scalar types, bad `git_repos` / `reference_repos` map, bad deploy
fields) must be reported as `invalid_manifest`, never silently coerced.
Folder-name fallback in the scanner is intentionally absent — these tests
are the safety net that catches regressions to silent repair.
"""

from __future__ import annotations

import json
from pathlib import Path

from services.manifest import (
    MANIFEST_FILENAME,
    TARGET_VERSION,
    Manifest,
    read_manifest,
    read_reference_repos,
    read_git_repos,
)


def _write(folder: Path, payload) -> None:
    folder.mkdir(parents=True, exist_ok=True)
    (folder / MANIFEST_FILENAME).write_text(
        json.dumps(payload) if not isinstance(payload, str) else payload,
        encoding="utf-8",
    )


class TestReadManifestHappyPath:
    def test_v4_manifest_basic(self, tmp_path: Path) -> None:
        _write(tmp_path, {"version": 4, "name": "Ctx"})
        errors: list[dict] = []
        manifest = read_manifest(tmp_path, errors)
        assert manifest is not None
        assert manifest.version == 4
        assert manifest.name == "Ctx"
        assert manifest.icon is None
        assert manifest.meta is False
        assert manifest.git_repos is None
        assert manifest.reference_repos is None
        assert manifest.description is None
        assert manifest.skills is None
        assert manifest.instructions is None
        assert manifest.memory is None
        assert errors == []

    def test_full_valid_v4(self, tmp_path: Path) -> None:
        _write(tmp_path, {
            "version": 4,
            "name": "DuetLab",
            "icon": "🎭",
            "meta": False,
            "git_repos": {
                "Duet": "git@github.com:owner/duet.git",
                "Duet-Instructions": "git@github.com:owner/duet-instructions.git",
            },
            "reference_repos": {"cookbook": "https://github.com/anthropics/cookbook.git"},
            "description": "A platform.",
            "skills": ["@anthropic-skills.git/skills/skill-creator"],
            "instructions": ["@DuetLab/README.md", "@Duet-Instructions.git/agents/executor.md"],
            "memory": "@DuetLab/README.md",
        })
        manifest = read_manifest(tmp_path, [])
        assert manifest == Manifest(
            version=4,
            name="DuetLab",
            icon="🎭",
            meta=False,
            git_repos={
                "Duet": "git@github.com:owner/duet.git",
                "Duet-Instructions": "git@github.com:owner/duet-instructions.git",
            },
            reference_repos={"cookbook": "https://github.com/anthropics/cookbook.git"},
            description="A platform.",
            skills=["@anthropic-skills.git/skills/skill-creator"],
            instructions=["@DuetLab/README.md", "@Duet-Instructions.git/agents/executor.md"],
            memory="@DuetLab/README.md",
        )

    def test_git_repos_preserves_insertion_order(self, tmp_path: Path) -> None:
        """Manifest map keys are read in source order — `products[]` mirrors it."""
        _write(tmp_path, {
            "version": 4,
            "name": "Lab",
            "git_repos": {
                "zebra": "https://z.git",
                "apple": "https://a.git",
                "mango": "https://m.git",
            },
        })
        manifest = read_manifest(tmp_path)
        assert manifest is not None
        assert list(manifest.git_repos) == ["zebra", "apple", "mango"]

    def test_meta_true(self, tmp_path: Path) -> None:
        _write(tmp_path, {"version": 4, "name": "Meta", "meta": True})
        manifest = read_manifest(tmp_path)
        assert manifest is not None
        assert manifest.meta is True

    def test_unknown_fields_ignored(self, tmp_path: Path) -> None:
        """Forward-compat: unknown fields don't reject the manifest."""
        _write(tmp_path, {"version": 4, "name": "Ctx", "future_field": 42})
        manifest = read_manifest(tmp_path, [])
        assert manifest is not None
        assert manifest.name == "Ctx"


class TestReadManifestAbsence:
    def test_missing_file_returns_none_no_error(self, tmp_path: Path) -> None:
        errors: list[dict] = []
        result = read_manifest(tmp_path, errors)
        assert result is None
        assert errors == []

    def test_none_folder_returns_none(self) -> None:
        assert read_manifest(None) is None


class TestReadManifestVersion:
    def test_missing_version_unrecognized(self, tmp_path: Path) -> None:
        _write(tmp_path, {"name": "X"})
        errors: list[dict] = []
        assert read_manifest(tmp_path, errors) is None
        codes = [e["reason_code"] for e in errors]
        assert codes == ["unrecognized_manifest_version"]

    def test_v3_manifest_unrecognized_version(self, tmp_path: Path) -> None:
        """v3 manifest is not read by Backend — Host owns the v3→v4 migration."""
        _write(tmp_path, {"version": 3, "name": "X", "workspace_config": {"primary_folder": "context"}})
        errors: list[dict] = []
        assert read_manifest(tmp_path, errors) is None
        assert errors[0]["reason_code"] == "unrecognized_manifest_version"

    def test_version_not_four_unrecognized(self, tmp_path: Path) -> None:
        _write(tmp_path, {"version": 99, "name": "X"})
        errors: list[dict] = []
        assert read_manifest(tmp_path, errors) is None
        assert errors[0]["reason_code"] == "unrecognized_manifest_version"

    def test_version_string_unrecognized(self, tmp_path: Path) -> None:
        """`version: "4"` (string) is not v4 — must not be silently accepted."""
        _write(tmp_path, {"version": "4", "name": "X"})
        errors: list[dict] = []
        assert read_manifest(tmp_path, errors) is None
        assert errors[0]["reason_code"] == "unrecognized_manifest_version"

    def test_target_version_constant(self) -> None:
        assert TARGET_VERSION == 4


class TestReadManifestInvalidShape:
    def test_invalid_json_text(self, tmp_path: Path) -> None:
        _write(tmp_path, "{not valid json!!!")
        errors: list[dict] = []
        assert read_manifest(tmp_path, errors) is None
        assert errors[0]["reason_code"] == "invalid_manifest"

    def test_top_level_array_rejected(self, tmp_path: Path) -> None:
        _write(tmp_path, [1, 2, 3])
        errors: list[dict] = []
        assert read_manifest(tmp_path, errors) is None
        assert errors[0]["reason_code"] == "invalid_manifest"
        assert "JSON object" in errors[0]["description"]

    def test_missing_name_rejected(self, tmp_path: Path) -> None:
        _write(tmp_path, {"version": 4})
        errors: list[dict] = []
        assert read_manifest(tmp_path, errors) is None
        assert errors[0]["reason_code"] == "invalid_manifest"
        assert "name" in errors[0]["description"]

    def test_empty_name_rejected(self, tmp_path: Path) -> None:
        _write(tmp_path, {"version": 4, "name": ""})
        errors: list[dict] = []
        assert read_manifest(tmp_path, errors) is None
        assert errors[0]["reason_code"] == "invalid_manifest"
        assert "name" in errors[0]["description"]

    def test_non_string_name_rejected(self, tmp_path: Path) -> None:
        _write(tmp_path, {"version": 4, "name": 123})
        errors: list[dict] = []
        assert read_manifest(tmp_path, errors) is None
        assert errors[0]["reason_code"] == "invalid_manifest"

    def test_non_string_icon_rejected(self, tmp_path: Path) -> None:
        _write(tmp_path, {"version": 4, "name": "X", "icon": 123})
        errors: list[dict] = []
        assert read_manifest(tmp_path, errors) is None
        assert errors[0]["reason_code"] == "invalid_manifest"
        assert "icon" in errors[0]["description"]

    def test_non_bool_meta_rejected(self, tmp_path: Path) -> None:
        _write(tmp_path, {"version": 4, "name": "X", "meta": "true"})
        errors: list[dict] = []
        assert read_manifest(tmp_path, errors) is None
        assert errors[0]["reason_code"] == "invalid_manifest"
        assert "meta" in errors[0]["description"]

    def test_non_string_description_rejected(self, tmp_path: Path) -> None:
        _write(tmp_path, {"version": 4, "name": "X", "description": 42})
        errors: list[dict] = []
        assert read_manifest(tmp_path, errors) is None
        assert errors[0]["reason_code"] == "invalid_manifest"

    def test_reference_repos_not_object(self, tmp_path: Path) -> None:
        _write(tmp_path, {"version": 4, "name": "X", "reference_repos": "nope"})
        errors: list[dict] = []
        assert read_manifest(tmp_path, errors) is None
        assert errors[0]["reason_code"] == "invalid_manifest"

    def test_reference_repos_value_not_string(self, tmp_path: Path) -> None:
        _write(tmp_path, {
            "version": 4, "name": "X",
            "reference_repos": {"good": "https://...", "bad": 42},
        })
        errors: list[dict] = []
        assert read_manifest(tmp_path, errors) is None
        assert errors[0]["reason_code"] == "invalid_manifest"
        assert "reference_repos" in errors[0]["description"]

    def test_empty_reference_repos_map_ok(self, tmp_path: Path) -> None:
        _write(tmp_path, {"version": 4, "name": "X", "reference_repos": {}})
        manifest = read_manifest(tmp_path, [])
        assert manifest is not None
        assert manifest.reference_repos is None


class TestGitReposValidation:
    """Validation rules §1.2 for the `git_repos` field."""

    def test_git_repos_not_object(self, tmp_path: Path) -> None:
        _write(tmp_path, {"version": 4, "name": "X", "git_repos": "https://..."})
        errors: list[dict] = []
        assert read_manifest(tmp_path, errors) is None
        assert errors[0]["reason_code"] == "invalid_manifest"
        assert "git_repos must be an object" in errors[0]["description"]

    def test_git_repos_empty(self, tmp_path: Path) -> None:
        _write(tmp_path, {"version": 4, "name": "X", "git_repos": {}})
        errors: list[dict] = []
        assert read_manifest(tmp_path, errors) is None
        assert errors[0]["reason_code"] == "invalid_manifest"
        assert "non-empty" in errors[0]["description"]

    def test_git_repos_alias_empty(self, tmp_path: Path) -> None:
        _write(tmp_path, {"version": 4, "name": "X", "git_repos": {"": "https://..."}})
        errors: list[dict] = []
        assert read_manifest(tmp_path, errors) is None
        assert errors[0]["reason_code"] == "invalid_manifest"

    def test_git_repos_url_not_string(self, tmp_path: Path) -> None:
        _write(tmp_path, {"version": 4, "name": "X", "git_repos": {"k": 42}})
        errors: list[dict] = []
        assert read_manifest(tmp_path, errors) is None
        assert errors[0]["reason_code"] == "invalid_manifest"
        assert "non-empty string" in errors[0]["description"]

    def test_git_repos_url_empty(self, tmp_path: Path) -> None:
        _write(tmp_path, {"version": 4, "name": "X", "git_repos": {"k": ""}})
        errors: list[dict] = []
        assert read_manifest(tmp_path, errors) is None
        assert errors[0]["reason_code"] == "invalid_manifest"

    def test_alias_overlap_with_reference_repos(self, tmp_path: Path) -> None:
        _write(tmp_path, {
            "version": 4,
            "name": "Lab",
            "git_repos": {"Duet": "https://duet.git"},
            "reference_repos": {"Duet": "https://other.git"},
        })
        errors: list[dict] = []
        assert read_manifest(tmp_path, errors) is None
        assert errors[0]["reason_code"] == "invalid_manifest"
        assert "git_repos" in errors[0]["description"]
        assert "reference_repos" in errors[0]["description"]

    def test_git_repos_absent_is_fine(self, tmp_path: Path) -> None:
        """`git_repos` is optional — a context without it is just intermediate."""
        _write(tmp_path, {"version": 4, "name": "Plain"})
        manifest = read_manifest(tmp_path)
        assert manifest is not None
        assert manifest.git_repos is None


class TestDeployFieldsValidation:
    """`skills` / `instructions` are optional lists of @-path strings;
    `memory` is an optional non-empty string. Resolution of @-paths happens
    later (deploy / orientation) — here only the shape is validated."""

    def test_all_absent(self, tmp_path: Path) -> None:
        _write(tmp_path, {"version": 4, "name": "X"})
        manifest = read_manifest(tmp_path, [])
        assert manifest is not None
        assert manifest.skills is None
        assert manifest.instructions is None
        assert manifest.memory is None

    def test_skills_and_instructions_lists(self, tmp_path: Path) -> None:
        _write(tmp_path, {
            "version": 4, "name": "X",
            "skills": ["@anthropic-skills.git/skills/skill-creator"],
            "instructions": ["@DuetLab/README.md", "@Duet-Instructions.git/agents/executor.md"],
        })
        manifest = read_manifest(tmp_path, [])
        assert manifest is not None
        assert manifest.skills == ["@anthropic-skills.git/skills/skill-creator"]
        assert manifest.instructions == [
            "@DuetLab/README.md", "@Duet-Instructions.git/agents/executor.md",
        ]

    def test_memory_string(self, tmp_path: Path) -> None:
        _write(tmp_path, {"version": 4, "name": "X", "memory": "@DuetLab/README.md"})
        manifest = read_manifest(tmp_path, [])
        assert manifest is not None
        assert manifest.memory == "@DuetLab/README.md"

    def test_empty_lists_ok(self, tmp_path: Path) -> None:
        """An explicit empty list is valid (means "manage, deploy nothing")."""
        _write(tmp_path, {"version": 4, "name": "X", "skills": [], "instructions": []})
        manifest = read_manifest(tmp_path, [])
        assert manifest is not None
        assert manifest.skills == []
        assert manifest.instructions == []

    def test_skills_not_list(self, tmp_path: Path) -> None:
        _write(tmp_path, {"version": 4, "name": "X", "skills": "@x"})
        errors: list[dict] = []
        assert read_manifest(tmp_path, errors) is None
        assert errors[0]["reason_code"] == "invalid_manifest"
        assert "skills" in errors[0]["description"]

    def test_instructions_entry_not_string(self, tmp_path: Path) -> None:
        _write(tmp_path, {"version": 4, "name": "X", "instructions": ["@ok", 42]})
        errors: list[dict] = []
        assert read_manifest(tmp_path, errors) is None
        assert errors[0]["reason_code"] == "invalid_manifest"
        assert "instructions" in errors[0]["description"]

    def test_skills_entry_empty(self, tmp_path: Path) -> None:
        _write(tmp_path, {"version": 4, "name": "X", "skills": ["@ok", "  "]})
        errors: list[dict] = []
        assert read_manifest(tmp_path, errors) is None
        assert errors[0]["reason_code"] == "invalid_manifest"
        assert "skills" in errors[0]["description"]

    def test_memory_not_string(self, tmp_path: Path) -> None:
        _write(tmp_path, {"version": 4, "name": "X", "memory": ["@x"]})
        errors: list[dict] = []
        assert read_manifest(tmp_path, errors) is None
        assert errors[0]["reason_code"] == "invalid_manifest"
        assert "memory" in errors[0]["description"]

    def test_memory_empty_string(self, tmp_path: Path) -> None:
        _write(tmp_path, {"version": 4, "name": "X", "memory": ""})
        errors: list[dict] = []
        assert read_manifest(tmp_path, errors) is None
        assert errors[0]["reason_code"] == "invalid_manifest"
        assert "memory" in errors[0]["description"]


class TestReadReferenceRepos:
    def test_returns_dict_when_present(self, tmp_path: Path) -> None:
        _write(tmp_path, {
            "version": 4, "name": "X",
            "reference_repos": {"a": "https://a.git", "b": "https://b.git"},
        })
        result = read_reference_repos(tmp_path)
        assert result == {"a": "https://a.git", "b": "https://b.git"}

    def test_returns_none_when_absent(self, tmp_path: Path) -> None:
        _write(tmp_path, {"version": 4, "name": "X"})
        assert read_reference_repos(tmp_path) is None


class TestReadGitRepos:
    def test_returns_dict_when_present(self, tmp_path: Path) -> None:
        _write(tmp_path, {
            "version": 4, "name": "X",
            "git_repos": {"Duet": "https://duet.git", "Lib": "https://lib.git"},
        })
        result = read_git_repos(tmp_path)
        assert result == {"Duet": "https://duet.git", "Lib": "https://lib.git"}

    def test_returns_none_when_absent(self, tmp_path: Path) -> None:
        _write(tmp_path, {"version": 4, "name": "X"})
        assert read_git_repos(tmp_path) is None
