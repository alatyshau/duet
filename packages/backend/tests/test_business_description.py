"""Business descriptions come only from explicit INDEX frontmatter."""

from pathlib import Path

import pytest

from description import read_business_description


@pytest.mark.parametrize("frontmatter, expected", [
    ("description: Business purpose", "Business purpose"),
    ('description: "Purpose: research #1"', "Purpose: research #1"),
    ("description: 'Owner''s research'", "Owner's research"),
    ("description: Purpose # a YAML comment", "Purpose"),
    ("description: >-\n  Product research\n  laboratory", "Product research laboratory"),
    ("description: |\n  Product research\n  laboratory", "Product research laboratory"),
    ("description: Организация работы предприятий", "Организация работы предприятий"),
    ("name: Lab", None),
    ("description:", None),
    ("description: null", None),
    ("description: 42", None),
    ("description: true", None),
    ("description: [one, two]", None),
    ("description: {nested: value}", None),
    ('description: "  "', None),
    ("description: [invalid", None),
    ("- not a mapping", None),
    ("!!python/object:os.system {}", None),
    ("", None),
])
def test_yaml_values(tmp_path, frontmatter, expected):
    (tmp_path / "INDEX.md").write_text(
        f"---\n{frontmatter}\n---\n# Body heading\n\nNot a description.\n",
        encoding="utf-8",
    )
    assert read_business_description(tmp_path) == expected


@pytest.mark.parametrize("text", [
    "# Heading\n\ndescription: Not frontmatter",
    "\n---\ndescription: Not at the start\n---\n",
    "---\ndescription: Unterminated",
    "# Heading\n\n---\ndescription: Body YAML\n---\n",
])
def test_no_body_or_unterminated_header_fallback(tmp_path, text):
    (tmp_path / "INDEX.md").write_text(text, encoding="utf-8")
    assert read_business_description(tmp_path) is None


def test_bom_crlf_and_closing_marker_at_eof(tmp_path):
    (tmp_path / "INDEX.md").write_bytes(
        "\ufeff---\r\ndescription: Explicit purpose\r\n---".encode("utf-8")
    )
    assert read_business_description(tmp_path) == "Explicit purpose"


def test_missing_invalid_encoding_and_directory(tmp_path):
    assert read_business_description(tmp_path) is None
    index = tmp_path / "INDEX.md"
    index.write_bytes(b"\xff")
    assert read_business_description(tmp_path) is None
    index.unlink()
    index.mkdir()
    assert read_business_description(tmp_path) is None


def test_unreadable_index_is_reported(tmp_path, monkeypatch, caplog):
    def denied(*args, **kwargs):
        raise PermissionError("access denied")

    monkeypatch.setattr(Path, "read_text", denied)
    assert read_business_description(tmp_path) is None
    assert "Cannot read business description" in caplog.text
