"""Tests for paths.is_path_inside.

These tests cover both Posix and Windows path semantics regardless of
host OS — using PurePosixPath and PureWindowsPath. The point of the
helper is that workspace.py path classification works on Windows where
Path.resolve() produces backslash-separated strings.
"""

import sys
from pathlib import Path, PurePosixPath, PureWindowsPath

sys.path.insert(0, str(Path(__file__).parent.parent))

from paths import is_path_inside


class TestIsPathInsidePosix:
    """Posix path semantics (Mac, Linux)."""

    def test_equal_paths(self) -> None:
        assert is_path_inside(PurePosixPath("/a/b"), PurePosixPath("/a/b"))

    def test_subpath(self) -> None:
        assert is_path_inside(PurePosixPath("/a/b/c"), PurePosixPath("/a/b"))

    def test_deep_subpath(self) -> None:
        assert is_path_inside(
            PurePosixPath("/a/b/c/d/e"), PurePosixPath("/a/b")
        )

    def test_parent_not_inside_child(self) -> None:
        assert not is_path_inside(PurePosixPath("/a/b"), PurePosixPath("/a/b/c"))

    def test_disjoint_paths(self) -> None:
        assert not is_path_inside(PurePosixPath("/x/y"), PurePosixPath("/a/b"))

    def test_prefix_string_but_different_dir(self) -> None:
        """/a/bb is NOT inside /a/b — relative_to should reject."""
        assert not is_path_inside(PurePosixPath("/a/bb"), PurePosixPath("/a/b"))


class TestIsPathInsideWindows:
    """Windows path semantics — what breaks the old `+ "/"` check."""

    def test_equal_paths(self) -> None:
        assert is_path_inside(
            PureWindowsPath("C:\\Projects\\Baza"),
            PureWindowsPath("C:\\Projects\\Baza"),
        )

    def test_subpath(self) -> None:
        """The exact case that the orientation bug breaks on Windows."""
        assert is_path_inside(
            PureWindowsPath("C:\\Projects\\Baza\\sub"),
            PureWindowsPath("C:\\Projects\\Baza"),
        )

    def test_deep_subpath(self) -> None:
        assert is_path_inside(
            PureWindowsPath("C:\\Projects\\Baza\\МетаЛаб\\Duet"),
            PureWindowsPath("C:\\Projects\\Baza"),
        )

    def test_parent_not_inside_child(self) -> None:
        assert not is_path_inside(
            PureWindowsPath("C:\\Projects"),
            PureWindowsPath("C:\\Projects\\Baza"),
        )

    def test_different_drive(self) -> None:
        assert not is_path_inside(
            PureWindowsPath("D:\\Projects\\Baza"),
            PureWindowsPath("C:\\Projects\\Baza"),
        )

    def test_prefix_string_but_different_dir(self) -> None:
        """C:\\Projects\\Baza2 is NOT inside C:\\Projects\\Baza — exactly the
        edge case that string-based startswith would mishandle."""
        assert not is_path_inside(
            PureWindowsPath("C:\\Projects\\Baza2"),
            PureWindowsPath("C:\\Projects\\Baza"),
        )


class TestIsPathInsideStringInput:
    """Helper accepts strings in addition to Path objects."""

    def test_string_inputs_on_current_os(self, tmp_path: Path) -> None:
        sub = tmp_path / "sub" / "deep"
        assert is_path_inside(str(sub), str(tmp_path))
        assert is_path_inside(str(tmp_path), str(tmp_path))
        assert not is_path_inside(str(tmp_path), str(sub))
