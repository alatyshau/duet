# Архитектура ядра Duet

**Статус:** черновик

---

## МОТИВАЦИЯ

Сейчас в Duet есть дублирование: MCP server существует в двух версиях (Python и TypeScript), логика работы с данными размазана между extension'ом и MCP.

При этом планируется расширение — три базы данных вместо одной (SQLite + DuckDB + LanceDB). Python имеет лучшую нативную поддержку этих БД.

Нужно определиться с архитектурой: где живёт ядро (логика работы с данными), а что является фасадом.

---

## ССЫЛКИ

- [MCP Server (TS)](../../packages/extension/src/mcp-server/index.ts) — текущая TS версия
- [MCP Server (Python)](../../packages/ai-kit/mcp-server/server.py) — Python версия
- [DatabaseManager](../../packages/extension/src/core/db/index.ts) — работа с SQLite в extension (WASM)
- [Duet-host](../../packages/host/) — Electron menu bar приложение (better-sqlite3, нативный)

---

## НАРРАТИВ

### Текущее состояние

Две реализации MCP server делают одно и то же:
- **Python** (`packages/ai-kit/mcp-server/`) — `timestamp`, `get_instruction_location`
- **TypeScript** (`packages/extension/src/mcp-server/`) — то же самое

TS версия копируется в `~/DuetData/mcp/` при активации extension'а. Python версия устанавливается через `install.py`.

Extension на TypeScript содержит всю логику:
- Сканирование иерархии
- Работа с SQLite (sql.js/WASM)
- Построение деревьев для UI

### Проблема WASM

sql.js работает через WASM — это медленнее нативного SQLite и имеет ограничения. Когда добавятся DuckDB и LanceDB, ситуация усложнится — для них тоже есть WASM версии, но они ещё более ограничены.

Python имеет отличную нативную поддержку всех трёх БД.

### Идея: Python как ядро

```
┌─────────────────────────────────────────┐
│  Python Core (data layer)               │
│  - SQLite (иерархия)                    │
│  - DuckDB (аналитика?)                  │
│  - LanceDB (embeddings?)                │
│  - Сканер иерархии                      │
│  - MCP Server                           │
└─────────────────────────────────────────┘
           ↑ stdio / subprocess
┌─────────────────────────────────────────┐
│  VS Code Extension (TypeScript)         │
│  - UI (tree views, commands)            │
│  - Вызывает Python core                 │
└─────────────────────────────────────────┘
```

MCP server становится не просто "утилитой для AI", а **полноценным бэкендом**. Вокруг него два фасада:
- AI-фасад (Claude Code общается через MCP установленный в папку DuetData, а Copilot общается с MCP изнутри VS Code расширения "mcpServerDefinitionProviders")
- Extension-фасад (VS Code UI вызывает те же функции)

### Три базы данных

Зачем три БД:

| БД | Назначение | Почему именно она |
|----|------------|-------------------|
| **SQLite** | Иерархия (бизнесы, дела, продукты) | Простота, надёжность |
| **DuckDB** | Аналитика, агрегации | Колоночное хранение, SQL |
| **LanceDB** | Embeddings, векторный поиск | AI/ML сценарии |

Конкретные use cases для DuckDB и LanceDB пока не определены, но архитектура должна их поддерживать.

---

## ОТКРЫТЫЕ ВОПРОСЫ

### Q1: Python vs TypeScript — финальное решение
**Статус:** ✅ РЕШЕНО

**Решение:** Python ядро.

**Обоснование:**
- Нативная поддержка SQLite, DuckDB, LanceDB
- Богатая экосистема для data processing
- MCP SDK на Python зрелый
- **Главное:** дешевле сделать рефакторинг сейчас, пока кодовая база маленькая, чем накапливать технический долг

---

### Q2: Коммуникация Extension ↔ Python
**Статус:** ✅ РЕШЕНО

**Решение:** HTTP, Extension сам управляет lifecycle backend.

**Архитектура:**
```
┌─────────────────────────────────────────┐
│  VS Code Extension                       │
│  - Управляет lifecycle Python backend    │
│  - Копирует backend из vsix → DuetData   │
│  - UI в боковой панели                   │
└─────────────────────────────────────────┘
              ↓ spawn
┌─────────────────────────────────────────┐
│  Python backend (localhost:PORT)         │
│  - sqlite3 (нативный)                   │
│  - Сканер иерархии                      │
│  - HTTP API + MCP server                │
│  - Единственный владелец БД             │
└─────────────────────────────────────────┘
         ↑ HTTP              ↑ HTTP MCP
┌─────────────┐       ┌─────────────┐
│ Extension   │       │ Claude Code │
└─────────────┘       └─────────────┘
```

**Обоснование:**
- Duet-host **отложен** — не нужен для MVP
- Extension может сам запустить Python
- Один процесс владеет БД — нет race conditions
- HTTP MCP проще конфигурировать

---

### Q3: Python runtime dependency
**Статус:** ✅ РЕШЕНО

**Решение:** Требуем Python 3.10+.

**Поведение Extension при запуске backend:**
1. Проверяет наличие Python 3.10+ (`python3 --version`)
2. Если нет — показывает понятную ошибку с инструкцией
3. При первом запуске создаёт venv в `~/DuetData/.venv`, устанавливает зависимости

---

### Q4: Scope первой фазы
**Статус:** ✅ РЕШЕНО

**Решение:** Новый backend (Python) = MCP (HTTP) + сканер + БД.

**Что делаем:**
- Удаляем TS MCP server (`packages/extension/src/mcp-server/`)
- Реализуем новый Python backend: сканер иерархии + работа с БД + HTTP API + HTTP MCP
- **Legacy Python MCP** (`packages/ai-kit/mcp-server/`) **не используется и не меняется** (временно остаётся в репо)

**Итог:** Python ядро владеет всей логикой данных. Extension становится тонким клиентом.

---

### Q5: Use cases для DuckDB и LanceDB
**Статус:** ✅ РЕШЕНО

**Решение:** Не блокер для текущей фазы. Use cases есть (много), но это будущее. Архитектура (Python ядро) уже поддерживает добавление новых БД — обсудим когда дойдём.

---

### Q6: Что переносить в Python
**Статус:** ✅ РЕШЕНО (см. Q4)

**Переносим:**
- [x] Новый backend: MCP endpoint `/mcp` (HTTP transport)
- [x] Сканер иерархии (сейчас `scanner.ts`)
- [x] Работа с БД (сейчас `db/index.ts`)

Extension остаётся на TS — тонкий клиент, вызывает HTTP API.

---

### Q7: Единый источник правды для DuetData path
**Статус:** ✅ РЕШЕНО

**Проблема:** Сейчас путь к DuetData хранился в двух местах:
- `~/.org.ve68.duet/config.json` (Duet-host)
- VS Code settings `duet.data_folder` (extension)

**Решение:** VS Code settings `duet.data_folder` — единственный источник правды.

**Архитектура:**
```
Extension (VS Code settings: duet.data_folder)
    │
    │ spawn --data-path {dataFolder}
    ▼
Backend (хранит в памяти)
    │
    │ MCP tool: duet_data_path
    ▼
AI Agent
```

**Почему этот подход:**
- **Explicit configuration** — путь передаётся явно, никаких fallback
- **Extension управляет lifecycle** — знает путь, запускает backend
- **Нет config.json для пути** — меньше файлов, меньше синхронизации
- **Пользователь выбирает путь** — Onboarding при первом запуске

---

### Q9: Порт и lifecycle backend
**Статус:** ✅ РЕШЕНО

**Порт:**
- Дефолтный: `19680`. Автоподбор отключён, смена только вручную.
- Extension записывает `port: 19680` в `config.json` (если ещё нет)
- Если занят — ошибка с инструкцией (пользователь меняет port в config.json и mcp.json вручную)
- Слушать только `127.0.0.1` (localhost-only)

**Важно:** Backend **не пишет** в config.json. Все конфиги управляются клиентом (Extension).

**Multi-window safety (обязательное требование):**
- На одном компьютере может быть много процессов/окон VS Code, но backend должен быть **один** на один `DuetDataPath`.
- Extension использует **startup-lock** файл (например `~/DuetData/.backend-start.lock`) и атомарное создание (`O_EXCL`) чтобы **только одно окно** имело право стартовать backend.
- Остальные окна не spawn'ят backend, а **ждут**, пока `/health` начнёт отвечать.

**Версионирование:**
- `config.json` содержит `version` — Extension записывает из `package.json` перед запуском backend
- `/health` возвращает `version` (для проверки запущенного)
- Backend отказывается запускаться если required поля в `config.json` не установлены: `version`, `port`, `business_folders`, `timestampTZ`

**Non-blocking старт Extension:**

UI показывается сразу, проверка backend — async.

```typescript
function checkBackendQuick(): 'likely_running' | 'not_running' {
    const pidFile = path.join(duetDataPath, '.pid');
    if (!fs.existsSync(pidFile)) return 'not_running';

    const pid = parseInt(fs.readFileSync(pidFile, 'utf8'));
    try {
        process.kill(pid, 0); // signal 0 = проверка без убийства (< 1ms)
        return 'likely_running';
    } catch {
        return 'not_running';
    }
}
```

| Результат | UI | Async действие |
|-----------|-----|----------------|
| `likely_running` | Нормальный UI | Ping `/health`, проверить версию |
| `not_running` | Spinner "Запуск..." | Запустить backend |

**Полный алгоритм lifecycle (async, после показа UI):**

```
1. Ping GET /health (timeout 2s)
   │
   ├─ Отвечает
   │   └─ Сравнить version с Extension version
   │       ├─ Актуальная → готово ✓
   │       └─ Старая → POST /stop → wait 3s → goto step 3
   │
   └─ Не отвечает
       └─ Проверить .pid файл
           ├─ Процесс жив → kill(PID) → wait 1s
           └─ Процесса нет → ok

2. (после stop/kill)

3. Проверить версию (Extension знает свою version из package.json)
   ├─ Backend файлы отсутствуют или устарели → копируем backend из vsix
   └─ Backend файлы актуальны → ok

4. Startup-lock: попытаться создать `~/DuetData/.backend-start.lock` (атомарно)
   │
   ├─ Lock НЕ получен
   │   └─ Wait for ready: ping /health с retry (10 попыток × 300ms)
   │       ├─ Отвечает → готово ✓
   │       └─ Не отвечает → ошибка (backend не стартовал в другом окне)
   │
   └─ Lock получен (это окно — единственный starter)
       ├─ Записать port: 19680 в config.json (если ещё не записан)
       ├─ Запустить backend: spawn python server.py --data-path {dataFolder}
       │   ├─ Успешно → goto step 5
       │   └─ Ошибка "Address already in use" → показать ошибку с инструкцией
       └─ (finally) удалить lock-файл

5. Wait for ready: ping /health с retry (10 попыток × 300ms)
   ├─ Отвечает → готово ✓
   └─ Не отвечает → ошибка, показать UI
```

**Edge cases:**

| Ситуация | Действие |
|----------|----------|
| Backend не запущен, файлов нет | Копируем из vsix → запускаем |
| Backend не запущен, старая версия | Перезаписываем → запускаем |
| Backend не запущен, актуальная версия | Запускаем |
| Backend запущен, актуальная версия | Используем |
| Backend запущен, старая версия | `/stop` → перезаписываем → запускаем |
| Backend завис (PID есть, не отвечает) | `kill(PID)` → перезаписываем → запускаем |
| Python не установлен | UI: "Требуется Python 3.10+" |

---

### Q10: Порядок запуска и доступность сервиса
**Статус:** ✅ РЕШЕНО

**Решение:** Extension сам управляет lifecycle backend (без Duet-host).

**Ключевое:**
- Duet-host **отложен** — не нужен для MVP
- Extension копирует backend из vsix → `~/DuetData/backend/`
- Extension запускает/останавливает/обновляет backend

**Структура DuetData:**
```
~/DuetData/
├── config.json  (version, port, business_folders, timestampTZ)
├── backend/          (Python код, копируется из vsix)
│   ├── server.py
│   └── ...
├── ai-kit/           (инструкции)
├── data/entities.db  (SQLite БД)
└── .pid              (PID запущенного процесса)
```

**Полный алгоритм lifecycle:** см. Q9

**Защита от двойного запуска:**
- Backend при старте пишет PID в `.pid`
- Перед запуском Extension проверяет `.pid` и процесс

**UI при ошибках:**
| Ситуация | UI |
|----------|-----|
| Python не установлен | "Требуется Python 3.10+" + ссылка на инструкцию |
| Backend не запустился | "Ошибка запуска backend" + логи |
| Backend работает | Нормальный UI |

---

### Q11: MCP транспорты — stdio vs HTTP
**Статус:** ✅ РЕШЕНО

**Суть проблемы:**

В Q2 написано "HTTP MCP", но это требовало уточнения. MCP (Model Context Protocol) поддерживает **несколько транспортов**:

| Транспорт | Как работает | Кто использует |
|-----------|--------------|----------------|
| **stdio** | Клиент spawn'ит процесс, общение через stdin/stdout | По умолчанию в большинстве инструментов |
| **HTTP** | Клиент подключается к HTTP серверу | ✅ Claude Code поддерживает |
| **SSE** | Server-Sent Events поверх HTTP | Deprecated, заменён на HTTP |

**Проверка показала:**

Claude Code **поддерживает HTTP MCP** начиная с 2025 года:
- Команда: `claude mcp add --transport http <name> <url>`
- Конфигурация в `.mcp.json`: `{ "type": "http", "url": "http://localhost:19680/mcp" }`
- Поддержка OAuth 2.0 для аутентификации (нам не нужна — localhost)

Источники:
- [Claude Code MCP Docs](https://code.claude.com/docs/en/mcp)
- [InfoQ: Claude Code Remote MCP Support](https://www.infoq.com/news/2025/06/anthropic-claude-remote-mcp/)

**Решение:** Вариант B — только HTTP.

**Обоснование:**
- Один процесс = нет конфликтов за БД
- Единый интерфейс для всех клиентов (Extension, Claude Code, Copilot)
- Проще в разработке и отладке
- HTTP — рекомендуемый транспорт (SSE deprecated)

**Конфигурация Claude Code:**
```bash
claude mcp add --transport http ai-kit http://localhost:19680/mcp
```

Или в `~/.claude/mcp.json`:
```json
{
  "ai-kit": {
    "type": "http",
    "url": "http://localhost:19680/mcp"
  }
}
```

---

### Q12: API контракт — какие endpoints нужны
**Статус:** ✅ РЕШЕНО

**Решение:** Унифицированный API (REST + MCP с одинаковыми названиями).

**Принципы:**
- **Один код** — handlers используются и REST, и MCP
- **Унифицированные названия** — одинаковые имена операций, аргументов, описаний
- **Разница только в протоколе** — REST для Extension, MCP для AI-клиентов
- **JSON + стандартные HTTP коды** — формат ответов
- **Без версионирования** — backend внутри vsix, обновляется вместе с extension
- **Без аутентификации** — localhost-only

**Операции:**

| Операция | Описание |
|----------|----------|
| `health` | Статус сервиса + версия |
| `stop` | Graceful shutdown (только REST, не MCP) |
| `timestamp` | Текущее время в формате YYMMDD_HHMMSS<tz> |
| `duet_data_path` | Путь к DuetData |
| `workspace_info` | Полная информация о workspace (главный вызов для AI) |
| `streams` | Дерево streams (business/stream/product) без projects |
| `projects` | Проекты указанного stream |
| `scan` | Пересканировать иерархию (блокирующий, таймаут клиента ≥20 сек) |

**Формат ответов:** REST оборачивает в объект (расширяемость), MCP возвращает данные напрямую (удобнее для AI). Названия и семантика унифицированы.

**Детали:** см. ВЫХОДЫ → API Specification

---

### Q13: Миграция существующих данных (index.db)
**Статус:** ✅ РЕШЕНО

**Решение:** Новый файл БД с другим именем.

- Python backend → `~/DuetData/data/entities.db` (новый файл)
- Старый extension → продолжает работать с `index.db`
- После завершения миграции → удалить `index.db` руками

**Обоснование:**
- Никакого кода миграции
- Extension продолжает работать во время разработки
- БД — кэш, scan восстановит всё

---

### Q14: Extension lifecycle — детали реализации
**Статус:** ✅ РЕШЕНО (брифинг 260131)

**Решения:**

| Вопрос | Решение |
|--------|---------|
| **Bundling** | Скрипт `bundle-backend.js` копирует `packages/backend/` → `dist/backend/` (без tests/, \_\_pycache\_\_) |
| **Path в vsix** | `BACKEND_RELATIVE_PATH = "dist/backend"` — зафиксировано как константа |
| **Версионирование** | Extension сравнивает `config.json.version` с `package.json.version` + проверяет `hasRequiredFields()` |
| **venv** | Extension вызывает `python3 -m venv` + `pip install -r requirements.txt` |
| **Config validation** | KISS — если пользователь испортил config.json, backend падает с ошибкой. Не repair'им. |
| **Порядок работ** | Шаг 2 (подготовка, не ломает) → Шаг 3 (атомарная замена) |

**Обоснование "не repair config":**
- Если пользователь лезет в config.json — он знает что делает
- Невалидный config = то же самое что занятый порт — backend падает, пользователь чинит
- Меньше кода, меньше edge cases

**Детали:** см. "Алгоритм установки backend" в ВЫХОДЫ.

---

## ВЫХОДЫ

### ⚠️ LEGACY POLICY — НЕ ТРОГАЕМ!

**Следующие файлы и системы — LEGACY. Мы их НЕ МОДИФИЦИРУЕМ, НЕ УДАЛЯЕМ, НЕ "УЛУЧШАЕМ":**

| Legacy | Почему не трогаем |
|--------|-------------------|
| `~/.claude/mcp.json` | Конфиг пользователя, может содержать другие MCP серверы |
| `~/DuetData/mcp/` | Старый TS MCP server, пользователь мог его кастомизировать |
| `packages/ai-kit/install.py` | Standalone установщик, работает независимо |
| `packages/ai-kit/mcp-server/` | Старый Python MCP server (stdio) |

**Новый MCP сервер:**
- Название: `duet` (не `ai-kit`!)
- Transport: HTTP
- Extension автоматически добавляет после установки backend: `claude mcp add --transport http duet http://localhost:{port}/mcp`
- Команда идемпотентна — не трогает legacy `ai-kit`

**Принцип:** Новое рядом со старым. Legacy `ai-kit` продолжает работать.

---

### Архитектурное решение

**Финальная архитектура: Python backend в DuetData + тонкие клиенты**

```
┌─────────────────────────────────────────────────────────────┐
│  ~/DuetData/                                                │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ backend/                  (Python код, копируется     │  │
│  │ ├── server.py              Extension из vsix)         │  │
│  │ ├── scanner.py                                        │  │
│  │ ├── db.py                                             │  │
│  │ ├── mcp_handler.py                                    │  │
│  │ └── requirements.txt                                  │  │
│  └───────────────────────────────────────────────────────┘  │
│  ├── config.json       (version, port, business_folders, timestampTZ) │
│  ├── ai-kit/                (инструкции, шаблоны)           │
│  ├── data/entities.db       (SQLite база)                   │
│  └── .pid                   (lockfile — PID процесса)       │
└─────────────────────────────────────────────────────────────┘
                              ↑
              spawn --data-path {dataFolder}
                              │
┌─────────────────────────────┴───────────────────────────────┐
│  VS Code Extension (duet.data_folder setting)               │
│  1. При активации: ping GET /health                         │
│  2. Если не отвечает: spawn server.py --data-path ...       │
│  3. Работает через HTTP API                                 │
│  4. UI в боковой панели                                     │
└─────────────────────────────────────────────────────────────┘
         ↑ HTTP API                    ↑ HTTP MCP
┌─────────────────────┐       ┌─────────────────────┐
│ Extension UI        │       │ Claude Code         │
│ (tree views,        │       │ (claude mcp add     │
│  commands)          │       │  --transport http)  │
└─────────────────────┘       └─────────────────────┘
```

**Ключевые решения:**
- **Один процесс** — lockfile (`.pid`) предотвращает двойной запуск
- **Extension управляет lifecycle** — Duet-host отложен, не нужен для MVP
- **HTTP для всех** — Extension через REST API, Claude через HTTP MCP
- **Backend в DuetData** — Extension копирует из vsix
- **Версия в config.json** — Extension записывает version из package.json перед запуском backend
- **Explicit configuration** — путь к DuetData передаётся через `--data-path`, никаких fallback

### Структура пакетов (monorepo)

```
packages/
├── extension/      — VS Code extension (тонкий HTTP клиент)
├── ai-kit/         — инструкции + install.py
└── backend/        — Python HTTP сервер  ← NEW
    ├── server.py       (FastAPI/Starlette, точка входа)
    ├── scanner.py      (порт scanner.ts)
    ├── db.py           (работа с SQLite)
    ├── mcp_handler.py  (MCP tools через HTTP)
    └── requirements.txt
```

**Extension** копирует `packages/backend/` (bundled в vsix) → `~/DuetData/backend/` при активации

### Конфигурация

**Принцип:** Extension — единственный источник правды для пути к DuetData.

**Путь к DuetData:**
- Extension хранит в VS Code settings (`duet.data_folder`)
- Backend получает через CLI: `--data-path`
- AI агенты получают через MCP tool `duet_data_path`

```
Extension (VS Code settings)
    │
    │ 1. Пишет port в config.json
    │ 2. spawn python server.py --data-path {dataFolder}
    ▼
Backend (читает port из config.json)
    │
    │ MCP tool: duet_data_path
    ▼
AI Agent
```

**Файлы конфигурации:**

| Файл | Содержимое | Кто пишет | Кто читает |
|------|------------|-----------|------------|
| `~/DuetData/config.json` | version, port, business_folders, timestampTZ | Extension | Backend |

**Порт (Extension):**
1. Записать `port: 19680` в `config.json` (если ещё нет)
2. Запустить backend с `--data-path {dataFolder}`
3. Если ошибка "Address already in use" — показать ошибку: "Port 19680 in use. Run `lsof -i :19680` to find process. Change port in `~/DuetData/config.json` and update `~/.claude/mcp.json`"

### Алгоритм установки backend

**Контекст:** Extension при активации проверяет версию backend и при необходимости устанавливает/обновляет его. Multi-window safe через install lock.

**Константы:**
```typescript
const CONFIG_DEFAULTS = {
  port: 19680,
  business_folders: [],
  timestampTZ: { id: "Z", value: "UTC" }  // default UTC, user configures later
};
const BACKEND_RELATIVE_PATH = "dist/backend";  // внутри vsix/extension
const INSTALL_LOCK = ".install.lock";
const PID_FILE = ".pid";
const INSTALL_TIMEOUT_MS = 60_000;
const HEALTH_TIMEOUT_MS = 2_000;
```

**Входные данные:**
- `extensionVersion` — из extension package.json
- `duetDataPath` — из VS Code setting `duet.data_folder`
- `extensionPath` — путь к установленному extension (содержит `dist/backend/`)

---

**PHASE 1: VERSION + SCHEMA CHECK**

```
configPath = join(duetDataPath, "config.json")
config = readJsonOrNull(configPath)

IF config?.version == extensionVersion AND hasRequiredFields(config):
    GOTO PHASE 3 (STARTUP)
ELSE:
    GOTO PHASE 2 (INSTALL)
```

Проверка `hasRequiredFields` нужна потому что backend отказывается стартовать без всех обязательных полей. Если пользователь вручную испортил config.json или Extension добавил новое обязательное поле — нужно пройти через PHASE 2 для merge.

---

**PHASE 2: INSTALL (atomic, multi-window safe)**

```
STEP 2.1: Acquire install lock
    lockPath = join(duetDataPath, INSTALL_LOCK)

    TRY:
        fd = open(lockPath, O_CREAT | O_EXCL | O_WRONLY)
        write(fd, process.pid)
        close(fd)
        // Lock acquired — we are the installer

    CATCH EEXIST:
        // Another window is installing
        waitUntilGone(lockPath, timeout=INSTALL_TIMEOUT_MS)

        // Re-check after wait
        config = readJsonOrNull(configPath)
        IF config?.version == extensionVersion AND hasRequiredFields(config):
            GOTO PHASE 3 (STARTUP)
        ELSE:
            THROW "Installation failed in another VS Code window"

STEP 2.2: Stop running backend
    port = config?.port ?? CONFIG_DEFAULTS.port

    TRY:
        response = GET http://localhost:{port}/health (timeout=HEALTH_TIMEOUT_MS)
        IF response.ok:
            POST http://localhost:{port}/stop
            sleep(3000)
    CATCH:
        // Backend not responding, continue

    pidPath = join(duetDataPath, PID_FILE)
    IF exists(pidPath):
        pid = parseInt(readFile(pidPath))
        IF processAlive(pid):
            kill(pid, SIGTERM)
            sleep(1000)
            IF processAlive(pid):
                kill(pid, SIGKILL)

STEP 2.3: Copy backend (atomic via rename)
    backendSrc = join(extensionPath, BACKEND_RELATIVE_PATH)
    backendDst = join(duetDataPath, "backend")
    backendNew = join(duetDataPath, "backend.new")
    backendOld = join(duetDataPath, "backend.old")

    // Cleanup (safe — we hold the lock)
    rmrf(backendOld)
    rmrf(backendNew)

    // Copy to temp directory
    copyDirRecursive(backendSrc, backendNew)

    // Atomic switch
    IF exists(backendDst):
        rename(backendDst, backendOld)
    rename(backendNew, backendDst)
    rmrf(backendOld)

STEP 2.4: Ensure venv
    venvDir = join(duetDataPath, ".venv")
    venvPython = join(venvDir, "bin/python3")
    requirements = join(duetDataPath, "backend/requirements.txt")

    IF NOT exists(venvDir):
        showProgress("Creating Python environment...")
        execSync("python3", ["-m", "venv", venvDir])

    showProgress("Installing dependencies...")
    execSync(venvPython, ["-m", "pip", "install", "-q", "-r", requirements])

STEP 2.5: Merge config
    config = config ?? {}
    config.version = extensionVersion

    FOR (field, defaultValue) OF CONFIG_DEFAULTS:
        IF !(field IN config):
            config[field] = defaultValue

    writeJsonAtomic(configPath, config)

STEP 2.6: Release lock
    unlink(lockPath)

    GOTO PHASE 3 (STARTUP)
```

---

**PHASE 3: STARTUP (см. Q9 для полного алгоритма)**

```
// Краткая версия — детали в Q9

STEP 3.1: Quick check
    pidPath = join(duetDataPath, PID_FILE)
    IF exists(pidPath) AND processAlive(readPid(pidPath)):
        status = "likely_running"
    ELSE:
        status = "not_running"

STEP 3.2: Health check or spawn
    IF status == "likely_running":
        TRY:
            response = GET http://localhost:{config.port}/health
            IF response.version == extensionVersion:
                RETURN success  // Backend ready
        CATCH:
            // Fall through to spawn

    // Need to spawn — use startup lock (separate from install lock)
    startupLockPath = join(duetDataPath, ".backend-start.lock")
    // ... (см. Q9 для деталей startup lock)

    venvPython = join(duetDataPath, ".venv/bin/python3")
    spawn(venvPython, ["server.py", "--data-path", duetDataPath], {
        cwd: join(duetDataPath, "backend")
    })

    // Wait for ready
    FOR attempt IN 1..10:
        sleep(300)
        TRY:
            response = GET http://localhost:{config.port}/health
            IF response.ok:
                RETURN success
        CATCH:
            continue

    THROW "Backend failed to start"
```

---

**Вспомогательные функции:**

```typescript
function readJsonOrNull(path: string): object | null {
    try { return JSON.parse(readFileSync(path, 'utf8')); }
    catch { return null; }
}

function hasRequiredFields(config: object): boolean {
    // All fields that backend requires to start
    return (
        typeof config.port === 'number' &&
        Array.isArray(config.business_folders) &&
        isValidTimestampTZ(config.timestampTZ)
    );
}

function isValidTimestampTZ(tz: unknown): boolean {
    return (
        tz != null &&
        typeof tz === 'object' &&
        typeof (tz as any).id === 'string' &&
        typeof (tz as any).value === 'string'
    );
}

function waitUntilGone(path: string, timeout: number): void {
    const start = Date.now();
    while (existsSync(path)) {
        if (Date.now() - start > timeout) throw new Error("Lock timeout");
        sleepSync(500);
    }
}

function processAlive(pid: number): boolean {
    try { process.kill(pid, 0); return true; }
    catch { return false; }
}

function writeJsonAtomic(path: string, data: object): void {
    // Use write-file-atomic or tmp + rename
    const tmp = path + '.tmp';
    writeFileSync(tmp, JSON.stringify(data, null, 2));
    renameSync(tmp, path);
}
```

### Транспорт MCP

| Клиент | Транспорт | Конфигурация |
|--------|-----------|--------------|
| Claude Code | HTTP | `claude mcp add --transport http duet http://localhost:{port}/mcp` |
| VS Code Copilot | HTTP | `McpHttpServerDefinition` через extension API |
| Cursor | HTTP | `.cursor/mcp.json` с `"type": "http"` |

**Примечание:** MCP сервер называется `duet` (не `ai-kit`!). Порт по умолчанию 19680.

### Lock-файлы: алгоритм

**Контекст:** Multi-window VS Code на одном DuetData. Только одно окно должно делать install/startup backend.

**Константы:**
```typescript
const INSTALL_STALE_MS = 60_000;       // 1 минута — lock считается stale
const HEARTBEAT_INTERVAL_MS = 30_000;  // 30 сек — обновление timestamp
```

**Формат lock-файла:**
```
{timestamp}:{windowName}
1706789012345:VS Code (Kreator)
```

**Алгоритм acquire lock:**
```typescript
function acquireLock(lockPath: string, windowName: string): boolean {
  try {
    const fd = fs.openSync(lockPath, 'wx');  // O_CREAT | O_EXCL
    fs.writeSync(fd, `${Date.now()}:${windowName}`);
    fs.closeSync(fd);
    return true;
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;

    // Lock exists — check if stale
    const content = fs.readFileSync(lockPath, 'utf8');
    const [timestamp, owner] = content.split(':');
    const startedAt = parseInt(timestamp);

    if (Date.now() - startedAt > INSTALL_STALE_MS) {
      fs.unlinkSync(lockPath);
      return acquireLock(lockPath, windowName);  // retry
    }
    return false;  // lock held by: owner
  }
}
```

**Heartbeat (владелец lock обновляет timestamp):**
```typescript
async function withInstallLock<T>(lockPath: string, windowName: string, fn: () => Promise<T>): Promise<T> {
  if (!acquireLock(lockPath, windowName)) {
    throw new LockHeldError(getOwnerFromLock(lockPath));
  }

  const heartbeat = setInterval(() => {
    fs.writeFileSync(lockPath, `${Date.now()}:${windowName}`);
  }, HEARTBEAT_INTERVAL_MS);

  try {
    return await fn();
  } finally {
    clearInterval(heartbeat);
    try { fs.unlinkSync(lockPath); } catch {}
  }
}
```

**UX при ожидании (> 5 сек):**
> "Ожидание: VS Code (Kreator) устанавливает backend..."
> [Отменить и исправить вручную]

**Кроссплатформенность:** Только timestamp, без проверки PID (Windows не поддерживает signal 0).

### Состояния боковой панели

**3 состояния:**

| Состояние | Условие | UI |
|-----------|---------|-----|
| `NO_DATA_FOLDER` | `duet.data_folder` не установлен | "Выберите папку DuetData" + кнопка |
| `INITIALIZING` | Папка есть, backend не готов | Progress / ошибка + "Повторить" |
| `READY` | Backend отвечает на `/health` | Дерево streams |

**INITIALIZING sub-states:**
- `in_progress`: "Установка backend..." / "Ожидание VS Code (Kreator)..."
- `failed`: "Python не найден" + [Повторить] + [Инструкция]

**Реализация: Welcome View** (viewsWelcome в package.json):
```json
"viewsWelcome": [
  {
    "view": "duet.streams",
    "contents": "Выберите папку DuetData\n[Выбрать папку](command:duet.selectDataFolder)",
    "when": "!duet.hasDataFolder"
  },
  {
    "view": "duet.streams",
    "contents": "$(sync~spin) Установка backend...",
    "when": "duet.hasDataFolder && duet.initializing"
  },
  {
    "view": "duet.streams",
    "contents": "$(error) Python 3.10+ не найден\n\nНайдено: Python 3.9\n\n[Повторить](command:duet.retry) | [Инструкция](command:duet.showPythonHelp)",
    "when": "duet.initFailed.python"
  }
]
```

**UX ошибки Python** (паттерн из install.py — "Ask your AI assistant"):
> Скопируйте в AI чат:
> "My python3 points to Python 3.9. I need Python 3.10+ for Duet. Help me fix my PATH."

**Принцип:** Extension activation **всегда успешна** (мгновенно). Install/startup — фоновая операция. UI реактивно отражает состояние через `setContext`.

### План миграции

Поэтапный переход без breaking changes (см. ПЛАН ВНЕДРЕНИЯ).

### API Specification

**Базовый URL:** `http://localhost:19680` (дефолтный порт)

**Формат:** JSON, стандартные HTTP коды (200, 400, 500)

**Принцип:** Один handler — два интерфейса. Названия, аргументы, описания унифицированы.

#### Операции

| Операция | REST | MCP Tool | Описание |
|----------|------|----------|----------|
| health | `GET /health` | `health` | Статус сервиса + версия |
| stop | `POST /stop` | — | Graceful shutdown (только REST) |
| timestamp | `GET /timestamp` | `timestamp` | Текущее время YYMMDD_HHMMSS<tz> |
| duet_data_path | `GET /duet-data-path` | `duet_data_path` | Путь к DuetData |
| workspace_info | `GET /workspace-info` | `workspace_info` | Полная информация о workspace |
| streams | `GET /streams` | `streams` | Дерево streams (business/stream/product) |
| projects | `GET /projects/{stream_id}` | `projects` | Проекты указанного stream |
| scan | `POST /scan` | `scan` | Пересканировать иерархию |

**Формат ответов:** REST оборачивает в объект (расширяемость), MCP возвращает данные напрямую (удобнее для AI).

#### health

Проверка работоспособности сервиса. Возвращает версию для проверки необходимости обновления.

**Response:**
```json
{ "status": "ok", "version": "1.0.0", "uptime_seconds": 3600 }
```

#### stop

Graceful shutdown backend. Только REST, нет MCP tool (AI не должен останавливать backend).

**Response:**
```json
{ "status": "stopping" }
```

Backend корректно закрывает соединения, освобождает порт и завершается.

#### timestamp

Текущее время в формате Duet.

**Response:**
```json
{ "timestamp": "260131_143052M" }
```

#### duet_data_path

Путь к директории DuetData.

**Response:**
```json
{ "path": "/Users/username/DuetData" }
```

#### workspace_info

Главный вызов для AI агентов — всё о текущем workspace в одном ответе.

**Arguments:**
- `workspace_path` (string, optional) — путь к workspace; если не указан, используется текущий

**Response:**
```json
{
  "duetDataPath": "/Users/username/DuetData",
  "instructionsPath": "/Users/username/DuetData/ai-kit",
  "chain": [
    { "id": "1", "type": "business", "name": "МетаЛаб", "path": "/repos/metalab" },
    { "id": "2", "type": "stream", "name": "ТехноЛаб", "path": "/repos/metalab/technolab" },
    { "id": "3", "type": "product", "name": "Duet", "path": "/repos/Duet.git" }
  ],
  "components": [
    { "name": "extension", "path": "packages/extension", "hasSpec": true },
    { "name": "ai-kit", "path": "packages/ai-kit", "hasSpec": true },
    { "name": "backend", "path": "packages/backend", "hasSpec": false }
  ]
}
```

#### streams

Дерево streams (business/stream/product) без projects. Используется Extension для sidebar tree view.

**Arguments:** нет

**Response (REST):**
```json
{
  "streams": [
    { "id": "1", "type": "business", "name": "МетаЛаб", "path": "/repos/metalab", "parent_id": null },
    { "id": "2", "type": "stream", "name": "ТехноЛаб", "path": "/repos/metalab/technolab", "parent_id": "1" },
    { "id": "3", "type": "product", "name": "Duet", "path": "/repos/Duet.git", "parent_id": "2" }
  ]
}
```

**Response (MCP):** возвращает список напрямую (без обёртки `{ "streams": [...] }`).

Клиент вычисляет `hasChildren` сам из parent_id отношений.

#### projects

Проекты указанного stream. stream_id может быть ID любого business/stream/product.

**Arguments:**
- `stream_id` (int, required) — ID родительского stream

**Response (REST):**
```json
{
  "projects": [
    { "id": "10", "type": "project", "name": "260117_extension_design", "path": "/projects/260117_extension_design", "parent_id": "3" }
  ]
}
```

**Response (MCP):** возвращает список напрямую.

#### scan

Пересканировать иерархию. Блокирующий вызов (таймаут клиента ≥20 сек).

**Arguments:** нет

**Response:**
```json
{
  "status": "completed",
  "entities_count": 42,
  "duration_ms": 3500
}
```

**Дедупликация:** если последний scan завершился < 5 сек назад, возвращает:
```json
{ "status": "skipped", "reason": "recent_scan" }
```

#### Ошибки

**REST API:**
```json
{
  "error": "Invalid stream_id: must be an integer",
  "code": "BAD_REQUEST"
}
```

HTTP коды: 400 (bad request), 404 (not found), 500 (internal error)

**MCP Tools:**

Используют стандартный механизм MCP — `McpError` с JSON-RPC error codes:

| Ситуация | Error Code | Пример |
|----------|------------|--------|
| Невалидные параметры | `-32602` (INVALID_PARAMS) | `stream_id` не число |
| Внутренняя ошибка | `-32603` (INTERNAL_ERROR) | БД недоступна |

```python
from mcp.shared.exceptions import McpError
from mcp.types import ErrorData, INVALID_PARAMS

raise McpError(ErrorData(code=INVALID_PARAMS, message="stream_id must be integer"))
```

**Не ошибки:** Пустой результат (entity not found) — возвращается пустой список `[]`, не exception.

#### TS Client

При реализации backend — сгенерировать TypeScript клиент для Extension:

```typescript
// packages/extension/src/core/api-client.ts
export class DuetApiClient {
  constructor(private baseUrl: string) {}

  async health(): Promise<HealthResponse> { ... }
  async stop(): Promise<StopResponse> { ... }
  async timestamp(): Promise<TimestampResponse> { ... }
  async duetDataPath(): Promise<DuetDataPathResponse> { ... }
  async workspaceInfo(workspacePath?: string): Promise<WorkspaceInfoResponse> { ... }
  async streams(): Promise<StreamsResponse> { ... }
  async projects(streamId: number): Promise<ProjectsResponse> { ... }
  async scan(): Promise<ScanResponse> { ... }
}
```

---

## ПЛАН ВНЕДРЕНИЯ

### Постановка задачи

**Scope:** Python backend (packages/backend/) + Extension как HTTP клиент. Extension сам управляет lifecycle backend.

**Фундаментальный вопрос:** Как унифицировать работу с данными в едином Python ядре, которое обслуживает и Extension, и AI-агентов?

**Контекст:** Все вопросы решены (Q1-Q13). HTTP для всех клиентов. Новый файл БД (entities.db).

### Критерии завершённости

- [ ] Python backend работает на localhost:19680
- [ ] Extension запускает backend автоматически
- [ ] Extension работает через HTTP API
- [ ] Claude Code подключается через `--transport http`
- [ ] TS MCP server, sql.js, scanner.ts удалены

---

### Шаг 1: Python backend
**Статус:** DONE

Создать packages/backend/ — HTTP сервер с MCP endpoint.

**Ход работы:**
- [x] Структура packages/backend/ (server.py, scanner.py, db.py, mcp_handler.py, config.py)
- [x] HTTP API: /health, /stop, /timestamp, /duet-data-path, /workspace-info, /streams, /projects/{id}, /scan
- [x] MCP endpoint /mcp (HTTP transport via FastMCP)
- [x] Lockfile (.pid), порт из config.json
- [x] spec/ARCHITECTURE.md, spec/DOMAIN.md
- [x] Тесты (pytest) — 76 passed
- [x] Review #1 issues resolved (8/10 CLOSED, 2 DEFER)

**Уточнения:**
- Backend **только читает** конфиги, не пишет
- Порт читается из `config.json`, Extension записывает
- Starlette + uvicorn + mcp SDK

---

### Шаг 2: Backend инфраструктура + установка
**Статус:** DONE

Добавляем инфраструктуру и **реально устанавливаем backend**, но UI остаётся старый (sql.js, scanner.ts). Backend работает "рядом", готов к переключению.

**Ход работы:**
- [x] Backend: после `/scan` писать `state.json` (`{ "last_scan_at": timestamp }`) для multi-window sync
- [x] `ConfigManager.write()` → merge-aware (read existing → merge → write), сохраняет `version`, `port`, `timestampTZ`
- [x] `bundle-backend.js`:
  - Копирует packages/backend/ → dist/backend/ (исключая tests/, \_\_pycache\_\_)
  - Добавлен в `vscode:prepublish` script
  - .vscodeignore не исключает dist/backend/
- [x] `api-client.ts` — DuetApiClient (HTTP клиент для backend API)
- [x] `backend-lifecycle.ts`:
  - Алгоритм install + startup (PHASE 1-3)
  - Lock management с heartbeat
  - Python version check (≥ 3.10) с actionable error
  - Config merge/validation при install
- [x] `sidebar-state.ts` — обёртки над `setContext()` для состояний (NO_DATA_FOLDER → INITIALIZING → READY)
- [x] Welcome View в package.json (viewsWelcome) для состояний
- [x] Подключить lifecycle к activation — backend устанавливается и запускается
- [x] **НЕ добавляем** `claude mcp add` автоматически — см. [AI Setup Wizard](topic_ai_duet_integration.md#шаг-4-ui-для-настройки-ai-агентов-ai-setup-wizard)
- [x] OutputChannel "Duet Backend" для логов
- [x] Команды: `duet.retryBackend`, `duet.showPythonHelp`, `duet.showBackendLogs`

**Ключевое:** После Шага 2 backend работает на localhost:19680, но Extension его **не использует** — старый код (sql.js, TreeView) продолжает работать как раньше.

#### Ad-hoc тестирование

**Подготовка:**
```bash
# 1. Build extension
cd ~/DuetData/repos/Duet.git/packages/extension && npm run package

# 2. Запустить backend в отдельном терминале (держать открытым)
cd ~/DuetData/repos/Duet.git/packages/backend
~/DuetData/.venv/bin/python3 server.py --data-path ~/DuetData
```

**Тесты API:**
| # | Тест | Команда | Статус |
|---|------|---------|--------|
| 1 | Build | `npm run package` — без ошибок | |
| 2 | Backend bundled | `ls dist/backend/` — есть server.py | |
| 3 | /health | `curl -s localhost:19680/health \| jq` | |
| 4 | /timestamp | `curl -s localhost:19680/timestamp \| jq` | |
| 5 | /streams | `curl -s localhost:19680/streams \| jq` | |
| 6 | /scan | `curl -s -X POST localhost:19680/scan \| jq` | |
| 7 | /workspace-info | `curl -s "localhost:19680/workspace-info?workspace_path=$(pwd)" \| jq` | |

   СТАТУС: проверили всё отлично. Но /workspace-info требует переделки. Вводим Шаг 3.

#### Review #1

1. DEFER **install-lock heartbeat не обновляется во время install** — Host устранит multi-window архитектурно; редкий edge case для прототипа — `BackendLifecycle.install()` использует `execSync` (python3/venv/pip), что блокирует event loop; heartbeat на `setInterval` не тикает. При `INSTALL_STALE_MS=60s` другое окно может удалить lock как “stale” и запустить параллельный install. Параллельно `INSTALL_TIMEOUT_MS=60s` не покрывает реальный `pip install`.  
   - **Fix:** убрать блокирующие операции из install (async spawn/execFile), либо сделать lock/heartbeat, который не зависит от event loop; синхронизировать значения stale/timeout с worst-case длительностью install; ожидание чужого install должно уметь self-heal stale lock.
2. DEFER **startup readiness определяется без проверки версии и может давать false-positive READY** — edge case; workaround: перезапустить VS Code — `waitForHealth()` возвращает success по любому ответу `/health` и не валидирует ожидаемую версию; при живом старом backend’е новый backend может не подняться (порт занят/краш), но UI уйдёт в READY. Дополнительно `startup()` не делает stop/replace при mismatch версии.  
   - **Fix:** `waitForHealth()` должен валидировать ожидаемую версию; при mismatch требуется stop/replace перед spawn. Для проверки версии нужен источник, не зависящий только от `config.json` (health сейчас возвращает `version` из config).
3. DEFER **порт читается один раз в конструкторе** — порт не меняется в рамках сессии; теоретическая проблема — `DuetApiClient` создаётся в конструкторе `BackendLifecycle` из значения, прочитанного один раз (или из default). При ручной смене порта/после merge defaults health/stop будут ходить не туда.  
   - **Fix:** вычислять baseUrl из актуального `config.port` перед запросами (или пересоздавать client после `readFull()/ensureDefaults()`).
4. DEFER **startup-lock без stale recovery** — Host будет управлять lifecycle; Extension станет тонким клиентом — `.backend-start.lock` создаётся через `O_EXCL`, но при падении окна/kill extension остаётся навсегда и блокирует старт до ручного удаления.  
   - **Fix:** добавить stale/heartbeat/PID-based recovery для startup lock (или унифицировать с install lock).
5. DEFER **extension host блокируется во время ensureRunning** — первый запуск, один раз; Host уберёт install из Extension — несмотря на async запуск, внутри используются `execSync` и sync FS (copyDir/rename) → блокируется extension host/UI, и дополнительно ломается heartbeat.  
   - **Fix:** перевести тяжёлые операции на async child_process + async fs, с логированием/прогрессом через OutputChannel.
6. CLOSED **логи backend в файл** — решает BrokenPipe/SIGPIPE + сохраняет логи между сессиями
   - Backend: `setup_logging()` → RotatingFileHandler (`DuetData/backend.log`, 5 MB, 1 backup)
   - Extension: `spawn(..., { stdio: 'ignore' })` — pipe не нужен
7. CLOSED **atomic write для всех файлов** — industry standard, минусов нет
   - Extension: `fs.atomicWriteFile()` в FileSystem интерфейс → config.json
   - Backend: `config.atomic_write()` → state.json
8. DEFER **platform assumptions в lifecycle/paths** — `Paths.venvPython` жёстко `/.venv/bin/python3`, команды `python3`, сигналы `SIGTERM/SIGKILL`. На Windows это не работает.
   - **Решение:** Host возьмёт lifecycle → platform-aware код будет в Host. См. [topic_host_core.md](../260108_host_design/topic_host_core.md#7-backend-installation).
9.  CLOSED **API client теряет первопричину на не-JSON ошибках** — при `!response.ok` всегда делается `response.json()`, что ломается на text/HTML ответе и скрывает статус/тело.
   - **Fix:** `parseErrorResponse()` — попытка JSON, fallback на text, включение status/statusText.

---

### Шаг 3: Относительные пути + workspace_info
**Статус:** DONE

`/workspace-info` должен корректно резолвить entity из `workspace_path` (cwd агента). Для этого переходим на относительные пути в DB.

**Контекст:**
- AI агент передаёт `workspace_path` = свой Working directory (например `/Users/.../repos/Duet.git`)
- Backend должен найти соответствующую entity и вернуть chain + components
- Сейчас `drive_path` хранится как абсолютный Google Drive путь — сравнение невозможно

**Алгоритм resolve_entity(workspace_path):**
1. Если путь начинается с `{DuetData}/repos/` (полный prefix из config):
   - Извлечь имя папки repo — первый сегмент после `repos/`
   - Обрезать суффикс `.git` (и будущие `.wt-*` для worktree)
   - `find_by_name(folder_name)` → entity (ищем по имени папки repo)
   - Если не найдено → UNKNOWN (AI предупредит пользователя)
2. Иначе (Google Drive путь):
   - Перебрать `business_folders[]` из config, найти который является prefix пути
   - Обрезать business_folder prefix → получить relative_path
   - Нормализовать слэши → `/`
   - `find_closest_entity(relative_path)` → entity
   - Если ни один business_folder не является prefix → UNKNOWN

**Ход работы:**
- [x] **Scanner:** `drive_path` → относительный от business_folder
  - Формат: `{business_folder_name}/{relative_path}` (для уникальности между business_folders)
  - Метод `_to_relative_path()` в Scanner
  - Нормализация слэшей → `/`
- [x] **DB:** `find_by_name()` уже существует — ищет entity по имени
- [x] **WorkspaceService:** реализован `_resolve_entity()` алгоритм
  - `_resolve_from_repos()` — для repos путей (по имени продукта)
  - `_resolve_from_drive()` — для drive путей (по относительному пути)
  - `_strip_repo_suffixes()` — удаление `.git` и `.wt-*`
  - `_get_product_path()` — получение абсолютного пути для scan_components
- [x] **Тесты:** 20 новых тестов в `test_workspace.py`
  - TestResolveEntity (7 тестов)
  - TestStripRepoSuffixes (3 теста)
  - TestGetWorkspaceInfo (4 теста)
  - TestScannerRelativePaths (6 тестов)
- [x] **Fixtures:** расширен `DuetDataBuilder` для repos
- [x] Все 109 тестов проходят

**Known limitations (DEFER):**
- Worktree суффиксы `.wt-*` — реализовано, но не протестировано на реальных worktrees
- Multi-product workspace — AI видит только первый folder

#### Ad-hoc тестирование

**Подготовка:**
```bash
# 1. Build extension
cd ~/DuetData/repos/Duet.git/packages/extension && npm run package

# 2. Запустить backend в отдельном терминале (держать открытым)
cd ~/DuetData/repos/Duet.git/packages/backend
~/DuetData/.venv/bin/python3 server.py --data-path ~/DuetData
```

**Тесты API:**
| # | Тест | Команда | Статус |
|---|------|---------|--------|
| 1 | /scan | `curl -s -X POST localhost:19680/scan \| jq` | ✅ 45 entities |
| 2 | /streams | `curl -s localhost:19680/streams \| jq` | ✅ относительные пути |
| 3 | /projects/:stream_id | `curl -s localhost:19680/projects/... \| jq` | ✅ |
| 4 | /workspace-info | `curl -s "localhost:19680/workspace-info?workspace_path=$(pwd)" \| jq` | ✅ chain + components |

**Тесты MCP (в этом чате с Claude):**
| # | Тест | Действие | Статус |
|---|------|----------|--------|
| 5 | MCP add | `claude mcp add --transport http duet http://localhost:19680/mcp` | ✅ |
| 6 | timestamp | Спросить Claude: "какой сейчас timestamp?" | ✅ |
| 7 | workspace_info | Спросить Claude: "workspace_info для текущей папки" | ✅ |


---

### Шаг 4: Переключение UI на HTTP backend
**Статус:** TODO

Backend уже работает (Шаг 2). Теперь переключаем UI и удаляем старый код **в Extension**.

**Ход работы:**
- [ ] `addBusiness`: генерировать `all-businesses.code-workspace` сразу после записи config.json (не в refresh/scan)
- [ ] Multi-window sync: FileSystemWatcher на `state.json` → refresh TreeView при изменении
  - Backend пишет `state.json` после `/scan` (`{ "last_scan_at": timestamp }`)
  - Extension watch'ит файл, при изменении → `GET /streams` → обновить TreeView
- [ ] Мигрировать TreeView на DuetApiClient (вместо sql.js)
- [ ] Подключить sidebar-state.ts к реальному TreeDataProvider
- [ ] Переключить MCP provider на HTTP (Copilot: `McpHttpServerDefinition`, name: `duet`)
- [ ] Data folder switch: `onDidChangeConfiguration('duet.data_folder')` → остановить старый backend → полный lifecycle для нового пути (PHASE 1-3: install если нужно)
- [ ] Удалить **в Extension**: `src/mcp-server/`, `src/core/db/`, `src/core/scanner.ts`
- [ ] Удалить из package.json: sql.js
- [ ] Удалить из dist: `sql-wasm.wasm`
- [ ] Обновить spec/ARCHITECTURE.md
- [ ] Документация: README с инструкцией `claude mcp add --transport http duet ...`

**⚠️ НЕ ТРОГАЕМ (см. LEGACY POLICY):** `~/DuetData/mcp/`, `~/.claude/mcp.json`, `packages/ai-kit/`

#### Ad-hoc тестирование

**Тесты Extension (F5 в VS Code):**
| # | Тест | Проверить | Статус |
|---|------|-----------|--------|
| 1 | Sidebar NO_DATA_FOLDER | Удалить `duet.data_folder` → Welcome View | |
| 2 | Sidebar READY | Установить путь → дерево streams (из HTTP API) | |
| 3 | Show Backend Logs | Палитра → "Duet: Show Backend Logs" | |
| 4 | TreeView refresh | `/scan` → дерево обновляется | |

**Тестирование:**
- TreeView показывает данные из HTTP API
- MCP `duet` работает через HTTP (Copilot)
- Старый код (sql.js, TS MCP **в Extension**) удалён
- Legacy в DuetData не тронуто
