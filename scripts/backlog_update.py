#!/usr/bin/env python3
"""
ЧТО: Единая точка входа для управления backlog Keeper.
ЗАЧЕМ: Решает race condition при параллельной работе Keeper и пользователя.
КТО_ИСПОЛЬЗУЕТ: Keeper.

Использование:
    python scripts/backlog_update.py                     # Только добавить новое (union)
    python scripts/backlog_update.py --done file1 file2  # Закрыть файлы + добавить новое
"""

import subprocess
import sys
import json
from pathlib import Path
from datetime import datetime, timezone
from typing import List

# Конфигурация
ROOT_DIR = Path(__file__).parent.parent.absolute()
KEEPER_STATE_FILE = ROOT_DIR / ".ai" / "keeper_state.json"
SCRIPTS_DIR = ROOT_DIR / "scripts"


def run_script(script_name: str) -> bool:
    """Запускает Python-скрипт и возвращает успешность."""
    script_path = SCRIPTS_DIR / script_name
    try:
        result = subprocess.run(
            [sys.executable, str(script_path)],
            cwd=ROOT_DIR,
            capture_output=True,
            text=True
        )
        print(result.stdout, end="")
        if result.stderr:
            print(result.stderr, end="")
        return result.returncode == 0
    except Exception as e:
        print(f"⚠️ Error running {script_name}: {e}")
        return False


def get_head_commit() -> str:
    """Возвращает хеш текущего HEAD коммита."""
    try:
        result = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=ROOT_DIR,
            capture_output=True,
            text=True,
            check=True
        )
        return result.stdout.strip()
    except Exception:
        return ""


def remove_from_backlog(done_items: List[str]) -> None:
    """
    Удаляет завершённые элементы из backlog.
    Поддерживает как файлы, так и папки (с trailing /).
    """
    if not done_items or not KEEPER_STATE_FILE.exists():
        return

    try:
        state = json.loads(KEEPER_STATE_FILE.read_text(encoding="utf-8"))
    except Exception as e:
        print(f"⚠️ Error reading keeper state: {e}")
        return

    backlog = state.get("backlog", {})

    # Нормализуем done_items: папки должны заканчиваться на /
    done_set = set()
    for item in done_items:
        item = item.rstrip("/")
        # Проверяем, это папка или файл
        item_path = ROOT_DIR / item
        if item_path.is_dir():
            done_set.add(item + "/")
        else:
            done_set.add(item)

    # Удаляем из files
    files = set(backlog.get("files", []))
    removed_files = files & done_set
    backlog["files"] = sorted(list(files - done_set))

    # Удаляем секции целиком (Keeper всегда обрабатывает секцию полностью)
    sections = backlog.get("sections", {})
    removed_sections = []

    for item in done_set:
        if item.endswith("/"):
            # Нормализуем: "apps/host/" → "apps/host", "./" → "."
            key = item.rstrip("/") or "."
            if key in sections:
                removed_sections.append(item)
                del sections[key]

    backlog["sections"] = sections
    state["backlog"] = backlog

    # Сохраняем
    KEEPER_STATE_FILE.write_text(
        json.dumps(state, ensure_ascii=False, indent=4),
        encoding="utf-8"
    )

    total_removed = len(removed_files) + len(removed_sections)
    if total_removed > 0:
        print(f"🗑️  Removed from backlog: {total_removed} items ({len(removed_files)} files, {len(removed_sections)} sections)")


def update_metadata(t_start: datetime) -> None:
    """Обновляет last_commit и updated_at в keeper_state."""
    if not KEEPER_STATE_FILE.exists():
        return

    try:
        state = json.loads(KEEPER_STATE_FILE.read_text(encoding="utf-8"))
    except Exception as e:
        print(f"⚠️ Error reading keeper state: {e}")
        return

    head = get_head_commit()
    if head:
        state["last_commit"] = head

    # ISO 8601 формат с Z (UTC)
    state["updated_at"] = t_start.strftime("%Y-%m-%dT%H:%M:%SZ")

    KEEPER_STATE_FILE.write_text(
        json.dumps(state, ensure_ascii=False, indent=4),
        encoding="utf-8"
    )
    print(f"📌 Metadata updated: last_commit={head[:7] if head else 'N/A'}, updated_at={state['updated_at']}")


def main(done_items: List[str] = None):
    """
    Основной алгоритм (по спеке backlog_update_spec.md):
    1. Фиксируем время старта (T_start) для updated_at
    2. Сканируем текущее состояние (doc_updater + git_updater делают union)
    3. Если есть --done, удаляем файлы из backlog
    4. Обновляем метаданные (last_commit = HEAD, updated_at = T_start)

    Формула: backlog = (existing ∪ current_scan) - done_files

    Порядок Scan → Remove гарантирует, что файлы помеченные как --done
    не будут добавлены обратно из-за mtime (т.к. updated_at сдвинется вперёд).
    """
    print("=" * 50)
    print("🔄 Backlog Update")
    print("=" * 50)

    # 1. Фиксируем время старта
    t_start = datetime.now(timezone.utc)
    print(f"\n⏱️  T_start: {t_start.strftime('%Y-%m-%dT%H:%M:%SZ')}")

    # 2. Сканируем текущее состояние (union с existing backlog)
    print("\n📂 Running doc_updater...")
    run_script("ai_doc_updater.py")

    print("\n📜 Running git_updater...")
    run_script("ai_git_updater.py")

    # 3. Удаляем завершённые элементы ПОСЛЕ скана
    if done_items:
        print(f"\n✅ Processing --done: {done_items}")
        remove_from_backlog(done_items)

    # 4. Обновляем метаданные
    print("\n📌 Updating metadata...")
    update_metadata(t_start)

    print("\n" + "=" * 50)
    print("✅ Backlog update complete")
    print("=" * 50)


if __name__ == "__main__":
    # Парсим аргументы: --done file1 file2 ...
    done_items = []
    if "--done" in sys.argv:
        idx = sys.argv.index("--done")
        done_items = sys.argv[idx + 1:]

    main(done_items)
