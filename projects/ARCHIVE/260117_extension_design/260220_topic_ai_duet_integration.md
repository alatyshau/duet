# [АРХИВ] Интеграция AI с Duet

**Архивировано:** 260220
**Причина:** Основные идеи реализованы в продукте. Живые идеи вынесены в бэклог.

---

## Что было сделано

### MCP tools для иерархии
Исходный план: три инструмента (`get_duet_data_location`, `get_hierarchy`, `find_entity`).

Реализовано (эволюционировало значительно):
- `duet_data_path` — путь к DuetData
- `workspace_info` — полная информация: цепочка business→stream→product, компоненты, алиасы, instructionsPath
- `streams` — все потоки (business, stream, product)
- `projects` — проекты для потока
- `scan` — пересканирование иерархии
- `health` — статус бэкенда

Архитектура тоже изменилась: MCP мигрировал с Extension SQLite на Backend HTTP API.

### Bootstrap для Claude Code
Решено через output styles (`~/.claude/output-styles/*.md`). Работает в продакшне.

### Исследование bootstrap-механизмов (Шаг 3)

| AI Агент | Bootstrap механизм | Расположение |
|----------|-------------------|--------------|
| Claude Code | Output styles | `~/.claude/output-styles/*.md` |
| VS Code Copilot | Custom Agents | User profile или `.github/agents/` |
| Cursor | Rules | `.cursorrules` |

Вывод: каждый AI требует отдельной процедуры настройки, нет универсального API.

### Проблема путей в multi-root workspace
Выявлены три контекста: (1) пути в инструкциях — от ai-kit root, (2) относительные markdown-ссылки — от текущего файла, (3) пути "от корня workspace" — к git-репо. В multi-root эвристика: `packages/`, `src/` → git-репо, не Drive.

---

## Контекст для понимания

Проблема: AI-агент не знает контекста "жизни как ОС" — иерархии бизнесов/дел/продуктов. Duet extension уже собирает эту информацию. Решение — дать AI доступ через MCP tools + bootstrap-инструкции.
