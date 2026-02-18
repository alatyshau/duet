# Codex review: Extension SQLite → Backend HTTP API

**Ревьюер:** Сократ (Codex)  
**Дата:** 2026-02-18  
**Скоуп задачи:** миграция Extension с локального `sql.js/index.db` + Scanner на Backend HTTP API (`/streams`, `/projects/{id}`, `/scan`) + удаление legacy MCP server + cleanup + обновление spec.

---

## 0) Что именно я ревьюил (и что сознательно игнорировал)

### В скоупе (reviewed)
- Backend:
  - `packages/backend/services/entities.py` (absolute_path, удаление state.json)
  - `packages/backend/config.py` (удаление `atomic_write`, `get_state_path`)
  - `packages/backend/tests/test_api.py` (unit+integration тесты для `absolute_path`)
  - `packages/backend/spec/ARCHITECTURE.md` (контракт API)
- Extension:
  - `packages/extension/src/core/api-client.ts` (типы `absolute_path`)
  - `packages/extension/src/core/tree/*` (BusinessTree / ContextBreadcrumb / ProjectsList)
  - `packages/extension/src/vscode/*` (activation/refresh/providers)
  - `packages/extension/esbuild.js`, `packages/extension/package.json`
  - удалённые: `core/db/`, `core/scanner.ts`, `mcp-server/`, `bundle-backend.js`, `scanner.test.ts`
  - `packages/extension/spec/ARCHITECTURE.md`
- Cross-spec:
  - `spec/ECOSYSTEM.md`

### Вне скоупа (ignored)
Изменения в `packages/host/*` и `packages/ai-instructions/*` **в этом ревью не оцениваю** (даже если они попали в общий git diff) — по твоей просьбе игнорирую всё, что не относится к миграции Extension→HTTP.

---

## 1) Выполненные проверки (я реально запускал)

### Extension
```bash
npm run verify:extension
```
- Typecheck/lint: OK
- Vitest: **97/97 passed**

### Backend
```bash
cd packages/backend
.venv/bin/python -m pytest
```
- Pytest: **164 passed**

---

## 2) Сводка / вердикт

### Что получилось хорошо (принципиально)
- **Ключевое решение R1 (“StreamEntity[] sync pattern”) реализовано корректно:** загрузка `/streams` один раз на activation и повторно на refresh; tree-операции синхронные по массиву → нет N+1 HTTP.
- **Шаг 3 (удаление Extension MCP server)** выполнен чисто: удалён код, сборка, contributes, зависимости.
- **Cleanup (sql.js, Scanner, index.db, bundle-backend)** проведён последовательно: сборка и тесты зелёные.
- Backend API расширен **backward-compatible** способом: добавлено поле `absolute_path` рядом с `path`.

### Однако
Есть **1 блокирующая проблема** и несколько **существенных (major) замечаний по спецификациям/краям**, которые стоит закрыть до “принятия” задачи.

---

## 3) Blocker (обязательно исправить до мержа)

### B1 — `duet.addBusiness` теперь функционально сломан

**Почему это blocker:** команда “➕ Добавить бизнес” — часть UX Extension. После миграции Scanner переехал в Backend и читает `DuetConfig/settings.json` (через pointer chain), но `addBusiness.ts` продолжает писать в **`DuetData/config.json`**, который Backend **не читает**.

**Фактический эффект сейчас:**
- пользователь выбирает папку → Extension создаёт `business.json` (это ок)
- Extension пишет путь в `DuetData/config.json` (legacy)
- затем вызывает `duet.refresh` → `POST /scan` → Backend сканирует *старый* список бизнесов из `DuetConfig/settings.json`
- новый бизнес **не появится** в дереве, пока пользователь вручную не поправит `DuetConfig/settings.json`

**Где видно в коде:**
- `packages/extension/src/vscode/commands/addBusiness.ts` использует `new ConfigManager(paths.configPath)` и `paths.configPath = DuetData/config.json`.
- Backend `get_business_folders()` читает `DuetConfig/settings.json`, `packages/backend/config.py`.

**Что нужно решить (выбрать один путь):**
1) **Правильный путь:** добавить backend endpoint наподобие `POST /add-business` (обновляет `DuetConfig/settings.json`) и дергать его из Extension.
2) **Компромисс (быстро, но осознанно):** Extension пишет напрямую в `DuetConfig/settings.json` (через `pointer.duetConfigPath`) и хранит там **или** абсолютный путь (работает, но не portable), **или** пытается подобрать `@alias` из `{machine}.json` (лучше).
3) **Если addBusiness больше не нужен:** убрать кнопку/команду из UI и spec (но это уже change поведения и нужно явно подтвердить).

Пока это не решено — миграция ломает существующий UX без явного согласования.

---

## 4) Major issues (желательно исправить до мержа)

### M1 — Spec drift в `packages/extension/spec/*` (кроме ARCHITECTURE)

`packages/extension/spec/ARCHITECTURE.md` обновлён хорошо, но рядом лежат спеки, которые теперь противоречат реальности:
- `packages/extension/spec/MCP.md` — описывает активный Extension MCP server, `mcpServerDefinitionProviders`, `index.db`, `sql-wasm.wasm`, деплой в `DuetData/mcp/` и т.д. **Этого больше нет.**
- `packages/extension/spec/DATA_MODEL.md` — до сих пор утверждает, что Extension имеет `index.db` и использует `db/index.ts` (удалено), и что миграция “в будущем”.

Это опасно, потому что спека в репо — источник истины для агентов и для тебя в будущем. Сейчас она вводит в заблуждение.

**Рекомендация:** либо обновить эти файлы под новую архитектуру, либо явно пометить как `LEGACY` и переместить/удалить (как часть spec hygiene).

### M2 — `spec/ECOSYSTEM.md` утверждает, что `DuetData/config.json` удалён, но код Extension всё ещё его читает/пишет

Даже если ты примешь решение “оставить config.json только для addBusiness”, `ECOSYSTEM.md` сейчас говорит, что `config.json` убран из структуры `DuetData/`.

Нужно привести в соответствие:
- либо реально перестать использовать `DuetData/config.json` (см. B1),
- либо вернуть его в описание как legacy (и указать “кто читает/пишет”).

### M3 — Backend: fallback `repos_path / drive_path` слишком широкий

В `EntitiesService._resolve_absolute_path()` сейчас логика:
1) если первый сегмент совпал с business folder name → ok
2) иначе если `repos_path` существует → вернуть `repos_path / drive_path`

Это корректно для repos-проектов (`MyProduct.git/projects/...`), но теоретически может выдать **ложный absolute_path** для “чужих” `drive_path`, если:
- в БД лежат сущности от старого скана, а business_folders уже изменились/уменьшились,
- или если появился новый формат `drive_path` не относящийся к repos.

**Более безопасный вариант:** делать repos-fallback только если
- `first_segment.endswith('.git')`, и/или
- `(repos_path / drive_path).exists()`

Это уменьшит шанс “тихо” подставить несуществующий путь.

---

## 5) Minor / nit (не блокируют, но стоит учесть)

### m1 — `ProjectsList.getProjects()` глушит все ошибки
Сейчас:
- catch-all → `return []`

Для UX может быть норм, но для дебага хуже. Я бы хотя бы логировал в OutputChannel или возвращал “error node” в дереве проектов (по аналогии с контекстом), чтобы не превращать реальные ошибки API в “пусто”.

### m2 — Стоит зафиксировать ожидание про `absolute_path`
В Extension логика открытия папок опирается на `TreeNode.id` (теперь это `absolute_path ?? path`). Если `absolute_path` внезапно `null`, дальше будет попытка открыть относительный `path`, что почти наверняка неверно.

Рекомендация: в местах, где мы реально *должны* иметь абсолютный путь (openFolder/workspace generation), лучше:
- явно проверять `absolute_path`, и
- показывать понятную ошибку (“backend returned null absolute_path; check settings.json business_folders / reposPath”).

---

## 6) Итог: что я бы попросил сделать перед “принять”

1) **Закрыть B1 (addBusiness):** выбрать стратегию и привести код+spec в соответствие.
2) **Привести extension spec в порядок:** обновить/удалить `spec/MCP.md` и `spec/DATA_MODEL.md` (или явно пометить как legacy).
3) (Опционально, но желательно) сузить backend repos-fallback в `_resolve_absolute_path()`.

После этого — архитектура миграции выглядит цельной и поддерживаемой.

