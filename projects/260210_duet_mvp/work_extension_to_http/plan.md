# Extension: SQLite -> Backend HTTP API

**Дата:** 260217
**Роль:** Дедал (PLANNING)
**Шаг:** 3 общего плана (ход_работы.md)

---

## АНАЛИЗ ТЕКУЩЕГО СОСТОЯНИЯ

### Что Extension хранит локально

**1. SQLite `index.db`** (через sql.js WASM):
- Таблица `entities` — полная иерархия business/stream/product/project
- Заполняется локальным `Scanner`, который сканирует файловую систему
- Файл: `DuetData/data/index.db`

**2. `config.json`** (через `ConfigManager`):
- `business_folders` — список корневых папок для сканирования
- `port`, `timestampTZ`, `version` — legacy
- Файл: `DuetData/config.json`
- **Legacy-дубликат** `DuetConfig/settings.json` — Backend читает settings.json, Extension читает config.json. Два файла с одними данными.

### Кто использует DatabaseManager (13 файлов)

| Слой | Файл | Операции | Характер |
|------|-------|----------|----------|
| **WRITE** | `scanner.ts` | init, clear, insertEntity, nameExists, findByName, updateEntityName, save | Полный scan |
| **READ** | `businessTree.ts` | getEntities(null/parentId), getAllEntities, getEntity, hasChildren | Tree navigation |
| **READ** | `projectsList.ts` | findClosestEntity, getEntity, getEntities | Projects listing |
| **READ** | `contextBreadcrumb.ts` | findByName, findClosestEntity, getEntity | Workspace context |
| **READ** | `mcp-server/index.ts` | Свой sql.js, queryEntities, findEntityByName | Standalone stdio MCP |
| **ORCH** | `extension.ts` | Создаёт instance, передаёт в providers | Entry point |
| **ORCH** | `refresh.ts` | Создаёт instance, запускает scanner, dumpIndex | Scan command |

### Кто использует ConfigManager (4 файла)

| Файл | Операции |
|-------|----------|
| `scanner.ts` | `config.read()` — бизнес-папки для сканирования |
| `refresh.ts` | `configManager.read()` — бизнес-папки для workspace generation |
| `addBusiness.ts` | `config.read()` + `config.write()` — добавление бизнеса |

### Что Backend уже предоставляет

| Endpoint | Возвращает | Заменяет в Extension |
|----------|-----------|---------------------|
| `GET /streams` | Все business/stream/product (без projects) | `getEntities`, `getAllEntities`, `findByName`, `findClosestEntity`, `hasChildren` |
| `GET /projects/{id}` | Проекты для stream | `getEntities(parentId)` для projects |
| `POST /scan` | Запускает rescan в backend | Весь `Scanner` класс |
| `GET /workspace-info` | chain, components | Построение chain в `contextBreadcrumb` |
| `GET /health` | Статус backend | Уже используется |

**DuetApiClient** уже есть в Extension и оборачивает все эти endpoints.

---

## РЕШЕНИЯ ИЗ РЕВЬЮ (Сократ, 260217)

### R1: Sync/Async стратегия

**Проблема (P1):** VS Code вызывает `getTreeItem()` для каждого узла. Внутри `hasActiveDescendant()` рекурсивно обходит дерево. Если каждый вызов = HTTP запрос → N+1 проблема. Также `updateCurrentContext()` вызывается из конструктора — конструктор не может быть async.

**Решение:** Загружать `StreamEntity[]` один раз при activation и при refresh. Providers работают sync по этому массиву. Не отдельный класс — просто поле `streams: StreamEntity[]`, разделяемое между providers.

```
activation → await apiClient.streams() → streams: StreamEntity[]
             → передать в providers (фильтруют sync)

refresh    → await apiClient.streams() → обновить массив
             → fire onDidChangeTreeData на всех providers
```

### R2: Entity type mapping

**Проблема (P3):** DatabaseManager возвращает `Entity` (`drivePath`, `parentId`), API возвращает `StreamEntity` (`path`, `parent_id`).

**Решение:** Один маппер `StreamEntity → Entity` в общем месте, или адаптировать tree-код к типам API напрямую. Не размазывать маппинг по providers.

### R3: config.json — legacy-дубликат

`DuetData/config.json` = legacy-дубликат `DuetConfig/settings.json`. После миграции Extension не нуждается в config.json:
- Scanner → заменён `POST /scan`
- business_folders для workspace gen → из `streams[]` (type=business → path)
- addBusiness → оставить ConfigManager минимально до backend endpoint

### R4: hasChildren фильтр

`db.hasChildren(entity.id, ['project'])` — фильтр `excludeTypes: ['project']` становится ненужен. `/streams` не содержит projects, поэтому `streams.some(s => s.parent_id === id)` автоматически исключает проекты.

### R5: Chain building

**Проблема (P4):** `workspaceInfo()` возвращает chain для одного workspace path. А `ContextBreadcrumb` строит chains для произвольных папок — в цикле по всем workspace folders.

**Решение:** С загруженным массивом `streams[]` chain строится тривиально: `parent_id → find parent in streams → recurse to root`. Отдельного механизма не требуется.

### R6: Абсолютные пути в /streams

**Проблема (Шаг 0):** Backend хранит относительные пути в `drive_path` (формат `!МетаЛаб/ДЕЛА/ТехноЛаб`). Extension нужны абсолютные для openFolder, findClosestEntity, workspace generation.

**Подтверждено по коду:** `scanner.py:_to_relative_path()` конвертирует абсолютный → относительный. `EntitiesService._entity_to_dict()` отдаёт `entity.drive_path` как `"path"`. Backend может резолвить обратно через `business_folders` из config.

**Решение:** Backend добавляет `absolute_path` в ответ `/streams` и `/projects` (резолв на стороне backend, клиенты не дублируют логику).

### R7: addBusiness (P2)

**Проблема:** `addBusiness.ts` пишет в `config.json`. Если удалить config.json — команда ломается.

**Решение:** Оставить ConfigManager минимально для addBusiness. Backend endpoint `POST /add-business` — отдельный follow-up, не блокирует core migration (шаги 0-3). Блокирует только полный cleanup в шаге 4.

### R8: Мёртвые артефакты

Одноразовые действия (руками, не кодом):

| Артефакт | Статус |
|----------|--------|
| `DuetData/mcp/` — legacy TS stdio MCP | Удалена |
| `DuetData/ai-kit/` — legacy инструкции + Python MCP | Удалена |
| `delete mcpServers['ai-kit']` в `ai-clients.ts` | Убран из кода |
| `DuetData/data/index.db` — локальная SQLite Extension | Удалить после шага 4 |
| `DuetData/state.json` — write-only, watcher не реализован | Удалить после шага 4 |
| `DuetData/config.json` — legacy-дубликат DuetConfig | Удалить после addBusiness endpoint |
| `~/.claude/settings.json` — permissions `mcp__ai-kit__*` | Удалить в шаге 4 |

---

## КЛЮЧЕВОЕ РЕШЕНИЕ

**Никаких промежуточных абстракций.** Tree providers переходят с `DatabaseManager` (sync, SQLite) на `DuetApiClient` (HTTP) + загруженный `StreamEntity[]` (для sync tree operations).

```
Было:   Extension → DatabaseManager (sql.js) → index.db
Стало:  Extension → DuetApiClient (fetch) → Backend HTTP API
                  → streams: StreamEntity[] (sync доступ для tree providers)
```

**Маппинг операций:**

| Операция Extension | Источник | Логика |
|-------------------|----------|--------|
| `getEntities(null)` — корни | `streams[]` | filter `parent_id === null` |
| `getEntities(parentId)` — дети | `streams[]` | filter `parent_id === id` |
| `getEntities(parentId)` — projects | `apiClient.projects(id)` | async вызов |
| `getAllEntities()` | `streams[]` | весь массив |
| `getEntity(id)` | `streams[]` | find by id |
| `findByName(name)` | `streams[]` | find by name |
| `findClosestEntity(path)` | `streams[]` | find by `absolute_path` prefix |
| `hasChildren(parentId)` | `streams[]` | `some(s => s.parent_id === id)` — фильтр project не нужен (R4) |
| Scan | `apiClient.scan()` | async вызов |
| Chain to root | `streams[]` | parent_id → find parent → recurse (R5) |
| Business folders | `streams[]` | filter type=business → `absolute_path` |

---

## ПЛАН ВНЕДРЕНИЯ

### Критерии завершённости

- [ ] Extension НЕ использует sql.js, index.db, sql-wasm.wasm
- [ ] Extension НЕ содержит Scanner (сканирование через `POST /scan`)
- [ ] Extension НЕ содержит `core/db/` директорию
- [ ] Все tree providers работают через DuetApiClient + StreamEntity[]
- [ ] Extension MCP server удалён (Backend MCP покрывает все tools)
- [ ] `config.json` не используется Extension'ом (кроме addBusiness до backend endpoint)
- [ ] Тесты проходят, verify:extension проходит
- [ ] Spec обновлены

### Шаг 0: Backend — абсолютные пути в /streams
**Статус:** TODO

**Проблема:** Backend хранит относительные пути в `drive_path` (`!МетаЛаб/ДЕЛА/ТехноЛаб`). Extension нужны абсолютные для openFolder, findClosestEntity, workspace generation.

**Решение:** В `EntitiesService._entity_to_dict()` — резолвить relative → absolute через business_folders. Добавить поле `absolute_path` (не ломая существующее `path`).

**Ход работы:**
- [ ] Добавить функцию резолва relative_path → absolute_path (через business_folders из config)
- [ ] Добавить `absolute_path` в `_entity_to_dict()`
- [ ] Обновить `StreamEntity` тип в Extension's `api-client.ts`
- [ ] Тест: `/streams` возвращает корректные абсолютные пути
- [ ] Обновить backend spec

**Коммит:** `feat(backend): add absolute_path to /streams and /projects responses`

### Шаг 1: Tree providers → StreamEntity[] + DuetApiClient
**Статус:** TODO

Переключить `businessTree.ts`, `projectsList.ts`, `contextBreadcrumb.ts` с DatabaseManager на работу с `StreamEntity[]` массивом (sync) и `DuetApiClient` (async для projects).

**Что меняется:**

**businessTree.ts:**
- `BusinessTree(db: DatabaseManager)` → `BusinessTree(streams: StreamEntity[])`
- `getRoots()`: `streams.filter(s => s.parent_id === null)` — sync
- `getChildren(id)`: `streams.filter(s => s.parent_id === id)` — sync
- `getAllNodes()`: весь массив — sync
- `hasChildren(id)`: `streams.some(s => s.parent_id === id)` — sync, без фильтра project (R4)
- `getEntity(id)`: `streams.find(s => s.id === id)` — sync
- Метод `updateStreams(newStreams)` для refresh

**projectsList.ts:**
- `ProjectsList(db)` → `ProjectsList(streams: StreamEntity[], api: DuetApiClient)`
- `findClosestEntity(path)`: поиск по `absolute_path` prefix в `streams[]` — sync
- `getProjects(parentId)`: `await api.projects(parentId)` — async

**contextBreadcrumb.ts:**
- `ContextBreadcrumb(deps with db)` → `ContextBreadcrumb(deps with streams, api)`
- `findByName(name)`: `streams.find(s => s.name === name)` — sync
- `findClosestEntity(path)`: поиск по `absolute_path` prefix — sync
- Chain building: parent_id → find in streams → recurse (R5) — sync

**Entity type mapping (R2):** Один маппер `StreamEntity` → формат для tree. Или адаптировать tree-код к `StreamEntity` напрямую.

**Providers:** BusinessTreeProvider, ContextProvider, ProjectsProvider — принимают `streams[]` и `apiClient` вместо `db`.

**Тесты:** mock `StreamEntity[]` массив вместо DatabaseManager.

**Коммит:** `refactor(extension): tree providers use StreamEntity[] from backend API`

### Шаг 2: extension.ts + refresh.ts → DuetApiClient
**Статус:** TODO

**extension.ts:**
- `DuetApiClient` уже создаётся для health check → расширить использование
- `const { streams } = await apiClient.streams()` → получить `StreamEntity[]`
- Передать `streams` и `apiClient` в providers
- Убрать `DatabaseManager`, `wasmPath`, `db.init()`
- Graceful fallback: если backend недоступен → stubs (как сейчас)

**refresh.ts:**
- `await apiClient.scan()` — backend сканирует
- `const { streams } = await apiClient.streams()` → обновить `StreamEntity[]`
- `fire onDidChangeTreeData` на всех providers
- Workspace generation: `streams.filter(s => s.type === 'business').map(s => s.absolute_path)`
- Убрать DatabaseManager, ConfigManager, Scanner
- `dumpIndex` → dump из `streams[]`

**Коммит:** `refactor(extension): activation and refresh use backend HTTP API`

### Шаг 3: Extension MCP server → удалить
**Статус:** TODO

Extension MCP server (`mcp-server/index.ts`) — legacy stdio, читает `index.db` через sql.js. Backend MCP (`/mcp`) покрывает все tools: `timestamp`, `duet_data_path`, `workspace_info`, `streams`, `projects`, `scan`, `health`.

Extension MCP добавляет `get_hierarchy` и `find_entity` — оба заменяются `streams` (плоский список + фильтрация). Удалять.

**Ход работы:**
- [ ] Удалить `mcp-server/index.ts`
- [ ] Убрать `registerMcpServerDefinitionProvider` из extension.ts целиком
- [ ] Обновить esbuild.js (убрать mcp-server bundle, убрать sql-wasm copy)

**Коммит:** `refactor(extension): remove legacy stdio MCP server`

### Шаг 4: Cleanup
**Статус:** TODO

**Удалить из Extension:**
- `core/db/index.ts` (DatabaseManager)
- `core/scanner.ts` (Scanner)
- `core/config.ts` (ConfigManager) — оставить минимально для addBusiness (R7)
- sql.js, write-file-atomic из dependencies
- Старые тесты (scanner.test.ts, config.test.ts)
- `bundle-backend.js` — backend больше не бандлится в VSIX

**Удалить dead code в backend:**
- `_write_state()` в `packages/backend/services/entities.py`
- `get_state_path()` в `packages/backend/config.py`
- `statePath` getter в `packages/extension/src/core/paths.ts`

**Примечание:** Ручные действия (удаление файлов на диске, чистка settings) — в таблице R8, не в этом шаге.

**Проверить:**
- `npm run verify:extension` проходит
- VSIX собирается и работает

**Коммит:** `refactor(extension): remove SQLite, scanner, legacy deps`

### Шаг 5: Spec update
**Статус:** TODO

- `packages/extension/spec/ARCHITECTURE.md` — убрать sql.js, scanner, config.json, MCP server. DuetApiClient + StreamEntity[] как центральный паттерн.
- `packages/backend/spec/ARCHITECTURE.md` — обновить API contracts (absolute_path)
- `spec/ECOSYSTEM.md` — обновить DuetData structure (убрать index.db, config.json, mcp/, ai-kit/), Who Reads What

**Коммит:** `docs(spec): update specs for Extension HTTP migration`

---

## ОТКРЫТЫЕ ВОПРОСЫ

### 1. addBusiness — backend endpoint
**Статус:** TODO

Сейчас `addBusiness.ts` пишет в `config.json`. Для полного cleanup нужен backend endpoint `POST /add-business` → пишет в `DuetConfig/settings.json`. Отдельный follow-up после core migration.

### 2. Формат absolute_path в API
**Статус:** TODO

Добавить `absolute_path` как новое поле рядом с `path`? Или заменить `path` на абсолютный? Рекомендация: добавить новое поле, не ломая `path` для MCP и других потребителей.

---

## РИСКИ

| Риск | Митигация |
|------|-----------|
| Backend недоступен при старте Extension | Graceful degradation: stubs. Retry при retryBackend |
| addBusiness пишет в config.json | Оставить ConfigManager минимально, backend endpoint позже (R7) |
| Изменение path формата в API | Добавить `absolute_path` как новое поле, не ломая `path` |
