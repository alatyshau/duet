# Архитектура конфигурации Duet

**Статус:** DONE

---

## МОТИВАЦИЯ

Текущая конфигурация хранит абсолютные пути в `config.json` — это не кроссплатформенно и не мультимашинно. Если у человека Mac дома и Windows на работе, один и тот же конфиг в Google Drive не будет работать на обеих машинах.

**Цель:** Разделить конфигурацию на:
1. **Глобальный указатель** (`~/.org.ve68.duet`) — файл, указывает где искать остальное
2. **Кэш** (DuetData) — локальный SSD, восстанавливается из исходников
3. **Конфигурация** (DuetConfig) — в облаке, общая для всех машин
4. **Машино-специфичные алиасы** (`{machine}.json`) — разрешают `@алиас` → абсолютный путь

**Бонус:** Внешние ресурсы (Dropbox, etc.) становятся частью иерархии через алиасы.

---

## ГЛОССАРИЙ

| Термин | Что это | Файл/Путь |
|--------|---------|-----------|
| **Pointer** | Глобальный указатель — минимальный JSON-файл в home-директории, который "указывает" где искать остальные конфиги. Паттерн "pointer file" — один файл указывает на расположение данных. | `~/.org.ve68.duet` |
| **DuetData** | Локальный кэш на SSD. Полностью восстанавливается из исходников. Содержит: entities.db, repos/, logs. | `/Users/.../DuetData/` |
| **DuetConfig** | Source of truth в облаке (Google Drive). Синхронизируется между машинами. Содержит: settings.json, {machine}.json. | `.../DuetConfig/` |
| **Machine alias** | Идентификатор машины (например `mac_work`, `win_home`). Определяет какой файл алиасов использовать. | Поле `machine` в pointer |
| **@alias** | Именованный путь с префиксом `@`. Резолвится в абсолютный путь через `{machine}.json`. Например: `@БАЗА` → `/Users/.../!БАЗА`. | `{machine}.json` |
| **Settings** | Общие настройки, одинаковые для всех машин: port, timezone, business_folders (как @aliases). | `settings.json` |
| **Source** | Поле в product.json, указывающее откуда брать код продукта. Типы: `git`, `local`. | `product.json` |

---

## ССЫЛКИ

- [260202_topic_vscode_extension.md](260202_topic_vscode_extension.md) — текущая реализация расширения
- [packages/backend/services/workspace.py](../../packages/backend/services/workspace.py) — workspace_info сервис
- [packages/backend/scanner.py](../../packages/backend/scanner.py) — сканер сущностей

---

## НАРРАТИВ

### Проблема абсолютных путей

Изначально хотели добавить "ресурс" — внешнюю папку (Dropbox) в sidebar. Первый план: добавить `external_path` в манифест. Но абсолютный путь не работает на другой машине.

### Решение: Именованные алиасы с нотацией `@`

Вместо абсолютных путей — именованные алиасы с префиксом `@`:

```json
// settings.json (в облаке, общий)
{
  "business_folders": ["@БАЗА", "@МетаЛаб"]
}

// product.json (в облаке, общий)
{
  "external_resource": "@Dropbox_Library"
}

// mac_work.json (локальный маппинг)
{
  "@БАЗА": "/Users/starship/.../!БАЗА",
  "@Dropbox_Library": "/Users/starship/Dropbox/Library"
}
```

**Единая нотация `@алиас`** — и в определении (ключ в `{machine}.json`), и в использовании (`settings.json`, манифесты).

### Разделение ответственности: Host vs Extension

**Host app** берёт на себя:
- Onboarding (выбор путей, machine alias)
- Создание `~/.org.ve68.duet`
- Установка Python и backend
- Исправление проблем с конфигурацией (warning в трее → UI)

**Extension** становится проще:
- Проверяет `~/.org.ve68.duet` при запуске
- Если нет/битый → welcome view "Установите Duet host"
- Если ок → работает как обычно

Это правильнее: Host — единая точка входа, extension — тонкий клиент.

### Разделение кэша и конфига

**DuetData** — это кэш. Он полностью восстанавливается:
- `data/entities.db` — из сканирования Drive
- `repos/*.git` — из `git clone`
- `*.log`, `.pid` — временные файлы

**DuetConfig** — это исходник. Должен быть в облаке:
- `settings.json` — общие настройки (version, timestampTZ, business_folders как алиасы)
- `{machine}.json` — маппинг алиасов для конкретной машины

### Глобальный указатель

`~/.org.ve68.duet` — JSON-файл (не папка!):

```json
{
  "machine": "mac_work",
  "duetDataPath": "/Users/starship/DuetData",
  "duetConfigPath": "/Users/starship/.../DuetConfig"
}
```

**Почему файл:** Минимализм. Всё остальное (логи, pid, lock) в DuetData.

---

## СВЯЗАННЫЕ ПРОЕКТЫ

> ⚠️ **Параллельная разработка.** Несколько проектов одновременно меняют архитектуру системы. Важно понимать их взаимосвязь.

| Проект | Статус | Что делает | Влияние на config |
|--------|--------|------------|-------------------|
| [topic_host_core.md](../260108_host_design/topic_host_core.md) | WIP | Host берёт на себя backend lifecycle | Host будет запускать backend, Extension станет тонким клиентом |
| **Этот топик** | WIP | Новая архитектура конфигурации | pointer, @aliases, DuetConfig |

### Стратегия: конкурентная реализация (из topic_host_core)

> Extension УЖЕ умеет всё: установка backend, запуск, health check, restart, версионирование.
> Мы **дублируем** эту реализацию в Host, тестируем, **потом** вырезаем из Extension.

**Следствие для этого топика:**
- Extension сейчас владеет backend lifecycle — **это временно**
- В целевом состоянии Host запускает backend, Extension — тонкий клиент
- Обновление config architecture (pointer, aliases) нужно делать в **обоих** компонентах, пока Extension ещё владеет lifecycle

---

## ТЕКУЩЕЕ СОСТОЯНИЕ КОМПОНЕНТОВ

> ⚠️ **Система в процессе рефакторинга.** Есть пересечения в ответственности, некоторые компоненты уже обновлены (Host), некоторые ещё используют старый формат (Extension, Backend). Этот раздел описывает реальное положение дел на момент анализа кода.

### Анализ по результатам code review

**Host** (`packages/host/`) — ✅ Частично обновлён:
```
- ✅ Читает pointer ~/.org.ve68.duet → duetDataPath, duetConfigPath, machine
- ⏳ НЕ запускает backend (это делает Extension) — ПЛАН: topic_host_core.md
- ❌ НЕ пишет state.json — ПЛАН: topic_host_core.md
- ❌ НЕ создаёт pointer (onboarding не реализован)
```
> **См. [topic_host_core.md](../260108_host_design/topic_host_core.md)** — план по переносу backend lifecycle в Host

**Extension** (`packages/extension/`) — ✅ Обновлён:
```
- ✅ Читает pointer ~/.org.ve68.duet (pointer.ts)
- ✅ Если pointer нет → welcome view "Установите Duet Host" (OnboardingProvider)
- ✅ Читает port из DuetConfig/{machine}.json (pointer.ts → readPort())
- ✅ Запускает backend БЕЗ --data-path (backend читает pointer сам)
- ✅ Пишет DuetData/backend/VERSION (вместо config.json version)
- ⚠️ Scanner (scanner.ts) ещё читает config.json (прототип, будет удалён)
```

**Backend** (`packages/backend/`) — ✅ Обновлён:
```
- ✅ Читает pointer ~/.org.ve68.duet (pointer.py)
- ✅ Запускается без --data-path (читает pointer сам)
- ✅ Читает settings.json + {machine}.json из DuetConfig
- ✅ Резолвит @aliases через aliases.py
- ✅ Версия из DuetData/backend/VERSION
```

### Пересечения и дублирование

| Функция | Host | Extension | Backend | Проблема |
|---------|------|-----------|---------|----------|
| **Источник путей** | `~/.org.ve68.duet` | VSCode settings | `--data-path` arg | 3 разных источника! |
| **Сканер иерархии** | — | `scanner.ts` | `scanner.py` | Дублирование кода |
| **Запись config** | — | пишет | — | Extension отвечает за config |
| **Чтение config** | — | читает | читает | OK, оба читают |
| **Запуск backend** | — | запускает | — | Extension отвечает |

### Реальный flow сейчас (временное состояние)

> ⚠️ Это **текущее** состояние. После завершения topic_host_core Host будет запускать backend.

```
User запускает VSCode с Extension
    ↓
Extension читает VSCode settings → duet.data_folder (или ~/DuetData)
    ↓
Extension пишет DuetData/config.json:
  - version (из package.json Extension)
  - port: 19680
  - business_folders (абсолютные пути!)
  - timestampTZ
    ↓
Extension запускает: python server.py --data-path DuetData
    ↓
Backend читает DuetData/config.json → business_folders
    ↓
Backend сканирует → entities.db
```

**Host работает отдельно:**
```
User запускает Host app
    ↓
Host читает ~/.org.ve68.duet (если есть)
    ↓
Host показывает tray icon + окно если нужен onboarding
    ↓
Host НЕ взаимодействует с Extension/Backend!
```

### Ключевые рассинхронизации

1. **Host уже читает pointer, но Extension игнорирует его** — Host обновлён "вперёд", Extension ещё использует VSCode settings.

2. **Extension пишет config.json до запуска backend** — Это временное решение, в целевой архитектуре config лежит в DuetConfig (облако).

3. **Extension передаёт --data-path backend'у** — В целевой архитектуре backend сам читает pointer.

4. **Два сканера делают одно и то же** — `scanner.ts` и `scanner.py` дублируют логику, потому что Extension и Backend оба нуждаются в данных иерархии.

### Матрица ответственности: Текущее vs Целевое

| Функция | Сейчас | Целевое | Проект |
|---------|--------|---------|--------|
| **Создание pointer** | ❌ Никто (руками) | Host (onboarding) | этот топик |
| **Чтение pointer** | Host ✅, Extension ❌, Backend ❌ | Все читают | этот топик |
| **Путь к DuetData** | Extension: VSCode settings; Backend: `--data-path` | Все из pointer | этот топик |
| **Путь к DuetConfig** | ❌ Не используется | Все из pointer | этот топик |
| **business_folders** | Extension пишет абсолютные пути в config.json | settings.json с @aliases | этот топик |
| **Резолвинг @aliases** | ❌ Не реализован | {machine}.json | этот топик |
| **version** | Extension → config.json → Backend читает | `DuetData/backend/VERSION` (= Host version) | topic_host_core |
| **port** | Extension → config.json → Backend читает | {machine}.json (может быть разным) | этот топик |
| **timestampTZ** | Extension → config.json → Backend читает | settings.json (в облаке) | этот топик |
| **Сканер** | Extension (TS) + Backend (PY) | Backend API | topic_host_core |
| **Запуск backend** | Extension | **Host** | topic_host_core |
| **state.json** | Backend пишет last_scan_at | Host пишет backend status | topic_host_core |
| **Onboarding** | ❌ Не реализован | Host | этот топик |
| **Warnings (path_lost)** | Host (tray icon) | Host | — |

### Упрощённая диаграмма: целевая архитектура

```
┌──────────────────────────────────────────────────────────────────────┐
│                            ~/.org.ve68.duet                          │
│                     (pointer: duetDataPath, duetConfigPath, machine) │
└───────────────────────────────┬──────────────────────────────────────┘
                                │
        ┌───────────────────────┼───────────────────────┐
        │                       │                       │
        ▼                       ▼                       ▼
   ┌─────────┐            ┌───────────┐           ┌─────────┐
   │  Host   │────spawn──▶│  Backend  │◀──HTTP───│Extension│
   │ (tray)  │            │  (Python) │           │ (VSCode)│
   └────┬────┘            └─────┬─────┘           └────┬────┘
        │                       │                      │
        │ onboarding,           │ MCP tools,           │ TreeView UI,
        │ warnings,             │ scan,                │ HTTP клиент
        │ backend lifecycle     │ workspace_info       │ (тонкий клиент)
        │                       │                      │
        └───────────────────────┼──────────────────────┘
                                │
                    ┌───────────┴───────────┐
                    ▼                       ▼
             ┌───────────┐           ┌───────────────┐
             │ DuetData  │           │ DuetConfig    │
             │  (cache)  │           │ (source, cloud)│
             │           │           │               │
             │ entities.db           │ settings.json │
             │ state.json ◀── Host   │ {machine}.json│
             │ backend.log           │               │
             └───────────┘           └───────────────┘
```

**Ключевое изменение (см. [topic_host_core.md](../260108_host_design/topic_host_core.md)):**
- Host **владеет** backend lifecycle (spawn/kill/health)
- Host пишет `state.json` со статусом backend
- Extension — **тонкий HTTP-клиент**, только UI

---

## ОТКРЫТЫЕ ВОПРОСЫ

### Формат и инициализация

- [x] **Q1:** Структура `~/.org.ve68.duet` — JSON или что-то проще?
  - ✅ **РЕШЕНО:** JSON-файл (не папка!).

- [x] **Q2:** Как выбирать machine alias при первом запуске?
  - ✅ **РЕШЕНО:** Onboarding переносим на **Host app**. Extension только проверяет наличие pointer.

- [x] **Q3:** Что делать если алиас не найден в `{machine}.json`?
  - ✅ **РЕШЕНО:**
    - **Extension:** welcome view "Запустите Duet host"
    - **Host:** warning иконка в трее + UI для исправления

### Миграция

- [x] **Q4:** Как мигрировать существующую конфигурацию?
  - ✅ **РЕШЕНО:** Руками. Приложение пока на одном компе, не в проде.

- [x] **Q5:** Обратная совместимость?
  - ✅ **РЕШЕНО:** Нет. Старый и новый формат сосуществуют временно.

### Формат путей

- [x] **Q7:** business_folders — относительные или через алиасы?
  - ✅ **РЕШЕНО:** Через алиасы (`@БАЗА`, `@МетаЛаб`). Абсолютные пути только в `{machine}.json`.

- [x] **Q8:** Нотация алиасов?
  - ✅ **РЕШЕНО:** Единая нотация `@алиас` везде — и в определении (ключ), и в использовании.

### workspace_info

- [x] **Q6:** Какие пути возвращать в `workspace_info`?
  - ✅ **РЕШЕНО:** `duetDataPath`, `duetConfigPath`, `machine`, `aliases`

### Архитектура компонентов (НОВЫЕ)

- [x] **Q9:** Flow запуска backend — кто инициирует?
  - ✅ **РЕШЕНО:** Все компоненты сами находят pointer `~/.org.ve68.duet`:
    - Host читает pointer → знает где DuetData, DuetConfig
    - Extension читает pointer → запускает backend без аргументов
    - Backend читает pointer → знает где всё
  - **Для тестов:** env `DUET_POINTER_FILE` переопределяет default `~/.org.ve68.duet`

- [x] **Q14:** Extension хранит `duet.data_folder` в VSCode settings — что делать?
  - ✅ **РЕШЕНО:** Выпилить `duet.data_folder` из VSCode settings, заменить на чтение pointer
  - Extension при активации читает pointer
  - Если pointer нет → welcome view "Установите Duet host"

- [x] **Q10:** Кто пишет settings.json?
  - ✅ **РЕШЕНО:** Пользователь руками (или Ariadna). Это source of truth.
  - **Что в settings.json:**
    - `business_folders` — как @aliases
    - `timestampTZ` — единый для всех машин
  - **Что в {machine}.json:**
    - `@aliases` маппинг
    - `port` — может быть разным на машинах (если занят)
  - **version НЕ в config файлах** — это не конфигурация, а состояние установки

- [x] **Q11:** Версионирование компонентов
  - ✅ **РЕШЕНО:**

  | Компонент | Где версия | Bump скрипт | Стратегия |
  |-----------|------------|-------------|-----------|
  | Extension | `packages/extension/package.json` | `build-vsix.js` (patch++) | При сборке VSIX |
  | Host | `packages/host/package.json` | `build-release.js` (создать) | При сборке release |
  | Backend | `DuetData/backend/VERSION` | Нет (= Host version) | Host пишет при установке |

  - **Backend version = Host version** — backend bundled в Host, релизятся вместе
  - **Flow проверки обновления:**
    ```
    Host запускается (v0.2.0)
        ↓
    Читает DuetData/backend/VERSION → "0.1.0"
        ↓
    0.1.0 < 0.2.0 → переустанавливает backend
        ↓
    Пишет DuetData/backend/VERSION → "0.2.0"
    ```
  - ✅ **Создан:** `packages/host/build-release.js` — bump версию + build release

- [x] **Q12:** Два сканера — это временно или постоянно?
  - ✅ **РЕШЕНО:** Временно. Будет только сканер на Python в Backend.
  - **scanner.ts** — прототип, будет удалён
  - **scanner.py** — финальная реализация
  - **План:** Extension будет вызывать Backend API для получения данных иерархии

- [x] **Q13:** Fallback на старый config.json нужен?
  - ✅ **РЕШЕНО:** Нет fallback. Изоляция.
  - Новый код **не знает** о старом формате
  - Миграция делается явно после теста и коммита
  - Старый `config.json` удаляется после полного перехода

---

## ВЫХОДЫ

### 1. Структура файлов

```
~/.org.ve68.duet                    # Глобальный указатель (файл!)
├── machine: "mac_work"
├── duetDataPath: "/Users/starship/DuetData"
└── duetConfigPath: "/Users/starship/.../DuetConfig"

/Users/starship/DuetData/           # Кэш (локальный SSD)
├── data/
│   └── entities.db
├── repos/
│   └── Product.git/
├── backend/
│   └── VERSION                     # Версия установленного backend (= Host version)
├── config.json                     # OLD — удаляется после полной миграции
├── backend.log
└── .pid

/Users/starship/.../DuetConfig/     # Конфигурация (Google Drive)
├── settings.json                   # Общие настройки
└── mac_work.json                   # Маппинг алиасов для этой машины
```

### 2. Формат ~/.org.ve68.duet (pointer file)

```json
{
  "machine": "mac_work",
  "duetDataPath": "/Users/starship/DuetData",
  "duetConfigPath": "/Users/starship/Library/CloudStorage/GoogleDrive-.../My Drive/!БАЗА/DuetConfig"
}
```

### 3. Формат settings.json (общий, в облаке)

```json
{
  "timestampTZ": {
    "id": "M",
    "value": "Europe/Moscow"
  },
  "business_folders": [
    "@БАЗА",
    "@МетаЛаб",
    "@СоциоЛаб",
    "@ТРЕЙДИНГ",
    "@СЕМЬЯ"
  ]
}
```

**Ключевое:**
- `business_folders` — алиасы с `@`, не абсолютные пути
- `timestampTZ` — единый timezone для всех машин
- **НЕТ version** — это не конфигурация
- **НЕТ port** — port в {machine}.json (может быть разным на машинах)

### 4. Формат {machine}.json (локальный маппинг)

```json
{
  "port": 19680,
  "@DuetData": "/Users/starship/DuetData",
  "@DuetConfig": "/Users/starship/Library/CloudStorage/GoogleDrive-.../My Drive/!БАЗА/DuetConfig",
  "@БАЗА": "/Users/starship/Library/CloudStorage/GoogleDrive-.../My Drive/!БАЗА",
  "@МетаЛаб": "/Users/starship/Library/CloudStorage/GoogleDrive-.../My Drive/!МетаЛаб",
  "@СоциоЛаб": "/Users/starship/Library/CloudStorage/GoogleDrive-.../My Drive/!СоциоЛаб",
  "@ТРЕЙДИНГ": "/Users/starship/Library/CloudStorage/GoogleDrive-.../My Drive/!ТРЕЙДИНГ",
  "@СЕМЬЯ": "/Users/starship/Library/CloudStorage/GoogleDrive-.../My Drive/!СЕМЬЯ",
  "@Dropbox_Library": "/Users/starship/Dropbox/Library"
}
```

**Ключевое:**
- `port` — может быть разным на разных машинах (если 19680 занят)
- Ключи с `@` — алиасы, значения — абсолютные пути
- `@DuetData` и `@DuetConfig` — дублирование pointer, но даёт единую нотацию везде

### 5. Формат product.json (source)

Продукты могут иметь разные источники: git репозитории, локальные папки, внешние ресурсы.

```json
// Git репозиторий
{
  "name": "Duet",
  "icon": "🎭",
  "source": {
    "type": "git",
    "url": "git@github.com:alatyshau/duet.git",
    "path": "@DuetData/repos/Duet.git"
  }
}

// Внешняя папка (Dropbox, etc.)
{
  "name": "Dropbox Archive",
  "icon": "📦",
  "source": {
    "type": "local",
    "path": "@Dropbox_Archive"
  }
}

// Продукт без source — открываем папку где лежит манифест
{
  "name": "Андрей",
  "icon": "👨‍🚀"
}
```

**Типы source:**
| type | Обязательные поля | Поведение |
|------|-------------------|-----------|
| `git` | `url`, `path` | clone url → path, open path |
| `local` | `path` | open path напрямую |
| (нет source) | — | open parent folder |

**Расширяемость:** Формат расширяем через `type`. В будущем возможны:
- `git-group` — несколько связанных репозиториев
- `git-sparse` — monorepo с sparse checkout

При сканировании `@алиас` в `path` → резолвится через `{machine}.json` → абсолютный путь.

### 6. Логика резолвинга

```
1. Читаем ~/.org.ve68.duet
   → duetConfigPath, machine

2. Читаем {duetConfigPath}/settings.json
   → business_folders: ["@БАЗА", "@МетаЛаб", ...]

3. Читаем {duetConfigPath}/{machine}.json
   → маппинг: "@БАЗА" → "/Users/.../!БАЗА"

4. Резолвим каждый @алиас → абсолютный путь

5. Сканируем
```

### 7. Расширенный workspace_info

```python
@mcp.tool()
def workspace_info(workspace_path: str = "") -> dict:
    """Get full workspace information."""
    return {
        # Существующие поля
        "duetDataPath": "/path/to/DuetData",
        "instructionsPath": "/path/to/ai-kit",
        "chain": [...],
        "components": [...],
        "status": "found",

        # Новые поля
        "duetConfigPath": "/path/to/DuetConfig",
        "machine": "mac_work",
        "aliases": {
            "@БАЗА": "/Users/.../!БАЗА",
            "@Dropbox_Library": "/Users/.../Dropbox/Library",
            ...
        }
    }
```

---

## ПЛАН ВНЕДРЕНИЯ

### Постановка задачи

#### Scope
Для всех клиентов Duet (extension, host app, AI agents).
- ✅ Включено: новая архитектура конфигурации, product source, расширение workspace_info
- ❌ Исключено: UI для редактирования алиасов (Ариадна редактирует JSON)

#### Monorepo структура (scope этого топика)

```
packages/host/                      # Electron menu bar app
├── src/renderer/pages/
│   └── SetupPage.tsx           # UI для создания pointer (3 поля)
├── src/main/ipc.ts             # IPC handler
└── src/core/config.ts          # createPointer()

packages/backend/               # Python FastAPI backend
├── pointer.py     (новый)      # Читает ~/.org.ve68.duet
├── aliases.py     (новый)      # Резолвит @aliases
├── config.py                   # settings.json + {machine}.json
├── scanner.py                  # @aliases + source
├── db.py                       # source fields
└── services/workspace.py       # + aliases в ответе

packages/extension/             # VSCode extension
├── src/core/config.ts          # Убрать duet.data_folder, читать pointer
└── src/extension.ts            # Проверка pointer при активации
```

**Вне scope:** UI для редактирования алиасов, установка backend

#### Контекст
- Ключевое решение: `@алиас` нотация, резолвится через `{machine}.json`
- Обратная совместимость: нет, старый формат временно сосуществует
- Принцип: кэш (DuetData) отделён от source of truth (DuetConfig)

### Критерии завершённости

**Host (создание pointer):**
- [ ] SetupPage: три поля (DuetData, DuetConfig, machine)
- [ ] Host создаёт `~/.org.ve68.duet`

**Backend (чтение нового конфига):**
- [ ] Читает pointer `~/.org.ve68.duet` (env `DUET_POINTER_FILE` для тестов)
- [ ] Читает settings.json + {machine}.json из DuetConfig
- [ ] Резолвит `@алиасы` → абсолютные пути
- [ ] Парсит `product.json.source` с типами `git`/`local`
- [ ] `workspace_info` возвращает duetConfigPath, machine, aliases

**Extension (проверка pointer):**
- [x] При активации проверяет `~/.org.ve68.duet`
- [x] Если нет → welcome view "Установите Duet Host"
- [x] Убрана логика настройки папки (VSCode settings `duet.data_folder`)

> **Вне scope:** UI для редактирования алиасов, установка backend (остаётся выключенной)

---

### Шаг 0: Дизайн решений
**Статус:** ✅ DONE

Все открытые вопросы Q1-Q14 закрыты. Ключевые решения:
- **Q12:** Только Python сканер, TS scanner.ts — прототип (удалить после миграции на Host)
- **Q13:** Нет fallback. Изоляция. Новый код не знает о старом формате.

---

### Шаг 1: Рефакторинг конфигурации
**Статус:** ✅ DONE

Все компоненты переходят на новую архитектуру конфигурации через pointer файл.

**Todos:**
- [x] 1.1 Backend: создать `pointer.py` + `aliases.py`
- [x] 1.2 Backend: обновить `config.py` для нового формата
- [x] 1.3 Backend: `scanner.py` резолвит @aliases
- [x] 1.4 Backend: `workspace_info` + aliases
- [x] 1.5 Extension: pointer + welcome view + backend-lifecycle без config.json
- [x] 1.6 Host: SetupPage UI

**Host** — создаёт pointer:
```
User запускает Host впервые (pointer не существует)
    ↓
SetupPage: три поля (DuetData, DuetConfig, machine)
    ↓
Host создаёт ~/.org.ve68.duet
```

**Backend** — читает новый конфиг:
- Pointer → где искать (см. [формат](#2-формат-orgve68duet-pointer-file))
- Settings → общие настройки (см. [формат](#3-формат-settingsjson-общий-в-облаке))
- Machine config → алиасы (см. [формат](#4-формат-machinejson-локальный-маппинг))
- Product source → откуда код (см. [формат](#5-формат-productjson-source))

**Extension** — проверяет pointer:
```
Extension активируется
    ↓
Проверяет ~/.org.ve68.duet
    ↓
Нет? → Welcome view "Установите Duet Host"
Есть? → Работает как обычно
```

**Файлы и примеры API:**

**Backend — новые модули:**

```python
# pointer.py
import os
from pathlib import Path

def get_pointer_path() -> Path:
    """Возвращает путь к pointer файлу. Для тестов: env DUET_POINTER_FILE."""
    return Path(os.environ.get('DUET_POINTER_FILE', Path.home() / '.org.ve68.duet'))

def read_pointer() -> dict:
    """Читает pointer. Raises FileNotFoundError если нет."""
    path = get_pointer_path()
    return json.loads(path.read_text())
    # Возвращает: {"machine": "mac_work", "duetDataPath": "...", "duetConfigPath": "..."}
```

```python
# aliases.py
class AliasResolver:
    def __init__(self, machine_config: dict):
        """machine_config — содержимое {machine}.json"""
        self.aliases = {k: v for k, v in machine_config.items() if k.startswith('@')}

    def resolve(self, path: str) -> str:
        """Резолвит @alias в абсолютный путь. Raises KeyError если алиас не найден."""
        if not path.startswith('@'):
            return path
        # "@БАЗА/subfolder" → "/Users/.../!БАЗА/subfolder"
        parts = path.split('/', 1)
        alias = parts[0]
        resolved = self.aliases[alias]
        return resolved if len(parts) == 1 else f"{resolved}/{parts[1]}"
```

**Extension — welcome view:**

```typescript
// extension.ts — при активации
const pointerPath = path.join(os.homedir(), '.org.ve68.duet');
if (!fs.existsSync(pointerPath)) {
    // Показать welcome view вместо TreeView
    vscode.commands.executeCommand('setContext', 'duet.noPointer', true);
    return;
}

// package.json — views
"viewsWelcome": [{
    "view": "duet-explorer",
    "contents": "Duet не настроен.\n\n[Установите Duet Host](https://duet.ve68.org)\n\nПосле установки запустите Host и выберите папки.",
    "when": "duet.noPointer"
}]
```

**Файлы:**
| Компонент | Файл | Что делает |
|-----------|------|------------|
| Host | [SetupPage.tsx](../../packages/host/src/renderer/pages/SetupPage.tsx) | UI: три поля + кнопка создать |
| Host | [config.ts](../../packages/host/src/core/config.ts) | `createPointer()` |
| Backend | `pointer.py` (новый) | См. пример выше |
| Backend | `aliases.py` (новый) | См. пример выше |
| Backend | [config.py](../../packages/backend/config.py) | settings.json + {machine}.json |
| Backend | [scanner.py](../../packages/backend/scanner.py) | @aliases + source |
| Backend | [db.py](../../packages/backend/db.py) | source fields в Entity |
| Extension | [config.ts](../../packages/extension/src/core/config.ts) | Убрать `duet.data_folder`, читать pointer |
| Extension | [extension.ts](../../packages/extension/src/extension.ts) | Проверка pointer при активации |

---

## Текущее состояние (миграция)

### Созданные файлы

| Файл | Статус | Описание |
|------|--------|----------|
| `~/.org.ve68.duet` | ✅ Создан | Pointer (JSON файл, НЕ папка!) |
| `DuetConfig/settings.json` | ✅ Создан | Общие настройки (без version, без port) |
| `DuetConfig/mac_work.json` | ✅ Создан | Маппинг алиасов + port |
| `packages/host/build-release.js` | ✅ Создан | Bump версию + build release |

### Обновлённый код

| Файл | Статус | Что сделано |
|------|--------|-------------|
| `packages/host/src/core/config.ts` | ✅ Обновлён | Читает pointer как файл |
| `packages/host/src/renderer/src/pages/SetupPage.tsx` | ✅ Создан | UI: три поля + кнопка |
| `packages/host/src/main/ipc-handlers.ts` | ✅ Обновлён | config:save-pointer |
| `packages/host/__tests__/helpers/fs.ts` | ✅ Обновлён | Тестовые хелперы |
| `packages/host/__tests__/unit/core/config.test.ts` | ✅ Обновлён | Тесты для нового формата |
| `packages/host/package.json` | ✅ Обновлён | npm run release |
| `packages/backend/pointer.py` | ✅ Создан | Читает ~/.org.ve68.duet |
| `packages/backend/aliases.py` | ✅ Создан | Резолвит @aliases |
| `packages/backend/config.py` | ✅ Обновлён | Pointer-based, settings.json + {machine}.json |
| `packages/backend/server.py` | ✅ Обновлён | Без --data-path, читает pointer |
| `packages/extension/src/core/pointer.ts` | ✅ Создан | Читает pointer + readPort() |
| `packages/extension/src/vscode/providers/OnboardingProvider.ts` | ✅ Создан | Welcome view |
| `packages/extension/src/vscode/extension.ts` | ✅ Обновлён | Читает pointer, context |
| `packages/extension/src/core/backend-lifecycle.ts` | ✅ Обновлён | Pointer-based, VERSION файл, без --data-path |

### Что ещё использует старый формат (config.json)

| Компонент | Файл | Зачем | План |
|-----------|------|-------|------|
| Extension | `scanner.ts` | Читает business_folders | Удалить после перехода на Backend API |
| Extension | `config.ts` (ConfigManager) | Используется scanner.ts, addBusiness.ts | Удалить вместе со scanner.ts |

**Уже не используют config.json:**
- ✅ Backend (pointer → settings.json + {machine}.json)
- ✅ Extension backend-lifecycle (pointer → readPort(), VERSION файл)
