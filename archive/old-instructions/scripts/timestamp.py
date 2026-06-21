#!/usr/bin/env python3
"""Get timestamp in format YYMMDD_HHMMSS<tz> using settings from .ai/settings.json"""

import json
import os
from datetime import datetime
from pathlib import Path

# Find .ai/settings.json relative to script or cwd
def find_settings():
    for base in [Path.cwd(), Path(__file__).parent.parent.parent.parent]:
        settings_path = base / ".ai" / "settings.json"
        if settings_path.exists():
            return settings_path
    return None

settings_path = find_settings()
if not settings_path:
    # Create default settings.json with UTC
    for base in [Path.cwd(), Path(__file__).parent.parent.parent.parent]:
        ai_dir = base / ".ai"
        if ai_dir.exists() or base == Path.cwd():
            ai_dir.mkdir(exist_ok=True)
            settings_path = ai_dir / "settings.json"
            default_settings = {
                "_DOC": {
                    "ЧТО": "Настройки для AI-скриптов",
                    "ЗАЧЕМ": "Хранит timezone и другие параметры для генерации timestamp",
                    "ИСПОЛЬЗОВАНИЕ": "packages/ai-kit/scripts/timestamp.py",
                    "СПЕКА": ".ai/schemas/settings.json.md"
                },
                "timezone": {
                    "id": "Z",
                    "value": "UTC"
                }
            }
            settings_path.write_text(json.dumps(default_settings, ensure_ascii=False, indent=4) + "\n")
            break
    if not settings_path:
        print(datetime.utcnow().strftime("%y%m%d_%H%M%SZ"))
        exit()

if settings_path:
    with open(settings_path) as f:
        tz = json.load(f).get("timezone", {"id": "Z", "value": "UTC"})

    os.environ["TZ"] = tz["value"]
    try:
        from time import tzset
        tzset()
    except ImportError:
        pass  # Windows doesn't have tzset

    print(datetime.now().strftime(f"%y%m%d_%H%M%S{tz['id']}"))
