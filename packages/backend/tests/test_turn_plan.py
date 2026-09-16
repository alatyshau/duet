"""Tests for the turn_plan MCP tool.

The tool is stateless: it renders one turn's checklist from a list of steps
and the index of the step in progress. These tests pin the rendering of each
output format and the argument validation, not the wording of the heading.
"""

import sys
from pathlib import Path

import pytest
from mcp.shared.exceptions import McpError

sys.path.insert(0, str(Path(__file__).parent.parent))

from mcp_handler import turn_plan


class TestRendering:
    """Markdown shape of the rendered checklist."""

    def test_first_step_in_progress(self) -> None:
        out = turn_plan(["Разобрать промпт", "Выполнить работу", "Написать респонз"])
        assert "- [ ] **Разобрать промпт** ← сейчас" in out
        assert "- [ ] Выполнить работу" in out
        assert "- [x]" not in out

    def test_earlier_steps_are_closed(self) -> None:
        out = turn_plan(["Разобрать промпт", "Выполнить работу"], current=1)
        assert "- [x] ~~Разобрать промпт~~" in out
        assert "- [ ] **Выполнить работу** ← сейчас" in out

    def test_all_steps_closed(self) -> None:
        out = turn_plan(["Разобрать промпт", "Написать респонз"], current=2)
        assert out.count("- [x]") == 2
        assert "← сейчас" not in out

    def test_starts_with_heading(self) -> None:
        out = turn_plan(["Один шаг"])
        assert out.split("\n")[0].startswith("### ")
        assert out.split("\n")[1] == ""


class TestValidation:
    """Arguments that cannot be rendered are refused."""

    def test_empty_items(self) -> None:
        with pytest.raises(McpError):
            turn_plan([])

    def test_current_negative(self) -> None:
        with pytest.raises(McpError):
            turn_plan(["Один шаг"], current=-1)

    def test_current_past_the_end(self) -> None:
        with pytest.raises(McpError):
            turn_plan(["Один шаг"], current=2)


class TestHtmlFormat:
    """fmt="html" renders the same plan as an HTML fragment."""

    def test_states_use_tags(self) -> None:
        out = turn_plan(["Раз", "Два", "Три"], current=1, fmt="html")
        assert "<s>Раз</s>" in out
        assert "<b>Два</b>" in out
        assert "<li>\u2b1c Три</li>" in out

    def test_wrapped_in_list(self) -> None:
        out = turn_plan(["Раз"], fmt="html")
        assert out.startswith("<h3>")
        assert "<ul>" in out and out.endswith("</ul>")

    def test_item_text_is_escaped(self) -> None:
        out = turn_plan(["<b>не тег</b>"], fmt="html")
        assert "&lt;b&gt;не тег&lt;/b&gt;" in out


class TestLineFormat:
    """fmt="line" puts the whole plan on one line."""

    def test_single_line(self) -> None:
        out = turn_plan(["Раз", "Два", "Три"], current=1, fmt="line")
        assert "\n" not in out

    def test_keeps_all_steps(self) -> None:
        out = turn_plan(["Раз", "Два", "Три"], current=1, fmt="line")
        assert "~~Раз~~" in out
        assert "**Два**" in out
        assert "Три" in out


class TestFormatValidation:
    """An unknown format is refused."""

    def test_unknown_format(self) -> None:
        with pytest.raises(McpError):
            turn_plan(["Раз"], fmt="xml")


class TestPlainFormat:
    """fmt="plain" is one unadorned line per step, no heading."""

    def test_one_line_per_step(self) -> None:
        out = turn_plan(["Раз", "Два", "Три"], current=1, fmt="plain")
        assert len(out.split("\n")) == 3

    def test_no_heading_and_no_markup(self) -> None:
        out = turn_plan(["Раз", "Два"], current=1, fmt="plain")
        assert "#" not in out
        assert "**" not in out
        assert "~~" not in out

    def test_marks_show_state(self) -> None:
        out = turn_plan(["Раз", "Два", "Три"], current=1, fmt="plain").split("\n")
        assert out[0].startswith("\u2705")
        assert out[1].startswith("\u23f3")
        assert out[2].startswith("\u2b1c")
