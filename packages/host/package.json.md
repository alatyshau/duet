# package.json

ЧТО: Манифест npm-пакета для Duet Host (Electron приложение).
ЗАЧЕМ: Определяет зависимости, скрипты сборки, метаданные пакета.
КТО ИСПОЛЬЗУЕТ: npm/node при установке и запуске.

---

## Ключевые поля

| Поле | Описание |
|------|----------|
| `name` | Имя пакета: `duet-host` (без `@` — иначе ломает пути на Windows) |
| `type` | `"module"` — используем ES modules (import/export вместо require) |
| `main` | Точка входа для Electron: `./out/main/index.js` |
| `scripts` | Команды npm (см. ниже) |

## Scripts

| Команда | Описание |
|---------|----------|
| `npm run dev` | Запуск в dev-режиме с HMR |
| `npm run start` | Запуск собранного приложения (electron-vite preview) |
| `npm run build` | Сборка (typecheck + electron-vite build) |
| `npm run build:mac` | Сборка .dmg для macOS |
| `npm run build:win` | Сборка .exe для Windows |
| `npm run build:linux` | Сборка AppImage/deb/snap для Linux |
| `npm run build:unpack` | Сборка без упаковки (для отладки) |
| `npm run lint` | Проверка кода ESLint |
| `npm run format` | Форматирование Prettier |
| `npm run typecheck` | Проверка типов TypeScript (node + web) |

### Lifecycle скрипты

| Команда | Когда запускается | Описание |
|---------|-------------------|----------|
| `postinstall` | После `npm install` | Пересобирает нативные модули под Electron (`electron-rebuild -v`) |

**Зачем postinstall?**

Нативные зависимости (C/C++/Rust) компилируются под конкретную версию Node.js.
Electron использует свою версию Node.js, поэтому нативные модули нужно пересобрать.

`electron-rebuild -v`:
- `-v` — verbose output, показывает прогресс (без этого выглядит как зависание)
- Автоматически находит нативные зависимости и пересобирает их
- Для модулей с prebuilt бинарниками (better-sqlite3) — скачивает готовый

## Dependencies

**Runtime** (`dependencies`):

| Пакет | Описание |
|-------|----------|
| `@electron-toolkit/preload` | Утилиты для preload-скриптов |
| `@electron-toolkit/utils` | Общие утилиты Electron |
| `better-sqlite3` | SQLite база данных (нативный модуль) |
| `@radix-ui/react-slot` | Примитив для shadcn/ui компонентов |
| `class-variance-authority` | Утилита для вариантов CSS классов (shadcn/ui) |
| `clsx` | Условное объединение CSS классов |
| `tailwind-merge` | Умное слияние Tailwind классов без конфликтов |
| `lucide-react` | Иконки (замена Heroicons/Feather) |

**Dev** (`devDependencies`):

| Пакет | Описание |
|-------|----------|
| `electron` | Electron runtime |
| `electron-builder` | Сборка дистрибутивов (DMG, EXE, AppImage) |
| `electron-vite` | Сборка с Vite для Electron |
| `@electron/rebuild` | Пересборка нативных модулей |
| `react`, `react-dom` | UI фреймворк |
| `typescript`, `vite` | Сборка и типизация |
| `tailwindcss` | CSS фреймворк (v4) |
| `@tailwindcss/postcss` | PostCSS плагин для Tailwind v4 |
| `postcss`, `autoprefixer` | CSS процессинг |
| `eslint`, `prettier` | Линтинг и форматирование |
| `@electron-toolkit/*` | ESLint/TypeScript конфиги для Electron |
| `@types/*` | TypeScript типы |
