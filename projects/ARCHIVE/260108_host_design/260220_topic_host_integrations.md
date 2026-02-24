# Host Integrations — архив сделанного

> Архив снятых частей topic_host_integrations.md. Живые идеи остались в оригинале.

## Что реализовано

### AI Clients config (было: "MCP installer")

Реализовано в `core/ai-clients.ts`. Host обнаруживает и конфигурирует AI-клиенты прямой записью в их конфиг-файлы:

| Клиент | Конфиг | Что пишет |
|--------|--------|-----------|
| Claude Code | `~/.claude/output-styles/ai-kit.md` | Output style (инструкции как system prompt) |
| Claude Code | `~/.claude.json` | MCP server (mcpServers.duet) |
| Codex | `~/.codex/config.toml` | `model_instructions_file` + `[mcp.duet]` |

UI: AgentsPage — detect + configure.

### Auto-update backend (было: "Auto-update")

Реализовано в `core/deploy.ts`. Deploy service с version comparison:
- Bundled resources → DuetData (atomic swap)
- `compareSemver(appVersion, deployed)` — deploy только при новой версии
- Backend stop → deploy → venv + pip → start
- VERSION file в DuetData/backend/

Вопросы об "откуда скачивать" отпали — backend bundled в Host, релизятся вместе.
