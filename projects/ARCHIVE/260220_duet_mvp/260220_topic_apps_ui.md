# Host UI: Приложения (Apps Manager)

**Статус:** реализовано

---

## МОТИВАЦИЯ

Duet Host сейчас управляет backend'ом через секцию "Сервер" внутри InstallPage. Это не масштабируется — в ближайшем будущем Duet будет управлять 10-20 Python-процессами из разных продуктов (Smimon, Lynx и др.). Каждое приложение может состоять из нескольких процессов: HTTP-серверы, воркеры, cron-задачи.

Нужна отдельная секция "Приложения" в сайдбаре с полноценным UI для управления процессами. Типы и компоненты строим сразу с прицелом на множество приложений, но реализуем пока только встроенный Duet Backend.

---

## ССЫЛКИ

- `spec/ECOSYSTEM.md` — архитектура экосистемы, роли компонентов
- `projects/260210_duet_mvp/REVIEW_NOTES.md` — ревью бэкенд-миграции, п.2 "UX при внезапной смерти backend"
- `/Users/starship/DuetData/repos/smimon.git/new_architecture/01-runtime.md` — стандартная архитектура Python-приложений (HTTP + Workers, health endpoints, логирование)
- `packages/host/src/shared/types.ts` — текущий `BackendStatus`
- `packages/host/src/core/backend.ts` — текущий backend lifecycle
- `packages/host/src/renderer/src/pages/InstallPage.tsx` — текущая секция "Сервер" (строки 331-382)
- `packages/host/src/renderer/src/components/layout/Sidebar.tsx` — текущий плоский sidebar

---

## НАРРАТИВ

### Исходная проблема

Из ревью (REVIEW_NOTES.md): "UX при внезапной смерти backend — отдельный большой вопрос, надо обсудить". Секция "Сервер" на InstallPage — временное решение, не готовое к множеству приложений.

### От "секции Сервер" к менеджеру приложений

Начали с обсуждения UI для backend, но быстро поняли что масштаб другой. Примеры будущих приложений:

| Приложение | Процессы | Тип |
|------------|----------|-----|
| Duet Backend | HTTP (порт 19680) | builtin |
| Smimon | HTTP (порт 8000) + Workers (порт 8001) | external |
| Lynx | Data Update (cron 24h) + Trading Robot (long-running) | external |

### Два уровня: App и Process

**App** — продукт из воркспейса. Имя, путь к папке, список процессов.
**Process** — конкретный entry point с командой запуска, портом, health endpoint.

### Типы процессов

| Тип | Жизненный цикл | Health | UI |
|-----|----------------|--------|----|
| `http` | long-running | `GET /health` | ● Running, uptime, port |
| `worker` | long-running | `GET /health` на отд. порту или PID | ● Running, uptime |
| `cron` | запустился → работа → вышел | exit code + timestamp | Последний запуск: OK/fail |

### Решения

- **Duet Backend = обычное приложение**, просто встроенное (builtin). Другие пользователи получают его в бандле, свои ставят в DuetData/apps.
- **Автозапуск backend** — всегда да (сейчас). В будущем — часть конфига приложения.
- **Авто-рестарт при падении** — не делаем. В будущем — часть конфига.
- **Конфигурация приложений** — не делаем. Гипотеза: `DuetConfig/apps.json`.
- **IPC каналы** — оставляем `backend:*`, не переименовываем. Маппинг `BackendStatus` → `ProcessStatus` в слое трансляции.
- **Роутинг** — без React Router, продолжаем `switch(currentPage)` с паттерном `app:duet-backend`.

---

## ОТКРЫТЫЕ ВОПРОСЫ

### UX

- ✅ **РЕШЕНО:** Где живёт UI бэкенда? → Отдельная секция "Приложения" в сайдбаре, не на InstallPage.
- ✅ **РЕШЕНО:** Табы по процессам или все на одной странице? → Все процессы на одной странице карточками (при 2-3 процессах табы прячут информацию).
- ✅ **РЕШЕНО:** `stopping` состояние? → Добавляем, показываем спиннер + "Остановка..."

### Архитектура

- ✅ **РЕШЕНО:** Переименовывать IPC каналы (`backend:*` → `app:process:*`)? → Нет, делаем при добавлении второго приложения.
- ✅ **РЕШЕНО:** Где маппер `BackendStatus` → `ProcessStatus`? → `shared/mappers.ts` (доступен и main, и renderer, чистая функция без зависимостей).
- ✅ **РЕШЕНО:** Где реестр приложений? → `core/apps.ts` (BUILTIN_APPS константа), в будущем дополняется динамически.

---

## ВЫХОДЫ

### Обобщённые типы (`shared/types.ts`)

```typescript
type ProcessType = 'http' | 'worker' | 'cron'
type ProcessState = 'stopped' | 'starting' | 'running' | 'stopping' | 'error'

interface ProcessStatus {
  state: ProcessState
  message?: string      // starting, stopping
  version?: string      // running
  uptime?: number       // running (секунды)
  error?: string        // error
}

interface ProcessInfo {
  id: string
  name: string
  type: ProcessType
  port?: number
}

interface AppInfo {
  id: string
  name: string
  description: string
  builtin: boolean
  processes: ProcessInfo[]
}
```

### Навигация в сайдбаре

```
Установка
Приложения              ← секция (раскрывающаяся)
  ● Duet Backend        ← StatusDot (зелёный/серый/красный/спиннер)
AI Агенты
```

### Страница приложения (AppPage)

```
┌─────────────────────────────────────────────┐
│  Duet Backend                               │
│  Python HTTP API + MCP                      │
├─────────────────────────────────────────────┤
│  HTTP (порт 19680)              ● Запущен   │
│  v0.1.3 · uptime 2ч 15м                    │
│  [Перезапустить] [Остановить]               │
├─────────────────────────────────────────────┤
│  Ошибки                                     │
│  (пусто)                      ← placeholder │
└─────────────────────────────────────────────┘
```

### Гипотезы на будущее (не реализуем)

- Конфиг: `DuetConfig/apps.json` с описанием приложений и процессов
- Деплой внешних приложений в `DuetData/apps/{app-id}/`
- Мониторинг stderr: ERROR → badge в сайдбаре, system notification
- Tray menu: список приложений со статусами

---

## ПЛАН ВНЕДРЕНИЯ

### Постановка задачи

#### Scope
Host UI. Только встроенный Duet Backend. Один процесс (HTTP).

#### Фундаментальный вопрос
Как структурировать UI для управления одним приложением так, чтобы он масштабировался на 10-20?

#### Контекст
- `core/backend.ts` НЕ трогаем — он уже хорошо абстрагирован
- IPC каналы `backend:*` оставляем — трансляция в `ProcessStatus` на уровне маппера
- Sidebar сейчас плоский — нужны секции с вложенными элементами
- Нет React Router — продолжаем `switch(currentPage)`

### Критерии завершённости

- [x] Типы `ProcessStatus`, `AppInfo`, `ProcessState` в `shared/types.ts`
- [x] `stopping` состояние в `BackendStatus` и в UI
- [x] Sidebar: секция "Приложения" с вложенным "Duet Backend" и StatusDot
- [x] AppPage: карточка процесса с кнопками Start/Stop/Restart
- [x] Секция "Сервер" убрана из InstallPage
- [x] `npm run typecheck && npx vitest run` зелёные
- [ ] Навигация между всеми страницами работает

### Шаг 0: Документ
**Статус:** DONE

Фиксация результатов планирования — этот файл.

### Фаза 1: Фундамент

#### Шаг 1: Типы + маппер
**Статус:** DONE

Добавить обобщённые типы в `shared/types.ts` (ProcessStatus, AppInfo, ProcessState, ProcessType, ProcessInfo). Добавить `stopping` в BackendStatus. Создать `shared/mappers.ts` с `backendStatusToProcessStatus()`. Создать `core/apps.ts` с `BUILTIN_APPS`. Тесты маппера.

**Файлы:**
- `packages/host/src/shared/types.ts` — новые типы + stopping
- `packages/host/src/shared/mappers.ts` — NEW
- `packages/host/src/core/apps.ts` — NEW
- `packages/host/src/preload/index.d.ts` — реэкспорт типов
- `packages/host/__tests__/unit/core/apps.test.ts` — NEW

### Фаза 2: UI

#### Шаг 2: Sidebar с секциями
**Статус:** DONE

Sidebar: поддержка `NavSection` с вложенными `NavItem[]`. Компонент `StatusDot`. Прокинуть `backendStatus` через Layout.

**Файлы:**
- `packages/host/src/renderer/src/components/layout/Sidebar.tsx`
- `packages/host/src/renderer/src/components/layout/Layout.tsx`

#### Шаг 3: AppPage + навигация
**Статус:** DONE

Создать `AppPage` (карточка процесса, кнопки, placeholder ошибок). Подключить в `App.tsx`: состояние `backendProcessStatus`, маппинг, роутинг `app:duet-backend`. Прокинуть статус в sidebar.

**Файлы:**
- `packages/host/src/renderer/src/pages/AppPage.tsx` — NEW
- `packages/host/src/renderer/src/App.tsx`

#### Шаг 4: Убрать "Сервер" из InstallPage
**Статус:** DONE

Удалить Section 3, `backendStatus` state, `handleBackendStart/Stop`, неиспользуемые импорты.

**Файлы:**
- `packages/host/src/renderer/src/pages/InstallPage.tsx`

### Фаза 3: Backend

#### Шаг 5: `stopping` в IPC handlers
**Статус:** DONE

`ensureBackendStopped`: broadcast `stopping` перед остановкой, `stopped` после.

**Файлы:**
- `packages/host/src/main/ipc-handlers.ts`

### Фаза 4: Документация

#### Шаг 6: Обновить spec
**Статус:** DONE

Отразить новую структуру в ARCHITECTURE.md.

**Файлы:**
- `packages/host/spec/ARCHITECTURE.md`
