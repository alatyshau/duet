"""Unit tests for `services.manifest.read_manifest` — strict v3 reader.

Backend is the strict reader: any malformed shape (missing required `name`,
wrong scalar types, bad `git_repos` / `reference_repos` map) must be
reported as `invalid_manifest`, never silently coerced. Folder-name
fallback in the scanner is intentionally absent — these tests are the
safety net that catches regressions to silent repair.
"""

from __future__ import annotations

import json
from pathlib import Path

from services.manifest import (
    MANIFEST_FILENAME,
    TARGET_VERSION,
    Manifest,
    WorkspaceConfig,
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
    def test_v3_manifest_basic(self, tmp_path: Path) -> None:
        _write(tmp_path, {"version": 3, "name": "Ctx"})
        errors: list[dict] = []
        manifest = read_manifest(tmp_path, errors)
        assert manifest is not None
        assert manifest.version == 3
        assert manifest.name == "Ctx"
        assert manifest.icon is None
        assert manifest.meta is False
        assert manifest.git_repos is None
        assert manifest.reference_repos is None
        assert manifest.description is None
        assert errors == []

    def test_full_valid_v3(self, tmp_path: Path) -> None:
        _write(tmp_path, {
            "version": 3,
            "name": "DuetLab",
            "icon": "🎭",
            "meta": False,
            "git_repos": {
                "Duet": "git@github.com:owner/duet.git",
                "Duet-Instructions": "git@github.com:owner/duet-instructions.git",
            },
            "reference_repos": {"cookbook": "https://github.com/anthropics/cookbook.git"},
            "description": "A platform.",
        })
        manifest = read_manifest(tmp_path, [])
        assert manifest == Manifest(
            version=3,
            name="DuetLab",
            icon="🎭",
            meta=False,
            git_repos={
                "Duet": "git@github.com:owner/duet.git",
                "Duet-Instructions": "git@github.com:owner/duet-instructions.git",
            },
            reference_repos={"cookbook": "https://github.com/anthropics/cookbook.git"},
            description="A platform.",
        )

    def test_git_repos_preserves_insertion_order(self, tmp_path: Path) -> None:
        """Manifest map keys are read in source order — `products[]` mirrors it."""
        _write(tmp_path, {
            "version": 3,
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
        _write(tmp_path, {"version": 3, "name": "Meta", "meta": True})
        manifest = read_manifest(tmp_path)
        assert manifest is not None
        assert manifest.meta is True

    def test_unknown_fields_ignored(self, tmp_path: Path) -> None:
        """Forward-compat: unknown fields don't reject the manifest."""
        _write(tmp_path, {"version": 3, "name": "Ctx", "future_field": 42})
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

    def test_v2_manifest_unrecognized_version(self, tmp_path: Path) -> None:
        """v2 manifest is not read by Backend — Host owns the v2→v3 migration."""
        _write(tmp_path, {"version": 2, "name": "X", "git_url": "https://..."})
        errors: list[dict] = []
        assert read_manifest(tmp_path, errors) is None
        assert errors[0]["reason_code"] == "unrecognized_manifest_version"

    def test_version_not_three_unrecognized(self, tmp_path: Path) -> None:
        _write(tmp_path, {"version": 99, "name": "X"})
        errors: list[dict] = []
        assert read_manifest(tmp_path, errors) is None
        assert errors[0]["reason_code"] == "unrecognized_manifest_version"

    def test_version_string_unrecognized(self, tmp_path: Path) -> None:
        """`version: "3"` (string) is not v3 — must not be silently accepted."""
        _write(tmp_path, {"version": "3", "name": "X"})
        errors: list[dict] = []
        assert read_manifest(tmp_path, errors) is None
        assert errors[0]["reason_code"] == "unrecognized_manifest_version"

    def test_target_version_constant(self) -> None:
        assert TARGET_VERSION == 3


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
        _write(tmp_path, {"version": 3})
        errors: list[dict] = []
        assert read_manifest(tmp_path, errors) is None
        assert errors[0]["reason_code"] == "invalid_manifest"
        assert "name" in errors[0]["description"]

    def test_empty_name_rejected(self, tmp_path: Path) -> None:
        _write(tmp_path, {"version": 3, "name": ""})
        errors: list[dict] = []
        assert read_manifest(tmp_path, errors) is None
        assert errors[0]["reason_code"] == "invalid_manifest"
        assert "name" in errors[0]["description"]

    def test_non_string_name_rejected(self, tmp_path: Path) -> None:
        _write(tmp_path, {"version": 3, "name": 123})
        errors: list[dict] = []
        assert read_manifest(tmp_path, errors) is None
        assert errors[0]["reason_code"] == "invalid_manifest"

    def test_non_string_icon_rejected(self, tmp_path: Path) -> None:
        _write(tmp_path, {"version": 3, "name": "X", "icon": 123})
        errors: list[dict] = []
        assert read_manifest(tmp_path, errors) is None
        assert errors[0]["reason_code"] == "invalid_manifest"
        assert "icon" in errors[0]["description"]

    def test_non_bool_meta_rejected(self, tmp_path: Path) -> None:
        _write(tmp_path, {"version": 3, "name": "X", "meta": "true"})
        errors: list[dict] = []
        assert read_manifest(tmp_path, errors) is None
        assert errors[0]["reason_code"] == "invalid_manifest"
        assert "meta" in errors[0]["description"]

    def test_non_string_description_rejected(self, tmp_path: Path) -> None:
        _write(tmp_path, {"version": 3, "name": "X", "description": 42})
        errors: list[dict] = []
        assert read_manifest(tmp_path, errors) is None
        assert errors[0]["reason_code"] == "invalid_manifest"

    def test_reference_repos_not_object(self, tmp_path: Path) -> None:
        _write(tmp_path, {"version": 3, "name": "X", "reference_repos": "nope"})
        errors: list[dict] = []
        assert read_manifest(tmp_path, errors) is None
        assert errors[0]["reason_code"] == "invalid_manifest"

    def test_reference_repos_value_not_string(self, tmp_path: Path) -> None:
        _write(tmp_path, {
            "version": 3, "name": "X",
            "reference_repos": {"good": "https://...", "bad": 42},
        })
        errors: list[dict] = []
        assert read_manifest(tmp_path, errors) is None
        assert errors[0]["reason_code"] == "invalid_manifest"
        assert "reference_repos" in errors[0]["description"]

    def test_empty_reference_repos_map_ok(self, tmp_path: Path) -> None:
        _write(tmp_path, {"version": 3, "name": "X", "reference_repos": {}})
        manifest = read_manifest(tmp_path, [])
        assert manifest is not None
        assert manifest.reference_repos is None


class TestGitReposValidation:
    """Validation rules §1.2 for the new `git_repos` field."""

    def test_git_repos_not_object(self, tmp_path: Path) -> None:
        _write(tmp_path, {"version": 3, "name": "X", "git_repos": "https://..."})
        errors: list[dict] = []
        assert read_manifest(tmp_path, errors) is None
        assert errors[0]["reason_code"] == "invalid_manifest"
        assert "git_repos must be an object" in errors[0]["description"]

    def test_git_repos_empty(self, tmp_path: Path) -> None:
        _write(tmp_path, {"version": 3, "name": "X", "git_repos": {}})
        errors: list[dict] = []
        assert read_manifest(tmp_path, errors) is None
        assert errors[0]["reason_code"] == "invalid_manifest"
        assert "non-empty" in errors[0]["description"]

    def test_git_repos_alias_empty(self, tmp_path: Path) -> None:
        _write(tmp_path, {"version": 3, "name": "X", "git_repos": {"": "https://..."}})
        errors: list[dict] = []
        assert read_manifest(tmp_path, errors) is None
        assert errors[0]["reason_code"] == "invalid_manifest"

    def test_git_repos_url_not_string(self, tmp_path: Path) -> None:
        _write(tmp_path, {"version": 3, "name": "X", "git_repos": {"k": 42}})
        errors: list[dict] = []
        assert read_manifest(tmp_path, errors) is None
        assert errors[0]["reason_code"] == "invalid_manifest"
        assert "non-empty string" in errors[0]["description"]

    def test_git_repos_url_empty(self, tmp_path: Path) -> None:
        _write(tmp_path, {"version": 3, "name": "X", "git_repos": {"k": ""}})
        errors: list[dict] = []
        assert read_manifest(tmp_path, errors) is None
        assert errors[0]["reason_code"] == "invalid_manifest"

    def test_alias_overlap_with_reference_repos(self, tmp_path: Path) -> None:
        _write(tmp_path, {
            "version": 3,
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
        _write(tmp_path, {"version": 3, "name": "Plain"})
        manifest = read_manifest(tmp_path)
        assert manifest is not None
        assert manifest.git_repos is None


class TestWorkspaceConfigValidation:
    """`workspace_config` is optional; when present must be an object whose
    known sub-keys are validated strictly. Unknown sub-keys are ignored
    (forward-compat). Absent field means `primary_folder` defaults to `git`."""

    def test_absent_workspace_config(self, tmp_path: Path) -> None:
        _write(tmp_path, {"version": 3, "name": "X"})
        manifest = read_manifest(tmp_path, [])
        assert manifest is not None
        assert manifest.workspace_config is None

    def test_primary_folder_context(self, tmp_path: Path) -> None:
        _write(tmp_path, {
            "version": 3, "name": "X",
            "workspace_config": {"primary_folder": "context"},
        })
        manifest = read_manifest(tmp_path, [])
        assert manifest is not None
        assert manifest.workspace_config == WorkspaceConfig(primary_folder="context")

    def test_primary_folder_git_explicit(self, tmp_path: Path) -> None:
        _write(tmp_path, {
            "version": 3, "name": "X",
            "workspace_config": {"primary_folder": "git"},
        })
        manifest = read_manifest(tmp_path, [])
        assert manifest is not None
        assert manifest.workspace_config == WorkspaceConfig(primary_folder="git")

    def test_empty_object_defaults_to_git(self, tmp_path: Path) -> None:
        """`workspace_config: {}` is equivalent to absent for every known
        sub-key — `primary_folder` defaults to `git`."""
        _write(tmp_path, {"version": 3, "name": "X", "workspace_config": {}})
        manifest = read_manifest(tmp_path, [])
        assert manifest is not None
        assert manifest.workspace_config == WorkspaceConfig(primary_folder="git")

    def test_workspace_config_not_object(self, tmp_path: Path) -> None:
        _write(tmp_path, {"version": 3, "name": "X", "workspace_config": "context"})
        errors: list[dict] = []
        assert read_manifest(tmp_path, errors) is None
        assert errors[0]["reason_code"] == "invalid_manifest"
        assert "workspace_config" in errors[0]["description"]

    def test_primary_folder_invalid_value(self, tmp_path: Path) -> None:
        _write(tmp_path, {
            "version": 3, "name": "X",
            "workspace_config": {"primary_folder": "drive"},
        })
        errors: list[dict] = []
        assert read_manifest(tmp_path, errors) is None
        assert errors[0]["reason_code"] == "invalid_manifest"
        assert "primary_folder" in errors[0]["description"]

    def test_primary_folder_non_string(self, tmp_path: Path) -> None:
        _write(tmp_path, {
            "version": 3, "name": "X",
            "workspace_config": {"primary_folder": 42},
        })
        errors: list[dict] = []
        assert read_manifest(tmp_path, errors) is None
        assert errors[0]["reason_code"] == "invalid_manifest"

    def test_unknown_sub_keys_ignored(self, tmp_path: Path) -> None:
        """Lenient on unknown sub-keys for forward-compat: a future Host may
        add `workspace_config.<new_field>` that older backend should not reject."""
        _write(tmp_path, {
            "version": 3, "name": "X",
            "workspace_config": {"primary_folder": "context", "future_hint": True},
        })
        manifest = read_manifest(tmp_path, [])
        assert manifest is not None
        assert manifest.workspace_config == WorkspaceConfig(primary_folder="context")


class TestReadReferenceRepos:
    def test_returns_dict_when_present(self, tmp_path: Path) -> None:
        _write(tmp_path, {
            "version": 3, "name": "X",
            "reference_repos": {"a": "https://a.git", "b": "https://b.git"},
        })
        result = read_reference_repos(tmp_path)
        assert result == {"a": "https://a.git", "b": "https://b.git"}

    def test_returns_none_when_absent(self, tmp_path: Path) -> None:
        _write(tmp_path, {"version": 3, "name": "X"})
        assert read_reference_repos(tmp_path) is None


class TestReadGitRepos:
    def test_returns_dict_when_present(self, tmp_path: Path) -> None:
        _write(tmp_path, {
            "version": 3, "name": "X",
            "git_repos": {"Duet": "https://duet.git", "Lib": "https://lib.git"},
        })
        result = read_git_repos(tmp_path)
        assert result == {"Duet": "https://duet.git", "Lib": "https://lib.git"}

    def test_returns_none_when_absent(self, tmp_path: Path) -> None:
        _write(tmp_path, {"version": 3, "name": "X"})
        assert read_git_repos(tmp_path) is None
