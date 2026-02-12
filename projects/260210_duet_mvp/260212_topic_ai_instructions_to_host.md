# Перенос AI инструкций и backend в Host

**Статус:** DONE (115 тестов green)

---

## МОТИВАЦИЯ

Установка разбросана: `install.py` (ручной) ставит AI инструкции + настраивает AI клиенты, Extension устанавливает backend. Host только создаёт pointer.

**Цель:** Host — единая точка установки AI инструкций и backend.

---

## ССЫЛКИ

- [spec/ECOSYSTEM.md](../../spec/ECOSYSTEM.md)
- [packages/ai-instructions/spec/ARCHITECTURE.md](../../packages/ai-instructions/spec/ARCHITECTURE.md)
- [projects/260108_host_design/topic_host_core.md](../260108_host_design/topic_host_core.md)
- [projects/260117_extension_design/topic_config_architecture.md](../260117_extension_design/topic_config_architecture.md)

---

## НАРРАТИВ

### packages/ai-instructions создан

Выделен чистый контентный пакет — source of truth для AI инструкций (`src/` + `spec/`). Legacy `packages/ai-kit/` не тронут.

### Разделение DuetData/ai-kit

Инструкции и legacy MCP живут в одной папке `DuetData/ai-kit/`. Разделяем: инструкции → `DuetData/ai-instructions/`, MCP остаётся в `DuetData/ai-kit/`.

### Единый паттерн деплоя

Instructions и backend деплоятся одинаково: bundle в `extraResources` при сборке → VERSION check при запуске → copy если версия изменилась. Для backend — atomic swap (crash safety) + async pip install. Lock-механика Extension не нужна: Host единственный инсталлятор.

### Конфигурация AI клиентов

Все 4 конфигурации из `install.py` переходят в Host через прямую запись файлов (не CLI). Контракты публичные и стабильные:

| Конфигурация | Файл | Формат |
|---|---|---|
| Claude Code output-style | `~/.claude/output-styles/duet.md` | Markdown + YAML frontmatter |
| Claude Code MCP | `~/.claude.json` (не settings.json!) | JSON, `mcpServers` |
| Codex instructions | `~/.codex/config.toml` | TOML, `model_instructions_file` |
| Codex MCP | `~/.codex/config.toml` | TOML, `[mcp_servers.duet]` секция |

Паттерн: detect (есть config dir?) → configure (write files) → show result. Ненайденный AI клиент — не ошибка, просто информация.

### UI Host: решения

**Sidebar:** 2 страницы (убрали "Настройки" — "Запуск при старте" уже в tray menu):
- 📦 Установка — папки + установка компонентов + лог
- 🤖 AI Агенты — конфигурация Claude Code, Codex, ...

**Tray:** 2 состояния (без Warning):
- Normal — всё ОК, или AI агенты не настроены (не ошибка)
- Error — папки не заданы, путь потерян, Python не найден, VERSION mismatch

**Страница "Установка":** папки + машина (верх) → статус компонентов + кнопка "Установить" (центр) → лог (низ). Кнопка показывает что будет установлено.

**Страница "AI Агенты":** список AI клиентов, для каждого: detect → status → auto-configure или инструкции что сделать руками.

---

## ОТКРЫТЫЕ ВОПРОСЫ

_(все закрыты)_

---

## ВЫХОДЫ

### Архитектура деплоя

**Build:** `electron-builder` → `extraResources`.
**Runtime:** VERSION check → skip if same → deploy if different. VERSION mismatch = Error в tray.

| | AI Instructions | Backend |
|---|---|---|
| Source | `packages/ai-instructions/src/` | `packages/backend/` |
| Deploy to | `DuetData/ai-instructions/` | `DuetData/backend/` |
| Copy | простой cp | atomic swap .new/.old |
| Post-deploy | — | check Python 3.10+, stop backend, venv + pip install (async) |

**vs Extension:** убраны install lock, heartbeat, multi-window wait. Atomic swap сохранён (crash safety).

### Конфигурация AI клиентов

Прямая запись файлов (не CLI). Кросс-платформенно через `os.homedir()`. Best effort: detect → configure → show result. Отдельная страница "AI Агенты".

### UI Host

| Элемент | Решение |
|---|---|
| Sidebar | 📦 Установка, 🤖 AI Агенты |
| Страница "Настройки" | Убрана |
| Tray | Normal / Error (без Warning) |
| Error = | папки не заданы, путь потерян, Python не найден, VERSION mismatch |
| Установка | папки + "Установить" + лог |
| AI Агенты | detect → status → configure / manual instructions |

---

## ПЛАН ВНЕДРЕНИЯ

### Постановка задачи

**Scope:** Host устанавливает AI инструкции и backend, конфигурирует AI клиенты. Запуск/остановка backend остаётся за Extension.

### Критерии завершённости

- [x] Host устанавливает AI инструкции в `DuetData/ai-instructions/`
- [x] Host устанавливает backend в `DuetData/backend/`
- [x] Host конфигурирует AI клиенты (Claude Code, Codex)
- [x] UI: страница "Установка" с кнопкой + логом
- [x] UI: страница "AI Агенты"
- [x] Extension не содержит логики установки backend
- [x] Legacy `install.py` больше не нужен

### Шаг 1: packages/ai-instructions
**Статус:** DONE

Source of truth для AI инструкций.

**Коммит:** `feat: extract actual AI instructions in the new package`

### Шаг 2: Host деплоит AI инструкции, backend, конфигурирует AI клиенты
**Статус:** DONE

**Ход работы:**

Пути:
- [x] Backend: `get_ai_kit_path()` → `get_instructions_path()`, путь `"ai-instructions"`
- [x] Backend тесты: обновить ассерты и фикстуры
- [x] Legacy MCP: разделить BASE_PATH на SETTINGS_PATH + INSTRUCTIONS_PATH
- [x] Extension MCP: `"ai-kit"` → `"ai-instructions"`
- [x] Deployed MCP, спеки, верификация

Деплой:
- [x] `electron-builder`: `extraResources` для ai-instructions + backend
- [x] Deploy service: VERSION check → deploy
- [x] AI instructions: copy → `DuetData/ai-instructions/`
- [x] Backend: atomic swap → `DuetData/backend/`, Python check, venv + pip (async)

AI клиенты:
- [x] Прямая запись файлов (Claude Code output-style + MCP, Codex config + MCP)

UI:
- [x] Страница "Установка" (папки + кнопка + лог)
- [x] Страница "AI Агенты" (detect + configure)
- [x] Убрать страницу "Настройки", sidebar = 2 кнопки
- [x] Tray: Error при VERSION mismatch

Cleanup:
- [x] Удалить логику установки из Extension

Доп. работа (ensureConfigDefaults + ревью):
- [x] `ensureConfigDefaults`: Host создаёт settings.json и {machine}.json при сохранении pointer'а
- [x] `detectAgents()`: убран неиспользуемый параметр `duetDataPath` (detect = только "config dir exists?" по спеку)
- [x] `tsconfig.node.json`: добавлены `src/core/**/*`, `src/platform/**/*` в include (typecheck проходил с ошибками)

### Шаг 3: Исправления по ревью
**Статус:** DONE

Ревью: [260212_review_ai_instructions_to_host.md](260212_review_ai_instructions_to_host.md) (17 пунктов).

- [x] #8: Комментарии ai-clients.ts — "backend HTTP MCP" → "Node stdio MCP", "[mcp]" → "[mcp.duet]"
- [x] #4: workspace.py docstring — "ai-kit" → "ai-instructions"
- [x] #5: mcp_handler.py docstrings — "ai-kit" → "ai-instructions", "config.json" → "settings.json"
- [x] #6: ai-kit instructions.py docstring — "ai-kit" → "ai-instructions"
- [x] #13: Tray icon на старте — `updateTrayIcon` после `createTray`
- [x] #14: deploy:start — `context.updateAppState()` в error branch + concurrency guard
- [x] #16: Preload — убраны дублированные типы, `import type` из shared/types.ts
- [x] #17: Валидация machine name — `isValidMachineName()` (path traversal protection)
- [x] #9: Честная диагностика — prerequisites check, `needs_setup` при отсутствии ai-instructions
- [x] #7: Output-style frontmatter — `keep-coding-instructions: true`, файл переименован в `duet.md`
- [x] #10: TOML — smol-toml вместо regex, `[mcp_servers.duet]`, legacy `[mcp.duet]` migration
- [x] #2, #3: spec/ECOSYSTEM.md актуализирован (Version Flow, Build & Release, Who Reads What, timestampTZ)
- [x] #15: Fake timers — DI через `StopOptions.sleep`, тесты 89ms вместо 6085ms
- [x] #11: Кроссплатформенность deploy.ts — `venvPythonPath()`, `findPython()`, `pythonInstallHint()` с DI platform

**Не в этом шаге:**
- #12: Extension `venvPython` — снимается (Python уходит из Extension)
- #5 (dead code): `get_instruction_location()` удалена из mcp_handler.py

### Шаг 4: Python path selector в UI
**Статус:** DONE

Electron на macOS при запуске из Finder/Spotlight получает минимальный PATH (`/usr/bin:/bin:/usr/sbin:/sbin`). Homebrew Python недоступен для auto-detect. Решение: явный выбор/подтверждение пути к Python в UI перед установкой.

- [x] `PythonStatus` discriminated union в `shared/types.ts`
- [x] `validatePython()` в `deploy.ts` — проверка конкретного пути (--version, min 3.10)
- [x] `runDeploy()` принимает `pythonCmd` как параметр (не ищет сам)
- [x] 4 новых IPC канала: `python:detect`, `python:validate`, `python:save`, `dialog:select-file`
- [x] `PythonField` компонент в InstallPage (auto-detect + ручной выбор + retry)
- [x] Секция "Компоненты" появляется только когда Python найден
- [x] `pythonPath` хранится в `{machine}.json` (per-machine)
- [x] 5 новых тестов validatePython, обновлены тесты runDeploy
- [x] Sidebar scroll fix (Layout.tsx: `h-screen overflow-hidden`)

**Коммит:** `4d9ce8b Fix python path resolution and introduce UI for that`

---

## КЛЮЧЕВЫЕ ФАЙЛЫ

| Что | Где |
|-----|-----|
| AI instructions source | `packages/ai-instructions/src/` |
| Legacy installer | `packages/ai-kit/install.py` |
| Legacy Python MCP | `packages/ai-kit/mcp-server/server.py` |
| Backend config | `packages/backend/config.py` |
| Extension backend lifecycle | `packages/extension/src/core/backend-lifecycle.ts` |
| **Host deploy service** | `packages/host/src/core/deploy.ts` |
| **Host AI clients** | `packages/host/src/core/ai-clients.ts` |
| **Host IPC handlers** | `packages/host/src/main/ipc-handlers.ts` |
| **Host InstallPage** | `packages/host/src/renderer/src/pages/InstallPage.tsx` |
| **Host AgentsPage** | `packages/host/src/renderer/src/pages/AgentsPage.tsx` |
| Host main process | `packages/host/src/main/index.ts` |
| Host tray | `packages/host/src/platform/tray.ts` |
| Host preload bridge | `packages/host/src/preload/index.ts` |
| Host preload types | `packages/host/src/preload/index.d.ts` |
| Host config + validation | `packages/host/src/core/config.ts` |
| Host spec | `packages/host/spec/ARCHITECTURE.md` |
| Ecosystem spec | `spec/ECOSYSTEM.md` |
| Ревью | `projects/260210_duet_mvp/260212_review_ai_instructions_to_host.md` |
