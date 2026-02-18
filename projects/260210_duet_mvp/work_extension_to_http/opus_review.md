# Ревью реализации: Extension SQLite → Backend HTTP API

**Ревьюер:** Сократ
**Статус:** Все шаги приняты. N4 требует фикса.

---

## Шаг 0: Backend — абсолютные пути (260218)

**Вердикт: ПРИНЯТ.**

- Алгоритм резолва совпадает с форматом scanner
- Unicode NFC согласован
- Тесты: 5 unit + 2 integration, 164 passed

---

## Шаги 1+2: Tree providers + оркестрация (260218)

**Вердикт: ПРИНЯТ. P1 исправлен — `findClosestEntity()` теперь использует `isPathInside()`. Тест добавлен.**

- DatabaseManager полностью убран из production-кода
- StreamEntity[] sync pattern (R1) реализован корректно
- ConfigManager остался только в addBusiness.ts (R7)
- 118 тестов green, types + lint OK

---

## Шаг 3: Extension MCP → удалить (260218)

**Вердикт: ПРИНЯТ. Без замечаний.**

### Что проверено

- `src/mcp-server/` — удалён. Директория не существует.
- `registerMcpServerDefinitionProvider` — нет в extension.ts. Нет в extension/src/ вообще.
- `mcpServerDefinitionProviders` — нет в package.json.
- `@modelcontextprotocol/sdk`, `zod` — нет в package.json.
- `sql-wasm.wasm` copy в esbuild — удалён.
- Тесты: 118 passed, types OK, lint OK.

Чисто. Всё удалённое — действительно мёртвый код после миграции на backend HTTP MCP.

---

## Шаг 4: Cleanup (260218)

**Вердикт: ПРИНЯТ с 2 замечаниями (N1, N2). Фиксить.**

### N1: Dead getters в `paths.ts`

**Файл:** `packages/extension/src/core/paths.ts:39-67`

Следующие getters не используются нигде в production-коде:
- `dbPath` — был для DatabaseManager
- `dbDir` — был для DatabaseManager
- `backendPath` — был для Extension-managed backend
- `pidPath` — был для Extension-managed backend
- `startupLockPath` — был для Extension-managed backend
- `venvPath` / `venvPython` — был для Extension-managed backend

Host имеет свой `Paths` класс. Extension больше не управляет backend lifecycle. Удалить.

### N2: Dead `atomic_write` в backend `config.py`

**Файл:** `packages/backend/config.py:348`

`atomic_write()` определён, но после удаления `_write_state()` не вызывается нигде. Progress говорит "остаётся как утилита", но dead code = удалить. Если понадобится — вернём из git.

### N3: Stale docstring в `run_scan()`

**Файл:** `packages/backend/services/entities.py:77-83`

```
After successful scan, writes state.json for multi-window sync.
Other VS Code windows watch this file to refresh their TreeView.
```

`_write_state()` удалён, но docstring всё ещё описывает старое поведение. Обновить.

### Что проверено

- `DatabaseManager` — нет ни одного import в extension/src/ (кроме тестов, которые тоже удалены)
- `Scanner` — нет import в extension/src/
- `sql.js`, `write-file-atomic` — нет в package.json
- `bundle-backend.js` — удалён
- `statePath` — удалён из paths.ts
- `_write_state()`, `get_state_path()` — удалены из backend
- Extension: 97 тестов passed. Backend: 164 passed.

---

## Шаг 5: Spec update (260218)

**Вердикт: ПРИНЯТ с 1 замечанием (N4). Фиксить.**

### Что проверено

**Extension ARCHITECTURE.md** — полная переработка, корректна:
- Data Flow section точно описывает activation→streams→providers→refresh цикл
- Key Decisions: `DuetApiClient` + `StreamEntity[]` как центральный паттерн
- Navigation обновлён на актуальные файлы
- Backend Health: "Single check on activation (no polling)" — корректно
- Build: без mcp-server и sql-wasm
- Testing: mock StreamEntity[] и DuetApiClient

**Backend ARCHITECTURE.md** — точечные правки, корректны:
- API Contracts: `absolute_path` документирован в `/streams` и `/projects`
- `atomic_write` и File Safety убраны
- config.py описан как read-only

**ECOSYSTEM.md** — обновлён корректно:
- Диаграмма: Extension = "UI (tree views)", HTTP connection
- DuetData: убраны `index.db`, `mcp/`, `config.json`, `ai-kit/`, `state.json`
- DB file: `entities.db` — корректно (backend использует именно это имя, старый `index.db` — мёртвый файл на диске)
- Who Reads What: убраны `config.json`, `ai-kit/`
- Build & Release: Extension без backend bundling

### N4: "polls" в ECOSYSTEM.md — stale после удаления polling

**Файл:** `spec/ECOSYSTEM.md:255` и `spec/ECOSYSTEM.md:262`

```
Extension (polls /health → detects when backend is up)
Extension → polls /health → detects when backend is up
```

Но строка 270 того же файла правильно говорит: "Extension checks `/health` once on activation (no polling)".

Противоречие. Заменить "polls" → "checks" в обоих местах.
