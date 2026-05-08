"""Unit tests for `services.manifest.read_manifest` — strict v2 reader.

Backend is the strict reader: any malformed shape (missing required `name`,
wrong scalar types, bad `reference_repos` map) must be reported as
`invalid_manifest`, never silently coerced. Folder-name fallback in the
scanner is intentionally absent — these tests are the safety net that
catches regressions to silent repair.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from services.manifest import (
    MANIFEST_FILENAME,
    TARGET_VERSION,
    Manifest,
    read_manifest,
    read_reference_repos,
)


def _write(folder: Path, payload) -> None:
    folder.mkdir(parents=True, exist_ok=True)
    (folder / MANIFEST_FILENAME).write_text(
        json.dumps(payload) if not isinstance(payload, str) else payload,
        encoding="utf-8",
    )


class TestReadManifestHappyPath:
    def test_minimal_valid_v2(self, tmp_path: Path) -> None:
        _write(tmp_path, {"version": 2, "name": "Ctx"})
        errors: list[dict] = []
        manifest = read_manifest(tmp_path, errors)
        assert manifest is not None
        assert manifest.version == 2
        assert manifest.name == "Ctx"
        assert manifest.icon is None
        assert manifest.meta is False
        assert manifest.git_url is None
        assert manifest.reference_repos is None
        assert manifest.description is None
        assert errors == []

    def test_full_valid_v2(self, tmp_path: Path) -> None:
        _write(tmp_path, {
            "version": 2,
            "name": "Duet",
            "icon": "📦",
            "meta": False,
            "git_url": "git@github.com:owner/repo.git",
            "reference_repos": {"cookbook": "https://github.com/anthropics/cookbook.git"},
            "description": "A platform.",
        })
        manifest = read_manifest(tmp_path, [])
        assert manifest == Manifest(
            version=2,
            name="Duet",
            icon="📦",
            meta=False,
            git_url="git@github.com:owner/repo.git",
            reference_repos={"cookbook": "https://github.com/anthropics/cookbook.git"},
            description="A platform.",
        )

    def test_meta_true(self, tmp_path: Path) -> None:
        _write(tmp_path, {"version": 2, "name": "Meta", "meta": True})
        manifest = read_manifest(tmp_path)
        assert manifest is not None
        assert manifest.meta is True

    def test_unknown_fields_ignored(self, tmp_path: Path) -> None:
        """Forward-compat: unknown fields don't reject the manifest."""
        _write(tmp_path, {"version": 2, "name": "Ctx", "future_field": 42})
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

    def test_version_not_two_unrecognized(self, tmp_path: Path) -> None:
        _write(tmp_path, {"version": 99, "name": "X"})
        errors: list[dict] = []
        assert read_manifest(tmp_path, errors) is None
        assert errors[0]["reason_code"] == "unrecognized_manifest_version"

    def test_version_string_unrecognized(self, tmp_path: Path) -> None:
        """`version: "2"` (string) is not v2 — must not be silently accepted."""
        _write(tmp_path, {"version": "2", "name": "X"})
        errors: list[dict] = []
        assert read_manifest(tmp_path, errors) is None
        assert errors[0]["reason_code"] == "unrecognized_manifest_version"


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
        """`{"version": 2}` without `name` must NOT silently fall back to folder name."""
        _write(tmp_path, {"version": 2})
        errors: list[dict] = []
        assert read_manifest(tmp_path, errors) is None
        assert errors[0]["reason_code"] == "invalid_manifest"
        assert "name" in errors[0]["description"]

    def test_empty_name_rejected(self, tmp_path: Path) -> None:
        _write(tmp_path, {"version": 2, "name": ""})
        errors: list[dict] = []
        assert read_manifest(tmp_path, errors) is None
        assert errors[0]["reason_code"] == "invalid_manifest"
        assert "name" in errors[0]["description"]

    def test_whitespace_name_rejected(self, tmp_path: Path) -> None:
        _write(tmp_path, {"version": 2, "name": "   "})
        errors: list[dict] = []
        assert read_manifest(tmp_path, errors) is None
        assert errors[0]["reason_code"] == "invalid_manifest"

    def test_non_string_name_rejected(self, tmp_path: Path) -> None:
        _write(tmp_path, {"version": 2, "name": 123})
        errors: list[dict] = []
        assert read_manifest(tmp_path, errors) is None
        assert errors[0]["reason_code"] == "invalid_manifest"

    def test_non_string_icon_rejected(self, tmp_path: Path) -> None:
        _write(tmp_path, {"version": 2, "name": "X", "icon": 123})
        errors: list[dict] = []
        assert read_manifest(tmp_path, errors) is None
        assert errors[0]["reason_code"] == "invalid_manifest"
        assert "icon" in errors[0]["description"]

    def test_non_bool_meta_rejected(self, tmp_path: Path) -> None:
        """`meta: "true"` (string) must NOT be silently coerced."""
        _write(tmp_path, {"version": 2, "name": "X", "meta": "true"})
        errors: list[dict] = []
        assert read_manifest(tmp_path, errors) is None
        assert errors[0]["reason_code"] == "invalid_manifest"
        assert "meta" in errors[0]["description"]

    def test_non_string_git_url_rejected(self, tmp_path: Path) -> None:
        _write(tmp_path, {"version": 2, "name": "X", "git_url": 123})
        errors: list[dict] = []
        assert read_manifest(tmp_path, errors) is None
        assert errors[0]["reason_code"] == "invalid_manifest"

    def test_empty_git_url_rejected(self, tmp_path: Path) -> None:
        _write(tmp_path, {"version": 2, "name": "X", "git_url": ""})
        errors: list[dict] = []
        assert read_manifest(tmp_path, errors) is None
        assert errors[0]["reason_code"] == "invalid_manifest"

    def test_non_string_description_rejected(self, tmp_path: Path) -> None:
        _write(tmp_path, {"version": 2, "name": "X", "description": 42})
        errors: list[dict] = []
        assert read_manifest(tmp_path, errors) is None
        assert errors[0]["reason_code"] == "invalid_manifest"

    def test_reference_repos_not_object(self, tmp_path: Path) -> None:
        _write(tmp_path, {"version": 2, "name": "X", "reference_repos": "nope"})
        errors: list[dict] = []
        assert read_manifest(tmp_path, errors) is None
        assert errors[0]["reason_code"] == "invalid_manifest"

    def test_reference_repos_value_not_string(self, tmp_path: Path) -> None:
        _write(tmp_path, {
            "version": 2, "name": "X",
            "reference_repos": {"good": "https://...", "bad": 42},
        })
        errors: list[dict] = []
        assert read_manifest(tmp_path, errors) is None
        assert errors[0]["reason_code"] == "invalid_manifest"
        assert "reference_repos" in errors[0]["description"]

    def test_reference_repos_empty_value(self, tmp_path: Path) -> None:
        _write(tmp_path, {"version": 2, "name": "X", "reference_repos": {"k": ""}})
        errors: list[dict] = []
        assert read_manifest(tmp_path, errors) is None
        assert errors[0]["reason_code"] == "invalid_manifest"

    def test_empty_reference_repos_map_ok(self, tmp_path: Path) -> None:
        _write(tmp_path, {"version": 2, "name": "X", "reference_repos": {}})
        manifest = read_manifest(tmp_path, [])
        assert manifest is not None
        assert manifest.reference_repos is None  # empty map normalised to None


class TestReadReferenceRepos:
    def test_returns_dict_when_present(self, tmp_path: Path) -> None:
        _write(tmp_path, {
            "version": 2, "name": "X",
            "reference_repos": {"a": "https://a.git", "b": "https://b.git"},
        })
        result = read_reference_repos(tmp_path)
        assert result == {"a": "https://a.git", "b": "https://b.git"}

    def test_returns_none_when_absent(self, tmp_path: Path) -> None:
        _write(tmp_path, {"version": 2, "name": "X"})
        assert read_reference_repos(tmp_path) is None

    def test_returns_none_when_manifest_invalid(self, tmp_path: Path) -> None:
        _write(tmp_path, {"version": 2})  # missing name → invalid → no Manifest
        assert read_reference_repos(tmp_path) is None
