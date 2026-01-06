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
┌─────────────────────────────────────────────────────────────────┐
│                    DUET HOST (Electron)                         │
│  • Висит в Menu Bar                                            │
│  • File Watcher — следит за изменениями                        │
│  • Индексация в SQLite + LanceDB                               │
│  • MCP Server для LLM                                          │
└─────────────────────────────────────────────────────────────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        ▼                     ▼                     ▼
   VS Code              Claude Desktop         Другие MCP
   Extension                                   клиенты
```

## Структура монорепо
```
Duet/
├── apps/
│   ├── host/                 ← Electron приложение (Menu Bar)
│   ├── vscode/               ← VS Code расширение
│   └── ai-instructions/      ← Legacy: AI инструкции
├── packages/
│   ├── core/                 ← Общая логика (парсеры, типы)
│   └── mcp-server/           ← MCP сервер
└── docs/                     ← Документация
```

Подробнее о каждом пакете — см. README.md внутри.

## Быстрый старт

### Требования

- Node.js 20+
- Google Drive Desktop (для синхронизации)

### Установка
```bash
# Клонировать / открыть проект
cd ~/Google\ Drive/.../Duet

# Установить зависимости
npm install

# Запустить Electron в dev-режиме
npm run dev:host
```

### Синхронизация с Google Drive (rclone)

Duet использует rclone вместо Google Drive Desktop для синхронизации — это позволяет исключить node_modules и другие временные файлы.

#### Первоначальная настройка
```bash
# Установить rclone
brew install rclone

# Настроить Google Drive
rclone config --config ~/DuetData/.duet/rclone.conf
# n → gdrive → drive → scope: 1 (Full access) → авторизация в браузере
```

#### Ручная синхронизация
```bash
cd ~/DuetData

# Скачать из облака (первый раз или обновить локальное)
rclone sync 'gdrive:!МетаЛаб/ДЕЛА/ТехноЛаб/ДЕЛА/Duet' Duet \
    --config .duet/rclone.conf \
    -v

# Загрузить в облако (после локальных изменений)
rclone sync Duet 'gdrive:!МетаЛаб/ДЕЛА/ТехноЛаб/ДЕЛА/Duet' \
    --exclude-from Duet/.duetignore \
    --config .duet/rclone.conf \
    -v

# Dry-run (проверить что будет сделано, без изменений)
# Добавь --dry-run к любой команде выше
```

#### Exclude patterns

При загрузке в облако исключаются:
- `.git/**` — git история (есть на GitHub)
- `node_modules/**` — npm зависимости (восстанавливаются через npm install)
- `dist/**` — билд артефакты
- `.turbo/**` — кэш Turborepo

#### Планируемая автоматизация

В будущем Duet Host будет автоматически:
- Upload: при изменении файлов (file watcher + debounce)
- Download: каждые 1-3 минуты

### Первый запуск

1. Duet спросит корневые папки ваших дел
2. Просканирует структуру

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
npm run dev:host      # Electron в dev-режиме
npm run build:host    # Сборка Electron
npm test              # Тесты (когда будут)
```

## Документация (ПОЗЖЕ)

- [CLAUDE.md](CLAUDE.md) — правила для ИИ-ассистентов
- [docs/architecture.md](docs/architecture.md) — подробная архитектура
- [docs/gpd-ontology.md](docs/gpd-ontology.md) — GPD методология

## Философия

> "Данные принадлежат человеку, не приложению"

Duet — это линза, не тюрьма:
- Duet удалён? Файлы остались (MD, CSV)
- Duet сломался? Открой в VS Code
- Duet не нравится? Напиши свой парсер

Vendor lock-in = 0

## Лицензия

MIT
