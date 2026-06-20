"""Instructions workspace scanner and merge pipeline.

Reads index.json and YAML frontmatter from persona/skill files
to build a dynamic catalog for orientation response.

merge_duet_instructions() is the primary entry point: merges platform
bootstrapper + per-agent core file + skills table into one merged file per
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
    """Scan entire instructions workspace for .md files with version suffixes."""
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
                "description": _error_description("version_suffix", rel_path),
            })
    return errors


def parse_frontmatter(text: str) -> dict:
    """Parse YAML frontmatter from markdown text.

    Expects --- delimiters at start of file.
    Returns empty dict if no frontmatter found.
    """
    result = _parse_frontmatter_with_error(text)
    return result[0]


def _parse_frontmatter_with_error(text: str) -> tuple[dict, str | None]:
    """Parse YAML frontmatter, returning (data, error_reason_code).

    Returns:
        Tuple of (frontmatter_dict, reason_code_or_None).
        On success: (data, None). On error: ({}, reason_code).
    """
    if not text.startswith("---"):
        return {}, "no_frontmatter"

    # Find closing --- on its own line (not substring match)
    lines = text.split("\n")
    end_line = None
    for i, line in enumerate(lines[1:], start=1):
        if line.strip() == "---":
            end_line = i
            break

    if end_line is None:
        return {}, "no_frontmatter"

    block = "\n".join(lines[1:end_line]).strip()
    if not block:
        return {}, "no_frontmatter"

    # Frontmatter should be compact metadata, not large content
    if len(block) > _MAX_FRONTMATTER_BYTES:
        logger.warning("Frontmatter block too large (%d bytes), skipping", len(block))
        return {}, "frontmatter_too_large"

    try:
        data = yaml.safe_load(block)
        if not isinstance(data, dict):
            return {}, "invalid_yaml"
        return data, None
    except yaml.YAMLError as e:
        logger.warning("Invalid YAML frontmatter: %s", e)
        return {}, "invalid_yaml"


def _scan_folder(base_path: Path, folder_path: Path, category: str | None = None) -> list[dict]:
    """Scan a folder for .md files with YAML frontmatter.

    Args:
        base_path: Root of instructions workspace (for relative paths).
        folder_path: Absolute path to scan.
        category: Skill category name (None for personas).

    Returns:
        List of catalog entries with name, description, path, and optional fields.
    """
    entries, _ = _scan_folder_with_errors(base_path, folder_path, category)
    return entries


def _scan_folder_with_errors(
    base_path: Path, folder_path: Path, category: str | None = None
) -> tuple[list[dict], list[dict]]:
    """Scan a folder, collecting both entries and validation errors.

    Returns:
        Tuple of (entries, errors). Each error: {path, reason_code, description}.
    """
    if not folder_path.is_dir():
        logger.warning("Instructions folder not found: %s", folder_path)
        return [], []

    entries = []
    errors = []

    for md_file in sorted(folder_path.glob("*.md")):
        if not md_file.is_file():
            continue

        rel_path = str(md_file.relative_to(base_path)).replace("\\", "/")

        try:
            text = md_file.read_text(encoding="utf-8")
        except OSError as e:
            logger.warning("Cannot read %s: %s", md_file, e)
            continue

        fm, reason_code = _parse_frontmatter_with_error(text)
        if reason_code:
            errors.append({
                "path": rel_path,
                "reason_code": reason_code,
                "description": _error_description(reason_code, rel_path),
            })
            continue

        name = fm.get("name")
        if not name:
            errors.append({
                "path": rel_path,
                "reason_code": "missing_fields",
                "description": _error_description("missing_fields", rel_path),
            })
            continue

        description = fm.get("description")
        if not description:
            errors.append({
                "path": rel_path,
                "reason_code": "missing_description",
                "description": _error_description("missing_description", rel_path),
            })
            # Don't continue — entry is still usable without description

        entry: dict = {
            "name": name,
            "description": description or "",
            "path": rel_path,
        }

        if category is not None:
            entry["category"] = category

        # Optional fields
        shortcuts = fm.get("shortcuts")
        if shortcuts:
            entry["shortcuts"] = shortcuts

        trigger = fm.get("trigger")
        if trigger:
            entry["trigger"] = trigger

        no_trigger = fm.get("noTrigger")
        if no_trigger:
            entry["noTrigger"] = no_trigger

        entries.append(entry)

    return entries, errors


def _error_description(reason_code: str, path: str) -> str:
    """Human-readable error description for a reason code."""
    messages = {
        # Frontmatter validation (instruction files)
        "no_frontmatter": f"No YAML frontmatter in {path}",
        "invalid_yaml": f"Invalid YAML frontmatter in {path}",
        "missing_fields": f"Missing required field (name) in {path}",
        "missing_description": f"Missing description in {path}",
        "version_suffix": f'Найден файл инструкций с суффиксом "_v2": {path}',
        "frontmatter_too_large": f"Frontmatter exceeds {_MAX_FRONTMATTER_BYTES} bytes in {path}",
        # Merge pipeline
        "content_between_h1_h2": f"Content between H1 and first H2 in {path}",
        "no_h2_found": f"No H2 (##) section found in {path}",
        "bootstrapper_not_found": f"Bootstrapper template not found: {path}",
        "bootstrapper_missing_marker": f"Insert marker not found in {path}",
        "index_not_found": f"index.json not found in instructions workspace",
        "index_invalid": f"Cannot parse {path}",
        "index_missing_field": f"Required field missing in {path}",
        "agent_file_not_found": f"Agent file not found: {path}",
    }
    return messages.get(reason_code, f"Validation error in {path}")


def scan_instructions(instructions_path: Path) -> dict:
    """Scan instructions workspace and build catalog.

    Reads index.json, then scans declared folders for personas and skills
    with YAML frontmatter.

    Args:
        instructions_path: Absolute path to instructions workspace root.

    Returns:
        Dict with basePath, personas, and skills lists.
        Returns minimal result if index.json is missing or invalid.
    """
    result: dict = {
        "basePath": str(instructions_path),
        "personas": [],
        "skills": [],
    }

    index_path = instructions_path / "index.json"
    if not index_path.exists():
        logger.warning("index.json not found at %s", instructions_path)
        return result

    try:
        index_data = json.loads(index_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as e:
        logger.warning("Cannot read index.json: %s", e)
        return result

    # Scan personas
    personas_config = index_data.get("personas")
    if isinstance(personas_config, dict) and "path" in personas_config:
        personas_dir = instructions_path / personas_config["path"]
        result["personas"] = _scan_folder(instructions_path, personas_dir)

    # Scan skill folders
    skill_folders = index_data.get("skill_folders")
    if isinstance(skill_folders, list):
        for folder_config in skill_folders:
            if not isinstance(folder_config, dict):
                continue
            folder_name = folder_config.get("name", "")
            folder_path_str = folder_config.get("path", "")
            if not folder_path_str:
                continue

            folder_path = instructions_path / folder_path_str
            skills = _scan_folder(
                instructions_path, folder_path, category=folder_name
            )
            result["skills"].extend(skills)

    return result


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
# SKILLS TABLE
# =============================================================================

SKILLS_TABLE_MARKER = "<!-- INSERT SKILLS TABLE -->"


def _build_skills_table(instructions_path: Path, index_data: dict) -> tuple[str, list[dict]]:
    """Build compact skills table for merged content.

    Scans instructions workspace with error collection.
    Receives pre-validated index_data from merge pipeline
    to avoid re-reading index.json.

    Returns:
        Tuple of (markdown_table, errors).
    """
    all_errors: list[dict] = []
    all_skills: list[dict] = []

    # Scan personas (for error collection, not included in table)
    personas_config = index_data.get("personas")
    if isinstance(personas_config, dict) and "path" in personas_config:
        personas_dir = instructions_path / personas_config["path"]
        _, persona_errors = _scan_folder_with_errors(instructions_path, personas_dir)
        all_errors.extend(persona_errors)

    # Scan skill folders
    skill_folders = index_data.get("skill_folders")
    if isinstance(skill_folders, list):
        for folder_config in skill_folders:
            if not isinstance(folder_config, dict):
                continue
            folder_path_str = folder_config.get("path", "")
            folder_name = folder_config.get("name", "")
            if not folder_path_str:
                continue

            folder_path = instructions_path / folder_path_str
            skills, skill_errors = _scan_folder_with_errors(
                instructions_path, folder_path, category=folder_name
            )
            all_skills.extend(skills)
            all_errors.extend(skill_errors)

    if not all_skills:
        return "", all_errors

    # Build markdown table
    lines = [
        "",
        "**Available skills:**",
        "",
        "| Name | Shortcuts | Path | Description | Trigger | noTrigger |",
        "|------|-----------|------|-------------|---------|-----------|",
    ]

    for skill in all_skills:
        name = skill["name"]
        shortcuts = ", ".join(skill.get("shortcuts", [])) or "—"
        path = skill.get("path", "—")
        description = skill.get("description", "—")
        trigger = skill.get("trigger", "—")
        no_trigger = skill.get("noTrigger", "—")
        lines.append(f"| {name} | {shortcuts} | {path} | {description} | {trigger} | {no_trigger} |")

    lines.append("")
    return "\n".join(lines), all_errors


# =============================================================================
# MERGE DUET INSTRUCTIONS (full pipeline)
# =============================================================================


def _read_bootstrapper_and_index(
    bootstrapper_path: Path, instructions_path: Path
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

    index_path = instructions_path / "index.json"
    if not index_path.exists():
        return None, None, [{
            "path": "index.json",
            "reason_code": "index_not_found",
            "description": "index.json not found in instructions workspace",
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
    skills_table: str,
    instructions_path: Path,
    agent_name: str,
    agent_rel_path: str,
) -> tuple[str | None, dict | None]:
    """Merge bootstrapper + one agent's core file + skills table.

    Args:
        bootstrapper_text: Pre-read bootstrapper template (with both markers).
        skills_table: Pre-built skills table markdown to substitute.
        instructions_path: Root of instructions workspace.
        agent_name: Logical agent name (e.g. "executor", "vizir") — used in errors.
        agent_rel_path: Path to agent's core .md file, relative to instructions root.

    Returns:
        Tuple of (merged_content, error). On success error is None.
    """
    if not _is_safe_relative_path(agent_rel_path, instructions_path):
        return None, {
            "path": agent_rel_path,
            "reason_code": "agent_file_not_found",
            "description": (
                f"Agent file path for '{agent_name}' is unsafe "
                f"(absolute or escapes instructions root): {agent_rel_path}"
            ),
        }

    agent_path = instructions_path / agent_rel_path
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
    if SKILLS_TABLE_MARKER in merged:
        merged = merged.replace(SKILLS_TABLE_MARKER, skills_table)
    return merged, None


def _build_bare_session_prompt(bootstrapper_text: str, skills_table: str) -> str:
    """Build the thin session prompt: bootstrapper + skills table, with the
    user-core marker removed (no agent core appended).

    This is `DuetData/duet.md` — deployed as the Claude output-style and the
    Codex/Antigravity system prompt. The behavioral layer (L7, etc.) is no
    longer baked into the session; it comes from the per-context
    CLAUDE.md/AGENTS.md/GEMINI.md instead. The full agent cores still go into
    the `duet-{agent}.md` subagent files.
    """
    bare = bootstrapper_text.replace(INSERT_MARKER, "")
    if SKILLS_TABLE_MARKER in bare:
        bare = bare.replace(SKILLS_TABLE_MARKER, skills_table)
    # The core marker sits at the tail of the bootstrapper; removing it leaves
    # trailing blank lines — trim to a single terminating newline.
    return bare.rstrip() + "\n"


def merge_duet_instructions(
    bootstrapper_path: Path,
    instructions_path: Path,
    output_dir: Path,
    errors_path: Path,
) -> dict:
    """Full merge pipeline for ALL agents declared in index.json.

    Pipeline:
    1. Read bootstrapper.md and index.json (once).
    2. Build skills table (once) — common to all agents.
    3. Scan workspace for version-suffix files (once).
    4. For each agent in index.agents: merge → write `duet-{agent}.md` to output_dir.
    5. Aggregate errors and write to errors_path.

    Status semantics (strict):
    - "ok": all declared agents merged successfully (validation warnings allowed).
    - "error": fatal pre-condition failed (bootstrapper, index, no agents declared) OR
               any single agent merge failed.

    Args:
        bootstrapper_path: Path to bootstrapper.md (source in packages/instructions;
            bundled next to backend at runtime).
        instructions_path: Path to instructions workspace root.
        output_dir: Directory where merged files are written
                    (`duet-{agent}.md` per agent).
        errors_path: Where to write errors JSON.

    Returns:
        Dict: { status, paths: { agent_name: absolute_path_str }, errors: [...] }.
    """
    bootstrapper_text, index_data, fatal_errors = _read_bootstrapper_and_index(
        bootstrapper_path, instructions_path
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

    # Skills table — shared across agents, built once.
    skills_table, validation_errors = _build_skills_table(instructions_path, index_data)
    aggregate_errors: list[dict] = list(validation_errors)
    aggregate_errors.extend(_scan_version_suffixes(instructions_path))

    output_dir.mkdir(parents=True, exist_ok=True)
    paths: dict[str, str] = {}

    # Thin session prompt (bootstrapper + skills, no core) — one per workspace.
    bare_output = output_dir / "duet.md"
    atomic_write(bare_output, _build_bare_session_prompt(bootstrapper_text, skills_table))

    for agent_name, agent_rel_path in agents_config.items():
        if not isinstance(agent_rel_path, str) or not agent_rel_path:
            aggregate_errors.append({
                "path": "index.json",
                "reason_code": "index_missing_field",
                "description": f"agents.{agent_name} must be a non-empty string path",
            })
            continue

        merged, err = _merge_one_agent(
            bootstrapper_text, skills_table, instructions_path, agent_name, agent_rel_path
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
