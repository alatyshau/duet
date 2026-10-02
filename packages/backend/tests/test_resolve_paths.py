"""Tests for alpha-path resolution behind the `resolve_paths` MCP tool.

The resolver works over a context list and a repos dir, so these tests build
a small tree in tmp_path: repos, a business with a ticket code and tickets in
every status folder, a business without a code, and a business with another
code. They pin what the agent gets: the absolute path, the ticket's kind and
state, the nearest folder for a missing file, and a reason for every failure.
"""

import asyncio
import json
import sys
import unicodedata
from pathlib import Path

import pytest
from mcp.shared.exceptions import McpError

sys.path.insert(0, str(Path(__file__).parent.parent))

from mcp_handler import mcp
from mcp_handler import resolve_paths as resolve_paths_tool
from services.resolve_paths import (
    ContextRef,
    describe_ticket,
    find_ticket_folders,
    render_markdown,
    resolve_paths,
)


def _manifest(folder: Path, name: str, **fields) -> None:
    folder.mkdir(parents=True, exist_ok=True)
    data = {"version": 4, "name": name, **fields}
    (folder / "context.json").write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")


def _dir(path: Path) -> Path:
    path.mkdir(parents=True, exist_ok=True)
    return path


@pytest.fixture
def tree(tmp_path: Path) -> dict:
    repos = _dir(tmp_path / "repos")
    _dir(repos / "Duet.git" / "spec")
    (repos / "Duet.git" / "spec" / "PRODUCT.md").write_text("x", encoding="utf-8")

    lab = tmp_path / "Drive" / "!МетаЛаб" / "DuetLab"
    _manifest(lab, "DuetLab", ticket_code="DUE")
    (lab / "README.md").write_text("x", encoding="utf-8")
    alpha = _dir(lab / "work" / "DUE009_AlphaPaths")
    (alpha / "INDEX.md").write_text("x", encoding="utf-8")
    _dir(alpha / "archive" / "DUE777_Inner")  # inside a ticket: never searched
    _dir(lab / "work" / "DUEX01_ShellPrototype")
    _dir(lab / "work" / "DUEA01_Weekly")
    _dir(lab / "archive" / "202609" / "DUE002_DuetChat")
    _dir(lab / "archive" / "202609" / "DUEX02_OldProgram")
    _dir(lab / "backlog" / "shell" / "DUE008_Blockers")

    meta = tmp_path / "Drive" / "!МетаЛаб"
    _manifest(meta, "МетаЛаб")

    game = tmp_path / "Drive" / "Stardew_Valley"
    _manifest(game, "Stardew_Valley")
    _dir(game / "archive" / "2026" / "09" / "VAL001_первые_скачивания")

    sub = tmp_path / "Drive" / "Subjectum"
    _manifest(sub, "Subjectum", ticket_code="SBT")
    _dir(sub / "work" / "QQQ001_Stray")

    family = tmp_path / "Drive" / "Семейный ЛикБез"
    _manifest(family, "Семейный ЛикБез")

    contexts = [
        ContextRef("МетаЛаб", meta),
        ContextRef("DuetLab", lab),
        ContextRef("Stardew_Valley", game),
        ContextRef("Subjectum", sub),
        ContextRef("Семейный ЛикБез", family),
    ]
    return {"repos": repos, "contexts": contexts, "lab": lab, "game": game, "sub": sub}


def _one(tree: dict, path: str):
    return resolve_paths([path], tree["repos"], tree["contexts"])[0]


class TestBusinessAndRepoPaths:
    """`@<repo>.git/...` and `@<business>/...` resolve to existing paths."""

    def test_repo_path(self, tree: dict) -> None:
        res = _one(tree, "@Duet.git/spec/PRODUCT.md")
        assert res.absolute == (tree["repos"] / "Duet.git/spec/PRODUCT.md").resolve()
        assert res.exists and res.error is None

    def test_business_path(self, tree: dict) -> None:
        res = _one(tree, "@DuetLab/README.md")
        assert res.absolute == (tree["lab"] / "README.md").resolve()
        assert res.exists

    def test_business_root_with_cyrillic_name(self, tree: dict) -> None:
        res = _one(tree, "@МетаЛаб")
        assert res.absolute == (tree["lab"].parent).resolve()

    def test_nfd_input_matches_nfc_name(self, tree: dict) -> None:
        res = _one(tree, unicodedata.normalize("NFD", "@Семейный ЛикБез"))
        assert res.error is None and res.exists

    def test_trailing_slash(self, tree: dict) -> None:
        assert _one(tree, "@DuetLab/").absolute == tree["lab"].resolve()


class TestMissingFile:
    """A missing file still gets its path, plus the nearest existing folder."""

    def test_path_given_and_nearest_named(self, tree: dict) -> None:
        res = _one(tree, "@DuetLab/нет/файл.md")
        assert res.error is None
        assert res.absolute == (tree["lab"] / "нет" / "файл.md").resolve()
        assert not res.exists
        assert res.nearest == ("@DuetLab", tree["lab"].resolve())

    def test_nearest_is_deepest_existing(self, tree: dict) -> None:
        res = _one(tree, "@DuetLab/work/новый.md")
        assert res.nearest[0] == "@DuetLab/work"

    def test_rendered_with_both_paths(self, tree: dict) -> None:
        out = render_markdown([_one(tree, "@DuetLab/нет.md")])
        assert "Файла нет. Ближайшая существующая папка — `@DuetLab`:" in out
        assert out.count("`/") == 2


class TestTickets:
    """`@<ticket>` resolves wherever the folder lies; state is the status dir."""

    def test_ticket_in_work(self, tree: dict) -> None:
        res = _one(tree, "@DUE009/INDEX.md")
        assert res.absolute == (tree["lab"] / "work/DUE009_AlphaPaths/INDEX.md").resolve()
        assert res.ticket.state == "active" and res.ticket.kind == ""
        assert describe_ticket(res.ticket) == "Проект DUE009 в работе."

    def test_ticket_in_archive_month_folder(self, tree: dict) -> None:
        res = _one(tree, "@DUE002")
        assert res.ticket.state == "closed"
        assert describe_ticket(res.ticket) == "Проект DUE002 закрыт, лежит в архиве за сентябрь 2026."

    def test_ticket_in_backlog_section(self, tree: dict) -> None:
        res = _one(tree, "@DUE008")
        assert res.absolute.name == "DUE008_Blockers"
        assert describe_ticket(res.ticket) == "Проект DUE008 ждёт."

    def test_program_and_process_kinds(self, tree: dict) -> None:
        assert describe_ticket(_one(tree, "@DUEX01").ticket) == "Программа DUEX01 в работе."
        assert describe_ticket(_one(tree, "@DUEX02").ticket).startswith("Программа DUEX02 закрыта,")
        assert describe_ticket(_one(tree, "@DUEA01").ticket) == "Процесс DUEA01 в работе."

    def test_missing_file_inside_ticket(self, tree: dict) -> None:
        res = _one(tree, "@DUE009/новое/отчёт.md")
        assert res.ticket is not None and not res.exists
        assert res.nearest[0] == "@DUE009"

    def test_year_month_archive_after_code_added(self, tree: dict) -> None:
        """Codes are read live: adding the line makes the next call resolve."""
        assert _one(tree, "@VAL001").error_code == "ticket_code_unregistered"
        _manifest(tree["game"], "Stardew_Valley", ticket_code="VAL")
        res = _one(tree, "@VAL001")
        assert res.error is None
        assert describe_ticket(res.ticket) == "Проект VAL001 закрыт, лежит в архиве за сентябрь 2026."

    def test_ticket_not_found_in_owner(self, tree: dict) -> None:
        res = _one(tree, "@DUE099")
        assert res.error_code == "ticket_not_found"
        assert "в DuetLab нет папки DUE099_*" in res.error

    def test_never_searches_inside_another_ticket(self, tree: dict) -> None:
        assert find_ticket_folders(tree["lab"], "DUE777") == []

    def test_two_folders_with_one_number_refused(self, tree: dict) -> None:
        _dir(tree["lab"] / "backlog" / "DUE009_Copy")
        res = _one(tree, "@DUE009")
        assert res.error_code == "ticket_ambiguous"
        assert "DUE009_AlphaPaths" in res.error and "DUE009_Copy" in res.error

    def test_rendered_section(self, tree: dict) -> None:
        out = render_markdown([_one(tree, "@DUE002")])
        lines = out.split("\n")
        assert lines[0] == "### @DUE002"
        assert lines[2].startswith("`/") and lines[2].endswith("DUE002_DuetChat`")
        assert lines[4] == "Проект DUE002 закрыт, лежит в архиве за сентябрь 2026."


class TestTicketCodes:
    """A ticket code resolves only through exactly one business."""

    def test_unregistered_code_points_to_manifest(self, tree: dict) -> None:
        res = _one(tree, "@VAL001")
        assert res.error_code == "ticket_code_unregistered"
        assert "код VAL не записан ни у одного бизнеса" in res.error
        assert "найдена в бизнесе Stardew_Valley" in res.error
        assert '`"ticket_code": "VAL"`' in res.error
        assert str(tree["game"] / "context.json") in res.error

    def test_unregistered_code_folder_in_business_with_other_code(self, tree: dict) -> None:
        res = _one(tree, "@QQQ001")
        assert res.error_code == "ticket_code_unregistered"
        assert "другой код, SBT" in res.error
        assert "ticket_code" not in res.error

    def test_unregistered_code_and_no_folder(self, tree: dict) -> None:
        res = _one(tree, "@ZZZ001")
        assert res.error_code == "ticket_code_unregistered"
        assert "нет ни в одном бизнесе" in res.error

    def test_code_declared_twice_is_refused(self, tree: dict) -> None:
        _manifest(tree["sub"], "Subjectum", ticket_code="DUE")
        res = _one(tree, "@DUE009")
        assert res.error_code == "ticket_code_conflict"
        assert "DuetLab" in res.error and "Subjectum" in res.error


class TestRefusals:
    """Addresses that cannot resolve say why."""

    def test_not_an_alpha_path(self, tree: dict) -> None:
        for raw in ("DuetLab/README.md", "@", "@/abs", ""):
            assert _one(tree, raw).error_code == "not_alpha_path", raw

    def test_unknown_head_suggests_exact_name(self, tree: dict) -> None:
        res = _one(tree, "@duetlab/README.md")
        assert res.error_code == "unknown_head"
        assert "`@DuetLab`" in res.error

    def test_escape_refused(self, tree: dict) -> None:
        assert _one(tree, "@DuetLab/../x").error_code == "escapes_root"
        assert _one(tree, "@DUE009/../../README.md").error_code == "escapes_root"

    def test_dot_heads_refused(self, tree: dict) -> None:
        """`@..` must not reach the parent of the repos dir (DuetData)."""
        for raw in ("@..", "@../data/entities.db", "@.", "@./Duet.git"):
            assert _one(tree, raw).error_code == "escapes_root", raw

    def test_one_failure_does_not_stop_the_rest(self, tree: dict) -> None:
        results = resolve_paths(["@nope", "@DuetLab"], tree["repos"], tree["contexts"])
        assert results[0].error and results[1].error is None
        out = render_markdown(results)
        assert out.index("### @nope") < out.index("### @DuetLab")


class TestTool:
    """The MCP tool: text output, a list of paths, empty list refused."""

    def test_empty_list_refused(self) -> None:
        with pytest.raises(McpError):
            resolve_paths_tool([])

    def test_registered_unstructured(self) -> None:
        tools = {t.name: t for t in asyncio.run(mcp.list_tools())}
        assert tools["resolve_paths"].outputSchema is None
        assert list(tools["resolve_paths"].inputSchema["properties"]) == ["paths"]


class TestThroughWorkspaceService:
    """End to end: scanned contexts in the DB feed the resolver."""

    def test_scanned_context_and_ticket(
        self, tmp_path: Path, db, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from scanner import Scanner
        from services.workspace import WorkspaceService
        from tests.fixtures import DuetDataBuilder, ManifestBuilder

        builder = DuetDataBuilder(tmp_path)
        builder.add_root_context("Root", folder_name="!Root")
        builder.add_repo("Duet")
        builder.build(monkeypatch)

        lab = builder.get_root_context_path(0) / "DuetLab"
        ManifestBuilder.context(lab, "DuetLab", ticket_code="DUE")
        _dir(lab / "archive" / "202609" / "DUE002_DuetChat")
        Scanner(db, repos_path=builder.get_repos_path()).scan()

        results = WorkspaceService(db).resolve_paths(["@Root", "@DUE002/INDEX.md", "@Duet.git"])

        assert results[0].absolute == builder.get_root_context_path(0).resolve()
        assert results[1].absolute == (lab / "archive/202609/DUE002_DuetChat/INDEX.md").resolve()
        assert results[1].ticket.state == "closed" and not results[1].exists
        assert results[2].absolute == builder.get_repo_path("Duet").resolve()
