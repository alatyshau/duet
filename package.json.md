# package.json

ЧТО: Корневой манифест монорепо Duet.

ЗАЧЕМ: Определяет метаданные проекта, структуру монорепо и команды запуска.

КТО ИСПОЛЬЗУЕТ:
- `pnpm` — менеджер пакетов, читает этот файл для всех операций
- IDE — для понимания структуры проекта

---

## Поля

### name, version, description
```json
"name": "duet",
"version": "0.1.0",
"description": "Duet — Getting Products Done"
```

Метаданные проекта. Используются при публикации в npm (мы не публикуем) и для идентификации.

### private
```json
"private": true
```

Запрещает случайную публикацию в npm. Для монорепо всегда `true`.

### workspaces
```json
"workspaces": ["apps/*", "packages/*"]
```

Определяет структуру монорепо. Говорит pnpm где искать под-пакеты:
- `apps/*` — приложения (Electron, VS Code extension, ...)
- `packages/*` — библиотеки (shared код между приложениями)

Каждый под-пакет имеет свой `package.json` со своим `name` (например `@duet/host`).

Подробнее: https://pnpm.io/workspaces

### scripts
```json
"scripts": {
  "dev:host": "pnpm --filter @duet/host dev",
  "build:host": "pnpm --filter @duet/host build"
}
```

Именованные команды (алиасы). Вместо длинной команды пишешь короткую:
```bash
pnpm dev:host    # вместо: pnpm --filter @duet/host dev
```

Разбор `pnpm --filter @duet/host dev`:
- `--filter @duet/host` — выбрать пакет с именем `@duet/host` (из `apps/host/package.json`)
- `dev` — выполнить скрипт `dev` из того пакета

Подробнее о scripts: https://docs.npmjs.com/cli/v10/using-npm/scripts
Подробнее о --filter: https://pnpm.io/filtering

### packageManager
```json
"packageManager": "pnpm@10.27.0"
```

Фиксирует версию pnpm для проекта. Corepack (встроен в Node.js) автоматически использует эту версию.

Подробнее: https://nodejs.org/api/corepack.html

---

## Структура монорепо
```
Duet/
├── package.json              ← ТЫ ЗДЕСЬ
├── apps/
│   ├── host/                 ← @duet/host (Electron приложение)
│   ├── vscode/               ← @duet/vscode (VS Code расширение, позже)
│   └── ai-instructions/      ← legacy проект
└── packages/
    ├── core/                 ← @duet/core (общая логика, позже)
    └── mcp-server/           ← @duet/mcp-server (MCP сервер, позже)
```

---

## Частые команды
```bash
pnpm install      # установить все зависимости всех пакетов
pnpm dev:host     # запустить Electron в dev-режиме
pnpm build:host   # собрать Electron приложение
```
