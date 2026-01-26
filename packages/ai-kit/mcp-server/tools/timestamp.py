"""Timestamp tool for AI Kit MCP server."""

import json
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

DEFAULT_TZ = {"id": "Z", "value": "UTC"}


def get_settings(base_path: Path) -> dict:
    """Load settings from ai-kit/settings.json."""
    settings_path = base_path / "settings.json"
    if settings_path.exists():
        with open(settings_path) as f:
            return json.load(f)
    return {"timestampTZ": DEFAULT_TZ}


def get_timestamp(base_path: Path) -> str:
    """Get formatted timestamp using settings from base_path."""
    settings = get_settings(base_path)
    tz_config = settings.get("timestampTZ", DEFAULT_TZ)
    tz = ZoneInfo(tz_config["value"])
    return datetime.now(tz).strftime(f"%y%m%d_%H%M%S{tz_config['id']}")
