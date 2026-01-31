# Host Integrations: MCP, Auto-update, Extensions

**Статус:** отложено

---

## МОТИВАЦИЯ

После того как Host станет хозяином backend lifecycle, следующий шаг — сделать его центром установки и настройки всей экосистемы Duet:

1. **MCP installer** — установка MCP сервера во все AI-клиенты (Claude Desktop, Codex CLI, Copilot)
2. **Auto-update** — автоматическое обновление backend на новые версии
3. **Extension helper** — помощь в установке Extension во все форки VS Code

Это снижает порог входа для пользователя: один Duet Host настраивает всё.

---

## ССЫЛКИ

- [topic_host_core.md](topic_host_core.md) — prerequisite (сначала core)

---

## НАРРАТИВ

### Почему отложено

Core функциональность (lifecycle, state.json) — фундамент. Без него интеграции не имеют смысла.

Порядок:
1. ✅ DuetData selection (уже есть)
2. ⏳ Backend lifecycle + state.json (topic_host_core)
3. 🔮 Integrations (этот топик)

### MCP landscape (2501)

Известные AI-клиенты с поддержкой MCP:
- **Claude Desktop** — `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Codex CLI** — config location TBD
- **Copilot** — config location TBD

Каждый клиент имеет свой формат конфига. Host должен знать как редактировать каждый.

### VS Code forks

Известные форки:
- VS Code (оригинал)
- Cursor
- Antigravity
- VSCodium
- Windsurf

Каждый имеет свой Extension marketplace или путь установки.

---

## ОТКРЫТЫЕ ВОПРОСЫ

### MCP installer

- Какие AI-клиенты поддерживаем в MVP?
- Как обнаруживаем установленные клиенты?
- Как безопасно редактируем их конфиги?
- Нужен ли rollback при ошибке?

### Auto-update

- Откуда скачиваем новые версии backend? (GitHub releases? npm?)
- Как проверяем наличие обновлений?
- Как делаем graceful update (stop → update → start)?
- Нужен ли пользовательский consent перед обновлением?

### Extension helper

- Какие форки поддерживаем в MVP?
- Как устанавливаем — через marketplace или VSIX?
- Как обнаруживаем установленные форки?

---

## ВЫХОДЫ

*Заполняется при переходе в активную работу*

---

## ПЛАН ВНЕДРЕНИЯ

### Постановка задачи

**Scope:** Host UI для установки интеграций. Требует завершённого topic_host_core.

**Фундаментальный вопрос:** Как Host становится единой точкой настройки всей экосистемы Duet?

**Контекст:**
- Зависит от topic_host_core (state.json, backend lifecycle)
- MVP: Claude Desktop + VS Code (один AI-клиент, один редактор)
- Расширяем на другие клиенты итеративно

### Критерии завершённости

- [ ] MCP установлен в Claude Desktop через UI Host
- [ ] Backend автоматически обновляется при новых версиях
- [ ] Extension устанавливается в выбранные форки VS Code

### Шаги

*Детализируются при переходе в активную работу*
