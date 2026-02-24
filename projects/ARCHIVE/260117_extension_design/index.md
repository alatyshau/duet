# Extension Design

**Статус:** завершён (MVP достигнут, живые идеи в бэклоге)

**Миссия:** Спроектировать и реализовать VS Code расширение "Duet" — навигатор по иерархии бизнесов/дел/продуктов с интеграцией Google Drive и git.

---

## Участники

| ID | Персона | Клиент | Роль |
|----|---------|--------|------|
| Гефест@ClaudeCode(Opus4.5) | Гефест | Claude Code | Реализация, код |
| Дедал@Copilot(Gemini3Pro) | Дедал | GitHub Copilot | Архитектура, ревью |
| Дедал@Codex(GPT5.2) | Дедал | Codex CLI | Архитектура, ревью |
| Сократ@ClaudeCode(Opus4.5) | Сократ | ClaudeCode | Мета-ревью, диалектика и планирование |

---

## Roadmap

1. ✅ Спецификация расширения (Steps 1-7)
2. ✅ Реализация UI и логики (Steps 8-12)
3. ✅ Polish & Release (Step 13)

---

## АРХИВ

### 260224_topic_core_architecture.md
> Архитектура ядра: Python backend + HTTP API

**Статус**: Завершён @turn(260224).

**Итог**: Реализован Python backend (Starlette + uvicorn) с HTTP API и MCP endpoint. Extension мигрирован на тонкий HTTP-клиент. Старый код (sql.js, TS MCP server, scanner.ts) удалён. 14 архитектурных вопросов решены. Lifecycle мигрировал в Host.

---

### 260224_topic_config_architecture.md
> Архитектура конфигурации: pointer, @aliases, DuetConfig

**Статус**: Завершён @turn(260224).

**Итог**: Реализована новая архитектура конфигурации. Pointer file (`~/.org.ve68.duet`) → DuetConfig (settings.json + {machine}.json) с @aliases. Все компоненты (Host, Backend, Extension) обновлены. config.json заменён.

---

### 260220_topic_ai_duet_integration.md
> Интеграция AI с Duet (снятая часть)

**Статус**: Частично завершён @turn(260220).

**Итог**: MCP tools для иерархии реализованы (workspace_info, streams, projects, scan). Bootstrap для Claude Code решён через output styles. Живые идеи (AI Setup Wizard, другие AI) вынесены в бэклог.

---

### 260202_topic_vscode_extension.md
> VS Code Extension "Duet"

**Статус**: Завершён @turn(260202).

**Итог**: Реализовано расширение Duet для VS Code — навигатор по иерархии бизнесов/дел/продуктов. Sidebar с тремя секциями (КОНТЕКСТ, ДЕЛА, ПРОЕКТЫ), SQLite для иерархии, Scanner для манифестов, MCP сервер для AI-интеграции.

---

### 260130_topic_mcp_integration.md
> Поддержка MCP в расширении Duet

**Статус**: Выполнено @turn(260130).

**Итог**: Реализован нативный MCP сервер на TypeScript. Инструменты `timestamp` и `get_instruction_location` портированы с Python. Сервер регистрируется через VS Code API (`mcpServerDefinitionProviders`).
