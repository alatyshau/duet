# package.json

ЧТО: Манифест npm-пакета для Duet Host (Electron приложение).
ЗАЧЕМ: Определяет зависимости, скрипты сборки, метаданные пакета.
КТО ИСПОЛЬЗУЕТ: npm/node при установке и запуске.

---

## Ключевые поля

| Поле | Описание |
|------|----------|
| `name` | Имя пакета: `@duet/host` (для npm workspaces) |
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

### Специальные скрипты (lifecycle)

| Команда | Когда запускается | Описание |
|---------|-------------------|----------|
| `postinstall` | Автоматически после `npm install` | Компилирует нативные зависимости под текущую версию Electron (`electron-builder install-app-deps`) |

## Dependencies

**Runtime** (`dependencies`):
- `@electron-toolkit/preload`, `@electron-toolkit/utils` — утилиты для Electron

**Dev** (`devDependencies`):
- `electron`, `electron-builder`, `electron-vite` — Electron toolchain
- `react`, `react-dom` — UI фреймворк
- `typescript`, `vite` — сборка
- `eslint`, `prettier` — линтинг/форматирование
- `@electron-toolkit/*` — конфиги ESLint/TypeScript для Electron
