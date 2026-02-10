# Duet

> Getting Products Done — Дуэт между Человеком и ИИ

## Что это

Duet — система управления знаниями и делами, построенная на принципах:

1. **Данные принадлежат человеку** — всё хранится в Google Drive в вечных форматах (MD, CSV, PY), не в проприетарной базе данных
2. **Дуэт с ИИ** — глубокая интеграция с LLM через MCP (Model Context Protocol)
3. **GPD-онтология** — иерархия Предприятие → Дело → Продукт для организации всей жизни

## Проблема

Notion, Obsidian и подобные инструменты:
- Прячут данные в свои форматы/базы
- Плохо интегрируются с LLM
- Не дают ИИ полного контекста о ваших делах

## Решение
```
Google Drive (твои данные)          Duet (семантика)
────────────────────────────        ─────────────────
МетаЛаб/                            • Индексирует
├── ДЕЛА/                           • Понимает структуру
│   ├── ТехноЛаб/                   • MCP для LLM
│   │   └── ДЕЛА/                   • UI для управления
│   │       └── Duet/
│   └── ...
└── ...

        ↓
    Claude / GPT / Cursor
    "Какие у меня Big Rocks в ТехноЛаб?"
    → Знает ответ через MCP
```

## Архитектура

```
┌─────────────────┐     writes      ┌──────────────────┐
│  Host (Electron) │ ──────────────→ │ ~/.org.ve68.duet │
│  Tray app, UI    │                 │   (pointer file) │
└─────────────────┘                 └────────┬─────────┘
                                      reads  │  reads
                              ┌──────────────┴──────────────┐
                              ▼                              ▼
                   ┌──────────────────┐          ┌──────────────────┐
                   │ Extension (VSCode)│          │ Backend (Python)  │
                   │ UI, tree, scanner │          │ HTTP API + MCP    │
                   └──────────────────┘          └──────────────────┘
                              │          spawns           ▲
                              └──────────────────────────┘
```

## Структура монорепо

```
Duet/
├── apps/
│   └── host/                ← Electron tray app (Menu Bar)
├── packages/
│   ├── extension/           ← VS Code расширение
│   ├── backend/             ← Python HTTP API + MCP
│   └── ai-kit/              ← AI инструкции (modes, stances, skills, personas)
├── spec/
│   └── ECOSYSTEM.md         ← Общая спека экосистемы (читай ПЕРВЫМ)
└── projects/                ← GTD-проекты
```

Подробнее о каждом компоненте — см. `spec/` внутри пакета.

## Быстрый старт

### Требования

- Node.js 20+
- Python 3.10+
- Google Drive Desktop (для синхронизации DuetConfig)

### Установка

```bash
git clone https://github.com/alatyshau/duet.git
cd duet
npm install
```

### Первый запуск

1. Установить и запустить **Duet Host** — он создаст pointer file (`~/.org.ve68.duet`) с путями к DuetData и DuetConfig
2. Открыть VS Code → установить **Duet Extension** (VSIX) → Extension подхватит pointer и запустит Backend

## Ключевые концепции

### GPD-онтология

- **Предприятие** — большая область жизни (Работа, Семья, OpenSource)
- **Дело** — ongoing concern внутри предприятия
- **Продукт** — конкретный результат

Подробнее позже будет тут: [docs/gpd-ontology.md](docs/gpd-ontology.md)

### MCP интеграция

Duet запускает MCP Server, который позволяет Claude и другим LLM:
- Искать по вашей базе знаний
- Понимать контекст текущего дела
- Создавать задачи и заметки

Подробнее позже будет тут: [docs/mcp-integration.md](docs/mcp-integration.md)

## Разработка

```bash
# Host (Electron tray app)
npm run dev:host                              # dev-режим
cd apps/host && npm run release               # bump + build → dist/Duet-{ver}.dmg

# Extension (VS Code)
cd packages/extension && npm run vsix         # bump + build → dist/duet-{ver}.vsix

# Backend (Python)
cd packages/backend && ../../.venv/bin/pytest  # тесты

# Тесты всех компонентов
cd apps/host && npm run test:run              # Host: 15 тестов
cd packages/extension && npm test             # Extension: 112 тестов
cd packages/backend && ../../.venv/bin/pytest  # Backend: 157 тестов
```

### CI/CD

GitHub Actions автоматически билдит Host (macOS/Windows/Linux) при push в main.

## Документация

- [spec/ECOSYSTEM.md](spec/ECOSYSTEM.md) — общая спека экосистемы (читай ПЕРВЫМ)
- Спеки компонентов — `spec/` внутри каждого пакета

## Философия

> "Данные принадлежат человеку, не приложению"

Duet — это линза, не тюрьма:
- Duet удалён? Файлы остались (MD, CSV)
- Duet сломался? Открой в VS Code
- Duet не нравится? Напиши свой парсер

Vendor lock-in = 0

## Лицензия

MIT
