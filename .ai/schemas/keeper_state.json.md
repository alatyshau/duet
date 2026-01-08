# Схема: keeper_state.json

ЧТО: Состояние агента Keeper.
ЗАЧЕМ: Отслеживание прогресса и управление бэклогом задач.
КТО ИСПОЛЬЗУЕТ: Keeper, `scripts/ai_git_updater.py`.

---

## Расположение

`.ai/keeper_state.json`

---

## Структура

```json
{
    "_DOC": {
        "ЧТО": "Состояние Keeper",
        "КТО_ИСПОЛЬЗУЕТ": "Keeper, scripts/ai_git_updater.py"
    },
    "role": "keeper",
    "last_commit": "abc123...",
    "updated_at": "2025-01-08T12:00:00Z",
    "backlog": [
        "apps/host/components.json",
        "apps/host/section.json",
        "apps/ai-instructions/section.json"
    ]
}
```

---

## Поля

### `role`
Идентификатор роли. Всегда `"keeper"`.

### `last_commit`
SHA хеш последнего обработанного коммита.

Keeper записывает сюда `HEAD` после обработки всех файлов из `GIT_HISTORY.md`.
Скрипт использует это значение чтобы показывать только новые изменения.

### `updated_at`
ISO timestamp последнего обновления.

### `backlog` (опционально)
Массив путей к файлам для обработки. Backfill-очередь.

**Формат путей:**
- Обычный файл: `apps/host/components.json`
- Папка (через section.json): `apps/host/section.json`
- Файл-компаньон: основной файл (`package.json`), компаньон подразумевается

> Алгоритм работы с бэклогом — см. [keeper.md](../roles/keeper.md)

---

## Пример

```json
{
    "_DOC": {
        "ЧТО": "Состояние Keeper",
        "КТО_ИСПОЛЬЗУЕТ": "Keeper, scripts/ai_git_updater.py"
    },
    "role": "keeper",
    "last_commit": "76d6d9d",
    "updated_at": "2026-01-08T15:30:00Z",
    "backlog": [
        "apps/host/components.json",
        "drafts/section.json"
    ]
}
```