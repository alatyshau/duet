"""Workspace orientation service.

Builds the orientation response for AI agents and the Extension. Top-level
shape (design-doc §3):

    {
      "duet_paths": {...},                # always
      "context": {"chain": [...]},        # when entity resolved
      "workspace": {kind, context_name,
                    context_folder,
                    git_folders, ...},    # always
      "products": [...]                   # when entity resolved
    }

Workspace block has four canonical fields (§3.1) plus per-shape addons
(`reference_repos`, meta-context's `root_context_folders` /
`duet_data_folder`). The old `type`/`topology`/`git_folder` fields are gone.
"""

import logging
import re
from pathlib import Path

from config import (
    get_duet_data_path,
    get_machine_config_path,
    get_repos_path,
    get_root_context_folders,
)
from db import DatabaseManager, Entity
from description import extract_description
from normalization import normalize_path
from paths import is_path_inside
from services.manifest import (
    Manifest,
    read_manifest,
    read_reference_repos as _read_manifest_reference_repos,
)
from services.at_paths import resolve_at_path
from services.deploy_instructions import deploy_instructions as _deploy_instructions
from services.products import build_products

logger = logging.getLogger(__name__)


class WorkspaceService:
    """Service for workspace orientation."""

    def __init__(self, db: DatabaseManager):
        self.db = db

    # === Entity resolution ===

    def _resolve_entity(self, workspace_path: str) -> Entity | None:
        """Resolve workspace path to an entity.

        Algorithm:
        1. If path starts with {DuetData}/repos/:
           - Extract repo folder name (first segment after repos/)
           - Strip .wt-* suffix, ensure .git suffix
           - find_by_name(name) -> product_repo/reference_repo entity
           - Navigate to parent (the context that owns it)

        2. Otherwise (Google Drive path):
           - Find which root context folder is a prefix of the path
           - Strip prefix -> relative_path
           - Normalize slashes -> /
           - find_closest_entity(relative_path) -> entity
        """
        workspace_path = normalize_path(workspace_path)
        path = Path(workspace_path).resolve()
        path_str = str(path)

        repos_path = get_repos_path()
        if repos_path:
            if is_path_inside(path, repos_path.resolve()):
                return self._resolve_from_repos(path, repos_path)

        return self._resolve_from_drive(path_str)

    def _resolve_from_repos(self, path: Path, repos_path: Path) -> Entity | None:
        """Resolve entity from repos path.

        Extracts repo name from path like /DuetData/repos/Duet.git/...
        Finds product_repo/reference_repo by name, returns parent entity.
        """
        try:
            relative = path.relative_to(repos_path)
            parts = relative.parts
            if not parts:
                return None

            repo_folder = parts[0]
            repo_name = re.sub(r"\.wt-[^/]*$", "", repo_folder)
            if not repo_name.endswith(".git"):
                repo_name = repo_name + ".git"

            repo_entity = self.db.find_by_name(repo_name)
            if not repo_entity:
                return None

            if repo_entity.type in ("product_repo", "reference_repo"):
                if repo_entity.parent_id:
                    return self.db.get_entity(repo_entity.parent_id)
                return None

            return repo_entity
        except ValueError:
            return None

    def _resolve_from_drive(self, path_str: str) -> Entity | None:
        """Resolve entity from Google Drive path."""
        path = Path(path_str)
        for folder in get_root_context_folders():
            folder_path = Path(folder).resolve()

            if is_path_inside(path, folder_path):
                try:
                    root_name = folder_path.name
                    relative = path.relative_to(folder_path)
                    relative_str = str(relative).replace("\\", "/")

                    if relative_str == ".":
                        full_relative = root_name
                    else:
                        full_relative = f"{root_name}/{relative_str}"

                    return self.db.find_closest_entity(full_relative)
                except ValueError:
                    continue

        return None

    def _is_path_in_hierarchy(self, workspace_path: str) -> bool:
        """Check if path is in repos/ or any root context folder."""
        workspace_path = normalize_path(workspace_path)
        path = Path(workspace_path).resolve()

        repos_path = get_repos_path()
        if repos_path and is_path_inside(path, repos_path.resolve()):
            return True

        for folder in get_root_context_folders():
            if is_path_inside(path, Path(folder).resolve()):
                return True

        return False

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

    # === Multi-path entity resolution ===

    def _classify_path(self, path_str: str) -> tuple[str, Entity | None]:
        """Classify a workspace path and resolve to entity."""
        normalized = normalize_path(path_str)
        path = Path(normalized).resolve()
        path_s = str(path)

        repos_path = get_repos_path()
        if repos_path and is_path_inside(path, repos_path.resolve()):
            entity = self._resolve_from_repos(path, repos_path)
            return ("git", entity)

        if (path / "context.json").exists():
            entity = self._resolve_from_drive(path_s)
            return ("context", entity)

        return ("ignored", None)

    def _resolve_multi_path(self, workspace_paths: list[str]) -> Entity | None:
        """Resolve best entity from multiple workspace paths.

        Rule: if the meta-context (the user's top-level container) is among the resolved
        entities — it wins; otherwise return the first resolved context.

        For multi-repo contexts (DuetLab), this also unifies several `repos/<alias>.git`
        paths to a single owning context — each path resolves via the corresponding
        `product_repo` entity to the same parent context, so the result is the same
        regardless of which path the agent opened.

        First-come fallback also covers the case where the DB temporarily has no entity
        with ``meta=true`` (e.g. between a Host meta-flag write and the next backend
        scan, or when the user has manually edited a manifest). Host owns the invariant
        — its startup/save sweep restores ``meta`` on the first folder — so Backend just
        picks the first resolved entity and lets Host fix the source of truth.
        """
        entities: list[Entity] = []
        for path_str in workspace_paths:
            _, entity = self._classify_path(path_str)
            if entity and entity.id:
                entities.append(entity)

        if not entities:
            return None

        meta_context = self.db.find_meta_context()
        if meta_context and meta_context.id:
            for e in entities:
                if e.id == meta_context.id:
                    return e

        return entities[0]

    # === Orientation response ===

    def get_orientation(
        self, workspace_path: str | None = None, workspace_paths: list[str] | None = None
    ) -> dict:
        """Get full workspace orientation for AI agents."""
        duet_data = get_duet_data_path()

        result: dict = {
            "duet_paths": {
                "duetDataPath": str(duet_data.resolve()),
                "machineConfig": str(get_machine_config_path().resolve()),
            },
        }

        paths = workspace_paths or ([workspace_path] if workspace_path else [])

        if not paths:
            result["workspace"] = self._build_unknown_workspace("no_workspace_path")
            return result

        if len(paths) > 1:
            entity = self._resolve_multi_path(paths)
        else:
            entity = self._resolve_entity(paths[0])

        if not (entity and entity.id):
            any_in_hierarchy = any(
                self._is_path_in_hierarchy(p) for p in paths
            )
            reason = "entity_not_in_db" if any_in_hierarchy else "path_not_in_hierarchy"
            result["workspace"] = self._build_unknown_workspace(reason)
            return result

        # --- Entity resolved ---
        chain = self.db.get_entity_chain(entity.id)

        result["context"] = self._build_context(chain)
        result["workspace"] = self._build_workspace(entity)
        result["products"] = self._build_products(entity)
        result["memory"] = self._build_memory(entity)

        return result

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

    def _build_memory(self, entity: Entity) -> dict | None:
        """Resolve the context-memory pointer (`context.json` → `memory`).

        Returns `{ref, path}` with the resolved absolute file path, or `None`
        when the context declares no memory file (or it doesn't resolve).
        """
        drive_path = self._resolve_drive_path(entity)
        manifest = read_manifest(drive_path) if drive_path else None
        if not manifest or not manifest.memory:
            return None
        resolved = resolve_at_path(
            manifest.memory, get_repos_path(), self._build_context_folders()
        )
        if resolved is None:
            return None
        return {"ref": manifest.memory, "path": str(resolved)}

    def deploy_instructions(self, workspace_paths: list[str]) -> dict:
        """Resolve the owning context for `workspace_paths` and deploy its
        instruction components (skills / instructions) into its Drive folder.

        Returns `{status, deployed, warnings}` or `{status: "unknown", reason}`
        when no owning context resolves.
        """
        if len(workspace_paths) > 1:
            entity = self._resolve_multi_path(workspace_paths)
        elif workspace_paths:
            entity = self._resolve_entity(workspace_paths[0])
        else:
            entity = None

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

    def _build_unknown_workspace(self, reason: str) -> dict:
        """Build workspace block for unknown/unresolved workspace.

        Same canonical four fields as a resolved workspace, with
        `kind="unknown"` and a `reason` discriminator.
        """
        return {
            "kind": "unknown",
            "reason": reason,
            "context_name": None,
            "context_folder": None,
            "git_folders": {},
        }

    def _build_context(self, chain: list[Entity]) -> dict:
        """Build context block with breadcrumb and chain.

        `icon` is the entity's emoji from the manifest (or scanner default —
        `📚` meta, `📦` terminal, `📁` intermediate). Always present, mirroring
        the `icon` field on `ContextEntity` returned by `GET /contexts`.
        """
        chain_items = []
        for entity in chain:
            item: dict = {
                "type": entity.type,
                "name": entity.name,
                "icon": entity.icon,
            }
            desc = self._get_entity_description(entity)
            if desc:
                item["description"] = desc
            chain_items.append(item)

        return {
            "breadcrumb": " / ".join(e.name for e in chain),
            "chain": chain_items,
        }

    def _build_workspace(self, entity: Entity) -> dict:
        """Build workspace block per §3.1.

        Always has the four canonical fields: kind, context_name,
        context_folder, git_folders. Adds `reference_repos` when the
        manifest declares any with existing clones. Adds meta-context
        addons (`root_context_folders`, `duet_data_folder`) for the
        meta-context.
        """
        drive_folder = self._resolve_drive_path(entity)
        git_folders = self._build_git_folders(entity)

        workspace: dict = {
            "kind": "context",
            "context_name": entity.name,
            "context_folder": str(drive_folder) if drive_folder else None,
            "git_folders": git_folders,
        }

        ref_repos = self._read_reference_repos(entity)
        if ref_repos:
            workspace["reference_repos"] = ref_repos

        if entity.meta:
            # Meta-context addons — preserve the wide-angle view used by
            # Host UI and existing tooling. Not in §3.1 canonical fields,
            # but explicitly retained as meta-only addons.
            workspace["duet_data_folder"] = str(get_duet_data_path().resolve())
            root_contexts = [
                e for e in self.db.get_all_entities()
                if e.type == "context" and e.parent_id is None
            ]
            root_map: dict[str, str] = {}
            for ctx in root_contexts:
                ctx_path = self._resolve_drive_path(ctx)
                if ctx_path:
                    root_map[ctx.name] = str(ctx_path)
            workspace["root_context_folders"] = root_map

        return workspace

    def _build_git_folders(self, entity: Entity) -> dict[str, str]:
        """Map alias → expected absolute git clone path.

        Read from the manifest on disk (fresh state). Includes **every**
        declared alias regardless of whether the clone exists on disk —
        the path is the expected location (`{repos}/{alias}.git`).
        Consumers (Extension, AI agents) decide whether to clone by
        checking `Path(git_folders[alias]).exists()`. Order matches the
        manifest's insertion order (Python dict invariant). Returns `{}`
        for contexts without `git_repos`.
        """
        if entity.type != "context":
            return {}
        drive_path = self._resolve_drive_path(entity)
        manifest = read_manifest(drive_path) if drive_path else None
        if not manifest or not manifest.git_repos:
            return {}

        repos_path = get_repos_path()
        if not repos_path:
            return {}

        return {alias: str(repos_path / f"{alias}.git") for alias in manifest.git_repos}

    def _build_products(self, entity: Entity) -> list[dict]:
        """Build the top-level products[] array (§3.2)."""
        if entity.type != "context":
            return []
        context_folder = self._resolve_drive_path(entity)
        git_folders = self._build_git_folders(entity)
        return build_products(entity.name, context_folder, git_folders)

    def _read_reference_repos(self, entity: Entity) -> dict[str, str] | None:
        """Read reference_repos from entity's manifest on disk.

        Returns map of {name.git: absolute_path} for existing clones.
        """
        if entity.type != "context":
            return None

        drive_path = self._resolve_drive_path(entity)
        ref_repos_raw = _read_manifest_reference_repos(drive_path)
        if not ref_repos_raw:
            return None

        repos_path = get_repos_path()
        if not repos_path:
            return None

        result: dict[str, str] = {}
        for ref_name in ref_repos_raw:
            clone_name = f"{ref_name}.git"
            clone_path = repos_path / clone_name
            if clone_path.exists():
                result[clone_name] = str(clone_path)

        return result if result else None

    def _get_entity_description(self, entity: Entity) -> str | None:
        """Get description for chain item.

        Priority: manifest's `description` field > first sentence of
        README.md at the context's Drive folder.
        """
        drive_path = self._resolve_drive_path(entity)
        if drive_path is None:
            return None

        if entity.type == "context":
            manifest = read_manifest(drive_path)
            if manifest and manifest.description:
                return manifest.description.strip() or None

        readme_path = drive_path / "README.md"
        return extract_description(readme_path)
