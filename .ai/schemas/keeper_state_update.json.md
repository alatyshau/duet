# Схема: keeper_state.json

ЧТО: Состояние агента Keeper.
ЗАЧЕМ: Отслеживание прогресса и управление бэклогом задач.
КТО ИСПОЛЬЗУЕТ: Keeper, `scripts/ai_doc_updater.py`, `scripts/ai_git_updater.py`, `scripts/backlog_update.py`.

---

## Расположение

`.ai/keeper_state.json`

---

## Структура

```json
{
    "_DOC": {...},
    "role": "keeper",
    "last_commit": "09a9c68",
    "updated_at": "2026-01-09T12:30:00Z",
    "backlog": {
        "sections": {
            ".": ["scripts/"],
            "apps/host": ["apps/host/src/components/"]
        },
        "files": [
            "scripts/new_script.py",
            "apps/host/src/main/index.ts"
        ]
    }
}
```

- `_DOC` — генерируется в `keeper_utils.py`
- `sections` — папки с `[MISSING DOCS!]`, сгруппированные по родительской секции (см. [workspace_map.json.md](workspace_map.json.md))
- `files` — файлы с `[MISSING DOCS!]` или изменённые (по mtime)

---

## Поля

### `role`
Идентификатор роли. Всегда `"keeper"`.

### `last_commit`
SHA хеш последнего обработанного коммита.

Используется как якорь для `git diff` — скрипт `ai_git_updater.py` ищет изменения между `last_commit..HEAD`.

### `updated_at`
ISO 8601 timestamp (UTC) последнего обновления.

**Формат:** `YYYY-MM-DDTHH:MM:SSZ`

Используется для фильтрации файлов по mtime — файлы с `mtime <= updated_at` считаются "уже обработанными" и не попадают в backlog.

### `backlog`
Структурированная очередь задач для Keeper.

#### `backlog.sections`
Объект, где ключ — parent section (из `workspace_map.json`), значение — массив папок без документации.

**Формат путей:** Папки всегда с trailing `/` (`scripts/__pycache__/`).

**Источник:** `ai_doc_updater.py` — находит папки с `[MISSING DOCS!]` в `WORKSPACE_MAP.md`.

#### `backlog.files`
Массив файлов для обработки (без trailing `/`).

**Источники:**
- `ai_doc_updater.py` — файлы с `[MISSING DOCS!]`
- `ai_git_updater.py` — изменённые файлы (по mtime)

**Union:** Оба скрипта добавляют файлы через union — существующие не теряются.

---

## Исключения

Следующие файлы **никогда не попадают** в backlog (автогенерируемые):
- `.ai/GIT_HISTORY.md`
- `.ai/keeper_state.json`
- `docs/WORKSPACE_MAP.md`

---

## Trailing / конвенция

- Папки **всегда** с `/` в конце: `scripts/`, `.github/`
- Файлы **никогда** с `/`: `apps/host/src/main/index.ts`

