# Host Testing & Cleanup

**Статус:** в работе

---

## МОТИВАЦИЯ

Host main process — 420 строк в одном файле. Невозможно unit-тестировать. Перед добавлением backend lifecycle нужно:

1. **Очистить** — удалить устаревший код (sync, rclone)
2. **Модуляризировать** — разбить на testable модули
3. **Покрыть тестами** — критические пути (config, AppState)

---

## ССЫЛКИ

- [apps/host/src/main/index.ts](../../apps/host/src/main/index.ts) — текущий monolith (420 lines)
- [topic_host_core.md](topic_host_core.md) — зависит от этого топика

---

## НАРРАТИВ

### Текущая структура

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

### Что удаляем

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

### Что тестируем

| Вид | Что | Файл |
|-----|-----|------|
| **Unit** | config: read/write JSON | `__tests__/unit/core/config.test.ts` |
| **Unit** | app-state: status transitions | `__tests__/unit/core/app-state.test.ts` |
| **Integration** | config + app-state вместе | `__tests__/integration/core-flow.test.ts` |
| **E2E** | приложение запускается, окно работает | `e2e/app-launch.spec.ts` |
| **Ручные** | tray, autolaunch | `platform/README.md` — инструкция |

**Разделение по папкам:**
- `core/` — unit-тесты
- `main/` — E2E-тесты
- `platform/` — только ручные тесты (Playwright не видит системный трей)

---

## ПРИНЯТЫЕ РЕШЕНИЯ

### 1. Структура тестов (separation)

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
│   ├── unit/                     # Unit тесты
│   │   └── core/
│   │       ├── config.test.ts
│   │       └── app-state.test.ts
│   ├── integration/              # Integration тесты
│   │   └── core-flow.test.ts     # config + app-state вместе
│   └── helpers/                  # Test utilities
│       ├── index.ts              # re-export
│       └── fs.ts                 # tmp dir helpers
│
├── e2e/                          # E2E тесты (Playwright + Electron)
│   └── app-launch.spec.ts        # приложение запускается
│
├── vitest.config.ts              # unit + integration
└── playwright.config.ts          # e2e
```

### 2. Виды тестов

| Вид | Что тестирует | Инструмент | В Фазе 1? |
|-----|---------------|------------|-----------|
| **Unit** | Один модуль изолированно | Vitest | ✅ Да |
| **Integration** | Несколько модулей вместе | Vitest | ✅ Да (1 пример) |
| **E2E** | Приложение целиком | Playwright | ✅ Да (1 пример) |

### 3. Test runner

- **Unit + Integration:** Vitest
- **E2E:** Playwright с `electron` launcher
- Тестируем `src/core/` как обычный Node.js код

### 4. Пути и tmp директории

- `process.env.DUET_CONFIG_DIR` — переопределяет путь к config dir в тестах
- Каждый тест создаёт свой tmp dir в `os.tmpdir()`
- Cleanup в `afterEach` через helper функцию
- **Vitest НЕ чистит автоматически** — cleanup явный

### 5. Test helpers

`__tests__/helpers/fs.ts` содержит:
- `createTestContext()` — создаёт tmp dir, configDir, duetDataDir
- `cleanup()` — удаляет tmp dir
- `writeTestConfig()` — пишет config.json в tmp

### 6. fs операции

Real fs + tmp dir. Моки не нужны — операции простые, real fs надёжнее.

### 7. CI для кроссплатформенности

**Цель:** Тесты на CI дают кроссплатформенность. Разработка на Mac, проверка на Windows/Linux автоматически.

**GitHub Actions matrix:**
- `macos-latest`
- `windows-latest`
- `ubuntu-latest` (с xvfb для headless)

**Что запускается на CI:**
- Unit тесты — все платформы
- Integration тесты — все платформы
- E2E тесты — все платформы (проверяет запуск + окно)

### 8. Стратегия тестирования

| Папка | Модуль | Автотесты | Вручную |
|-------|--------|-----------|---------|
| `core/` | `config.ts` | ✅ Unit | — |
| `core/` | `app-state.ts` | ✅ Unit | — |
| `main/` | `index.ts` | ✅ E2E | — |
| `main/` | `ipc-handlers.ts` | ✅ E2E | — |
| `main/` | `window.ts` | ✅ E2E | — |
| `platform/` | `tray.ts` | ❌ | 🖐️ Mac + Windows |
| `platform/` | `autolaunch.ts` | ❌ | 🖐️ Mac + Windows |
| — | Дистрибутив (.dmg, .exe) | ❌ | 🖐️ Перед релизом |

### 9. Папка platform/ — консервация

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

### 10. Порядок шагов (4 шага)

1. **Cleanup + Модуляризация** — вся структура кода и ресурсов
2. **Unit + Integration** — vitest, тесты для core/
3. **E2E + CI** — playwright, GitHub Actions
4. **Консервация platform/** — ручная проверка, документация

**Принцип:** Сначала порядок в коде → потом тесты для этого кода.

### 11. UI тесты React

Отложены до Фазы 2 (topic_host_core.md). Вернуться когда появится backend status в UI.

### 12. CI workflow детали

- **Кэш:** Да, `actions/cache` для node_modules — обязательно
- **Артефакты:** Нет, coverage report не нужен
- **Триггеры:** `push` + `pull_request` на `paths: apps/host/**`

### 13. Структура resources/

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

**Scope:** Cleanup + модуляризация + тесты для Host.

**Фундаментальный вопрос:** Как сделать main process testable без переписывания всего?

**Контекст:**
- Выносим только pure functions (config, app-state)
- Electron-specific код оставляем как есть
- Тесты на vitest (уже настроен в monorepo)

### Критерии завершённости

- [ ] Удалён устаревший код (sync, rclone, Versions)
- [ ] Структура src/: core/, main/, platform/
- [ ] Структура resources/: tray/mac/, tray/win/, app/
- [ ] Unit тесты: config.ts, app-state.ts
- [ ] Integration тест: config + app-state вместе
- [ ] E2E тест: приложение запускается + окно работает
- [ ] CI: GitHub Actions с матрицей macOS/Windows/Ubuntu
- [ ] platform/ проверен вручную на Mac + Windows
- [ ] Приложение работает как раньше

### Шаг 1: Cleanup + Модуляризация

**Статус:** TODO

Весь рефакторинг структуры кода и ресурсов.

**Ход работы:**
- [ ] Удалить устаревший код
  - [ ] Sidebar.tsx: удалить sync из navItems
  - [ ] SetupPage.tsx: удалить заглушку rclone
  - [ ] App.tsx: удалить case 'sync'
  - [ ] Удалить Versions.tsx
- [ ] Создать `src/core/`
  - [ ] config.ts (DUET_CONFIG_DIR, readConfig, writeConfig, типы)
  - [ ] app-state.ts (AppStatus, AppState, checkAppState)
- [ ] Создать `src/platform/`
  - [ ] tray.ts (createTray, updateTrayIcon, getTrayIconPath)
  - [ ] autolaunch.ts (setupAutoLaunch, isAutoLaunchEnabled)
- [ ] Модуляризировать `src/main/`
  - [ ] window.ts (createWindow, showWindow)
  - [ ] ipc-handlers.ts (setupIpcHandlers)
  - [ ] index.ts (~50 строк, только склейка)
- [ ] Реорганизовать `resources/`
  - [ ] tray/mac/ (trayTemplate.png, trayWarningTemplate.png, @2x)
  - [ ] tray/win/ (tray.ico, tray-warning.ico)
  - [ ] app/ (icon.svg, icon.png)
  - [ ] Обновить пути в tray.ts
- [ ] Проверить что приложение запускается

**Коммит:** `refactor(host): cleanup + modularize (core/, platform/, resources/)`

### Шаг 2: Unit + Integration тесты

**Статус:** TODO

Настройка vitest и написание тестов для core/.

**Ход работы:**
- [ ] Инфраструктура vitest
  - [ ] Добавить vitest в devDependencies
  - [ ] Создать `vitest.config.ts`
  - [ ] Добавить scripts: test, test:run
- [ ] Helpers
  - [ ] `__tests__/helpers/fs.ts` (createTestContext, cleanup)
  - [ ] `__tests__/helpers/index.ts` (re-export)
- [ ] Unit тесты
  - [ ] `__tests__/unit/core/config.test.ts`
    - readConfig с несуществующим файлом → {}
    - readConfig с валидным JSON → parsed object
    - readConfig с битым JSON → {}
    - writeConfig создаёт директорию и файл
  - [ ] `__tests__/unit/core/app-state.test.ts`
    - no config → status 'no_config'
    - config + path exists → status 'ready'
    - config + path not exists → status 'path_lost'
- [ ] Integration тест
  - [ ] `__tests__/integration/core-flow.test.ts`
    - writeConfig → checkAppState → verify status

**Коммит:** `test(host): add unit + integration tests`

### Шаг 3: E2E тесты + CI

**Статус:** TODO

Настройка Playwright и GitHub Actions.

**Ход работы:**
- [ ] Инфраструктура Playwright
  - [ ] Добавить playwright, @playwright/test в devDependencies
  - [ ] Создать `playwright.config.ts` с electron launcher
  - [ ] Добавить script: test:e2e
- [ ] E2E тест
  - [ ] `e2e/app-launch.spec.ts`
    - Запустить приложение
    - Показать окно (через evaluate, не tray click)
    - Проверить что renderer загрузился
    - Закрыть приложение
- [ ] CI (GitHub Actions)
  - [ ] `.github/workflows/host-test.yml`
  - [ ] Matrix: macos-latest, windows-latest, ubuntu-latest
  - [ ] Кэш node_modules
  - [ ] Ubuntu: xvfb-run для E2E

**Коммит:** `test(host): add e2e tests + CI workflow`

### Шаг 4: Консервация platform/

**Статус:** TODO

Ручная проверка и документация platform/.

**Ход работы:**
- [ ] Mac
  - [ ] Иконка в Menu Bar
  - [ ] Смена иконки (normal/warning)
  - [ ] Меню работает
  - [ ] Tooltip правильный
  - [ ] Автозапуск включается/выключается
- [ ] Windows
  - [ ] Иконка в System Tray
  - [ ] Смена иконки (normal/warning)
  - [ ] Меню работает
  - [ ] Tooltip правильный
  - [ ] Автозапуск включается/выключается
- [ ] Документация
  - [ ] `platform/README.md` с чеклистом проверки
  - [ ] Ссылка на resources/tray/

**Коммит:** `docs(host): add platform/ manual testing checklist`

---

## ОТКРЫТЫЕ ВОПРОСЫ

*Нет открытых вопросов.*
