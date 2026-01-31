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
- [Duet-host](../../apps/host/) — Electron menu bar приложение (better-sqlite3, нативный)

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
- Backend отказывается запускаться если `version` не установлена

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

## ВЫХОДЫ

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

### Транспорт MCP

| Клиент | Транспорт | Конфигурация |
|--------|-----------|--------------|
| Claude Code | HTTP | `claude mcp add --transport http ai-kit http://localhost:{port}/mcp` |
| VS Code Copilot | HTTP | `McpHttpServerDefinition` через extension API |
| Cursor | HTTP | `.cursor/mcp.json` с `"type": "http"` |

**Примечание:** Порт по умолчанию 19680. При смене порта в `config.json` нужно также обновить `~/.claude/mcp.json`.

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
**Статус:** IN_REVIEW

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

**Коммит:** `feat(backend): Python HTTP backend с MCP`

#### Review #1: Daedalus(GPT) @turn(260131_025510M)

**Issues:**

1. ✅ CLOSED **Версия backend не совпадает с версией Extension** — было: в `server.py` захардкожено `VERSION = "0.6.0"`.
   - **Решение:** version теперь в config.json. Extension записывает из package.json перед запуском. Backend читает через `config.get_version()`. Хардкод убран.

2. ✅ CLOSED **CORS настроен как `allow_origins=["*"]`** — при localhost-only сервис становится читаемым из любого origin в браузере.
   - **Решение:** CORS убран полностью. Ни Extension (Node.js), ни Claude Code не используют браузер.

3. ✅ CLOSED **`/scan` блокирует event loop** — при длительном скане все запросы к backend будут ждать завершения.
   - **Решение:** добавлена дедупликация сканов — если < 5 сек назад → `{"status": "skipped", "reason": "recent_scan"}`. Задокументировано в spec.

4. ✅ CLOSED **Валидация query params неполная → 500 вместо 400**.
   - **Решение:** `/projects/{stream_id:int}` — Starlette route constraint возвращает 404 для non-int. Старый `/entities` удалён.

5. ✅ CLOSED **API контракт "unified handlers" не соблюдён по форме ответов**.
   - **Решение:** это ожидаемое поведение. REST оборачивает в объект (расширяемость), MCP возвращает данные напрямую (удобнее для AI). Задокументировано в топике и spec.

6. ✅ CLOSED **`entities` endpoint слишком общий**.
   - **Решение:** заменён на `/streams` и `/projects/{stream_id}`. Клиент вычисляет `hasChildren` из parent_id.

7. ⏸ DEFER **Неэкспонированный tool `get_instruction_location`**.
   - **Решение:** отложить на `topic_ai_duet_integration.md`. Сейчас legacy MCP работает, не блокер.

8. ✅ CLOSED **Неправильное имя конфига и лишний fallback**.
   - **Решение:** `config.json` везде в коде, fallback на `ai-kit/settings.json` убран, docstrings исправлены.

9. ⏸ DEFER **Риск гонки при прямом запуске двух backend-процессов**.
   - **Решение:** Extension отвечает за startup-lock (Шаг 2). Для backend сейчас действий нет.

10. ✅ CLOSED **Невозможность воспроизвести "pytest — 33 passed"**.
    - **Решение:** создан `requirements-dev.txt`, обновлён `spec/ARCHITECTURE.md` с инструкцией. Добавлена секция "Python Environment" про venv в корне монорепо.

#### Review #2: Daedalus(GPT) @turn(260131_043913M)

**Issues:**

1. ✅ CLOSED **"Fix" для блокировки event loop на `/scan` фактически не решает исходную проблему** — дебаунс (`recent_scan`) снижает частоту запусков, но первый (или редкий) scan всё равно выполняется синхронно внутри `async` handler и на время скана блокирует обработку других запросов.
   - **Fix:** либо принять и явно задокументировать последствия ("backend не отвечает на /health и /stop во время scan"), либо вынести scan из event loop (thread/task) и описать статус/прогресс.
   - **Решение:** Задокументировано в `spec/ARCHITECTURE.md`: debounce, blocking behavior, why OK (single-user local app), future (file watchers + WebSockets).

2. ✅ CLOSED **В топике остаётся противоречие про порт для Claude Code и базовый URL** — одновременно указано:
   - конфиг порта в `config.json` + fallback диапазон (порт может стать ≠19680),
   - но примечание: "Claude Code подключается по фиксированному порту 19680",
   - и "API Specification: Базовый URL http://localhost:19680".
   - **Fix:** привести все упоминания к одному контракту (`{port}` из `config.json`) или явно зафиксировать, что порт *после установки всегда 19680* и fallback запрещён.
   - **Решение:** Fallback убран из Q9 и "Алгоритм выбора порта". Порт фиксированный 19680. Если занят — ошибка с инструкцией: `lsof -i :19680`, изменить в config.json и mcp.json.

3. ✅ CLOSED **Описание `config.json` в топике неполное/разъезжается по секциям** — в Q9/выходах говорится, что `config.json` содержит `version` и `port`, но в таблице "Файлы конфигурации" перечислены только `business_folders, timestampTZ`.
   - **Fix:** синхронизировать список полей `config.json` во всех местах документа.
   - **Решение:** Синхронизировано везде: `version, port, business_folders, timestampTZ`.

4. ✅ CLOSED **"Backend отказывается запускаться если version не установлена" реализовано через исключение в lifespan/health** — `get_version()` вызывается внутри lifespan (print) и в `/health`; при отсутствии/битом `config.json` это приводит к исключению/500 и потенциально неочевидным логам.
   - **Fix:** валидировать наличие `version` в `main()` до старта сервера и завершаться с контролируемым exit code + понятным stderr (без стек-трейса как "контракт поведения").
   - **Решение:** Добавлена проверка в `main()` после `config.init()`. Exit code 1 + понятный stderr. Тест `test_startup_fails_without_version` добавлен.

5. ✅ CLOSED **Валидация `timestampTZ` в `config.json` отсутствует** — `get_timestamp()` ожидает `timestampTZ` как dict с ключами `id`/`value`; при неверном типе/структуре возможен `KeyError`/`TypeError`.
   - **Fix:** валидировать `timestampTZ` при чтении конфига (и иметь детерминированный fallback на DEFAULT_TIMEZONE).
   - **Решение:** Добавлена валидация в `read_config()`: проверка что dict с ключами `id` и `value`, иначе DEFAULT_TIMEZONE. 3 теста добавлены.

6. ✅ CLOSED **MCP tool `projects(stream_id: str)` не валидирует вход** — при нечисловом `stream_id` будет `ValueError` без controlled error payload.
   - **Fix:** добавить явную валидацию и возврат структурированной ошибки (в духе REST `{"error","code"}`) либо стандартизированный MCP error.
   - **Решение:** Добавлен try/except в `mcp_handler.py:projects()` с возвратом `{"error": "...", "code": "BAD_REQUEST"}`. Тест добавлен.

7. ✅ CLOSED **`projects_handler` содержит недостижимую ветку 400 из-за `Route("/projects/{stream_id:int}")`** — сейчас есть `try/except ValueError`, но при non-int запрос не матчит роут и вернёт 404.
   - **Fix:** либо убрать ручной парсинг и полагаться на `stream_id:int` (и тип `int` в `path_params`), либо убрать `:int` и оставить 400.
   - **Решение:** Убран `:int` из роута, теперь handler возвращает 400 с понятным сообщением. Тест обновлён.

8. ✅ CLOSED **Воспроизводимость тестов подтверждена только по артефактам, но не по фактическому прогону** — вижу `requirements-dev.txt` и инструкции в `spec/ARCHITECTURE.md`, но в текущем окружении репозитория `pytest` не установлен, поэтому реальный прогон "74 passed" здесь не верифицирован.
   - **Fix:** зафиксировать в процессе ревью обязательную команду прогона в согласованном окружении (например `.venv/bin/pytest` после установки requirements-dev).
   - **Решение:** Верифицировано: `.venv/bin/pytest` — 82 passed.

#### Review #3: Daedalus(GPT) @turn(260131_051845M)

**Issues:**

1. ✅ CLOSED **Legacy fallback `timestampTZ` через `~/DuetData/ai-kit/settings.json` заявлен в документах, но не реализован в backend**.
   - **Решение:** Убраны упоминания fallback из топика и `spec/DOMAIN.md`. Extension сам записывает `timestampTZ` в `config.json` (Шаг 2). Один источник правды.

2. ✅ CLOSED **API spec vs реализация: MCP tool `health`**.
   - **Решение:** Добавлены `version` и `uptime_seconds` в MCP tool `health`. REST и MCP возвращают одинаковые данные.

3. ✅ CLOSED **Контракт ошибок для MCP tools не описан, но уже используется**.
   - **Решение:** Переделано на стандартный MCP механизм — `McpError` с JSON-RPC error codes (`INVALID_PARAMS = -32602`). Задокументировано в API spec.

4. ✅ CLOSED **Формулировка "порт фиксированный 19680" конфликтует с разрешённой ручной сменой порта**.
   - **Решение:** Заменено "фиксированный" на "дефолтный 19680, автоподбор отключён, смена только вручную". Уточнено в Q9 и примечании к транспортам.

#### Review #4: Daedalus(GPT) @turn(260131_053856M)

**Checked:**

| Item | Status |
|------|--------|
| `topic_core_architecture.md` (Q9, конфиги, API spec, ошибки MCP) | ⚠ |
| `packages/backend/config.py` (version/TZ validation) | ✓ |
| `packages/backend/mcp_handler.py` (McpError, health payload) | ✓ |
| `packages/backend/server.py` (startup version check, /projects 400) | ✓ |
| `packages/backend/spec/DOMAIN.md` (config + file paths) | ✓ |

**Issues:**

1. ⚠ OPEN **В топике всё ещё есть “захардкоженные” примеры `localhost:19680`, которые конфликтуют с “порт настраиваемый через config.json”** — сейчас одновременно:
   - допускается ручная смена `port` в `~/DuetData/config.json`,
   - но в Q11 (примеры Claude Code) и в `API Specification` написано `http://localhost:19680`,
   - и в критериях завершённости: “Python backend работает на localhost:19680”.
   - **Fix:** либо везде заменить на `http://localhost:{port}` (и указать “default 19680”), либо явно написать, что порт **всегда** 19680 (и тогда убрать инструкции про смену порта).

---

### Шаг 2: Extension → HTTP клиент
**Статус:** TODO

Extension становится тонким клиентом, сам запускает backend.

**Ход работы:**
- [ ] Bundling packages/backend/ в vsix
- [ ] Копирование backend → ~/DuetData/backend/
- [ ] Extension записывает version в config.json (из package.json) перед запуском backend
- [x] Backend читает version из config.json (нет version = ошибка) *(Review #1)*
- [x] Убрать хардкод VERSION из server.py, добавить get_version() в config.py *(Review #1)*
- [x] Обновить тестовую фикстуру — создавать config.json с version: "test" *(Review #1)*
- [ ] DuetApiClient (api-client.ts)
- [ ] Auto-start backend (lifecycle из Q9)
- [ ] Startup-lock для multi-window VS Code (`~/DuetData/.backend-start.lock`) — только одно окно стартует backend
- [ ] Удалить: mcp-server/, core/db/, scanner.ts, sql.js
- [ ] Обновить spec/ARCHITECTURE.md (архитектура изменилась)

**Коммит:** `refactor(extension): HTTP клиент вместо локальной логики`
