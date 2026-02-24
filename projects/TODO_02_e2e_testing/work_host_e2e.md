# Ход работы над Host E2E

**ЦЕЛЬ:** `npm run test:e2e` стабильно проходит локально и на CI (macOS, Windows, Linux). После каждого push мы знаем, что Host запускается, показывает окно и не падает.

**ЧТО ДАЛЬШЕ:** пока не знаю

## Общий план

1. Разобраться почему тесты нестабильны (две независимые проблемы — см. детали ниже).
2. Починить, добиться 3+ стабильных запуска подряд.
3. Включить в CI (`host-test.yml`, сейчас `if: false`).

## Текущий статус

**Законсервировано.** Инфраструктура собрана, 6 тестов написаны, но нестабильны. E2E выключены в CI.

**Что уже сделано:**
- Стек выбран: **WebdriverIO + wdio-electron-service v9.2.1** (не Playwright, не Spectron)
- 6 E2E тестов написаны (`e2e/app-launch.e2e.ts`), 4 из 6 проходили при первом запуске
- Три побочные проблемы решены: ESM/CJS конфликт, ELECTRON_RUN_AS_NODE, electron-builder в monorepo

**Что выяснили:**
- Проблема **не индустриальная** (VS Code, Slack, Discord тестируют E2E нормально) — она **локальная**, в нашей monorepo-конфигурации
- Есть **две независимые проблемы**, и возможно хватит решить одну из них

**Две проблемы:**

| Проблема | Режим | Симптом | Monorepo? |
|----------|-------|---------|-----------|
| Broken symlink на electron | appEntryPoint | `no chrome binary` | Да |
| Timeout на повторных запусках | packaged app | `unable to discover open pages` | Неясно |

**Первый шаг при возобновлении:** попробовать явный `goog:chromeOptions.binary` для решения symlink-проблемы.

---

## Детали: исправленные проблемы

### ESM/CJS конфликт

`"type": "module"` + ESM сборка → Electron не грузил main process. Решение — собирать main и preload как CJS:

```typescript
// electron.vite.config.ts
main: { build: { rollupOptions: { output: { format: 'cjs', entryFileNames: '[name].cjs' } } } }
```

### ELECTRON_RUN_AS_NODE

Claude Code ставит `ELECTRON_RUN_AS_NODE=1` → Electron запускался как Node.js. Решение — сброс в скриптах:

```json
"dev": "ELECTRON_RUN_AS_NODE= electron-vite dev"
```

### electron-builder в monorepo

Нефиксированная версия `^39.2.6` → electron-builder не мог определить версию. Решение — `"electron": "39.2.6"` (без ^).

---

## Детали: открытая проблема A — broken symlink

```
packages/host/node_modules/.bin/electron → broken symlink
node_modules/.bin/electron → работает (electron в корне)
```

wdio-electron-service ищет electron в `packages/host/node_modules/`, но в monorepo electron hoisted в корень.

**Варианты:**

| # | Вариант | Что сделать |
|---|---------|-------------|
| 1 | Явный binary path | `goog:chromeOptions.binary` в wdio.conf.ts |
| 2 | Запуск из корня | `cd ../.. && npm run -w packages/host test:e2e` |
| 3 | Fix symlink | Создать правильную ссылку (хрупко) |

---

## Детали: открытая проблема B — нестабильность packaged app

Первый запуск — 4/6 тестов ок. Повторные — timeout: `unable to discover open pages`.

**Гипотезы (не проверены):**
- Cleanup между тестами не работает
- Порты остаются занятыми
- Chrome процессы зависают
- user-data-dir не чистится

**Варианты:**

| # | Вариант | Что сделать |
|---|---------|-------------|
| 1 | Debug логи | Verbose logging ChromeDriver — найти root cause |
| 2 | Cleanup hooks | afterTest/afterSession убить процессы |
| 3 | Изолировать user-data-dir | Каждый тест — свой temp dir |

---

## Файлы

```
packages/host/
├── wdio.conf.ts              # Конфиг WebdriverIO
├── e2e/
│   └── app-launch.e2e.ts     # 6 тестов
├── package.json              # test:e2e = "wdio run wdio.conf.ts"
└── electron.vite.config.ts   # format: 'cjs' для main и preload

.github/workflows/
└── host-test.yml             # CI (unit работает, e2e отключён через if: false)
```

## Ссылки

- [wdio-electron-service docs](https://webdriver.io/docs/wdio-electron-service/)
- [wdio-electron-service v9.2.1 releases](https://github.com/webdriverio-community/wdio-electron-service/releases)
- [Chrome DevTools Protocol security changes](https://developer.chrome.com/blog/remote-debugging-port)
