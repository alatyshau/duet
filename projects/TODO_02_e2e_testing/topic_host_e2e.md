# Host E2E Testing

**Статус:** законсервировано

> ⚠️ **E2E тесты выключены в CI** (`.github/workflows/host-test.yml`)
> Код сохранён, но не выполняется (`if: false`).
> Включить: заменить `if: false` на оригинальные условия.

---

## МОТИВАЦИЯ

**Главная цель:** Стабильные E2E тесты для Host на CI.

Без E2E тестов нет уверенности что приложение запускается после изменений. Unit-тесты покрывают логику, но не Electron lifecycle.

**Контекст:**
- Unit-тесты готовы (15 тестов, vitest) — см. [topic_host_testing.md](topic_host_testing.md)
- Инфраструктура E2E готова (WebdriverIO + wdio-electron-service v9.2.1)
- Проблема: E2E работают нестабильно или не работают вовсе

---

## ССЫЛКИ

- [topic_host_testing.md](topic_host_testing.md) — unit-тесты, cleanup, модуляризация
- [topic_host_core.md](topic_host_core.md) — зависит от этого топика
- [wdio-electron-service docs](https://webdriver.io/docs/wdio-electron-service/)
- [wdio-electron-service configuration](https://github.com/webdriverio-community/wdio-electron-service/blob/main/docs/configuration/service-configuration.md)
- [wdio-electron-service releases](https://github.com/webdriverio-community/wdio-electron-service/releases) — v9.2.1 поддерживает Electron 39
- [Electron automated testing](https://www.electronjs.org/docs/latest/tutorial/automated-testing) — WebdriverIO рекомендован
- [Chrome DevTools Protocol security changes](https://developer.chrome.com/blog/remote-debugging-port)

---

## НАРРАТИВ

### Исследование E2E (260201)

#### Проблема

E2E тесты для Electron 39 (Chrome 142) имеют проблемы с remote debugging.

#### Исправленные проблемы

##### ESM/CJS конфликт (✅ ИСПРАВЛЕНО)

**Проблема:** `"type": "module"` в package.json + ESM сборка = Electron не мог загрузить main process.

```
SyntaxError: The requested module 'electron' does not provide an export named 'BrowserWindow'
```

**Решение:** Собирать main и preload как CommonJS:

```typescript
// electron.vite.config.ts
main: {
  build: {
    rollupOptions: {
      output: {
        format: 'cjs',
        entryFileNames: '[name].cjs'
      }
    }
  }
}
```

**Почему:** Electron модуль — CommonJS. При import из ESM named exports не работают. Стандартная практика — собирать в CJS.

##### ELECTRON_RUN_AS_NODE (✅ ИСПРАВЛЕНО)

**Проблема:** В окружении Claude Code установлена `ELECTRON_RUN_AS_NODE=1` → Electron запускался как Node.js.

**Решение:** Явно сбрасывать переменную в скриптах:

```json
"dev": "ELECTRON_RUN_AS_NODE= electron-vite dev",
"start": "ELECTRON_RUN_AS_NODE= electron-vite preview"
```

##### electron-builder в monorepo (✅ ИСПРАВЛЕНО)

**Проблема:** electron-builder не мог определить версию electron (нефиксированная `^39.2.6`).

**Решение:** Фиксированная версия в package.json: `"electron": "39.2.6"` (без ^).

#### Текущее состояние E2E

**Что работает:**
- ✅ `npm run build` — собирает приложение
- ✅ `npm run start` — запускает production preview
- ✅ `npm run build:unpack` — создаёт packaged app
- ⚠️ E2E тесты — **нестабильны**

**Проблема с E2E:**

Chrome 136+ требует `--user-data-dir` для `--remote-debugging-port` (security fix). Мы добавили это в wdio.conf.ts, но тесты работают нестабильно — первый запуск проходит, последующие падают с timeout.

```
unable to discover open pages
WebDriverError: The operation was aborted due to timeout
```

#### Файлы E2E инфраструктуры

```
packages/host/
├── wdio.conf.ts              # Конфиг WebdriverIO (настроен, нестабильно)
├── e2e/
│   └── app-launch.e2e.ts     # 6 тестов (4 проходят когда работает)
├── package.json              # test:e2e = "wdio run wdio.conf.ts"
└── electron.vite.config.ts   # format: 'cjs' для main и preload

.github/workflows/
└── host-test.yml             # CI workflow (unit работает, e2e отключён)
```

### Ключевое открытие: E2E НЕ сломано для индустрии (260201)

**Изначальная гипотеза (ошибочная):**
> Chrome 136+ сломал remote debugging → вся индустрия Electron E2E тестирования не работает уже 3 месяца.

**Исследование показало:**
- wdio-electron-service v9.2.1 **поддерживает** Electron 39 (Chrome 142)
- Auto-setup Chromedriver работает для Electron v26+
- VS Code, Slack, Discord — тестируют E2E нормально
- Spectron deprecated (2022), но WebdriverIO и Playwright работают

**Реальная проблема — локальная:**
1. Мы использовали `appBinaryPath` (packaged app) для локальной разработки — это сложнее
2. Monorepo: broken symlink на electron в `packages/host/node_modules/.bin/`
3. Electron установлен в корне, а wdio ищет в подпапке

**Вывод:**
- Проблема не в Chrome 142 глобально
- Проблема в нашей конфигурации для monorepo
- Нужно правильно указать путь к electron binary

### Виды E2E тестов

| Вид | Что | Файл |
|-----|-----|------|
| **E2E** | приложение запускается, окно работает | `e2e/app-launch.spec.ts` |
| **Ручные** | tray, autolaunch | `platform/README.md` — инструкция |
| **Integration** | backend lifecycle (topic_host_core) | *будет позже* |

**Разделение по папкам:**
- `core/` — unit-тесты (см. [topic_host_testing.md](topic_host_testing.md))
- `main/` — E2E-тесты
- `platform/` — только ручные тесты (Playwright не видит системный трей)

**Примечание:** Integration тесты (с реальным backend процессом) появятся в topic_host_core.

### Принятые решения

#### 1. Test runner

- **Unit + Integration:** Vitest (см. [topic_host_testing.md](topic_host_testing.md))
- **E2E:** WebdriverIO с `wdio-electron-service`
- Тестируем `src/core/` как обычный Node.js код

#### 2. CI для кроссплатформенности

**Цель:** Тесты на CI дают кроссплатформенность. Разработка на Mac, проверка на Windows/Linux автоматически.

**GitHub Actions matrix:**
- `macos-latest`
- `windows-latest`
- `ubuntu-latest` (с xvfb для headless)

**Что запускается на CI:**
- Unit тесты — все платформы
- Integration тесты — все платформы
- E2E тесты — все платформы (проверяет запуск + окно)

#### 3. Стратегия тестирования

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

#### 4. CI workflow детали

- **Кэш:** Да, `actions/cache` для node_modules — обязательно
- **Артефакты:** Нет, coverage report не нужен
- **Триггеры:** `push` + `pull_request` на `paths: packages/host/**`

---

## ОТКРЫТЫЕ ВОПРОСЫ

### 0. Нужны ли два режима? ⚠️ КЛЮЧЕВОЙ ВОПРОС

> **Возможно достаточно ОДНОГО рабочего режима, а не двух конфигов.**

**Две РАЗНЫЕ проблемы, которые мы смешали:**

| Проблема | Режим | Симптом | Это monorepo? |
|----------|-------|---------|---------------|
| **A. Нестабильность** | packaged app | 1-й запуск ок, повторные — timeout | ❌ НЕТ |
| **B. Broken symlink** | appEntryPoint | "no chrome binary" | ✅ ДА |

**Логика:**
- Если решим A (нестабильность) → packaged app работает везде → один конфиг
- Если решим B (symlink) → appEntryPoint работает везде → один конфиг
- Два режима нужны только если каждый решает свою проблему частично

**Что исследовать:**
1. Шаг 1: Можно ли appEntryPoint использовать и на CI?
2. Шаг 2: Можно ли packaged app использовать и локально?

**Текущее решение:** Ведём оба шага параллельно, но держим в уме что может хватить одного.

### 1. Шаг 1: Как запустить appEntryPoint в monorepo?

**Проблема:** broken symlink в `packages/host/node_modules/.bin/electron`

**Варианты:**
| # | Вариант | Effort | Риск |
|---|---------|--------|------|
| 1 | `goog:chromeOptions.binary` явно | Low | Может не работать |
| 2 | Запуск из корня monorepo | Low | Изменение workflow |
| 3 | Fix symlink | Low | Хрупкое |

### 2. Шаг 2: Почему packaged app нестабилен?

**Факт:** Первый запуск работал (4/6 тестов), повторные — timeout.

**Гипотезы (не проверены):**
- Cleanup между тестами не работает
- Порты остаются занятыми
- Chrome процессы зависают
- user-data-dir не чистится

**Варианты:**
| # | Вариант | Effort | Риск |
|---|---------|--------|------|
| 1 | Добавить cleanup hooks | Low | Может не помочь |
| 2 | Убить процессы между тестами | Low | Грубо |
| 3 | Изолировать user-data-dir | Low | Было, не помогло? |
| 4 | Debug логи ChromeDriver | Medium | Найти root cause |

### 3. Monorepo vs обычный репо — что бы изменилось?

> **Заметка для будущего исследования**

**Вопрос:** Если бы Host был отдельным репозиторием (не monorepo), какие проблемы исчезли бы автоматически?

**Гипотеза:**

| Проблема | Monorepo-специфична? | Почему |
|----------|---------------------|--------|
| Broken symlink | ✅ ДА | electron в корне, wdio ищет в packages/host/node_modules |
| Нестабильность packaged app | ❓ НЕ ЯСНО | Может быть общая проблема ChromeDriver |
| ESM/CJS конфликт | ❌ НЕТ | Electron всегда CJS, это общее |
| ELECTRON_RUN_AS_NODE | ❌ НЕТ | Это окружение Claude Code, не monorepo |

**Зачем знать:**
- Если большинство проблем от monorepo → возможно стоит иметь шаблон конфига для monorepo
- Если проблемы общие → решение пригодится для любого Electron проекта

**Когда исследовать:** После стабилизации E2E (низкий приоритет).

---

**Детали конфигурации wdio-electron-service:**
- CDP Bridge: timeout 10s, retry 3, wait 100ms (по умолчанию)
- `appEntryPoint` требует electron в node_modules
- `appEntryPoint` переопределяет `appBinaryPath` если оба установлены
- Auto-setup Chromedriver для Electron v26+

---

## ВЫХОДЫ

### Целевое состояние

**E2E тесты стабильно проходят на CI:**
- macOS
- Windows
- Linux (с xvfb)

**Инфраструктура:**
- WebdriverIO + wdio-electron-service v9.2.1
- GitHub Actions workflow
- 6+ E2E тестов покрывающих основные сценарии

---

## ПЛАН ВНЕДРЕНИЯ

### Постановка задачи

**Scope:** E2E тесты для Host — локально и на CI.

**Фундаментальный вопрос:** Достаточно ли решить одну проблему, или нужны два режима?

**Две независимые проблемы:**

| Проблема | Режим | Симптом | Решаема? |
|----------|-------|---------|----------|
| **Symlink** | appEntryPoint | "no chrome binary" | ✅ Да, monorepo |
| **Нестабильность** | packaged app | timeout на повторных | ❓ Не исследовано |

**Два режима (если оба нужны):**

| Режим | Где | Подход | Конфиг |
|-------|-----|--------|--------|
| **Dev** | Локально | `appEntryPoint` (из `out/`) | `wdio.conf.ts` |
| **Prod** | CI | `appBinaryPath` (packaged) | `wdio.ci.conf.ts` |

**Контекст:**
- Unit-тесты работают (15 тестов, vitest) — [topic_host_testing.md](topic_host_testing.md)
- Инфраструктура E2E готова (WebdriverIO + wdio-electron-service v9.2.1)
- Шаг 1 и Шаг 2 можно вести параллельно — разные проблемы

### Критерии завершённости

**Главный критерий:**
- [ ] **E2E тесты стабильно проходят на CI** (все 3 платформы)

**Дополнительно:**
- [ ] Локальный запуск E2E работает (`npm run test:e2e`)
- [ ] 3+ успешных запуска подряд (стабильность)

### Шаг 1: E2E — appEntryPoint режим

**Статус:** ЗАКОНСЕРВИРОВАНО

**Проблема:** Broken symlink в monorepo
**Цель:** `npm run test:e2e` работает локально из `out/`

#### Суть проблемы

```
packages/host/node_modules/.bin/electron → broken symlink
node_modules/.bin/electron → работает (electron в корне)
```

**Ошибка:** `no chrome binary at .../packages/host/node_modules/.bin/electron`

#### Ход работы

| # | Задача | Статус |
|---|--------|--------|
| 1 | Инфраструктура WebdriverIO | ✅ v9.23.2 |
| 2 | Тесты написаны | ✅ 6 тестов |
| 3 | Переключить на `appEntryPoint` | ✅ wdio.conf.ts |
| 4 | **Исправить electron path** | 🔄 блокер |
| 5 | Проверить стабильность | ⏳ 3+ запуска |

#### Варианты решения (задача 4)

| # | Вариант | Что сделать |
|---|---------|-------------|
| 1 | Явный binary path | Добавить `goog:chromeOptions.binary` в конфиг |
| 2 | Запуск из корня | `cd ../.. && npm run -w packages/host test:e2e` |
| 3 | Fix symlink | Создать правильную ссылку |

**Следующий шаг:** Попробовать вариант 1.

#### После исправления

```bash
npm run build      # → out/
npm run test:e2e   # тестирует из out/
```

### Шаг 2: E2E — packaged app режим

**Статус:** ЗАКОНСЕРВИРОВАНО

**Проблема:** Нестабильность — первый запуск ок, повторные timeout
**Цель:** Стабильные E2E для packaged app (локально и CI)

#### Суть проблемы

**Факт:** 4/6 тестов прошли на ПЕРВОМ запуске. Повторные — timeout.

**Ошибка:**
```
unable to discover open pages
WebDriverError: The operation was aborted due to timeout
```

**Гипотезы:**
- Cleanup между тестами не работает
- Порты остаются занятыми
- Chrome процессы зависают
- user-data-dir не чистится (было добавлено, не помогло?)

#### Ход работы

| # | Задача | Статус |
|---|--------|--------|
| 1 | **Исследовать причину timeout** | ⏳ |
| 2 | Добавить cleanup hooks | ⏳ |
| 3 | Создать `wdio.ci.conf.ts` | ⏳ |
| 4 | Настроить для 3 платформ | ⏳ |
| 5 | Обновить GitHub Actions | ⏳ |

#### Варианты решения (задача 1-2)

| # | Вариант | Что сделать |
|---|---------|-------------|
| 1 | Debug логи | Включить verbose logging ChromeDriver |
| 2 | Cleanup hooks | afterTest/afterSession убить процессы |
| 3 | Новый user-data-dir | Каждый тест — свой temp dir |
| 4 | Kill chrome между тестами | `pkill -f chrome` в afterTest |

**Следующий шаг:** Включить debug логи, понять где timeout.

#### После исправления

```bash
npm run build:unpack  # → dist/
npm run test:e2e:ci   # тестирует packaged app
```

