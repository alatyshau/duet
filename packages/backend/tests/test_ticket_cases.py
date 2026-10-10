"""Data-driven tests for the ticket tools. The cases live in `tests/ticket_cases/`.

Each behavior of `tickets`, `new_ticket`, `move_ticket`, and `edit_ticket` is
a folder you can review without reading any code:

    ticket_cases/trees/<tree>/     a business folder that cases start from
    ticket_cases/<tool>/<case>/
        tree.txt      name of the shared tree to start from
        before/       a case-specific starting folder, used instead of
                      tree.txt when no shared tree has the layout needed
        call.txt      the call, on one line:
                      new_ticket(name="Thesaurus", parent="DUEX02")
        expected.md   the exact response the tool must return
        after/        files the call creates or modifies (and nothing else)
        removed.txt   folders the call removes, one path per line
        today.txt     the date of the call, if not 2026-10-08

A case whose name contains `_error_` must fail: the result is flagged as an
error and the disk is untouched. Every other case must succeed.

A case with neither `after/` nor `removed.txt` must leave the disk untouched.
`ticket_cases/CASES.md` has a one-line summary of every case and describes
the shared trees. To change behavior, update the case first, then the code.
Nothing here writes to `ticket_cases/`.

In `expected.md`, `{root}` stands for the directory containing the business.
"""

import ast
import asyncio
import json
import os
import shutil
import sys
import threading
import time
import unicodedata
from datetime import date
from pathlib import Path

import pytest
import yaml

sys.path.insert(0, str(Path(__file__).parent.parent))

import mcp_handler
import services.tickets.model as tickets_model
import services.tickets.writes as tickets_writes
from mcp.types import CallToolResult
from mcp_handler import mcp
from services.resolve_paths import ContextRef
from services.tickets import ACTIONS, Result, run
from services.tickets.frontmatter import Frontmatter
from services.tickets.naming import humanize_name, next_number, to_pascal_case


CASES_DIR = Path(__file__).parent / "ticket_cases"
DEFAULT_TODAY = date(2026, 10, 8)
TREES_DIR = CASES_DIR / "trees"
CASE_DIRS = sorted(p for p in CASES_DIR.glob("*/*") if p.is_dir() and p.parent != TREES_DIR)


def start_of(case: Path) -> Path:
    """Return the folder a case starts from: its own `before/` or a shared tree."""
    if (case / "before").is_dir():
        assert not (case / "tree.txt").exists(), "a case uses either tree.txt or before/, not both"
        return case / "before"
    return TREES_DIR / (case / "tree.txt").read_text(encoding="utf-8").strip()


def expected_tree(case: Path, start: dict[str, bytes]) -> dict[str, bytes]:
    """Build the expected tree: start, minus `removed.txt`, plus the files in `after/`."""
    tree = dict(start)
    removed = case / "removed.txt"
    if removed.exists():
        for line in removed.read_text(encoding="utf-8").split("\n"):
            folder = unicodedata.normalize("NFC", line.strip().rstrip("/"))
            if not folder:
                continue
            gone = [path for path in tree if path.startswith(folder + "/")]
            assert gone, f"removed.txt lists {folder}, which is not in the starting tree"
            for path in gone:
                del tree[path]
    if (case / "after").is_dir():
        tree.update(tree_of(case / "after"))
    return tree


def parse_call(text: str) -> tuple[str, dict]:
    """Parse `tool(key="value", ...)` into the tool name and its keyword arguments."""
    node = ast.parse(text.strip(), mode="eval").body
    assert isinstance(node, ast.Call) and isinstance(node.func, ast.Name), text
    assert node.func.id in ACTIONS and not node.args, text
    return node.func.id, {kw.arg: ast.literal_eval(kw.value) for kw in node.keywords}


def tree_of(folder: Path) -> dict[str, bytes]:
    """Map each file under `folder` to its contents. Empty folders are ignored."""
    return {
        # Normalize to NFC: macOS and git can disagree on how non-ASCII names are encoded.
        unicodedata.normalize("NFC", path.relative_to(folder).as_posix()):
            path.read_bytes()
        for path in sorted(folder.rglob("*"))
        if path.is_file() and path.name != ".DS_Store"
    }


@pytest.mark.parametrize("case", CASE_DIRS, ids=lambda p: f"{p.parent.name}/{p.name}")
def test_case(case: Path, tmp_path: Path) -> None:
    root = tmp_path.resolve()
    start = start_of(case)
    name = json.loads((start / "context.json").read_text(encoding="utf-8"))["name"]
    business = root / name
    shutil.copytree(start, business)

    action, arguments = parse_call((case / "call.txt").read_text(encoding="utf-8"))
    assert action == case.parent.name, "a case must live in the folder named after its tool"
    today_file = case / "today.txt"
    today = (date.fromisoformat(today_file.read_text(encoding="utf-8").strip())
             if today_file.exists() else DEFAULT_TODAY)

    result = run(action, [ContextRef(name, business)], today, **arguments)

    expected = (case / "expected.md").read_text(encoding="utf-8").rstrip("\n")
    assert result.text.replace(str(root), "{root}") == expected
    assert result.is_error == ("_error_" in case.name)
    assert tree_of(business) == expected_tree(case, tree_of(start))
    if result.is_error:
        assert tree_of(business) == tree_of(start), "a failed call must not change the disk"


def test_cases_md_lists_every_case() -> None:
    """Every case must be listed in `CASES.md`, and every listed case must exist."""
    listed = set()
    for line in (CASES_DIR / "CASES.md").read_text(encoding="utf-8").splitlines():
        name = line.split("`")[1] if line.startswith("- `") else ""
        if name.partition("/")[0] in ACTIONS:
            listed.add(name)
    on_disk = {f"{p.parent.name}/{p.name}" for p in CASE_DIRS}
    assert listed == on_disk


class TestNames:
    """Naming rules, with the samples the extension's button was accepted on."""

    @pytest.mark.parametrize("typed, slug", [
        ("ui research", "UiResearch"),
        ("UI research", "UiResearch"),
        ("new ticket button", "NewTicketButton"),
        ("синхронизация корзины", "СинхронизацияКорзины"),
        ("duet work 2", "DuetWork2"),
        ("  bin   sync  ", "BinSync"),
        ("bin-sync_now.please", "BinSyncNowPlease"),
        ("iPhone app", "IPhoneApp"),
        ("uI research", "UIResearch"),
        ("don't panic", "DontPanic"),
        ("it’s done", "ItsDone"),
        ("IntentSwitcher", "IntentSwitcher"),
        ("UIResearch", "UiResearch"),
        ("Duet2Work", "Duet2Work"),
        ("a/b", "AB"),
        ("../up", "Up"),
        ("йод", "Йод"),
        ("", ""),
        ("  — … ", ""),
        ("́", ""),
    ])
    def test_to_pascal_case(self, typed: str, slug: str) -> None:
        assert to_pascal_case(typed) == slug

    @pytest.mark.parametrize("raw, spaced", [
        ("IntentSwitcher", "Intent Switcher"),
        ("UIResearch", "UI Research"),
        ("DuetWork2", "Duet Work2"),
        ("DuetWork_Full", "Duet Work Full"),
        ("DuetLabCuration", "Duet Lab Curation"),
        ("Modes", "Modes"),
        ("", ""),
        ("ПланРабот", "План Работ"),
        ("ЗОЖ_План", "ЗОЖ План"),
        ("UIИсследование", "UI Исследование"),
    ])
    def test_humanize_name(self, raw: str, spaced: str) -> None:
        assert humanize_name(raw) == spaced


class TestFrontmatter:
    """Edits touch only the fields they set; everything else stays byte for byte."""

    SOURCE = (
        "---\n"
        "folder-type: work\n"
        "opened: 2026-10-01   # set by hand\n"
        "custom-field: [a, b]\n"
        "parent: DUEX02\n"
        "---\n"
        "\n# Title\n\n---\n\nBody with a rule above.\n"
    )

    def test_round_trip_is_identical(self) -> None:
        assert Frontmatter.parse(self.SOURCE).render() == self.SOURCE

    def test_setting_a_field_keeps_other_lines_and_the_body(self) -> None:
        fm = Frontmatter.parse(self.SOURCE)
        fm.set("parent", "DUEX01")
        assert fm.render() == self.SOURCE.replace("parent: DUEX02", "parent: DUEX01")

    def test_new_field_goes_in_canonical_position(self) -> None:
        fm = Frontmatter.parse(self.SOURCE)
        fm.set("closed", "2026-10-08")
        assert fm.keys() == ["folder-type", "opened", "closed", "custom-field", "parent"]

    def test_second_value_turns_a_field_into_a_list_and_back(self) -> None:
        fm = Frontmatter.parse(self.SOURCE)
        fm.set("closed", ["2026-10-03", "2026-10-08"])
        assert "closed:\n  - 2026-10-03\n  - 2026-10-08\n" in fm.render()
        assert fm.get_list("closed") == ["2026-10-03", "2026-10-08"]
        fm.set("closed", ["2026-10-03"])
        assert "closed: 2026-10-03\n" in fm.render()

    def test_reads_comments_inline_lists_and_null(self) -> None:
        fm = Frontmatter.parse(self.SOURCE.replace("parent: DUEX02", "parent: null"))
        assert fm.get("opened") == "2026-10-01"
        assert fm.get_list("custom-field") == ["a", "b"]
        assert fm.get("parent") is None

    @pytest.mark.parametrize("value", [
        "CI pipeline: what runs on every commit",
        'say "hi"',
        "#hashtag first",
        "trailing colon:",
        "null",
        " padded ",
    ])
    def test_values_yaml_would_misread_are_quoted_and_read_back(self, value: str) -> None:
        fm = Frontmatter.parse(self.SOURCE)
        fm.set("description", value)
        assert Frontmatter.parse(fm.render()).get("description") == value
        assert yaml.safe_load(fm.text().strip("-\n"))["description"] == value

    def test_crlf_files_keep_their_line_endings(self) -> None:
        source = self.SOURCE.replace("\n", "\r\n")
        fm = Frontmatter.parse(source)
        fm.set("parent", "DUEX01")
        assert fm.render() == source.replace("parent: DUEX02", "parent: DUEX01")

    def test_bom_is_preserved(self) -> None:
        source = "\ufeff" + self.SOURCE
        assert Frontmatter.parse(source).render() == source

    def test_text_without_frontmatter_is_all_body(self) -> None:
        fm = Frontmatter.parse("# Just a title\n")
        assert not fm.present and fm.body == "# Just a title\n"


class TestNumbers:
    def test_one_past_the_highest(self) -> None:
        assert next_number("DUE", "project", ["DUE004", "DUE022", "DUE017"]) == "DUE023"

    def test_first(self) -> None:
        assert next_number("DUE", "project", []) == "DUE001"

    def test_each_kind_has_its_own_sequence(self) -> None:
        taken = ["DUE007", "DUEX03", "DUEA01", "MET512"]
        assert next_number("DUE", "project", taken) == "DUE008"
        assert next_number("DUE", "program", taken) == "DUEX04"
        assert next_number("DUE", "process", taken) == "DUEA02"

    def test_returns_none_when_exhausted(self) -> None:
        assert next_number("DUE", "project", ["DUE999"]) is None
        assert next_number("DUE", "program", ["DUEX99"]) is None


@pytest.fixture
def lab(tmp_path: Path) -> Path:
    """A scratch copy of the shared `lab` tree."""
    business = tmp_path.resolve() / "DuetLab"
    shutil.copytree(TREES_DIR / "lab", business)
    return business


def call(lab: Path, action: str, **arguments):
    return run(action, [ContextRef("DuetLab", lab)], DEFAULT_TODAY, **arguments)


def fail_writes(monkeypatch: pytest.MonkeyPatch) -> None:
    def refuse(path: Path, text: str) -> None:
        raise OSError("disk unavailable")

    monkeypatch.setattr(tickets_writes, "_write_index", refuse)


class TestRollback:
    """A write that fails halfway must leave the disk as it was, so a retry just works."""

    def test_close_is_rolled_back_and_retry_succeeds(self, lab: Path, monkeypatch) -> None:
        before = tree_of(lab)
        with monkeypatch.context() as patch:
            fail_writes(patch)
            failed = call(lab, "move_ticket", ticket="DUE008", to="archive")
        assert failed.is_error and "nothing was changed" in failed.text
        assert tree_of(lab) == before

        retried = call(lab, "move_ticket", ticket="DUE008", to="archive")
        assert not retried.is_error
        index = lab / "archive" / "202610" / "DUE008_CoreProtocols" / "INDEX.md"
        assert index.read_text(encoding="utf-8").count("closed: 2026-10-08") == 1

    def test_rename_is_rolled_back_and_retry_succeeds(self, lab: Path, monkeypatch) -> None:
        before = tree_of(lab)
        with monkeypatch.context() as patch:
            fail_writes(patch)
            failed = call(lab, "edit_ticket", ticket="DUE008", name="Base Protocols")
        assert failed.is_error and "nothing was changed" in failed.text
        assert tree_of(lab) == before

        retried = call(lab, "edit_ticket", ticket="DUE008", name="Base Protocols")
        assert not retried.is_error
        index = lab / "work" / "DUE008_BaseProtocols" / "INDEX.md"
        assert "renamed-from: DUE008_CoreProtocols" in index.read_text(encoding="utf-8")

    def test_failed_create_leaves_no_folder_and_keeps_the_number(
        self, lab: Path, monkeypatch
    ) -> None:
        before = tree_of(lab)
        with monkeypatch.context() as patch:
            fail_writes(patch)
            failed = call(lab, "new_ticket", name="Probe", code="DUE")
        assert failed.is_error and "DUE037 is still free" in failed.text
        assert tree_of(lab) == before
        assert not (lab / "work" / "DUE037_Probe").exists()

        retried = call(lab, "new_ticket", name="Probe", code="DUE")
        assert retried.text.startswith("### Created DUE037 Probe")

    def test_failed_edit_in_place_changes_nothing(self, lab: Path, monkeypatch) -> None:
        before = tree_of(lab)
        fail_writes(monkeypatch)
        failed = call(lab, "edit_ticket", ticket="DUE008", icon="🔎")
        assert failed.is_error and "Nothing was changed" in failed.text
        assert tree_of(lab) == before

    def test_failed_rollback_reports_the_exact_state(self, lab: Path, monkeypatch) -> None:
        fail_writes(monkeypatch)
        real_rename = Path.rename
        renames = []

        def rename_once(self: Path, target: Path) -> Path:
            renames.append(target)
            if len(renames) > 1:
                raise OSError("folder is locked")
            return real_rename(self, target)

        monkeypatch.setattr(Path, "rename", rename_once)
        failed = call(lab, "move_ticket", ticket="DUE008", to="archive")
        moved = lab / "archive" / "202610" / "DUE008_CoreProtocols"
        assert failed.is_error
        assert "left half-updated" in failed.text and str(moved) in failed.text
        assert "Retrying won't fix this" in failed.text

    def test_write_is_atomic(self, lab: Path, monkeypatch) -> None:
        index = lab / "work" / "DUE008_CoreProtocols" / "INDEX.md"
        original = index.read_bytes()

        def refuse(source, target) -> None:
            raise OSError("disk unavailable")

        monkeypatch.setattr(tickets_writes.os, "replace", refuse)
        with pytest.raises(OSError):
            tickets_writes._write_index(index, "truncated")
        assert index.read_bytes() == original
        assert [p.name for p in index.parent.iterdir()] == ["INDEX.md"]

    @pytest.mark.skipif(os.geteuid() == 0, reason="root can read any file")
    def test_permission_denied_is_not_an_empty_file(self, lab: Path) -> None:
        index = lab / "work" / "DUE008_CoreProtocols" / "INDEX.md"
        original = index.read_bytes()
        index.chmod(0o000)
        try:
            failed = call(lab, "edit_ticket", ticket="DUE008", icon="🔎")
        finally:
            index.chmod(0o644)
        assert failed.is_error and "can't be changed safely" in failed.text
        assert index.read_bytes() == original


    def test_read_only_index_is_updated_and_stays_read_only(self, lab: Path) -> None:
        # Nothing in Duet marks a ticket's INDEX.md read-only, and where Duet does use
        # that mode (deployed instruction files) it means "managed by Duet", which the
        # frontmatter is. So the flag doesn't block the tool; it is only preserved.
        index = lab / "work" / "DUE008_CoreProtocols" / "INDEX.md"
        index.chmod(0o444)
        try:
            updated = call(lab, "edit_ticket", ticket="DUE008", icon="🔎")
            assert not updated.is_error
            assert "icon: 🔎" in index.read_text(encoding="utf-8")
            assert index.stat().st_mode & 0o777 == 0o444
        finally:
            index.chmod(0o644)

    def test_write_keeps_the_file_permissions(self, lab: Path) -> None:
        index = lab / "work" / "DUE008_CoreProtocols" / "INDEX.md"
        index.chmod(0o600)
        assert not call(lab, "edit_ticket", ticket="DUE008", icon="🔎").is_error
        assert index.stat().st_mode & 0o777 == 0o600


class TestConcurrency:
    """A read that overlaps a move must never report a missing or duplicated ticket."""

    def test_reads_during_moves_are_consistent(self, lab: Path) -> None:
        stop = threading.Event()
        answers: list[str] = []

        def mover() -> None:
            shelves = ("backlog", "work")
            turn = 0
            while not stop.is_set():
                call(lab, "move_ticket", ticket="DUE007", to=shelves[turn % 2])
                turn += 1

        def reader() -> None:
            while not stop.is_set():
                answers.append(call(lab, "tickets", number="DUE007").text)

        threads = [threading.Thread(target=mover)] + [
            threading.Thread(target=reader) for _ in range(4)]
        for thread in threads:
            thread.start()
        time.sleep(1.0)
        stop.set()
        for thread in threads:
            thread.join()

        assert len(answers) > 20
        assert all(answer.startswith("### DUE007 UIResearch") for answer in answers)


    def test_stalled_read_does_not_block_writes_forever(self, lab: Path, monkeypatch) -> None:
        before = tree_of(lab)
        monkeypatch.setattr(tickets_model, "LOCK_TIMEOUT_SECONDS", 0.2)
        stalled = threading.Event()
        release = threading.Event()
        real_list = tickets_model.list_ticket_folders

        def stall(folder, strict=False):
            stalled.set()
            release.wait(5)
            return real_list(folder, strict=strict)

        monkeypatch.setattr(tickets_model, "list_ticket_folders", stall)
        reader = threading.Thread(target=lambda: call(lab, "tickets", code="DUE"))
        reader.start()
        assert stalled.wait(2)
        try:
            started = time.monotonic()
            blocked = call(lab, "move_ticket", ticket="DUE008", to="backlog")
            assert time.monotonic() - started < 2
            assert blocked.is_error
            assert "another ticket operation is still running" in blocked.text
            assert tree_of(lab) == before
        finally:
            release.set()
            reader.join()

class TestMcpBoundary:
    """What the service tests can't see: argument validation and the MCP error flag."""

    @pytest.fixture
    def tools(self, lab: Path, monkeypatch):
        class Service:
            def ticket_action(self, action: str, **arguments):
                return call(lab, action, **arguments)

        monkeypatch.setattr(mcp_handler, "_workspace_service", Service())
        return lambda name, arguments: asyncio.run(mcp.call_tool(name, arguments))

    def test_schema_is_strict_and_annotated(self) -> None:
        tools = {t.name: t for t in asyncio.run(mcp.list_tools())}
        for name in ACTIONS:
            assert tools[name].outputSchema is None
            assert tools[name].inputSchema["additionalProperties"] is False
        assert tools["tickets"].annotations.readOnlyHint is True
        assert tools["new_ticket"].annotations.idempotentHint is False
        assert tools["move_ticket"].inputSchema["properties"]["to"]["enum"] == [
            "work", "backlog", "archive"]
        # An enum next to a nullable type would publish a schema that forbids null.
        for name in ACTIONS:
            for prop in tools[name].inputSchema["properties"].values():
                assert not ("enum" in prop and "anyOf" in prop)

    def test_misspelled_argument_is_rejected_before_any_write(self, tools, lab: Path) -> None:
        before = tree_of(lab)
        result = tools("new_ticket", {"name": "Typo probe", "code": "DUE", "shelff": "backlog"})
        assert isinstance(result, CallToolResult) and result.isError
        assert result.content[0].text.startswith(
            "Error: `new_ticket` has no argument `shelff`. Did you mean `shelf`?")
        result = tools("edit_ticket", {"ticket": "DUE008", "description": "x", "status": "done"})
        assert result.isError and "use `move_ticket`" in result.content[0].text
        assert tree_of(lab) == before

    def test_wrong_argument_type_gets_the_tools_own_error(self, tools) -> None:
        result = tools("move_ticket", {"ticket": 28, "to": "work"})
        assert isinstance(result, CallToolResult) and result.isError
        assert result.content[0].text.startswith("Error: invalid arguments for `move_ticket`")

    def test_missing_required_argument_gets_the_tools_own_error(self, tools) -> None:
        result = tools("move_ticket", {"ticket": "DUE008"})
        assert isinstance(result, CallToolResult) and result.isError
        assert "`to`" in result.content[0].text

    def test_value_outside_the_enum_gets_the_tools_own_error(self, tools) -> None:
        result = tools("move_ticket", {"ticket": "DUE008", "to": "done"})
        assert isinstance(result, CallToolResult) and result.isError
        assert result.content[0].text == (
            'Error: `to` must be "work", "backlog", or "archive"; got "done".')

    def test_enum_values_are_not_case_sensitive(self, tools, lab: Path) -> None:
        tools("move_ticket", {"ticket": "DUE008", "to": "Backlog"})
        assert (lab / "backlog" / "DUE008_CoreProtocols").is_dir()

    def test_null_optional_arguments_mean_the_default(self, tools, lab: Path) -> None:
        tools("new_ticket", {"name": "Probe", "code": "DUE", "parent": None,
                             "description": None})
        assert (lab / "work" / "DUE037_Probe" / "INDEX.md").is_file()

    def test_slow_read_times_out_instead_of_hanging(self, tools, monkeypatch) -> None:
        class StalledService:
            def ticket_action(self, action: str, **arguments):
                time.sleep(0.5)

        monkeypatch.setattr(mcp_handler, "_workspace_service", StalledService())
        monkeypatch.setattr(mcp_handler, "_READ_TIMEOUT_SECONDS", 0.05)
        result = tools("tickets", {"code": "DUE"})
        assert isinstance(result, CallToolResult) and result.isError
        assert "the drive may be unavailable" in result.content[0].text

    def test_tools_do_not_run_on_the_event_loop(self, tools, monkeypatch) -> None:
        seen = []

        class Service:
            def ticket_action(self, action: str, **arguments):
                seen.append(threading.current_thread() is threading.main_thread())
                return Result("ok")

        monkeypatch.setattr(mcp_handler, "_workspace_service", Service())
        tools("move_ticket", {"ticket": "DUE008", "to": "backlog"})
        assert seen == [False]

    def test_null_leaves_a_field_unchanged(self, tools, lab: Path) -> None:
        tools("edit_ticket", {"ticket": "DUE008", "parent": None, "icon": "🔎"})
        index = (lab / "work" / "DUE008_CoreProtocols" / "INDEX.md").read_text(encoding="utf-8")
        assert "parent: DUEX02" in index and "icon: 🔎" in index


class TestTools:
    """The four MCP tools are registered and return plain text."""

    def test_registered_unstructured(self) -> None:
        tools = {t.name: t for t in asyncio.run(mcp.list_tools())}
        for name in ACTIONS:
            assert tools[name].outputSchema is None

    def test_through_workspace_service(self, tmp_path: Path, db, monkeypatch) -> None:
        from scanner import Scanner
        from services.workspace import WorkspaceService
        from tests.fixtures import DuetDataBuilder

        builder = DuetDataBuilder(tmp_path)
        builder.add_root_context("Root", folder_name="!Root")
        builder.build(monkeypatch)
        lab = builder.get_root_context_path(0) / "DuetLab"
        shutil.copytree(TREES_DIR / "lab", lab)
        Scanner(db, repos_path=builder.get_repos_path()).scan()

        service = WorkspaceService(db)
        created = service.ticket_action("new_ticket", name="Thesaurus", parent="DUEX02")
        assert not created.is_error
        assert created.text.startswith("### Created DUE037 Thesaurus")
        assert (lab / "work" / "DUE037_Thesaurus" / "INDEX.md").is_file()
        assert "`DUE037` Thesaurus" in service.ticket_action("tickets", code="DUE").text
