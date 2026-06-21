"""Instructions merge pipeline.

merge_duet_instructions() is the primary entry point: merges platform
bootstrapper + per-agent core file into one merged file per
agent declared in index.json (e.g. duet-executor.md, duet-vizir.md).
"""

import json
import logging
import re
from pathlib import Path

import yaml

from fileio import atomic_write, atomic_write_json

logger = logging.getLogger(__name__)


# Max frontmatter size (bytes)
_MAX_FRONTMATTER_BYTES = 4096

# Pattern for version suffixes like _v2, _v3, _v10
_VERSION_SUFFIX_RE = re.compile(r"_v\d+$")


def _has_version_suffix(stem: str) -> bool:
    """Check if filename stem ends with a version suffix (_v2, _v3, etc.)."""
    return bool(_VERSION_SUFFIX_RE.search(stem))


_SCAN_IGNORE_DIRS = {"old", ".git", "node_modules", "__pycache__"}


def _scan_version_suffixes(base_path: Path) -> list[dict]:
    """Scan the platform instructions dir for .md files with version suffixes."""
    errors = []
    for md_file in sorted(base_path.rglob("*.md")):
        if not md_file.is_file():
            continue
        # Skip ignored directories
        if _SCAN_IGNORE_DIRS & {p.name for p in md_file.relative_to(base_path).parents}:
            continue
        if _has_version_suffix(md_file.stem):
            rel_path = str(md_file.relative_to(base_path)).replace("\\", "/")
            errors.append({
                "path": rel_path,
                "reason_code": "version_suffix",
                "description": f'Найден файл инструкций с суффиксом "_v2": {rel_path}',
            })
    return errors


# =============================================================================
# BOOTSTRAPPER MERGE
# =============================================================================

INSERT_MARKER = "<!-- INSERT USER CORE INSTRUCTIONS -->"


def _extract_user_content(agent_core_text: str) -> str:
    """Extract user content from an agent's core .md file.

    Strategy: take everything starting from the first H2 (##).
    H1 is the file's "cover" for GitHub/editor — not part of instructions.
    Content between H1 and first H2 is an error (should not exist).

    Args:
        agent_core_text: Full text of the agent's core file
                         (e.g. agents/executor.md, agents/vizir.md).

    Returns:
        Content from first ## onwards.

    Raises:
        ValueError: If content exists between H1 and first H2,
                    or if no H2 found.
    """
    lines = agent_core_text.split("\n")

    h1_line = None
    first_h2_line = None

    for i, line in enumerate(lines):
        if line.startswith("# ") and h1_line is None:
            h1_line = i
        elif line.startswith("## ") and first_h2_line is None:
            first_h2_line = i
            break

    if first_h2_line is None:
        raise ValueError("No H2 (##) found in agent core file")

    # Check for content between H1 and first H2
    if h1_line is not None:
        between = lines[h1_line + 1 : first_h2_line]
        if any(line.strip() for line in between):
            raise ValueError(
                "Content found between H1 and first H2 in agent core file. "
                "Move it into an H2 section or remove it."
            )

    return "\n".join(lines[first_h2_line:])


# =============================================================================
# MERGE DUET INSTRUCTIONS (full pipeline)
# =============================================================================


def _read_bootstrapper_and_index(
    bootstrapper_path: Path, platform_dir: Path
) -> tuple[str | None, dict | None, list[dict]]:
    """Read bootstrapper template and index.json — shared inputs for all agents.

    Returns:
        Tuple of (bootstrapper_text, index_data, errors).
        On fatal error one or both first elements are None and errors describes the cause.
    """
    if not bootstrapper_path.exists():
        return None, None, [{
            "path": str(bootstrapper_path),
            "reason_code": "bootstrapper_not_found",
            "description": f"Bootstrapper template not found: {bootstrapper_path}",
        }]

    bootstrapper_text = bootstrapper_path.read_text(encoding="utf-8")

    if INSERT_MARKER not in bootstrapper_text:
        return None, None, [{
            "path": str(bootstrapper_path),
            "reason_code": "bootstrapper_missing_marker",
            "description": f"Marker {INSERT_MARKER!r} not found in {bootstrapper_path.name}",
        }]

    index_path = platform_dir / "index.json"
    if not index_path.exists():
        return None, None, [{
            "path": "index.json",
            "reason_code": "index_not_found",
            "description": "index.json not found in platform instructions dir",
        }]

    try:
        index_data = json.loads(index_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as e:
        return None, None, [{
            "path": "index.json",
            "reason_code": "index_invalid",
            "description": f"Cannot parse index.json: {e}",
        }]

    return bootstrapper_text, index_data, []


def _is_safe_relative_path(rel_path: str, base: Path) -> bool:
    """Reject path-traversal attempts in user-controlled `index.json` entries.

    Relative path is safe iff:
      1. it has no absolute root (`/foo`, `C:\\foo`),
      2. resolved against `base` it stays under `base` (no `../` escapes).
    """
    candidate = Path(rel_path)
    if candidate.is_absolute():
        return False
    try:
        resolved = (base / candidate).resolve()
        resolved.relative_to(base.resolve())
        return True
    except ValueError:
        return False


def _merge_one_agent(
    bootstrapper_text: str,
    platform_dir: Path,
    agent_name: str,
    agent_rel_path: str,
) -> tuple[str | None, dict | None]:
    """Merge bootstrapper + one agent's core file.

    Args:
        bootstrapper_text: Pre-read bootstrapper template (with the core marker).
        platform_dir: Platform instructions dir (packages/instructions, bundled next to backend).
        agent_name: Logical agent name (e.g. "executor", "vizir") — used in errors.
        agent_rel_path: Path to agent's core .md file, relative to platform_dir.

    Returns:
        Tuple of (merged_content, error). On success error is None.
    """
    if not _is_safe_relative_path(agent_rel_path, platform_dir):
        return None, {
            "path": agent_rel_path,
            "reason_code": "agent_file_not_found",
            "description": (
                f"Agent file path for '{agent_name}' is unsafe "
                f"(absolute or escapes instructions root): {agent_rel_path}"
            ),
        }

    agent_path = platform_dir / agent_rel_path
    if not agent_path.exists():
        return None, {
            "path": agent_rel_path,
            "reason_code": "agent_file_not_found",
            "description": f"Agent file not found for '{agent_name}': {agent_rel_path}",
        }

    agent_text = agent_path.read_text(encoding="utf-8")
    try:
        user_content = _extract_user_content(agent_text)
    except ValueError as e:
        error_msg = str(e)
        reason_code = (
            "content_between_h1_h2"
            if "between H1 and first H2" in error_msg
            else "no_h2_found"
        )
        return None, {
            "path": agent_rel_path,
            "reason_code": reason_code,
            "description": error_msg,
        }

    merged = bootstrapper_text.replace(INSERT_MARKER, user_content)
    return merged, None


def _build_bare_session_prompt(bootstrapper_text: str) -> str:
    """Build the thin session prompt: bootstrapper with the user-core marker
    removed (no agent core appended).

    This is `DuetData/duet.md` — deployed as the Claude output-style and the
    Codex/Antigravity system prompt. The behavioral layer (L7, etc.) is no
    longer baked into the session; it comes from the per-context
    CLAUDE.md/AGENTS.md/GEMINI.md instead. The full agent cores still go into
    the `duet-{agent}.md` subagent files.
    """
    bare = bootstrapper_text.replace(INSERT_MARKER, "")
    # The core marker sits at the tail of the bootstrapper; removing it leaves
    # trailing blank lines — trim to a single terminating newline.
    return bare.rstrip() + "\n"


def merge_duet_instructions(
    bootstrapper_path: Path,
    platform_dir: Path,
    output_dir: Path,
    errors_path: Path,
) -> dict:
    """Full merge pipeline for ALL agents declared in index.json.

    Pipeline:
    1. Read bootstrapper.md and index.json (once).
    2. Scan workspace for version-suffix files (once).
    3. For each agent in index.agents: merge → write `duet-{agent}.md` to output_dir.
    4. Aggregate errors and write to errors_path.

    Status semantics (strict):
    - "ok": all declared agents merged successfully (validation warnings allowed).
    - "error": fatal pre-condition failed (bootstrapper, index, no agents declared) OR
               any single agent merge failed.

    Args:
        bootstrapper_path: Path to bootstrapper.md (source in packages/instructions;
            bundled next to backend at runtime).
        platform_dir: Path to the platform instructions dir (packages/instructions,
            bundled next to backend) — holds index.json and the agent cores
            (executor.md, vizir.md). NOT the user instructions workspace.
        output_dir: Directory where merged files are written
                    (`duet-{agent}.md` per agent).
        errors_path: Where to write errors JSON.

    Returns:
        Dict: { status, paths: { agent_name: absolute_path_str }, errors: [...] }.
    """
    bootstrapper_text, index_data, fatal_errors = _read_bootstrapper_and_index(
        bootstrapper_path, platform_dir
    )
    if fatal_errors:
        atomic_write_json(errors_path, fatal_errors)
        return {"status": "error", "paths": {}, "errors": fatal_errors}

    assert bootstrapper_text is not None
    assert index_data is not None

    agents_config = index_data.get("agents")
    if not isinstance(agents_config, dict) or not agents_config:
        err = [{
            "path": "index.json",
            "reason_code": "index_missing_field",
            "description": "'agents' field missing or empty in index.json",
        }]
        atomic_write_json(errors_path, err)
        return {"status": "error", "paths": {}, "errors": err}

    aggregate_errors: list[dict] = list(_scan_version_suffixes(platform_dir))

    output_dir.mkdir(parents=True, exist_ok=True)
    paths: dict[str, str] = {}

    # Thin session prompt (bootstrapper, no core) — one per workspace.
    bare_output = output_dir / "duet.md"
    atomic_write(bare_output, _build_bare_session_prompt(bootstrapper_text))

    for agent_name, agent_rel_path in agents_config.items():
        if not isinstance(agent_rel_path, str) or not agent_rel_path:
            aggregate_errors.append({
                "path": "index.json",
                "reason_code": "index_missing_field",
                "description": f"agents.{agent_name} must be a non-empty string path",
            })
            continue

        merged, err = _merge_one_agent(
            bootstrapper_text, platform_dir, agent_name, agent_rel_path
        )
        if err is not None:
            aggregate_errors.append(err)
            continue
        assert merged is not None

        agent_output = output_dir / f"duet-{agent_name}.md"
        atomic_write(agent_output, merged)
        paths[agent_name] = str(agent_output)

    atomic_write_json(errors_path, aggregate_errors)

    expected = set(agents_config.keys())
    actual = set(paths.keys())
    status = "ok" if actual == expected else "error"

    return {
        "status": status,
        "paths": paths,
        "output_style": str(bare_output),
        "errors": aggregate_errors,
    }
