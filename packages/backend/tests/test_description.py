"""Tests for description extraction and spec file resolution."""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

from description import extract_description, find_spec_file


class TestExtractDescription:
    """Tests for extract_description function."""

    def test_paragraph_after_h1(self, tmp_path: Path) -> None:
        """Extracts first sentence from paragraph after H1."""
        md = tmp_path / "test.md"
        md.write_text("# My Title\n\nThis is the description. More text here.")
        assert extract_description(md) == "This is the description."

    def test_structural_element_after_h1(self, tmp_path: Path) -> None:
        """Returns H1 text when next content is structural (##, table, etc.)."""
        md = tmp_path / "test.md"
        md.write_text("# My Title\n\n## Section\n\nSome text.")
        assert extract_description(md) == "My Title"

    def test_table_after_h1(self, tmp_path: Path) -> None:
        """Returns H1 text when next content is a table."""
        md = tmp_path / "test.md"
        md.write_text("# My Title\n\n| Col | Val |\n|-----|-----|\n| a | b |")
        assert extract_description(md) == "My Title"

    def test_list_after_h1(self, tmp_path: Path) -> None:
        """Returns H1 text when next content is a list."""
        md = tmp_path / "test.md"
        md.write_text("# My Title\n\n- item 1\n- item 2")
        assert extract_description(md) == "My Title"

    def test_code_block_after_h1(self, tmp_path: Path) -> None:
        """Returns H1 text when next content is a code block."""
        md = tmp_path / "test.md"
        md.write_text("# My Title\n\n```python\nprint('hi')\n```")
        assert extract_description(md) == "My Title"

    def test_blockquote_after_h1(self, tmp_path: Path) -> None:
        """Returns H1 text when next content is a blockquote."""
        md = tmp_path / "test.md"
        md.write_text("# My Title\n\n> Some quote here.")
        assert extract_description(md) == "My Title"

    def test_no_h1(self, tmp_path: Path) -> None:
        """Returns None when no H1 heading."""
        md = tmp_path / "test.md"
        md.write_text("## Not H1\n\nSome text.")
        assert extract_description(md) is None

    def test_h1_only(self, tmp_path: Path) -> None:
        """Returns H1 text when nothing follows."""
        md = tmp_path / "test.md"
        md.write_text("# Just a Title\n")
        assert extract_description(md) == "Just a Title"

    def test_empty_lines_between_h1_and_content(self, tmp_path: Path) -> None:
        """Skips empty lines between H1 and first content."""
        md = tmp_path / "test.md"
        md.write_text("# Title\n\n\n\nParagraph starts here. Then more.")
        assert extract_description(md) == "Paragraph starts here."

    def test_cyrillic_paragraph(self, tmp_path: Path) -> None:
        """Works with Cyrillic text."""
        md = tmp_path / "test.md"
        md.write_text("# Предприятие МетаЛаб\n\nОписание предприятия. Ещё текст.")
        assert extract_description(md) == "Описание предприятия."

    def test_cyrillic_h1_with_structural_content(self, tmp_path: Path) -> None:
        """Returns Cyrillic H1 text when structural content follows."""
        md = tmp_path / "test.md"
        md.write_text("# Предприятие МетаЛаб\n\n`ПРОЕКТЫ/251101`")
        assert extract_description(md) == "Предприятие МетаЛаб"

    def test_file_not_found(self, tmp_path: Path) -> None:
        """Returns None when file doesn't exist."""
        md = tmp_path / "nonexistent.md"
        assert extract_description(md) is None

    def test_sentence_without_period(self, tmp_path: Path) -> None:
        """Returns full line when no sentence-ending punctuation."""
        md = tmp_path / "test.md"
        md.write_text("# Title\n\nNo period at the end")
        assert extract_description(md) == "No period at the end"

    def test_exclamation_mark_ends_sentence(self, tmp_path: Path) -> None:
        """Exclamation mark ends sentence."""
        md = tmp_path / "test.md"
        md.write_text("# Title\n\nHello world! More text.")
        assert extract_description(md) == "Hello world!"

    def test_quoted_paragraph(self, tmp_path: Path) -> None:
        """Paragraph starting with quote is treated as paragraph."""
        md = tmp_path / "test.md"
        md.write_text('# Title\n\n"Getting Things Done" is a method.')
        assert extract_description(md) == '"Getting Things Done" is a method.'

    def test_digit_start_paragraph(self, tmp_path: Path) -> None:
        """Paragraph starting with digit is treated as paragraph."""
        md = tmp_path / "test.md"
        md.write_text("# Title\n\n42 is the answer. To everything.")
        assert extract_description(md) == "42 is the answer."

    def test_empty_file(self, tmp_path: Path) -> None:
        """Returns None for empty file."""
        md = tmp_path / "test.md"
        md.write_text("")
        assert extract_description(md) is None

    def test_question_mark_ends_sentence(self, tmp_path: Path) -> None:
        """Question mark ends sentence."""
        md = tmp_path / "test.md"
        md.write_text("# Title\n\nIs this a question? Yes it is.")
        assert extract_description(md) == "Is this a question?"

    def test_multiline_paragraph_uses_first_line(self, tmp_path: Path) -> None:
        """Only the first line of multi-line paragraph is considered."""
        md = tmp_path / "test.md"
        md.write_text("# Title\n\nFirst line. Second.\nThird line.")
        assert extract_description(md) == "First line."

    def test_link_start_is_paragraph(self, tmp_path: Path) -> None:
        """Paragraph starting with [link] is treated as paragraph."""
        md = tmp_path / "test.md"
        md.write_text("# Title\n\n[Duet](https://example.com) is a tool. More text.")
        assert extract_description(md) == "[Duet](https://example.com) is a tool."

    def test_paren_start_is_paragraph(self, tmp_path: Path) -> None:
        """Paragraph starting with (note) is treated as paragraph."""
        md = tmp_path / "test.md"
        md.write_text("# Title\n\n(Note) This is important. More text.")
        assert extract_description(md) == "(Note) This is important."

    def test_single_sentence_at_end_of_line(self, tmp_path: Path) -> None:
        """Sentence ending at end of line (no trailing space)."""
        md = tmp_path / "test.md"
        md.write_text("# Title\n\nSingle sentence.")
        assert extract_description(md) == "Single sentence."


class TestFindSpecFile:
    """Tests for find_spec_file function."""

    def test_finds_product_md(self, tmp_path: Path) -> None:
        """Finds PRODUCT.md for product entity type."""
        spec_dir = tmp_path / "spec"
        spec_dir.mkdir()
        (spec_dir / "PRODUCT.md").write_text("# Product")
        assert find_spec_file(tmp_path, "product") == spec_dir / "PRODUCT.md"

    def test_fallback_to_component_md(self, tmp_path: Path) -> None:
        """Falls back to COMPONENT.md when PRODUCT.md absent."""
        spec_dir = tmp_path / "spec"
        spec_dir.mkdir()
        (spec_dir / "COMPONENT.md").write_text("# Component")
        assert find_spec_file(tmp_path, "product") == spec_dir / "COMPONENT.md"

    def test_fallback_to_architecture_md(self, tmp_path: Path) -> None:
        """Falls back to ARCHITECTURE.md when higher-priority files absent."""
        spec_dir = tmp_path / "spec"
        spec_dir.mkdir()
        (spec_dir / "ARCHITECTURE.md").write_text("# Arch")
        assert find_spec_file(tmp_path, "component") == spec_dir / "ARCHITECTURE.md"

    def test_returns_none_when_no_spec(self, tmp_path: Path) -> None:
        """Returns None when no spec files exist."""
        assert find_spec_file(tmp_path, "product") is None

    def test_returns_none_when_no_spec_dir(self, tmp_path: Path) -> None:
        """Returns None when spec/ directory doesn't exist."""
        assert find_spec_file(tmp_path, "product") is None

    def test_component_type_starts_with_component_md(self, tmp_path: Path) -> None:
        """Component type checks COMPONENT.md first."""
        spec_dir = tmp_path / "spec"
        spec_dir.mkdir()
        (spec_dir / "COMPONENT.md").write_text("# Comp")
        (spec_dir / "ARCHITECTURE.md").write_text("# Arch")
        assert find_spec_file(tmp_path, "component") == spec_dir / "COMPONENT.md"

    def test_business_type(self, tmp_path: Path) -> None:
        """Business type checks BUSINESS.md first."""
        spec_dir = tmp_path / "spec"
        spec_dir.mkdir()
        (spec_dir / "BUSINESS.md").write_text("# Biz")
        assert find_spec_file(tmp_path, "business") == spec_dir / "BUSINESS.md"

    def test_stream_type(self, tmp_path: Path) -> None:
        """Stream type checks STREAM.md first."""
        spec_dir = tmp_path / "spec"
        spec_dir.mkdir()
        (spec_dir / "STREAM.md").write_text("# Stream")
        assert find_spec_file(tmp_path, "stream") == spec_dir / "STREAM.md"

    def test_project_type(self, tmp_path: Path) -> None:
        """Project type checks PROJECT.md first."""
        spec_dir = tmp_path / "spec"
        spec_dir.mkdir()
        (spec_dir / "PROJECT.md").write_text("# Project")
        assert find_spec_file(tmp_path, "project") == spec_dir / "PROJECT.md"

    def test_fallback_to_readme_md(self, tmp_path: Path) -> None:
        """Falls back to README.md when higher-priority files absent."""
        spec_dir = tmp_path / "spec"
        spec_dir.mkdir()
        (spec_dir / "README.md").write_text("# Readme")
        assert find_spec_file(tmp_path, "component") == spec_dir / "README.md"

    def test_fallback_to_index_md(self, tmp_path: Path) -> None:
        """Falls back to INDEX.md as last resort."""
        spec_dir = tmp_path / "spec"
        spec_dir.mkdir()
        (spec_dir / "INDEX.md").write_text("# Index")
        assert find_spec_file(tmp_path, "component") == spec_dir / "INDEX.md"

    def test_unknown_entity_type_falls_back_to_component(self, tmp_path: Path) -> None:
        """Unknown entity type uses component fallback chain."""
        spec_dir = tmp_path / "spec"
        spec_dir.mkdir()
        (spec_dir / "COMPONENT.md").write_text("# Comp")
        assert find_spec_file(tmp_path, "unknown_type") == spec_dir / "COMPONENT.md"
