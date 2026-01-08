#!/usr/bin/env python3
"""
ЧТО: Скрипт генерации отчета о состоянии Git (.ai/GIT_HISTORY.md).
ЗАЧЕМ: Предоставляет ИИ-агентам контекст о последних изменениях (commit history) и текущем "грязном" состоянии (uncommitted changes), чтобы уменьшить скоуп анализа.
КТО_ИСПОЛЬЗУЕТ: Keeper, Все агенты.
"""

import subprocess
import os
import json
from pathlib import Path
from typing import List, Set, Tuple, Dict

# Конфигурация
ROOT_DIR = Path(__file__).parent.parent.absolute()
OUTPUT_FILE = ROOT_DIR / ".ai" / "GIT_HISTORY.md"
MAX_COMMITS = 5

def run_git(args: List[str]) -> str:
    """Выполняет git-команду и возвращает stdout."""
    try:
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
    """
    Возвращает список файлов, которые изменены или добавлены (staged или unstaged).
    Игнорирует удалённые файлы.
    Использует git ls-files для untracked (получает файлы, не директории).
    """
    files = set()

    # Источник 1: Отслеживаемые файлы, которые изменены/staged (из status)
    output = run_git(["status", "--porcelain"])
    for line in output.splitlines():
        if not line: continue

        status = line[:2]
        path = line[3:].strip()

        # Пропускаем untracked (обрабатываются отдельно) и удалённые
        if status == '??' or 'D' in status:
            continue

        if "->" in path:
            path = path.split("->")[-1].strip()

        files.add(path)

    # Источник 2: Неотслеживаемые файлы (рекурсивно, отдельные файлы)
    untracked = run_git(["ls-files", "--others", "--exclude-standard"])
    for line in untracked.splitlines():
        if line.strip():
            files.add(line.strip())

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
                if current_commit:
                    commits.append(current_commit)
                
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
                    if 'D' in status:
                        continue
                    current_commit["files"].append(path)
    
    if current_commit:
        commits.append(current_commit)
        
    return commits

def get_agent_states() -> List[Dict]:
    """Сканирует .ai/ на *_state.json и возвращает дельты (история + uncommitted)."""
    states = []
    ai_dir = ROOT_DIR / ".ai"
    if not ai_dir.exists(): return []

    # 1. Получаем текущие "грязные" файлы (релевантны для всех)
    uncommitted = set(get_uncommitted_files())

    for f in ai_dir.glob("*_state.json"):
        try:
            data = json.loads(f.read_text(encoding="utf-8"))
            role = data.get("role", f.stem.replace("_state", "").title())
            last_commit = data.get("last_commit", "").strip()

            # Используем set для объединения уникальных файлов из обоих источников
            all_changes = set()

            # Источник A: История (с last_commit)
            if last_commit:
                # 1. Проверяем существование коммита (мог потеряться из-за rebase/squash)
                chk = subprocess.run(
                    ["git", "cat-file", "-e", last_commit],
                    cwd=ROOT_DIR,
                    capture_output=True
                )

                if chk.returncode != 0:
                    print(f"⚠️ Commit {last_commit} not found for {role}. Forcing full scan.")
                    last_commit = None  # Считаем как новый запуск
                else:
                    # 2. Получаем изменения
                    diff_out = run_git(["diff", "--name-only", f"{last_commit}..HEAD"])
                    if diff_out:
                        for l in diff_out.splitlines():
                            if l.strip():
                                all_changes.add(l.strip())

            # Источник B: "Грязные" файлы (всегда релевантны)
            all_changes.update(uncommitted)

            # Конвертируем в отсортированный список
            final_changes = sorted(list(all_changes))

            states.append({
                "role": role,
                "last_commit": last_commit,
                "changes": final_changes,
                "filename": f.name
            })
        except Exception as e:
            print(f"⚠️ Error reading state {f}: {e}")

    return states

def generate_markdown(uncommitted: List[str], commits: List[dict], agent_contexts: List[dict]) -> str:
    """Генерирует markdown-отчёт о состоянии Git."""
    lines = []
    lines.append("# Git History & Context")
    lines.append("")
    lines.append("> Auto-generated by `scripts/ai_git_updater.py`. Contains strictly Added/Modified files (Deleted files ignored).")
    lines.append("")

    # Сводка метаданных
    lines.append("## 📌 Summary")
    
    head_commit = commits[0] if commits else None
    if head_commit:
        head_val = f"`{head_commit['hash']}` ({head_commit['date']})"
    else:
        head_val = "Unknown"
        
    status_val = f"🚧 Dirty ({len(uncommitted)} uncommitted items)" if uncommitted else "✅ Clean"
    
    lines.append(f"- **HEAD**: {head_val}")
    lines.append(f"- **Status**: {status_val}")
    lines.append("")
    lines.append("---")
    lines.append("")

    # Контексты агентов
    if agent_contexts:
        lines.append("## 🤖 Agent Interaction Context")
        lines.append("")
        for ctx in agent_contexts:
            role = ctx['role']
            last = ctx['last_commit']
            changes = ctx['changes']
            
            if not last:
                lines.append(f"### {role}: ⚠️ Needs Full Scan")
            elif not changes:
                lines.append(f"### {role}: ✅ Up to date (Verified at `{last[:7]}`)")
            else:
                lines.append(f"### {role}: 🆕 {len(changes)} changes since last run (`{last[:7]}`)")
                for f in changes:
                    lines.append(f"- `{f}`")
            lines.append("")
        lines.append("---")
        lines.append("")

    # 1. Незакоммиченные изменения
    lines.append("## 🚧 Uncommitted Changes (Dirty State)")
    
    if not uncommitted:
        lines.append("_Working tree is clean._")
    else:
        lines.append(f"**{len(uncommitted)} files changed:**")
        for f in uncommitted:
            lines.append(f"- `{f}`")
            
    lines.append("")
    lines.append("---")
    lines.append("")

    # 2. Недавняя история
    lines.append(f"## 📜 Recent History (Last {len(commits)} Commits)")
    
    for c in commits:
        lines.append(f"### [`{c['hash']}`] {c['date']} — {c['message']}")
        lines.append(f"> By **{c['author']}**")
        
        if c['files']:
            lines.append("")
            for f in c['files']:
                lines.append(f"- `{f}`")
        else:
            lines.append("")
            lines.append("_No file changes (or only deletions)_")
            
        lines.append("")
        
    return "\n".join(lines)

if __name__ == "__main__":
    print("🔄 Scanning git history...")
    uncommitted = get_uncommitted_files()
    commits = get_recent_commits(MAX_COMMITS)
    agent_contexts = get_agent_states()
    
    md_content = generate_markdown(uncommitted, commits, agent_contexts)
    
    OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_FILE.write_text(md_content, encoding="utf-8")
    
    print(f"✅ Git history updated: {OUTPUT_FILE}")
