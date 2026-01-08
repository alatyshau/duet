# Схема: WORKSPACE_MAP.md

ЧТО: Карта структуры репозитория.
ЗАЧЕМ: Навигация по проекту для людей и AI.
КТО ИСПОЛЬЗУЕТ: Разработчики, AI-агенты.

---

## Расположение

`docs/WORKSPACE_MAP.md` (настраивается в `workspace_map.json` → `target_file`)

---

## Структура

```markdown
# Workspace Map

> Автоматически сгенерировано. Не редактировать вручную.

## 📦 apps/host
Electron Menu Bar приложение

### Содержимое
- `src/main/` — Главный процесс
- `src/renderer/` — React UI
- ...

## 📦 packages/core
Общая логика

...
```

---

## Маркеры

### `[MISSING DOCS!]`
Указывает на файл/папку без документации.

```markdown
- `src/utils/` — [MISSING DOCS!]
```

**Действие**: Keeper должен создать документацию.

