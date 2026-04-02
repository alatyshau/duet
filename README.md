# Duet

Система управления знаниями и делами, построенная на дуэте Человека и ИИ.

## Принципы

1. **Данные принадлежат человеку** — всё хранится в Google Drive в вечных форматах (MD, CSV, PY), не в проприетарной базе данных
2. **Дуэт с ИИ** — глубокая интеграция с LLM через MCP (Model Context Protocol)
3. **Entity Hierarchy** — иерархия Business → Stream → Product для организации всей жизни

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
    Claude Code / Codex / Antigravity
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
├── packages/
│   ├── host/                ← Electron tray app (Menu Bar)
│   ├── extension/           ← VS Code расширение
│   └── backend/             ← Python HTTP API + MCP
├── spec/
│   └── PRODUCT.md           ← Спека продукта (читай ПЕРВЫМ)
└── projects/                ← GTD-проекты
```

AI-инструкции живут в отдельном репозитории **Duet-Instructions** (принадлежит пользователю, не продукту). Duet предоставляет платформенный bootstrapper и инструменты для работы с ними.

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
   1. На Маке: `sudo xattr -rd com.apple.quarantine /Applications/Duet.app`
2. Открыть VS Code → установить **Duet Extension** (VSIX) → Extension подхватит pointer и запустит Backend

## Ключевые концепции

### Entity Hierarchy

- **Business** — большая область жизни (МетаЛаб, Семья)
- **Stream** — ongoing concern внутри business (может вкладываться)
- **Product** — конкретный результат с git-репозиторием

### MCP + Orientation

Backend запускает MCP Server. AI-агенты вызывают `orientation()` при старте сессии — получают полный контекст: иерархию сущностей, каталог инструкций (персоны, скиллы), ключевые файлы, компоненты продукта.

### AI-инструкции

Инструкции для AI-агентов живут в отдельном репо **Duet-Instructions**, которым владеет пользователь. Duet компонует платформенный bootstrapper с пользовательскими инструкциями и конфигурирует три AI-клиента: Claude Code, Codex, Antigravity (Gemini).

### Reference Repos

Любая сущность может объявить `reference_repos` в манифесте — read-only клоны вспомогательных репозиториев (cookbook, документация и т.д.).

## Разработка

```bash
# Host (Electron tray app)
npm run dev:host                              # dev-режим
cd packages/host && npm run release               # bump + build → dist/Duet-{ver}.dmg

# Extension (VS Code)
cd packages/extension && npm run vsix         # bump + build → dist/duet-{ver}.vsix

# Backend (Python)
cd packages/backend && ../../.venv/bin/pytest  # тесты

# Тесты всех компонентов
cd packages/host && npm run test:run
cd packages/extension && npm test
cd packages/backend && ../../.venv/bin/pytest
```

### CI/CD

GitHub Actions автоматически билдит Host (macOS/Windows/Linux) при push в main.

## Документация

- [spec/PRODUCT.md](spec/PRODUCT.md) — спека продукта (читай ПЕРВЫМ)
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
