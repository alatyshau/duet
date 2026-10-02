"""Tests for the turn_report MCP tool.

The tool shows one agent report as is: it returns the Markdown it was given
and only checks that the report opens with a level-3 heading. These tests pin
the pass-through and the heading check, not the wording of the error.
"""

import sys
from pathlib import Path

import pytest
from mcp.shared.exceptions import McpError
from mcp.types import INVALID_PARAMS

sys.path.insert(0, str(Path(__file__).parent.parent))

from mcp_handler import turn_report

REPORT = (
    "### PPUAA — R18\n"
    "\n"
    "**Parse.** Вопрос: кто задаёт формат отчёта. Ответ нужен, а не действие.\n"
    "\n"
    "**Plan.** Ответить, разделив, что задаёт инструмент и что задаёт агент.\n"
)


class TestPassThrough:
    """A report with a heading comes back unchanged."""

    def test_multiline_report_unchanged(self) -> None:
        assert turn_report(REPORT) == REPORT

    def test_leading_blank_lines_kept(self) -> None:
        report = "\n  \n" + REPORT
        assert turn_report(report) == report


class TestValidation:
    """A report that does not open with a level-3 heading is refused."""

    @pytest.mark.parametrize(
        "report",
        [
            "",
            "  \n\n",
            "**Parse.** Без заголовка.",
            "## PPUAA — R18\n\nТекст.",
            "#### PPUAA — R18\n\nТекст.",
            "###\n\nТекст.",
            "###   \n\nТекст.",
            "###PPUAA — R18",
            " ### PPUAA — R18",
        ],
        ids=[
            "empty",
            "blank",
            "no-heading",
            "level-2",
            "level-4",
            "no-text",
            "only-spaces",
            "no-space",
            "indented",
        ],
    )
    def test_refused(self, report: str) -> None:
        with pytest.raises(McpError):
            turn_report(report)

    def test_error_is_invalid_params_with_example(self) -> None:
        with pytest.raises(McpError) as exc:
            turn_report("")
        assert exc.value.error.code == INVALID_PARAMS
        assert "### PPUAA — R18" in exc.value.error.message
