# Схема: section.json

ЧТО: Паспорт секции (Section Folder).
ЗАЧЕМ: Мета-данные модуля для карты и навигации.
ИСПОЛЬЗОВАНИЕ: `packages/ai-kit/scripts/ai_doc_updater.py`, Keeper.

---

## Расположение

Внутри каждой Section Folder:
```
packages/host/section.json
packages/core/section.json
```

---

## Структура

```json
{
  "_DOC": {
    "ЧТО": "Мета-данные секции",
    "ИСПОЛЬЗОВАНИЕ": "packages/ai-kit/scripts/ai_doc_updater.py",
    "СПЕКА": ".ai/schemas/section.json.md"
  },
  "title": "Красивое название",
  "description": "Описание секции (ОБЯЗАТЕЛЬНО)",
  "emoji": "📦",
  "folders": {
     "src/main": "Описание вложенной папки"
  }
}
```

---

## Поля

### `title` (обязательно)
Человекочитаемое название секции для карты.

### `description` (обязательно)
Описание назначения секции. 1-3 предложения.

### `emoji` (опционально)
Иконка для визуального выделения в карте.

### `folders` (опционально)
Описания вложенных Thin Folders.

```json
"folders": {
   "src/main": "Главный процесс Electron",
   "src/renderer": "React UI",
   "src/preload": "Мост main↔renderer"
}
```

---

## Кто создаёт

- **Principal** определяет какие папки являются секциями (`workspace_map.json`)
- **Keeper** создаёт и наполняет `section.json`
