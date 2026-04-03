"""Instructions workspace scanner and bootstrapper merge.

Reads index.json and YAML frontmatter from persona/skill files
to build a dynamic catalog for workspace_info response.

Also provides merge_bootstrapper() for combining platform bootstrapper
with user core_instructions into a final output-style, and
merge_duet_instructions() for full merge-to-file pipeline.
"""

import json
import logging
from pathlib import Path

import yaml

from fileio import atomic_write, atomic_write_json

logger = logging.getLogger(__name__)


# Max frontmatter size (bytes)
_MAX_FRONTMATTER_BYTES = 4096


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
        description = fm.get("description")
        if not name or not description:
            errors.append({
                "path": rel_path,
                "reason_code": "missing_fields",
                "description": f"Missing required fields (name, description) in {rel_path}",
            })
            continue

        entry: dict = {
            "name": name,
            "description": description,
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
        "missing_fields": f"Missing required fields (name, description) in {path}",
        "frontmatter_too_large": f"Frontmatter exceeds {_MAX_FRONTMATTER_BYTES} bytes in {path}",
        # Merge pipeline
        "content_between_h1_h2": f"Content between H1 and first H2 in {path}",
        "no_h2_found": f"No H2 (##) section found in {path}",
        "bootstrapper_not_found": f"Bootstrapper template not found: {path}",
        "bootstrapper_missing_marker": f"Insert marker not found in {path}",
        "index_not_found": f"index.json not found in instructions workspace",
        "index_invalid": f"Cannot parse {path}",
        "index_missing_field": f"Required field missing in {path}",
        "core_instructions_not_found": f"Core instructions file not found: {path}",
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


def _extract_user_content(core_instructions_text: str) -> str:
    """Extract user content from core_instructions.md.

    Strategy: take everything starting from the first H2 (##).
    H1 is the file's "cover" for GitHub/editor — not part of instructions.
    Content between H1 and first H2 is an error (should not exist).

    Args:
        core_instructions_text: Full text of user's core_instructions.md.

    Returns:
        Content from first ## onwards.

    Raises:
        ValueError: If content exists between H1 and first H2,
                    or if no H2 found.
    """
    lines = core_instructions_text.split("\n")

    h1_line = None
    first_h2_line = None

    for i, line in enumerate(lines):
        if line.startswith("# ") and h1_line is None:
            h1_line = i
        elif line.startswith("## ") and first_h2_line is None:
            first_h2_line = i
            break

    if first_h2_line is None:
        raise ValueError("No H2 (##) found in core_instructions.md")

    # Check for content between H1 and first H2
    if h1_line is not None:
        between = lines[h1_line + 1 : first_h2_line]
        if any(line.strip() for line in between):
            raise ValueError(
                "Content found between H1 and first H2 in core_instructions.md. "
                "Move it into an H2 section or remove it."
            )

    return "\n".join(lines[first_h2_line:])


def merge_bootstrapper(
    bootstrapper_path: Path, instructions_path: Path
) -> str:
    """Merge platform bootstrapper with user core_instructions.

    Reads bootstrapper.md, finds INSERT_MARKER, replaces it with
    user content extracted from core_instructions.md (everything from
    first H2 onwards).

    Args:
        bootstrapper_path: Path to bootstrapper.md (in backend package).
        instructions_path: Path to instructions workspace root.

    Returns:
        Merged content ready to be written as output-style.

    Raises:
        FileNotFoundError: If bootstrapper.md or core_instructions not found.
        ValueError: If INSERT_MARKER not found in bootstrapper,
                    or core_instructions has invalid structure.
    """
    # Read bootstrapper
    bootstrapper_text = bootstrapper_path.read_text(encoding="utf-8")
    if INSERT_MARKER not in bootstrapper_text:
        raise ValueError(
            f"Marker {INSERT_MARKER!r} not found in {bootstrapper_path}"
        )

    # Find core_instructions path from index.json
    index_path = instructions_path / "index.json"
    if not index_path.exists():
        raise FileNotFoundError(f"index.json not found at {instructions_path}")

    index_data = json.loads(index_path.read_text(encoding="utf-8"))
    core_file = index_data.get("core_instructions")
    if not core_file:
        raise ValueError("'core_instructions' not specified in index.json")

    core_path = instructions_path / core_file
    if not core_path.exists():
        raise FileNotFoundError(f"core_instructions not found: {core_path}")

    core_text = core_path.read_text(encoding="utf-8")
    user_content = _extract_user_content(core_text)

    return bootstrapper_text.replace(INSERT_MARKER, user_content)


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
        "| Name | Shortcuts | Trigger |",
        "|------|-----------|---------|",
    ]

    for skill in all_skills:
        name = skill["name"]
        shortcuts = ", ".join(skill.get("shortcuts", [])) or "—"
        trigger = skill.get("trigger", "—")
        # Truncate long triggers for table readability
        if isinstance(trigger, str) and len(trigger) > 80:
            trigger = trigger[:77] + "..."
        lines.append(f"| {name} | {shortcuts} | {trigger} |")

    lines.append("")
    return "\n".join(lines), all_errors


# =============================================================================
# MERGE DUET INSTRUCTIONS (full pipeline)
# =============================================================================


def _merge_step_by_step(
    bootstrapper_path: Path, instructions_path: Path
) -> tuple[str | None, dict | None, list[dict]]:
    """Execute merge pipeline step-by-step, collecting precise errors.

    Each failure point produces an error with the exact path of the
    broken file, not a generic fallback. This is critical for Host UI
    where the Fix button needs to open the right file.

    Returns:
        Tuple of (merged_content_or_None, index_data_or_None, errors).
        If merged_content is None, a fatal error prevented merge.
        index_data is passed through to avoid re-reading index.json.
    """
    # Step 1: Read bootstrapper.md
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

    # Step 2: Read index.json
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

    # Step 3: Resolve core_instructions path
    core_file = index_data.get("core_instructions")
    if not core_file:
        return None, None, [{
            "path": "index.json",
            "reason_code": "index_missing_field",
            "description": "'core_instructions' field not specified in index.json",
        }]

    core_path = instructions_path / core_file
    if not core_path.exists():
        return None, None, [{
            "path": core_file,
            "reason_code": "core_instructions_not_found",
            "description": f"core_instructions file not found: {core_file}",
        }]

    # Step 4: Extract user content from core_instructions
    core_text = core_path.read_text(encoding="utf-8")
    try:
        user_content = _extract_user_content(core_text)
    except ValueError as e:
        error_msg = str(e)
        if "between H1 and first H2" in error_msg:
            reason_code = "content_between_h1_h2"
        else:
            reason_code = "no_h2_found"
        return None, None, [{
            "path": core_file,
            "reason_code": reason_code,
            "description": error_msg,
        }]

    # Step 5: Merge
    merged = bootstrapper_text.replace(INSERT_MARKER, user_content)
    return merged, index_data, []


def merge_duet_instructions(
    bootstrapper_path: Path,
    instructions_path: Path,
    output_path: Path,
    errors_path: Path,
) -> dict:
    """Full merge pipeline: bootstrapper + user content + skills table → file.

    Orchestrates:
    1. Step-by-step merge with precise error attribution
    2. Skills table generation with validation error collection
    3. Atomic write of merged content and errors

    Args:
        bootstrapper_path: Path to bootstrapper.md (in backend package).
        instructions_path: Path to instructions workspace root.
        output_path: Where to write merged content (e.g. DuetData/duet-instructions.md).
        errors_path: Where to write errors JSON (e.g. DuetData/data/duet-instructions-errors.json).

    Returns:
        Dict with status, path, and errors list.
    """
    # Step 1: Merge bootstrapper + user content
    merged, index_data, merge_errors = _merge_step_by_step(bootstrapper_path, instructions_path)

    if merged is None:
        # Fatal merge error — can't produce output
        atomic_write_json(errors_path, merge_errors)
        return {"status": "error", "path": None, "errors": merge_errors}

    errors: list[dict] = []

    # Step 2: Build skills table and collect validation errors
    # index_data is guaranteed non-None here (merge succeeded)
    skills_table, validation_errors = _build_skills_table(instructions_path, index_data)
    errors.extend(validation_errors)

    # Step 3: Insert skills table if marker present
    if SKILLS_TABLE_MARKER in merged:
        merged = merged.replace(SKILLS_TABLE_MARKER, skills_table)

    # Step 4: Write merged content (atomic)
    atomic_write(output_path, merged)

    # Step 5: Write errors JSON
    atomic_write_json(errors_path, errors)

    return {
        "status": "ok",
        "path": str(output_path),
        "errors": errors,
    }
