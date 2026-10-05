"""Workspace orientation service.

Answers one question for an AI agent: given the folder a session was opened
in, which business is it and what must be read first. The answer is Markdown
text of three kinds, chosen by where the folder lies:

- inside a venture folder (a root context folder) — the nearest business up
  the tree: its paths on this machine and its entry points;
- inside `DuetData/repos` — the repo and the businesses that declare it;
- anywhere else — one line saying the folder is outside Duet.

A business is chosen by a business folder only. A repo folder never chooses
one, because several businesses may declare the same repo. Deploying
instructions uses the same rule (`resolve_business`).
"""

import re
from pathlib import Path

from config import (
    get_duet_data_path,
    get_repos_path,
    get_root_context_folders,
)
from db import DatabaseManager, Entity
from normalization import normalize_path
from paths import is_path_inside
from services.manifest import read_manifest
from services.resolve_paths import ContextRef, Resolution, resolve_paths as _resolve_paths
from services.deploy_instructions import deploy_instructions as _deploy_instructions

# A business's entry point: the first of these that exists in its folder.
ENTRY_POINT_FILES = ("INDEX.md", "README.md")

OUTSIDE_DUET = "Not a business folder: this path is outside Duet."
INSIDE_REPO = "Not a business folder: this path is inside a git-repo."
NOT_REGISTERED = (
    "Not a business folder: this path is inside a venture folder, but no business "
    "is registered for it. Run `scan` and call `orientation` again."
)


class WorkspaceService:
    """Service for workspace orientation."""

    def __init__(self, db: DatabaseManager):
        self.db = db

    # === Business resolution ===

    def resolve_business(self, folder: str) -> Entity | None:
        """Resolve a folder to its business: the nearest one up the tree.

        A business is a folder with `context.json` that the scanner
        registered. `folder` may lie deeper — a ticket's work folder or a
        direction without a manifest leads to the same business. A folder
        outside every venture folder (a repo under `DuetData/repos` included)
        resolves to None: a repo folder does not choose a business.
        """
        path = Path(normalize_path(folder)).resolve()
        for root in get_root_context_folders():
            root_path = Path(root).resolve()
            if not is_path_inside(path, root_path):
                continue
            relative = path.relative_to(root_path).as_posix()
            drive_path = root_path.name if relative == "." else f"{root_path.name}/{relative}"
            entity = self.db.find_closest_entity(drive_path)
            if entity and entity.id and entity.type == "context":
                return entity
        return None

    def _resolve_businesses(self, folders: list[str]) -> Entity | None:
        """Pick one business for a window that has several folders open.

        Each folder resolves by `resolve_business`; the meta-context wins when
        it is among them, otherwise the first resolved business. The fallback
        also covers a DB that temporarily has no `meta=true` entity (between a
        Host meta-flag write and the next scan): Host owns that invariant.
        """
        entities = [e for e in map(self.resolve_business, folders) if e]
        if not entities:
            return None
        meta_context = self.db.find_meta_context()
        if meta_context and meta_context.id:
            for e in entities:
                if e.id == meta_context.id:
                    return e
        return entities[0]

    def _is_in_venture_folder(self, path: Path) -> bool:
        return any(
            is_path_inside(path, Path(root).resolve()) for root in get_root_context_folders()
        )

    # === Path resolution helpers ===

    def _resolve_drive_path(self, entity: Entity) -> Path | None:
        """Resolve entity's drive_path to absolute filesystem path.

        Invariant: entity.drive_path is stored with `/` separator regardless
        of host OS — Scanner normalizes via `replace("\\", "/")`. Splitting
        on `/` here is therefore safe on Windows.
        """
        if not entity.drive_path:
            return None

        first_segment = entity.drive_path.split("/")[0]

        for folder in get_root_context_folders():
            folder_path = Path(folder)
            if normalize_path(folder_path.name) == first_segment:
                return folder_path.parent / entity.drive_path

        return None

    # === Orientation answer ===

    def get_orientation(self, path: str) -> str:
        """Build the orientation answer for one folder, as Markdown text."""
        folder = Path(normalize_path(path)).resolve()

        repos_path = get_repos_path()
        if repos_path and is_path_inside(folder, repos_path.resolve()):
            return self._render_repo(folder, repos_path.resolve())

        entity = self.resolve_business(path)
        if entity is None:
            return NOT_REGISTERED if self._is_in_venture_folder(folder) else OUTSIDE_DUET
        return self._render_business(entity)

    def _render_business(self, entity: Entity) -> str:
        """Answer for a business folder: paths of this machine, then entry points.

        Only the active business and its venture (the root of the parent
        chain) are named; intermediate parents are left to the entry points.
        Repos are listed as the manifest declares them, at the expected
        clone path, whether or not the clone exists yet.
        """
        chain = self.db.get_entity_chain(entity.id)
        venture = chain[0] if len(chain) > 1 else None
        folder = self._resolve_drive_path(entity)
        if folder is None:
            return NOT_REGISTERED
        venture_folder = self._resolve_drive_path(venture) if venture else None

        paths = [_duet_data_line()]
        label = "active business folder" if venture else "active venture folder"
        paths.append(_path_line(entity.name, label, folder))
        if venture and venture_folder:
            paths.append(_path_line(venture.name, "parent venture folder", venture_folder))

        manifest = read_manifest(folder)
        repos_path = get_repos_path()
        if manifest and repos_path:
            for alias in manifest.git_repos or {}:
                paths.append(_path_line(f"{alias}.git", "git-repo", repos_path / f"{alias}.git"))
            for name in manifest.reference_repos or {}:
                paths.append(
                    _path_line(f"{name}.git", "reference repo, read-only", repos_path / f"{name}.git")
                )

        steps = []
        venture_entry = _entry_point(venture_folder)
        if venture_entry:
            steps.append(f"* Read venture entry point: `{venture_entry}`")
        entry = _entry_point(folder)
        if entry:
            kind = "business" if venture else "venture"
            steps.append(f"* Read {kind} entry point: `{entry}`")

        return _join_sections([("Paths", paths), ("Next immediate steps", steps)])

    def _render_repo(self, folder: Path, repos_path: Path) -> str:
        """Answer for a folder inside `DuetData/repos`: the repo and who declares it.

        The repo is the first segment under `repos`; a worktree folder
        (`X.wt-N`) stands for its repo `X.git`. Declaring businesses are
        collected from the manifests on disk — one repo may be declared by
        several, so no business is chosen here.
        """
        parts = folder.relative_to(repos_path).parts
        if not parts:
            return OUTSIDE_DUET
        repo_name = re.sub(r"\.wt-[^/]*$", "", parts[0])
        if not repo_name.endswith(".git"):
            repo_name += ".git"
        alias = repo_name[: -len(".git")]
        repo_folder = repos_path / repo_name

        declared = []
        for context in self.db.get_contexts():
            context_folder = self._resolve_drive_path(context)
            if context_folder is None:
                continue
            manifest = read_manifest(context_folder)
            if not manifest:
                continue
            if alias in (manifest.git_repos or {}):
                declared.append(_path_line(context.name, "business folder", context_folder))
            elif alias in (manifest.reference_repos or {}):
                declared.append(
                    _path_line(context.name, "business folder, read-only reference", context_folder)
                )
        if not declared:
            declared = ["no business declares this repo"]

        steps = []
        readme = repo_folder / "README.md"
        if readme.is_file():
            steps.append(f"* Read git-repo entry point: `{readme}`")

        body = _join_sections([
            ("Paths", [_duet_data_line(), _path_line(repo_name, "git-repo", repo_folder)]),
            ("Declared by", declared),
            ("Next immediate steps", steps),
        ])
        return f"{INSIDE_REPO}\n\n{body}"

    def _build_context_folders(self) -> dict[str, str]:
        """Map every context name → its absolute Drive folder.

        Feeds the `@<name>/<rest>` resolver: `@<context-name>` resolves to that
        context's folder (alongside repo-dir aliases under `<DuetData>/repos`).
        """
        out: dict[str, str] = {}
        for entity in self.db.get_all_entities():
            if entity.type != "context":
                continue
            folder = self._resolve_drive_path(entity)
            if folder:
                out[entity.name] = str(folder)
        return out

    def resolve_paths(self, paths: list[str]) -> list[Resolution]:
        """Resolve agent-facing alpha paths (repos, contexts, tickets).

        See `services/resolve_paths.py`; contexts come from the entities DB,
        ticket codes are read live from their manifests.
        """
        contexts = [
            ContextRef(name=name, folder=Path(folder))
            for name, folder in self._build_context_folders().items()
        ]
        return _resolve_paths(paths, get_repos_path(), contexts)

    def deploy_instructions(self, workspace_paths: list[str]) -> dict:
        """Resolve the business for `workspace_paths` and deploy its
        instruction components (skills / instructions / system_prompt) into its Drive folder.

        The business comes from business folders only (`resolve_business`):
        a repo folder among the paths chooses nothing.

        Returns `{status, deployed, warnings}` or `{status: "unknown", reason}`
        when no business resolves.
        """
        entity = self._resolve_businesses(workspace_paths)

        if not (entity and entity.id):
            return {"status": "unknown", "reason": "no_owning_context"}

        drive_path = self._resolve_drive_path(entity)
        manifest = read_manifest(drive_path) if drive_path else None
        if not drive_path or not manifest:
            return {"status": "unknown", "reason": "no_context_manifest"}

        report = _deploy_instructions(
            Path(drive_path),
            manifest,
            get_repos_path(),
            self._build_context_folders(),
        )
        return {"status": "ok", **report}


def _duet_data_line() -> str:
    return f"* `@DuetData` (path to DuetData): `{get_duet_data_path().resolve()}`"


def _path_line(name: str, label: str, path: Path) -> str:
    return f"* `@{name}` ({label}): `{path}`"


def _entry_point(folder: Path | None) -> Path | None:
    """The file a business is entered through: `INDEX.md`, else `README.md`."""
    if folder is None:
        return None
    for filename in ENTRY_POINT_FILES:
        candidate = folder / filename
        if candidate.is_file():
            return candidate
    return None


def _join_sections(sections: list[tuple[str, list[str]]]) -> str:
    """Render `**Title:**` blocks separated by a blank line; empty ones are dropped."""
    blocks = [f"**{title}:**\n" + "\n".join(lines) for title, lines in sections if lines]
    return "\n\n".join(blocks)
