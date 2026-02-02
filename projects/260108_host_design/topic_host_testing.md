# Host Cleanup & Unit Testing

**Статус:** в работе

---

## МОТИВАЦИЯ

**Главная цель:** Чистая, модульная структура Host с unit-тестами.

Перед E2E тестами нужно:
1. Удалить устаревший код (sync, rclone)
2. Модуляризировать — разбить на testable модули
3. Покрыть core/ unit-тестами

**Путь к полному тестированию:**
1. ~~Очистить~~ — удалить устаревший код ✅
2. ~~Модуляризировать~~ — разбить на testable модули ✅
3. ~~Unit-тесты~~ — покрыть core/ ✅
4. **E2E тесты** — см. [topic_host_e2e.md](topic_host_e2e.md)

---

## ССЫЛКИ

- [apps/host/src/main/index.ts](../../apps/host/src/main/index.ts) — entry point (~90 lines после рефакторинга)
- [topic_host_core.md](topic_host_core.md) — зависит от этого топика
- [topic_host_e2e.md](topic_host_e2e.md) — E2E тесты (выделено в отдельный топик)

---

## НАРРАТИВ

### Исходная структура

```
apps/host/src/
├── main/
│   └── index.ts          # 420 lines — ВСЁ здесь
├── preload/
│   ├── index.ts          # 64 lines — ok
│   └── index.d.ts        # типы
└── renderer/src/
    ├── App.tsx           # 104 lines — содержит case 'sync'
    ├── pages/
    │   └── SetupPage.tsx # 129 lines — содержит rclone заглушку
    ├── components/
    │   ├── layout/
    │   │   ├── Layout.tsx    # 35 lines — ok
    │   │   └── Sidebar.tsx   # 84 lines — содержит sync page
    │   ├── ui/
    │   │   └── button.tsx    # shadcn — ok
    │   └── Versions.tsx      # 23 lines — удалить
    └── lib/
        └── utils.ts      # cn() — ok
```

### Что удалено

| Файл | Строки | Что |
|------|--------|-----|
| `Sidebar.tsx` | 25 | `{ id: 'sync', label: 'Статус синхронизации' }` |
| `SetupPage.tsx` | 106-119 | Заглушка "Синхронизация с облаком / rclone" |
| `SetupPage.tsx` | 122-125 | Подсказка про Google Drive |
| `App.tsx` | 84 | `case 'sync': return <div>...` |
| `Versions.tsx` | всё | Boilerplate, не используется |

### Целевая структура

```
apps/host/src/
├── core/                  # ← Pure functions, unit-тесты
│   ├── config.ts          # read/write config.json
│   └── app-state.ts       # логика определения статуса
├── main/                  # Electron-specific, E2E-тесты
│   ├── index.ts           # Entry point, склейка
│   ├── window.ts          # BrowserWindow management
│   └── ipc-handlers.ts    # IPC handlers registry
├── platform/              # ⚠️ Только ручные тесты
│   ├── README.md          # Инструкция по ручному тестированию
│   ├── tray.ts            # Tray icon, menu, tooltip
│   └── autolaunch.ts      # Автозапуск при старте системы
├── preload/               # Мост main↔renderer (безопасность)
└── renderer/              # React UI
```

**Принципы:**
- `core/` — pure functions, не требуют `electron` import
- `main/` — Electron-specific, покрыто E2E
- `platform/` — системные интеграции, Playwright не видит → ручные тесты

Зеркалит структуру Extension (`packages/extension/src/core/`).

### Будущие модули (Фазы 2-3)

При реализации [topic_host_core.md](topic_host_core.md) и [topic_host_integrations.md](topic_host_integrations.md) в `src/core/` добавятся:

| Фаза | Модуль | Что делает |
|------|--------|------------|
| 2 | `backend-lifecycle.ts` | spawn/kill backend процесса |
| 2 | `state-file.ts` | read/write `state.json` |
| 2 | `health-check.ts` | HTTP ping к backend |
| 3 | `mcp-installer.ts` | редактирование конфигов AI-клиентов |

### Виды тестов

| Вид | Что | Файл |
|-----|-----|------|
| **Unit** | config: read/write JSON | `__tests__/unit/core/config.test.ts` |
| **Unit** | app-state: status transitions | `__tests__/unit/core/app-state.test.ts` |
| **Unit** | config + app-state flow | `__tests__/unit/core/core-flow.test.ts` |
| **E2E** | приложение запускается, окно работает | см. [topic_host_e2e.md](topic_host_e2e.md) |
| **Ручные** | tray, autolaunch | `platform/README.md` — инструкция |
| **Integration** | backend lifecycle (topic_host_core) | *будет позже* |

**Разделение по папкам:**
- `core/` — unit-тесты (включая flow тесты нескольких модулей)
- `main/` — E2E-тесты (см. [topic_host_e2e.md](topic_host_e2e.md))
- `platform/` — только ручные тесты (Playwright не видит системный трей)

**Примечание:** Integration тесты (с реальным backend процессом) появятся в topic_host_core.

### Принятые решения

#### 1. Структура тестов (separation)

Тесты отдельно от кода (Java-стиль), масштабируется на 300+ тестов:

```
apps/host/
├── src/                          # Исходники
│   ├── core/                     # ← unit-тесты
│   ├── main/                     # ← E2E-тесты
│   ├── platform/                 # ← ⚠️ только ручные тесты
│   ├── preload/
│   └── renderer/
│
├── __tests__/                    # Все автотесты
│   ├── unit/                     # Unit тесты (включая flow)
│   │   └── core/
│   │       ├── config.test.ts
│   │       ├── app-state.test.ts
│   │       └── core-flow.test.ts
│   └── helpers/                  # Test utilities
│       ├── index.ts              # re-export
│       └── fs.ts                 # tmp dir helpers
│
├── e2e/                          # E2E тесты (см. topic_host_e2e.md)
│   └── app-launch.spec.ts
│
├── vitest.config.ts              # unit
└── wdio.conf.ts                  # e2e
```

#### 2. Test runner

- **Unit + Integration:** Vitest
- **E2E:** WebdriverIO с `wdio-electron-service` (см. [topic_host_e2e.md](topic_host_e2e.md))
- Тестируем `src/core/` как обычный Node.js код

#### 3. Пути и tmp директории

- `process.env.DUET_CONFIG_DIR` — переопределяет путь к config dir в тестах
- Каждый тест создаёт свой tmp dir в `os.tmpdir()`
- Cleanup в `afterEach` через helper функцию
- **Vitest НЕ чистит автоматически** — cleanup явный

#### 4. Test helpers

`__tests__/helpers/fs.ts` содержит:
- `createTestContext()` — создаёт tmp dir, configDir, duetDataDir
- `cleanup()` — удаляет tmp dir
- `writeTestConfig()` — пишет config.json в tmp

#### 5. fs операции

Real fs + tmp dir. Моки не нужны — операции простые, real fs надёжнее.

#### 6. Папка platform/ — консервация

**Весь непокрываемый код в отдельной папке:**

```
platform/
├── README.md       # Инструкция по ручному тестированию
├── tray.ts         # Системный трей
└── autolaunch.ts   # Автозапуск
```

**Правила:**
- Playwright не видит системный трей → автотесты невозможны
- Перед изменением любого файла в `platform/` — ручной тест на Mac + Windows
- `README.md` содержит чеклист что проверять
- После проверки — не трогать без необходимости

#### 7. Структура resources/

Иконки разделены по назначению и платформе:

```
resources/
├── tray/
│   ├── mac/
│   │   ├── trayTemplate.png
│   │   ├── trayTemplate@2x.png
│   │   ├── trayWarningTemplate.png
│   │   └── trayWarningTemplate@2x.png
│   └── win/
│       ├── tray.ico
│       └── tray-warning.ico
│
└── app/
    ├── icon.svg
    └── icon.png
```

**Принцип:** Подпапки по платформе, не ломаем соглашение macOS про `*Template.png`.

#### 8. UI тесты React

Отложены до Фазы 2 (topic_host_core.md). Вернуться когда появится backend status в UI.

---

## ОТКРЫТЫЕ ВОПРОСЫ

*Нет открытых вопросов — unit-тесты завершены.*

---

## ВЫХОДЫ

### После cleanup

**Остаётся функционал:**
- Tray icon (normal/warning по статусу)
- Tray menu (Открыть, Автозапуск, Выйти)
- Окно с SetupPage (выбор папки DuetData)
- AppState: `no_config | path_lost | ready`
- Config: `~/.org.ve68.duet/config.json`

**Удалено:**
- Sync page
- rclone заглушки
- Versions компонент

---

## ПЛАН ВНЕДРЕНИЯ

### Постановка задачи

**Scope:** Cleanup + модуляризация + unit-тесты для Host.

**Контекст:** Подготовка к E2E тестам (см. [topic_host_e2e.md](topic_host_e2e.md)).

### Критерии завершённости

**Выполнено:**
- [x] Удалён устаревший код (sync, rclone, Versions)
- [x] Структура src/: core/, main/, platform/
- [x] Структура resources/: tray/mac/, tray/win/, app/
- [x] Unit тесты: config.ts, app-state.ts (15 тестов)
- [x] Build работает: npm run build, start, build:unpack
- [x] CI: GitHub Actions запускает unit тесты
- [x] Приложение работает как раньше

**В процессе:**
- [ ] platform/ проверен вручную на Mac + Windows
- [ ] CI билд exe работает (build-host.yml)

### Шаг 1: Cleanup + Модуляризация

**Статус:** DONE

Весь рефакторинг структуры кода и ресурсов.

**Ход работы:**
- [x] Удалить устаревший код
  - [x] Sidebar.tsx: удалить sync из navItems
  - [x] SetupPage.tsx: удалить заглушку rclone
  - [x] App.tsx: удалить case 'sync'
  - [x] Удалить Versions.tsx
- [x] Создать `src/core/`
  - [x] config.ts (DUET_CONFIG_DIR, readConfig, writeConfig, типы)
  - [x] app-state.ts (AppStatus, AppState, checkAppState)
- [x] Создать `src/platform/`
  - [x] tray.ts (createTray, updateTrayIcon, getTrayIconPath)
  - [x] autolaunch.ts (setAutoLaunch, isAutoLaunchEnabled)
  - [x] README.md (чеклист ручного тестирования)
- [x] Модуляризировать `src/main/`
  - [x] window.ts (createWindow, showWindow, sendAppState)
  - [x] ipc-handlers.ts (setupIpcHandlers)
  - [x] index.ts (~90 строк, только склейка)
- [x] Реорганизовать `resources/`
  - [x] tray/mac/ (trayTemplate.png, trayWarningTemplate.png, @2x)
  - [x] tray/win/ (tray.ico, tray-warning.ico)
  - [x] app/ (icon.svg, icon.png)
  - [x] Обновить пути в tray.ts
- [x] Проверить что приложение компилируется (typecheck + build)

### Шаг 2: Unit тесты

**Статус:** DONE

Настройка vitest и написание тестов для core/.

**Ход работы:**
- [x] Инфраструктура vitest
  - [x] Добавить vitest в devDependencies
  - [x] Создать `vitest.config.ts`
  - [x] Добавить scripts: test, test:run
- [x] Helpers
  - [x] `__tests__/helpers/fs.ts` (createTestContext, cleanup)
  - [x] `__tests__/helpers/index.ts` (re-export)
- [x] Unit тесты
  - [x] `__tests__/unit/core/config.test.ts` (7 тестов)
  - [x] `__tests__/unit/core/app-state.test.ts` (6 тестов)
  - [x] `__tests__/unit/core/core-flow.test.ts` (2 теста) — flow нескольких модулей

**Результат:** 15 тестов пройдено ✅

**Примечание:** Integration тесты (с реальным backend процессом) появятся в topic_host_core.

### Шаг 3: Консервация platform/

**Статус:** TODO

Ручная проверка tray + autolaunch на Mac и Windows. Убедиться что билд работает.

**Ход работы:**
- [ ] Проверить что `npm run build:win` работает на CI
- [ ] Mac: tray icon, menu, tooltip, autolaunch
- [ ] Windows: tray icon, menu, tooltip, autolaunch
- [ ] Обновить `platform/README.md` с чеклистом
