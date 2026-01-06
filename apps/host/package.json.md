# package.json

ЧТО: Манифест npm-пакета для Duet Host (Electron приложение).
ЗАЧЕМ: Определяет зависимости, скрипты сборки, метаданные пакета.
КТО ИСПОЛЬЗУЕТ: npm/node при установке и запуске.

---

## Ключевые поля

| Поле | Описание |
|------|----------|
| `name` | Имя пакета: `duet-host` (без `@` — иначе ломает пути на Windows) |
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
- `@electron-toolkit/preload`, `@electron-toolkit/utils` — утилиты для Electron
- `better-sqlite3` — SQLite база данных (нативный модуль)

**Dev** (`devDependencies`):
- `electron`, `electron-builder`, `electron-vite` — Electron toolchain
- `@electron/rebuild` — пересборка нативных модулей под Electron
- `react`, `react-dom` — UI фреймворк
- `typescript`, `vite` — сборка
- `eslint`, `prettier` — линтинг/форматирование
- `@electron-toolkit/*` — конфиги ESLint/TypeScript для Electron
