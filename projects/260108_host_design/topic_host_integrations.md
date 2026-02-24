# Host Integrations: расширение экосистемы

**Статус:** бэклог

---

## МОТИВАЦИЯ

Host уже конфигурирует Claude Code и Codex. Следующий шаг — расширить на другие AI-клиенты и VS Code форки, чтобы один Duet Host настраивал всё.

---

## Что уже сделано (→ архив)

- ✅ AI Clients: Claude Code + Codex (detect + configure) — `core/ai-clients.ts`
- ✅ Auto-update backend: deploy service с version comparison — `core/deploy.ts`

---

## Живые направления

### 1. Другие AI-клиенты

Добавить поддержку новых MCP-клиентов в `core/ai-clients.ts`:

| Клиент | Конфиг | Статус |
|--------|--------|--------|
| Claude Code | `~/.claude.json` | ✅ Готово |
| Codex | `~/.codex/config.toml` | ✅ Готово |
| Copilot | TBD | 🔮 |
| Cursor | TBD | 🔮 |
| Claude Desktop | `~/Library/Application Support/Claude/claude_desktop_config.json` | 🔮 |

**Открытые вопросы:**
- Какие клиенты следующие по приоритету?
- Как обнаруживаем установленные клиенты?

### 2. Extension в VS Code форках

Помощь в установке Duet Extension в форки VS Code:

| Форк | Marketplace | Статус |
|------|------------|--------|
| VS Code | Open VSX / MS | 🔮 |
| Cursor | свой | 🔮 |
| Windsurf | свой | 🔮 |
| VSCodium | Open VSX | 🔮 |

**Открытые вопросы:**
- Как устанавливаем — через marketplace или VSIX?
- Как обнаруживаем установленные форки?
