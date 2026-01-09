#!/usr/bin/env python3
"""
ЧТО: Утилиты для работы с keeper_state.json.
ЗАЧЕМ: Единая точка загрузки/сохранения состояния Keeper, избегаем дублирования кода.
КТО_ИСПОЛЬЗУЕТ: ai_doc_updater.py, ai_git_updater.py, backlog_update.py.
"""

import json
from pathlib import Path
from typing import Dict, Any

# Определяем ROOT_DIR (родитель папки scripts)
# Предполагаем, что utils лежит в scripts/
try:
    ROOT_DIR = Path(__file__).parent.parent.absolute()
except NameError:
    # Fallback для интерактивного режима
    ROOT_DIR = Path.cwd()

KEEPER_STATE_FILE = ROOT_DIR / ".ai" / "keeper_state.json"

def get_default_state() -> Dict[str, Any]:
    """Возвращает структуру состояния по умолчанию."""
    return {
        "_DOC": {
            "ЧТО": "Файл состояния для ИИ-роли The Keeper",
            "ЗАЧЕМ": "Хранит хеш последнего проверенного коммита и бэклог незавершённых задач",
            "КТО_ИСПОЛЬЗУЕТ": "scripts/ai_doc_updater.py, scripts/ai_git_updater.py, scripts/backlog_update.py, The Keeper"
        },
        "role": "keeper",
        "last_commit": "",
        "updated_at": "",
        "backlog": {
            "sections": {},
            "files": []
        }
    }

def load_keeper_state() -> Dict[str, Any]:
    """
    Загружает состояние Keeper.
    Если файла нет -- создаёт его с дефолтными значениями.
    """
    if not KEEPER_STATE_FILE.exists():
        print(f"⚠️ {KEEPER_STATE_FILE.name} not found, creating new with defaults")
        default_state = get_default_state()
        save_keeper_state(default_state)
        return default_state

    try:
        with open(KEEPER_STATE_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        print(f"⚠️ Error loading {KEEPER_STATE_FILE.name}: {e}. Returning default state (not saved).")
        return get_default_state()

def save_keeper_state(state: Dict[str, Any]) -> None:
    """Сохраняет состояние Keeper в JSON с отступами."""
    KEEPER_STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(KEEPER_STATE_FILE, "w", encoding="utf-8") as f:
        json.dump(state, f, ensure_ascii=False, indent=4)
