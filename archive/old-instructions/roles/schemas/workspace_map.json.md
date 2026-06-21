# Схема: workspace_map.json

ЧТО: Мастер-план структуры репозитория.
ЗАЧЕМ: Определяет какие папки являются "Секциями" и порядок их отображения в карте.
ИСПОЛЬЗОВАНИЕ: `packages/ai-kit/scripts/ai_doc_updater.py`, Principal.

---

## Расположение

`.ai/workspace_map.json`

---

## Структура

```json
{
    "_DOC": {
        "ЧТО": "Мастер-план структуры (Flat List Architecture).",
        "ЗАЧЕМ": "Определяет порядок секций в карте.",
        "ИСПОЛЬЗОВАНИЕ": "packages/ai-kit/scripts/ai_doc_updater.py, Principal",
        "СПЕКА": ".ai/schemas/workspace_map.json.md"
    },
    "target_file": "docs/WORKSPACE_MAP.md",
    "ignore_patterns": [ ... ],
    "section_folders": [ ... ]
}
```

---

## Поля

### `target_file`
Путь к генерируемой карте. По умолчанию `docs/WORKSPACE_MAP.md`.

### `ignore_patterns`
Список исключений при сканировании.

| Тип | Формат | Пример |
|-----|--------|--------|
| Папка | Заканчивается на `/` | `node_modules/`, `dist/` |
| Файл | Без слэша | `.DS_Store`, `*.log` |

### `section_folders`
Список путей к секциям в порядке отображения.

```json
"section_folders": [
    "packages/host",
    "packages/extension",
    "packages/backend",
    "docs"
]
```

---

## Терминология

### Section Folder (Секция)
Папка, **явно** указанная в `section_folders`.

**Смысл**: Крупный архитектурный узел (Модуль/Компонент).

- Имеет право на свой `section.json` (паспорт)
- В карте выделяется как заголовок (Header)

**Разделение ответственности:**
- **Principal** определяет какие папки являются секциями
- **Keeper** создаёт и наполняет `section.json`

### Thin Folder (Тонкая папка)
Любая папка **не** в списке, но внутри секции.

- Не имеет `section.json`
- Описывается через `folders` родительского `section.json`

### Ignored Folder (Игнорируемая папка)
Папка из `ignore_patterns` (напр. `node_modules/`, `dist/`).

- Содержимое **не сканируется**
- Сама папка **описывается** через `folders` родительского `section.json`
- Цель: не захламлять карту, но дать понять что папка существует
