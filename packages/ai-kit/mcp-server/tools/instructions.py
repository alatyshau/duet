"""Instructions location tool for AI Kit MCP server."""

from pathlib import Path


def get_instruction_location(base_path: Path) -> str:
    """Return absolute path to ai-kit directory containing instructions."""
    return str(base_path.resolve())
