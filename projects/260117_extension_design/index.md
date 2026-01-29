# Extension Design

**Статус:** в работе

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

## Темы

| Файл | Название | Статус |
|------|----------|--------|
| [topic_vscode_extension.md](topic_vscode_extension.md) | VS Code Extension "Duet" | в работе (Step 8) |
| [topic_dependency_check.md](topic_dependency_check.md) | Установка AI Kit из расширения | в работе |
| [topic_nice_to_have.md](topic_nice_to_have.md) | Nice to Have | backlog |

---

## Roadmap

1. ✅ Спецификация расширения (Steps 1-7)
2. 🔄 Реализация UI и логики (Steps 8-12)
3. ⏳ Polish & Release (Step 13)

---

## Открытые вопросы

Нет открытых вопросов.

---

## АРХИВ

### 260130_topic_mcp_integration.md
> Поддержка MCP в расширении Duet

**Статус**: Выполнено @turn(260130).

**Итог**: Реализован нативный MCP сервер на TypeScript. Инструменты `timestamp` и `get_instruction_location` портированы с Python. Сервер регистрируется через VS Code API (`mcpServerDefinitionProviders`).
