#!/usr/bin/env python3
"""
ЧТО: Скрипт генерации отчета о состоянии Git (.ai/GIT_HISTORY.md) и обновления бэклога Keeper.
ЗАЧЕМ: 
1. Предоставляет ИИ контекст о последних изменениях.
2. Добавляет изменённые файлы в очередь задач (backlog) Keeper'а, используя mtime как источник истины.
ИСПОЛЬЗОВАНИЕ: Keeper, backlog_updater.py.
"""

import subprocess
import os
import json
from pathlib import Path
from typing import List, Set
from datetime import datetime, timezone

# Импортируем утилиты (предполагаем, что они в той же папке scripts/)
try:
    from keeper_utils import load_keeper_state, save_keeper_state, ROOT_DIR, KEEPER_STATE_FILE
except ImportError:
    # Fallback если запуск не из корня или проблемы с путями
    # Пытаемся добавить текущую директорию в sys.path
    import sys
    sys.path.append(str(Path(__file__).parent))
    from keeper_utils import load_keeper_state, save_keeper_state, ROOT_DIR, KEEPER_STATE_FILE

# Конфигурация
OUTPUT_FILE = ROOT_DIR / ".ai" / "GIT_HISTORY.md"
MAX_COMMITS = 5

# Файлы, которые никогда не должны попадать в backlog (автогенерируемые или служебные)
IGNORED_FILES = {
    ".ai/GIT_HISTORY.md",
    ".ai/INSTRUCTIONS.md",
    ".ai/keeper_state.json",
    "docs/WORKSPACE_MAP.md",
    "AGENTS.md",
    "CLAUDE.md",
    "GEMINI.md",
}

# Паттерны по имени файла (basename) — исключаются везде
IGNORED_BASENAMES = {
    "section.json",  # Паспорта секций обрабатываются через механизм секций, не файлов
}

# Префиксы папок — содержимое не обрабатывается Keeper (но показывается в WORKSPACE_MAP)
IGNORED_PREFIXES = {
    ".ai/",      # AI-инфраструктура управляется ai-kit, не Keeper
    "drafts/",   # Черновики — временные файлы, не требуют документирования
}

def run_git(args: List[str]) -> str:
    """Выполняет git-команду и возвращает stdout."""
    try:
        # core.quotepath=false — чтобы кириллица и спецсимволы в путях не экранировались
        result = subprocess.run(
            ["git", "-c", "core.quotepath=false"] + args,
            cwd=ROOT_DIR,
            capture_output=True,
            text=True,
            check=True
        )
        return result.stdout.rstrip()
    except subprocess.CalledProcessError as e:
        # Не выводим ошибку для пустого diff или невалидного range (обрабатывается позже)
        return ""

def get_uncommitted_files() -> List[str]:
    """Возвращает список файлов (staged + unstaged), кроме удалённых."""
    files = set()
    output = run_git(["status", "--porcelain"])
    for line in output.splitlines():
        if not line: continue
        status = line[:2]
        path = line[3:].strip()
        if status == '??' or 'D' in status: continue  # Untracked handled separately, deleted ignored
        if "->" in path: path = path.split("->")[-1].strip()  # Rename: берём новое имя
        files.add(path)

    untracked = run_git(["ls-files", "--others", "--exclude-standard"])
    for line in untracked.splitlines():
        if line.strip(): files.add(line.strip())

    return sorted(list(files))

def get_recent_commits(limit: int) -> List[dict]:
    """Возвращает последние коммиты со статистикой файлов."""
    cmd = [
        "log", 
        f"-n {limit}", 
        "--pretty=format:COMMIT_START|%h|%an|%ad|%s",
        "--date=short",
        "--name-status"
    ]
    
    output = run_git(cmd)
    
    commits = []
    current_commit = None
    
    for line in output.splitlines():
        if not line.strip(): continue

        if line.startswith("COMMIT_START|"):
            parts = line.split("|")
            if len(parts) >= 5:
                if current_commit: commits.append(current_commit)
                current_commit = {
                    "hash": parts[1],
                    "author": parts[2],
                    "date": parts[3],
                    "message": "|".join(parts[4:]),
                    "files": []
                }
        else:
            if current_commit:
                parts = line.split(maxsplit=1)
                if len(parts) == 2:
                    status, path = parts
                    if 'D' in status: continue
                    current_commit["files"].append(path)
    
    if current_commit: commits.append(current_commit)
    return commits

def generate_markdown(uncommitted: List[str], commits: List[dict]) -> str:
    """Генерирует markdown-отчёт о состоянии Git, без контекста агентов."""
    lines = []
    lines.append("<!-- GENERATED FILE — DO NOT EDIT MANUALLY")
    lines.append("     Source: packages/ai-kit/scripts/ai_git_updater.py")
    lines.append("     Script: python packages/ai-kit/scripts/ai_git_updater.py")
    lines.append("     ")
    lines.append("     All changes must be made via git operations, then regenerated. -->")
    lines.append("")
    lines.append("# Git History & Context")
    lines.append("")
    lines.append("")

    head_commit = commits[0] if commits else None
    head_val = f"`{head_commit['hash']}` ({head_commit['date']})" if head_commit else "Unknown"
    status_val = f"🚧 Dirty ({len(uncommitted)} uncommitted items)" if uncommitted else "✅ Clean"
    
    lines.append("## 📌 Summary")
    lines.append(f"- **HEAD**: {head_val}")
    lines.append(f"- **Status**: {status_val}")
    lines.append("")
    lines.append("---")
    lines.append("")

    lines.append("## 🚧 Uncommitted Changes (Dirty State)")
    if not uncommitted:
        lines.append("_Working tree is clean._")
    else:
        lines.append(f"**{len(uncommitted)} files changed:**")
        for f in uncommitted: lines.append(f"- `{f}`")
    lines.append("")
    lines.append("---")
    lines.append("")

    lines.append(f"## 📜 Recent History (Last {len(commits)} Commits)")
    for c in commits:
        lines.append(f"### [`{c['hash']}`] {c['date']} — {c['message']}")
        lines.append(f"> By **{c['author']}**")
        if c['files']:
            lines.append("")
            for f in c['files']: lines.append(f"- `{f}`")
        else:
            lines.append("")
            lines.append("_No file changes (or only deletions)_")
        lines.append("")
        
    return "\n".join(lines)

# --- Keeper Backlog Logic ---

def commit_exists(commit_hash: str) -> bool:
    """Проверяет существует ли коммит в репозитории."""
    if not commit_hash: return False
    res = subprocess.run(
        ["git", "cat-file", "-e", commit_hash],
        cwd=ROOT_DIR,
        capture_output=True
    )
    return res.returncode == 0

def get_git_diff_files(since_commit: str) -> Set[str]:
    """Возвращает файлы, изменённые с since_commit до HEAD."""
    files = set()
    output = run_git(["diff", "--name-only", f"{since_commit}..HEAD"])
    for line in output.splitlines():
        if line.strip(): files.add(line.strip())
    # Также добавляем файлы, которые есть в uncommitted (они всегда 'fresh')
    # хотя логика фильтрации mtime всё равно всё проверит, но нужно добавить их в список кандидатов
    return files

def get_all_repo_files() -> Set[str]:
    """Возвращает все текстовые файлы в репо (Full Scan source)."""
    files = set()
    output = run_git(["ls-files"])
    for line in output.splitlines():
        if line.strip(): files.add(line.strip())
    return files

def filter_by_mtime(candidates: Set[str], updated_at_iso: str) -> List[str]:
    """
    Фильтрует список файлов, оставляя только те, у которых mtime > updated_at.
    Если updated_at пуст, возвращает всё (Initial Scan).
    """
    if not updated_at_iso:
        return sorted(list(candidates))

    # Парсим updated_at
    # Python 3.7+ fromisoformat не всегда парсит 'Z', но 3.11 ок. 
    # Формат 'YYYY-MM-DDTHH:MM:SSZ' или с оффсетом.
    # Если строка пустая - уже вернули всё выше.
    try:
        # Для совместимости заменяем Z на +00:00
        iso_str = updated_at_iso.replace("Z", "+00:00")
        threshold_dt = datetime.fromisoformat(iso_str)
        threshold_ts = threshold_dt.timestamp()
    except Exception as e:
        print(f"⚠️ Error parsing updated_at '{updated_at_iso}': {e}. Treating as full scan.")
        return sorted(list(candidates))

    filtered = []
    for rel_path in candidates:
        full_path = ROOT_DIR / rel_path
        if not full_path.exists(): continue
        
        try:
            mtime = full_path.stat().st_mtime
            if mtime > threshold_ts:
                filtered.append(rel_path)
        except Exception:
            pass # ignore errors

    return sorted(filtered)

def update_backlog() -> None:
    """
    Обновляет backlog Keeper'а изменёнными файлами.

    Алгоритм:
    1. Определяет режим (Full Scan или Normal)
    2. Собирает кандидатов (git diff + uncommitted)
    3. Фильтрует по mtime > updated_at
    4. Мержит с существующим backlog (union)
    """
    state = load_keeper_state()
    last_commit = state.get("last_commit", "").strip()
    updated_at = state.get("updated_at", "").strip()
    
    candidates = set()
    mode = "UNKNOWN"

    # 1. Определяем режим
    if not last_commit or not commit_exists(last_commit):
        mode = "FULL SCAN (No commit anchor)"
        candidates = get_all_repo_files()
        candidates.update(get_uncommitted_files())  # untracked тоже нужны
    else:
        mode = "NORMAL MODE"
        # Diff candidates
        candidates = get_git_diff_files(last_commit)
        # + Uncommitted candidates (always check them)
        candidates.update(get_uncommitted_files())

    # 2. Фильтрация
    # Exclude self-generated/ignored files from candidates
    def is_ignored(path: str) -> bool:
        if path in IGNORED_FILES:
            return True
        if Path(path).name in IGNORED_BASENAMES:
            return True
        for prefix in IGNORED_PREFIXES:
            if path.startswith(prefix):
                return True
        return False

    candidates = {c for c in candidates if not is_ignored(c)}

    print(f"🔍 Mode: {mode}. Candidates: {len(candidates)}. Threshold: {updated_at or 'NONE'}")
    changed = filter_by_mtime(candidates, updated_at)

    # 3. Обновление (Union) + очистка legacy
    backlog = state.get("backlog", {})
    existing = set(backlog.get("files", []))

    # Фильтруем существующие файлы тоже (очистка legacy записей)
    existing_cleaned = {f for f in existing if not is_ignored(f)}
    removed_count = len(existing) - len(existing_cleaned)

    if changed:
        merged = existing_cleaned | set(changed)
    else:
        merged = existing_cleaned

    backlog["files"] = sorted(list(merged))
    state["backlog"] = backlog
    save_keeper_state(state)

    if changed or removed_count:
        msg_parts = []
        if changed:
            msg_parts.append(f"+{len(changed)} new")
        if removed_count:
            msg_parts.append(f"-{removed_count} ignored")
        print(f"✅ Backlog updated: {', '.join(msg_parts)}. Total: {len(merged)}")
    else:
        print("✅ Backlog updated: No changes.")

if __name__ == "__main__":
    print("🔄 Generating GIT_HISTORY.md...")
    uncommitted = get_uncommitted_files()
    commits = get_recent_commits(MAX_COMMITS)
    md_content = generate_markdown(uncommitted, commits)
    
    OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_FILE.write_text(md_content, encoding="utf-8")
    print(f"📄 Report saved to {OUTPUT_FILE}")

    print("🔄 Updating Keeper Backlog...")
    update_backlog()