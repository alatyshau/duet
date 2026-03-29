"""Instructions workspace scanner.

Reads index.json and YAML frontmatter from persona/skill files
to build a dynamic catalog for workspace_info response.
"""

import json
import logging
from pathlib import Path

import yaml

logger = logging.getLogger(__name__)


def parse_frontmatter(text: str) -> dict:
    """Parse YAML frontmatter from markdown text.

    Expects --- delimiters at start of file.
    Returns empty dict if no frontmatter found.
    """
    if not text.startswith("---"):
        return {}

    # Find closing --- on its own line (not substring match)
    lines = text.split("\n")
    end_line = None
    for i, line in enumerate(lines[1:], start=1):
        if line.strip() == "---":
            end_line = i
            break

    if end_line is None:
        return {}

    block = "\n".join(lines[1:end_line]).strip()
    if not block:
        return {}

    # Frontmatter should be compact metadata, not large content
    if len(block) > 4096:
        logger.warning("Frontmatter block too large (%d bytes), skipping", len(block))
        return {}

    try:
        data = yaml.safe_load(block)
        return data if isinstance(data, dict) else {}
    except yaml.YAMLError as e:
        logger.warning("Invalid YAML frontmatter: %s", e)
        return {}


def _scan_folder(base_path: Path, folder_path: Path, category: str | None = None) -> list[dict]:
    """Scan a folder for .md files with YAML frontmatter.

    Args:
        base_path: Root of instructions workspace (for relative paths).
        folder_path: Absolute path to scan.
        category: Skill category name (None for personas).

    Returns:
        List of catalog entries with name, description, path, and optional fields.
    """
    if not folder_path.is_dir():
        logger.warning("Instructions folder not found: %s", folder_path)
        return []

    entries = []
    for md_file in sorted(folder_path.glob("*.md")):
        if not md_file.is_file():
            continue

        try:
            text = md_file.read_text(encoding="utf-8")
        except OSError as e:
            logger.warning("Cannot read %s: %s", md_file, e)
            continue

        fm = parse_frontmatter(text)
        if not fm:
            logger.warning("No frontmatter in %s, skipping", md_file)
            continue

        name = fm.get("name")
        description = fm.get("description")
        if not name or not description:
            logger.warning(
                "Missing required fields (name, description) in %s, skipping",
                md_file,
            )
            continue

        rel_path = str(md_file.relative_to(base_path)).replace("\\", "/")

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

    return entries


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
