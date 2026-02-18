# Ход реализации: Extension SQLite → Backend HTTP API

**Начало:** 260218
**Исполнитель:** Дедал

---

## Шаг 0: Backend — абсолютные пути в /streams и /projects

**Статус:** DONE (принят Сократом)

### Задача
Backend хранит относительные пути в `drive_path` (`!МетаЛаб/ДЕЛА/ТехноЛаб`).
Добавить `absolute_path` в ответ `/streams` и `/projects`.

### Что сделано

1. **`packages/backend/services/entities.py`** — три изменения:
   - `_build_path_lookup()` — строит `{business_folder_name: Path}` + `repos_path`. Вызывается один раз на запрос.
   - `_resolve_absolute_path(drive_path, path_lookup)` — резолвит `drive_path` в абсолютный путь. Алгоритм: первый сегмент = имя business_folder → ищем в lookup → собираем полный путь. Fallback: repos_path / drive_path (для проектов из repos/).
   - `_entity_to_dict()` — принимает `path_lookup`, добавляет `absolute_path` в ответ.

2. **`packages/extension/src/core/api-client.ts`** — добавлено `absolute_path: string | null` в `StreamEntity` и `ProjectEntity`.

3. **`packages/backend/tests/test_api.py`** — 7 новых тестов:
   - `TestResolveAbsolutePath` (5 unit-тестов): root, nested, repos, None, no match
   - `TestAbsolutePathIntegration` (2 интеграционных): streams + projects через API

### Чеклист
- [x] Добавить функцию резолва relative_path → absolute_path
- [x] Добавить `absolute_path` в `_entity_to_dict()`
- [x] Обновить `StreamEntity` и `ProjectEntity` тип в Extension's `api-client.ts`
- [x] Unit-тесты: резолв путей
- [x] Integration-тесты: `/streams` и `/projects` возвращают корректные абсолютные пути
- [ ] Обновить backend spec (Шаг 5)

---

## Шаги 1+2: Tree providers → StreamEntity[] + DuetApiClient

**Статус:** DONE (принят Сократом, P1 исправлен)

### P1 fix: `findClosestEntity()` path boundary

**Баг (найден Сократом):** `contextBreadcrumb.ts` — наивный `startsWith` без проверки `/` separator. `/drive/Biz` ложно-положительно матчил `/drive/BizExtra/something`.

**Фикс:** Заменил на `folderPath === s.absolute_path || isPathInside(folderPath, s.absolute_path)`. Использует уже импортированный `isPathInside` — тот же подход, что в `isInsideRepos()` ниже в файле.

**Тест добавлен:** `contextBreadcrumb.test.ts` — "should not false-match path with same prefix but different entity".

### Задача
Все tree-провайдеры (BusinessTree, ContextBreadcrumb, ProjectsList) и VS Code провайдеры (BusinessTreeProvider, ContextProvider, ProjectsProvider) переключить с `DatabaseManager` (sql.js WASM) на `StreamEntity[]` (из `/streams` API) и `DuetApiClient` (для `/projects/{id}`).

### Что сделано

**Ядро (core/tree/):**

1. **`businessTree.ts`** — конструктор принимает `StreamEntity[]` вместо `DatabaseManager`.
   - `updateStreams()` для обновления данных после scan
   - `mapEntity()` использует `absolute_path` как `TreeNode.id`, `parseInt(stream.id)` как `entityId`
   - `getChildren` фильтрует по `parent_id` (строковое сравнение)

2. **`projectsList.ts`** — конструктор принимает `DuetApiClient` вместо `DatabaseManager`.
   - `getProjects(entityId: number | null)` — async, вызывает `api.projects(entityId)`
   - Маппинг `ProjectEntity → ProjectItem`: `absolute_path ?? path` как path

3. **`contextBreadcrumb.ts`** — `ContextBreadcrumbDeps` = `{ streams: StreamEntity[], reposPath: string }`.
   - `updateStreams()` для обновления
   - `findClosestEntity()` — boundary-safe prefix-match по `absolute_path` (P1 fix)
   - `buildChainToRoot()` — обход `parent_id` по `streams[]`
   - `entityToNode()` — маппит snake_case поля StreamEntity

**VS Code провайдеры:**

4. **`BusinessTreeProvider.ts`** — конструктор `(streams, reposPath?)` вместо `(db, wasmPath, reposPath?)`.
5. **`ContextProvider.ts`** — конструктор `(streams, reposPath)` вместо `(db, paths)`.
6. **`ProjectsProvider.ts`** — конструктор `(api: DuetApiClient)` вместо `(db)`.

**Оркестрация:**

7. **`extension.ts`** — `apiClient.streams()` при активации, graceful fallback на stubs.
8. **`refresh.ts`** — `refreshFromBackend()` → `scan()` + `streams()` + workspace generation.

**Тесты:** 5 тестовых файлов переписаны, 118 tests passed (117 + 1 P1 fix тест).

### Чеклист
- [x] Все tree/providers переписаны
- [x] Оркестрация (extension.ts, refresh.ts) через API
- [x] Все тесты зелёные
- [x] P1 fix: path boundary в findClosestEntity
- [x] verify:extension — types + lint + tests

---

## Шаг 3: Extension MCP server → удалён

**Статус:** IN_REVIEW

### Задача
Extension MCP server (`mcp-server/index.ts`) — legacy stdio, читает `index.db` через sql.js. Backend MCP (`/mcp`) покрывает все tools. Удалить.

### Что сделано

1. **Удалён** `src/mcp-server/index.ts` и директория `src/mcp-server/`

2. **`extension.ts`** — убран блок `registerMcpServerDefinitionProvider` (L58-88): создание `serverPath`, регистрация `McpStdioServerDefinition`, весь условный блок `vscode.lm?.registerMcpServerDefinitionProvider`.

3. **`esbuild.js`** — убраны:
   - Копирование `sql-wasm.wasm` в dist (20 строк)
   - MCP Server build context (`mcpCtx`)
   - Ссылки на `mcpCtx` в watch/rebuild секции
   - Неиспользуемые imports `fs` и `path`

4. **`package.json`** — убраны:
   - `mcpServerDefinitionProviders` из `contributes`
   - `@modelcontextprotocol/sdk` из dependencies (только mcp-server использовал)
   - `zod` из dependencies (только mcp-server использовал)

### Что проверено
- `@modelcontextprotocol/sdk` — не импортируется нигде кроме удалённого mcp-server
- `zod` — не импортируется нигде кроме удалённого mcp-server
- `sql-wasm.wasm` copy — нужен был только для dist/mcp-server.js runtime

### Тесты
```
10 test files, 118 tests passed (vitest)
Types: OK (tsc --noEmit)
Lint: OK (eslint)
```

### Чеклист
- [x] Удалить `mcp-server/index.ts`
- [x] Убрать `registerMcpServerDefinitionProvider` из extension.ts
- [x] Обновить esbuild.js (убрать mcp-server bundle, убрать sql-wasm copy)
- [x] Убрать `mcpServerDefinitionProviders` из package.json
- [x] Убрать MCP-only dependencies (`@modelcontextprotocol/sdk`, `zod`)

---

## Шаг 4: Cleanup

**Статус:** IN_REVIEW (N1, N2, N3 исправлены)

### Задача
Удалить из Extension все модули, которые больше не используются после миграции на HTTP API. Удалить dead code в Backend.

### Что сделано

**Extension — удалённые файлы:**

1. **`src/core/db/index.ts`** и директория `src/core/db/` — DatabaseManager (sql.js WASM обёртка)
2. **`src/core/scanner.ts`** — Scanner (файловый сканер иерархии)
3. **`src/test/unit/scanner.test.ts`** — 21 тест Scanner + DatabaseManager
4. **`bundle-backend.js`** — бандлинг Python backend в VSIX (Host теперь управляет backend)

**Extension — правки:**

5. **`src/core/paths.ts`** — убраны мёртвые getters: `statePath`, `dbPath`, `dbDir`, `backendPath`, `pidPath`, `startupLockPath`, `venvPath`, `venvPython` (N1 fix)

6. **`package.json`** — убраны:
   - `sql.js` из dependencies
   - `write-file-atomic` из dependencies
   - `@types/sql.js` из devDependencies
   - `@types/write-file-atomic` из devDependencies
   - `node bundle-backend.js` из `vscode:prepublish` скрипта

**Backend — правки:**

7. **`services/entities.py`** — убраны:
   - `_write_state()` метод (писал state.json для multi-window sync, больше не нужен)
   - Вызов `self._write_state()` из `scan()`
   - Импорты `json`, `atomic_write`, `get_state_path`
   - Обновлён docstring `run_scan()` — убрано упоминание state.json (N3 fix)

8. **`config.py`** — убраны:
   - Функция `get_state_path()` (возвращала путь к state.json)
   - Функция `atomic_write()` — больше не вызывается нигде (N2 fix)
   - Импорты `tempfile`, `os` — использовались только в `atomic_write`

### Что проверено
- `DatabaseManager` не импортируется из production-кода (только из удалённого scanner.ts и тестов)
- `Scanner` не импортируется из `vscode/` слоя
- Dead getters в paths.ts — все 7 удалены, никто не использовал
- `_write_state()`, `get_state_path()`, `atomic_write()` — не вызываются нигде

### Тесты
```
Extension: 10 test files, 97 tests passed (vitest)
Types: OK (tsc --noEmit)
Lint: OK (eslint)

Backend: 164 passed (pytest)
```

### Чеклист
- [x] Удалить `core/db/` (DatabaseManager)
- [x] Удалить `core/scanner.ts` (Scanner)
- [x] Удалить `scanner.test.ts`
- [x] Удалить `bundle-backend.js`
- [x] Убрать dead getters из paths.ts (N1)
- [x] Убрать sql.js, write-file-atomic и их @types из dependencies
- [x] Убрать bundle-backend из prepublish
- [x] Убрать `_write_state()` и `get_state_path()` из backend
- [x] Убрать `atomic_write()` из config.py (N2)
- [x] Обновить docstring `run_scan()` (N3)
- [x] verify:extension проходит
- [x] pytest проходит

---

## Шаг 5: Spec update

**Статус:** IN_REVIEW

### Задача
Обновить спецификации всех затронутых компонентов после миграции Extension с SQLite на Backend HTTP API.

### Что сделано

**1. `packages/extension/spec/ARCHITECTURE.md`** — полная переработка:
- Убрано: sql.js, Scanner, config.json, MCP server, bundle-backend.js, "Backend is embedded in VSIX"
- Убрано: polling каждые 10с (заменено: single check on activation + retry)
- Убрано: File Safety / atomic config.json section
- Добавлено: "Data Flow" section — `StreamEntity[]` sync pattern, activation→refresh цикл
- Обновлено: Key Decisions — `DuetApiClient` + `StreamEntity[]` как центральный паттерн
- Обновлено: Navigation — `core/tree/` файлы вместо `db/index.ts`, `mcp-server/`
- Обновлено: Build & Release — esbuild.js только extension bundle, без mcp-server и sql-wasm
- Обновлено: Testing — mock StreamEntity[] и DuetApiClient вместо FileSystem DI

**2. `packages/backend/spec/ARCHITECTURE.md`** — точечные правки:
- config.py: убрано упоминание `atomic_write()`
- Navigation: убрана строка "Atomic file write"
- API Contracts: `/streams` и `/projects` — добавлено `absolute_path` в описание
- Убрана секция "File Safety" (atomic_write удалён)

**3. `spec/ECOSYSTEM.md`** — обновления:
- Диаграмма: Extension "UI, tree, scanner" → "UI (tree views)", "polls" → "HTTP"
- Extension description: "thin client — all data from Backend HTTP API"
- AI Kit: MCP note обновлён — "replaced by Backend HTTP MCP"
- DuetData directory: убраны `index.db`, `mcp/`, `config.json`, `ai-kit/`, `state.json`
- settings.json: timestampTZ readers — убран "Extension MCP"
- Database Schema: "Shared schema" → "Backend's SQLite schema"
- Who Reads What: убраны строки `config.json`, `ai-kit/`
- Extension Release: убран bundle-backend шаг, обновлён текст
- Backend artifact: убрано "Extension VSIX"

### Чеклист
- [x] `packages/extension/spec/ARCHITECTURE.md` — полная переработка
- [x] `packages/backend/spec/ARCHITECTURE.md` — absolute_path, убран atomic_write
- [x] `spec/ECOSYSTEM.md` — DuetData structure, Who Reads What, Build & Release
- [x] verify:extension проходит
