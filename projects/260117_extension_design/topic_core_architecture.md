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

**Решение:** Унификация MCP серверов = MCP + сканер + БД.

**Что делаем:**
- Удаляем TS MCP server (`packages/extension/src/mcp-server/`)
- Python MCP server становится единственным
- Реализуем в Python: сканер иерархии + работа с БД (сейчас не реализовано)
- Добавляем HTTP транспорт (для Duet-host)

**Итог:** Python ядро владеет всей логикой данных. Extension становится тонким клиентом.

---

### Q5: Use cases для DuckDB и LanceDB
**Статус:** ✅ РЕШЕНО

**Решение:** Не блокер для текущей фазы. Use cases есть (много), но это будущее. Архитектура (Python ядро) уже поддерживает добавление новых БД — обсудим когда дойдём.

---

### Q6: Что переносить в Python
**Статус:** ✅ РЕШЕНО (см. Q4)

**Переносим:**
- [x] MCP server (унификация двух версий)
- [x] Сканер иерархии (сейчас `scanner.ts`)
- [x] Работа с БД (сейчас `db/index.ts`)

Extension остаётся на TS — тонкий клиент, вызывает HTTP API.

---

### Q7: Единый источник правды для DuetData path
**Статус:** ✅ РЕШЕНО

**Проблема:** Сейчас путь к DuetData хранился в двух местах:
- `~/.org.ve68.duet/config.json` (Duet-host)
- VS Code settings `duet.data_folder` (extension)

**Решение:** Единый файл `~/DuetData/config.json`

**Почему этот подход:**
- **Один источник правды** — все читают из одного места
- **Внутри DuetData** — конфигурация рядом с данными
- **Человекочитаемый JSON** — можно редактировать вручную при необходимости

**Миграция:**
- Duet-host: перенести `duetDataPath` из `~/.org.ve68.duet/config.json` в `~/DuetData/config.json`
- Extension: читать из `~/DuetData/config.json` вместо VS Code settings
- VS Code setting `duet.data_folder` — deprecated, удалить

**Формат файла:** см. секцию ВЫХОДЫ → Конфигурация

---

### Q9: Порт и lifecycle backend
**Статус:** ✅ РЕШЕНО

**Порт:**
- Дефолт: `19680`
- Если занят — 4 попытки случайного порта в `[17680, 21680]`
- Слушать только `127.0.0.1` (localhost-only)

**Хранение:** `~/DuetData/config.json`
```json
{
  "port": 19680,
  "duetDataPath": "/Users/username/DuetData"
}
```

**Версионирование:**
- `~/DuetData/backend/VERSION` — файл с версией (для проверки без запуска)
- `/health` возвращает `version` (для проверки запущенного)
- Версия backend = версия Extension из `package.json`

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

3. Проверить ~/DuetData/backend/VERSION
   ├─ Нет файла или версия старая → копируем backend из vsix
   └─ Версия актуальная → ok

4. Запустить backend: spawn python server.py

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
├── config.json       (порт, настройки)
├── backend/          (Python код, копируется из vsix)
│   ├── server.py
│   ├── VERSION       (версия backend)
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
| `entities` | Список entities с фильтрами |
| `scan` | Пересканировать иерархию (блокирующий, до ~1 мин) |

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
│  │ ├── VERSION               (версия backend)            │  │
│  │ └── requirements.txt                                  │  │
│  └───────────────────────────────────────────────────────┘  │
│  ├── config.json            (port, duetDataPath)            │
│  ├── ai-kit/                (инструкции, шаблоны)           │
│  ├── data/entities.db       (SQLite база)                   │
│  └── .pid                   (lockfile — PID процесса)       │
└─────────────────────────────────────────────────────────────┘
                              ↑
              spawn (если не запущен)
                              │
┌─────────────────────────────┴───────────────────────────────┐
│  VS Code Extension                                          │
│  1. При активации: ping GET /health                         │
│  2. Если не отвечает: spawn ~/DuetData/backend/server.py    │
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
- **Backend в DuetData** — Extension копирует из vsix, версионирование через `VERSION` файл
- **Версия backend = версия Extension** — обновляются вместе

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

**Единый файл конфигурации:** `~/DuetData/config.json`

```json
{
  "port": 19680,
  "duetDataPath": "/Users/username/DuetData"
}
```

| Поле | Описание | Кто пишет | Кто читает |
|------|----------|-----------|------------|
| `port` | Порт HTTP API | Backend при старте | Extension, Claude Code |
| `duetDataPath` | Путь к DuetData | install.py | Все |

**Алгоритм выбора порта:**
1. Попробовать `19680` (дефолт)
2. Если занят — 4 попытки случайного порта в диапазоне `[17680, 21680]`
3. Если все 5 попыток неудачны — ошибка

### Транспорт MCP

| Клиент | Транспорт | Конфигурация |
|--------|-----------|--------------|
| Claude Code | HTTP | `claude mcp add --transport http ai-kit http://localhost:{port}/mcp` |
| VS Code Copilot | HTTP | `McpHttpServerDefinition` через extension API |
| Cursor | HTTP | `.cursor/mcp.json` с `"type": "http"` |

**Примечание:** Клиенты читают `port` из `~/DuetData/config.json` перед подключением.

### План миграции

Поэтапный переход без breaking changes (см. ПЛАН ВНЕДРЕНИЯ).

### API Specification

**Базовый URL:** `http://localhost:{port}` (порт из `~/DuetData/config.json`)

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
| entities | `GET /entities` | `entities` | Список entities с фильтрами |
| scan | `POST /scan` | `scan` | Пересканировать иерархию |

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

#### entities

Список entities с фильтрами. Используется Extension для tree views.

**Arguments:**
- `type` (string, optional) — фильтр по типу: business, stream, product, component, project
- `parent_id` (string, optional) — только дети указанного родителя
- `root_only` (boolean, optional) — только корневые entities (без parent)

**Response:**
```json
{
  "entities": [
    {
      "id": "1",
      "type": "business",
      "name": "МетаЛаб",
      "path": "/repos/metalab",
      "parent_id": null,
      "children_count": 3
    }
  ]
}
```

#### scan

Пересканировать иерархию. Блокирующий вызов (до ~1 минуты).

**Arguments:** нет

**Response:**
```json
{
  "status": "completed",
  "entities_count": 42,
  "duration_ms": 3500
}
```

#### Ошибки

```json
{
  "error": "Entity not found",
  "code": "NOT_FOUND"
}
```

HTTP коды: 400 (bad request), 404 (not found), 500 (internal error)

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
  async entities(filters?: EntitiesFilters): Promise<EntitiesResponse> { ... }
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
**Статус:** TODO

Создать packages/backend/ — HTTP сервер с MCP endpoint.

**Ход работы:**
- [ ] Структура packages/backend/ (server.py, scanner.py, db.py, mcp_handler.py)
- [ ] HTTP API: /health, /stop, /timestamp, /duet-data-path, /workspace-info, /entities, /scan
- [ ] MCP endpoint /mcp (HTTP transport)
- [ ] Lockfile (.pid) + алгоритм выбора порта
- [ ] spec/ARCHITECTURE.md, spec/DOMAIN.md
- [ ] Тесты (pytest)

**Коммит:** `feat(backend): Python HTTP backend с MCP`

---

### Шаг 2: Extension → HTTP клиент
**Статус:** TODO

Extension становится тонким клиентом, сам запускает backend.

**Ход работы:**
- [ ] Bundling packages/backend/ в vsix
- [ ] Копирование backend → ~/DuetData/backend/ + VERSION
- [ ] DuetApiClient (api-client.ts)
- [ ] Auto-start backend (lifecycle из Q9)
- [ ] Удалить: mcp-server/, core/db/, scanner.ts, sql.js
- [ ] Обновить spec/ARCHITECTURE.md (архитектура изменилась)

**Коммит:** `refactor(extension): HTTP клиент вместо локальной логики`
