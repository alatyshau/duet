"""The platform prompt is built without an agent registry or role cores."""

import json
from pathlib import Path

import pytest

from instructions import GENERATED_BANNER, merge_duet_instructions


def test_builds_only_session_prompt(tmp_path):
    source = tmp_path / "duet-core.md"
    source.write_text("# Duet\n\nPlatform instructions.\n\n", encoding="utf-8")
    output = tmp_path / "output"
    errors = output / "data/errors.json"

    result = merge_duet_instructions(source, output, errors)

    assert result == {
        "status": "ok",
        "output_style": str(output / "duet.md"),
        "errors": [],
    }
    assert (output / "duet.md").read_text() == (
        GENERATED_BANNER + "# Duet\n\nPlatform instructions.\n"
    )
    assert sorted(p.name for p in output.glob("*.md")) == ["duet.md"]
    assert json.loads(errors.read_text()) == []


def test_missing_source_preserves_previous_prompt_and_reports_error(tmp_path):
    prompt = tmp_path / "duet.md"
    prompt.write_text("previous prompt", encoding="utf-8")
    errors = tmp_path / "data/errors.json"

    result = merge_duet_instructions(tmp_path / "missing.md", tmp_path, errors)

    assert result["status"] == "error"
    assert result["output_style"] is None
    assert result["errors"][0]["reason_code"] == "core_prompt_read_error"
    assert json.loads(errors.read_text()) == result["errors"]
    assert prompt.read_text() == "previous prompt"


def test_write_failure_is_reported(tmp_path):
    source = tmp_path / "duet-core.md"
    source.write_text("# Duet", encoding="utf-8")
    output = tmp_path / "not-a-directory"
    output.write_text("keep me", encoding="utf-8")
    errors = tmp_path / "data/errors.json"

    result = merge_duet_instructions(source, output, errors)

    assert result["status"] == "error"
    assert result["errors"][0]["reason_code"] == "prompt_write_error"
    assert output.read_text() == "keep me"


def test_rebuild_uses_current_source_and_clears_errors(tmp_path):
    source = tmp_path / "duet-core.md"
    output = tmp_path / "output"
    errors = output / "data/errors.json"
    merge_duet_instructions(source, output, errors)
    source.write_text("# Current platform prompt", encoding="utf-8")

    result = merge_duet_instructions(source, output, errors)

    assert result["status"] == "ok"
    assert json.loads(errors.read_text()) == []
    assert (output / "duet.md").read_text().endswith("# Current platform prompt\n")


def test_real_platform_source_has_no_role_dependency(tmp_path):
    source = Path(__file__).resolve().parents[2] / "instructions/duet-core.md"
    result = merge_duet_instructions(source, tmp_path, tmp_path / "errors.json")
    assert result["status"] == "ok"
    assert "INSERT USER CORE" not in (tmp_path / "duet.md").read_text()
    assert not (source.parent / "index.json").exists()
    assert not (source.parent / "bootstrapper.md").exists()
    assert "## Scripts in Business Folders" in source.read_text()
    assert "@Duet.git/packages/instructions/duet-core.md" in GENERATED_BANNER


def test_core_uses_business_vocabulary_and_current_discovery_tool():
    source = Path(__file__).resolve().parents[2] / "instructions/duet-core.md"
    text = source.read_text()
    assert "`business_tree()`" in text
    assert "## Businesses and work" in text
    assert "`INDEX.md`" in text
    assert "`context.json`" in text  # The actual manifest name is not renamed.
    for obsolete in (
        "contexts()", "Context — the unit of productive life", "Platform context",
        "Work context", "work/WIP_", "one operating ritual (next section)",
    ):
        assert obsolete not in text


@pytest.mark.asyncio
async def test_http_build_contract(client, duet_data):
    response = await client.post("/merge-duet-instructions")
    assert response.status_code == 200
    result = response.json()
    assert result == {
        "status": "ok",
        "output_style": str(duet_data / "duet.md"),
        "errors": [],
    }
    assert (duet_data / "duet.md").read_text().startswith(GENERATED_BANNER)
    assert sorted(path.name for path in duet_data.glob("duet*.md")) == ["duet.md"]


def test_source_naming_warnings_do_not_block_the_build(tmp_path):
    sources = tmp_path / "sources"
    sources.mkdir()
    source = sources / "duet-core.md"
    source.write_text("# Duet", encoding="utf-8")
    (sources / "rules_v2.md").write_text("# Draft", encoding="utf-8")
    (sources / "old").mkdir()
    (sources / "old/rules_v3.md").write_text("# Archived", encoding="utf-8")
    result = merge_duet_instructions(source, tmp_path / "output", tmp_path / "errors.json")
    assert result["status"] == "ok"
    assert result["output_style"] is not None
    assert [error["path"] for error in result["errors"]] == ["rules_v2.md"]
    assert result["errors"][0]["reason_code"] == "version_suffix"
