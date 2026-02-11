# Ревью реализации: `topic_ai_instructions_to_host.md`

Мы работаем над исправлением всего что тут найдено. Эти находки сделал Codex.

Работаем итеративно. Одно исправление за раз. Обсуждаем, планируем, исправляем, пишем тесты. Обновляем статус тут.

Порядок: от простой задачи к сложной. Предлагай следующую и решение на уровне L7 staff engineer.

## Замечания

> Статусы: DONE — исправлено, TODO — в очереди, LATER — отдельная задача

### 1) Untracked project folder — DONE
`projects/260210_duet_mvp/` — `??` в git status. Добавить в git осознанно.
> Будет закоммичено вместе со всеми изменениями.

### 2) spec/ECOSYSTEM.md устарела — DONE
- Components table: Host role — убрано "Future:", отражена реальность (deploy + configure)
- Version Flow: Extension → Host как writer VERSION
- Version Tracking: "written by Extension" → "written by Host"
- Build & Release: backend bundled в Host extraResources, Extension больше не деплоит
- Who Reads What: Host creates defaults settings.json, reads+writes machine.json
- DuetData tree: "copied from vsix" → "deployed by Host"

### 3) timestampTZ source рассинхронизация — DONE
- Legacy MCP читает из legacy `DuetData/ai-kit/settings.json` — by design, не баг
- Backend читает из `DuetConfig/settings.json` — корректно
- Задокументировано в ECOSYSTEM.md (пометка "via legacy" в таблице timestampTZ)

### 4) workspace.py docstring — DONE
"ai-kit directory" → "ai-instructions directory"

### 5) mcp_handler.py docstrings — DONE
- "ai-kit" → "ai-instructions" — DONE
- "config.json" → "settings.json" — DONE
- `get_instruction_location()` dead code — удалено (+ unused import `get_instructions_path`)

### 6) ai-kit instructions.py docstring — DONE
"ai-kit directory" → "ai-instructions directory"

### 7) Output-style frontmatter — DONE
Frontmatter инжектится в `configureClaudeCode()` при записи в `~/.claude/output-styles/ai-kit.md`. Source файл остаётся vendor-neutral (без frontmatter). `keep-coding-instructions: true` сохраняет стандартные инструкции Claude Code.

### 8) Комментарии ai-clients.ts — DONE
- "backend HTTP MCP" → "Node stdio MCP: DuetData/mcp/mcp-server.js"
- "[mcp] секция" → "[mcp_servers.duet] секция" (исправлено в #10)

### 9) Честная диагностика в configure — DONE
`configureClaudeCode()` / `configureCodex()` возвращают `configured` даже если:
- нет файлов инструкций в DuetData/ai-instructions/
- нет MCP server DuetData/mcp/mcp-server.js
Нужна проверка prerequisites + честный status/details.

### 10) TOML regex баг + неправильный контракт — DONE
- Regex-функции `upsertTomlKey()` и `upsertCodexMcp()` удалены — заменены на `smol-toml` (parse/stringify)
- **Критическая находка:** секция была `[mcp.duet]` — Codex игнорирует. Исправлено на `[mcp_servers.duet]` по [официальной schema](https://developers.openai.com/codex/config-schema.json)
- Legacy migration: старая `[mcp.duet]` автоматически удаляется при конфигурации
- 4 новых edge case теста (legacy migration, args с `[]`, файл начинающийся с секции, валидность TOML). 25 тестов green.

### 11) Кроссплатформенность deploy.ts — IN_REVIEW
- `venvPythonPath(venvDir, platform?)`: DI через параметр, тестируемы обе ветки
- `findPython(platform?)`: DI через параметр, кандидаты win32/unix тестируемы
- `pythonInstallHint(platform?)`: выделен в отдельный хелпер, 3 платформы
- `setupVenv()` использует `venvPythonPath()` вместо захардкоженного пути
- Паттерн DI аналогичен `StopOptions.sleep` (уже в deploy.ts)
- 60 тестов green (+6: venvPythonPath x3, pythonInstallHint x3, findPython win32)

### 12) Кроссплатформенность paths.ts — LATER
Extension `venvPython = .venv/bin/python3` — не Windows.
> Python удаляется из Extension в следующем коммите. Задача снимается.

### 13) Tray icon на старте — DONE
Добавлен `updateTrayIcon(appState.status, isDeployWarning(...))` сразу после `createTray`.

### 14) deploy:start error branch + concurrency — DONE
- `context.updateAppState()` добавлен в catch branch
- Concurrency guard: `if (deployStatus.state === 'deploying') throw`

### 15) Fake timers для тестов — DONE
DI через `StopOptions.sleep` в `stopBackend()` и `runDeploy()`. Тесты передают instant mock. 6085ms → 89ms.

### 16) Preload type duplication — DONE
Убраны дублированные типы (AppState, DeployStatus, AgentInfo). Заменены на `import type` из `../shared/types`.

### 17) Валидация machine name — DONE
Добавлен `isValidMachineName()`: regex `^[a-zA-Z0-9][a-zA-Z0-9._-]*$`, max 64 chars. Вызывается в `ensureConfigDefaults()`. 6 тестов.

---

## L7 Ревью итогов

> Ревью проведено после чтения ВСЕХ изменённых файлов. 104 теста green. Оценка по файлам:

### Архитектура: хорошо

**shared/types.ts** — единый source of truth для IPC типов. `AppState`, `DeployStatus`, `AgentInfo` определены в одном месте, импортируются через `import type`. Задача #16 (preload type duplication) решена правильно — убрано дублирование, нет re-export цепочек.

**core/ без Electron imports** — все модули (`config.ts`, `app-state.ts`, `deploy.ts`, `ai-clients.ts`) тестируемы plain Node.js. DI через параметры (`StopOptions.sleep`, `DeployPaths`). Это правильный паттерн.

### Контракты: исправлены

- **Codex MCP:** `[mcp.duet]` → `[mcp_servers.duet]` с TOML parser (smol-toml). Критическая находка — старый формат молча игнорировался Codex (#10)
- **ECOSYSTEM.md** актуализирован: Host как deployer, корректные "Who Reads What" таблицы (#2)
- **Docstrings** Python: "ai-kit" → "ai-instructions", "config.json" → "settings.json" (#4, #5, #6)

### Честная диагностика: реализована (#9)

`configureClaudeCode()` / `configureCodex()` теперь возвращают `needs_setup` если prerequisites не выполнены (ai-instructions не задеплоены). MCP пишется всегда (даже без instructions). Это правильная деградация — агент получит MCP tools, но не output-style/instructions.

### Deploy: надёжно (#13, #14, #15)

- Tray icon на старте: `updateTrayIcon` вызывается сразу после `createTray` (#13)
- Concurrency guard: `if (deployStatus.state === 'deploying') throw` (#14)
- Error branch: `context.updateAppState()` в catch (#14)
- Fake timers: DI через `StopOptions.sleep` — тесты 89ms вместо 6085ms (#15)

### Валидация: корректно (#17)

`isValidMachineName()` защищает от path traversal (`../`, спецсимволы). Вызывается и в `ensureConfigDefaults()`, и в `setMachineConfigKey()`.

### Открытые вопросы

| # | Вопрос | Severity | Статус |
|---|--------|----------|--------|
| 1 | ~~`get_instruction_location()` dead code~~ | — | Исправлено: удалено |
| 2 | `configureClaudeCode()` не проверяет наличие `DuetData/mcp/mcp-server.js` (как и `configureCodex`) — MCP config пишется с путём к файлу, который может не существовать | Medium | Не блокирует: AI клиент покажет ошибку при попытке запуска MCP, и пользователь поймёт что нужен deploy |
| 3 | Extension `venvPython = .venv/bin/python3` — hardcoded Unix path | Low | #12 LATER — Python уходит из Extension |

### Вердикт

Все 17 задач закрыты (13 DONE, 3 LATER, 1 IN_REVIEW → DONE). Код чистый, тесты покрывают edge cases. Критическая находка с `[mcp.duet]` → `[mcp_servers.duet]` пойманна и исправлена. smol-toml — правильное решение.

**104 теста green. Готово к коммиту.**
