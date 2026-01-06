# package.json

ЧТО: Корневой манифест монорепо Duet.

ЗАЧЕМ: Определяет структуру монорепо и команды запуска.

КТО ИСПОЛЬЗУЕТ:
- `npm` — менеджер пакетов, читает этот файл для всех операций
- IDE — для понимания структуры

---

## Поля

### name, description
```json
"name": "duet",
"description": "Duet — Getting Products Done"
```

Метаданные монорепо. Используются для идентификации.

### version
```json
"version": "0.0.0"
```

Версия `0.0.0` — служебное значение, **ни на что не влияет**.

Корневой пакет `private: true`, поэтому не публикуется в npm.
Реальные версии — в каждом модуле отдельно:
- `apps/host/package.json` → версия Electron-приложения
- `apps/vscode/package.json` → версия VS Code расширения (будет)
- и т.д.

### private
```json
"private": true
```

Запрещает случайную публикацию в npm. Для монорепо всегда `true`.

### workspaces
```json
"workspaces": ["apps/*", "packages/*"]
```

Определяет структуру монорепо. Говорит npm где искать под-пакеты:
- `apps/*` — приложения (Electron, VS Code extension, ...)
- `packages/*` — библиотеки (shared код между приложениями)

Каждый под-пакет имеет свой `package.json` со своим `name` (например `duet-host`).

npm workspaces поднимает общие зависимости в корневой `node_modules` (hoisting),
что уменьшает дублирование.

Подробнее: https://docs.npmjs.com/cli/v10/using-npm/workspaces

### scripts
```json
"scripts": {
  "dev:host": "npm run dev --workspace=duet-host",
  "build:host": "npm run build --workspace=duet-host"
}
```

Именованные команды (алиасы). Вместо длинной команды пишешь короткую:
```bash
npm run dev:host    # вместо: npm run dev --workspace=duet-host
```

Разбор `npm run dev --workspace=duet-host`:
- `--workspace=duet-host` — выбрать пакет с именем `duet-host` (из `apps/host/package.json`)
- `dev` — выполнить скрипт `dev` из того пакета

Подробнее о scripts: https://docs.npmjs.com/cli/v10/using-npm/scripts
Подробнее о --workspace: https://docs.npmjs.com/cli/v10/using-npm/workspaces#running-commands-in-the-context-of-workspaces

---

## Структура монорепо
```
Duet/
├── package.json              ← ТЫ ЗДЕСЬ
├── node_modules/             ← общие зависимости (hoisted)
├── apps/
│   ├── host/                 ← duet-host (Electron приложение)
│   │   ├── package.json
│   │   └── node_modules/     ← симлинки на корневой node_modules
│   ├── vscode/               ← duet-vscode (VS Code расширение, позже)
│   └── ai-instructions/      ← legacy модуль
└── packages/
    ├── core/                 ← duet-core (общая логика, позже)
    └── mcp-server/           ← duet-mcp-server (MCP сервер, позже)
```

---

## Частые команды
```bash
npm install          # установить все зависимости всех пакетов
npm run dev:host     # запустить Electron в dev-режиме
npm run build:host   # собрать Electron приложение
```