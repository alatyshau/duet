# Duet MVP

**Миссия:** MVP Duet — рабочая система из Host + Extension + Backend + AI Instructions.

**Участники:** Андрей, AI-агенты (Claude Code, Codex)

---

## АКТИВНЫЕ

### topic_apps_ui.md
> Host UI: Приложения — менеджер Python-процессов

**Статус:** Реализовано @turn(260216). Ожидает ручной проверки навигации.

---

## АРХИВ

### 260212_topic_ai_instructions_to_host.md
> Host — единая точка установки AI инструкций и backend

**Статус:** Выполнено @turn(260212).

**Итог:** Host деплоит AI инструкции + backend, конфигурирует AI клиенты (Claude Code, Codex). Python path selector в UI. Atomic swap, venv + pip, VERSION check. 115 тестов. Коммиты: `64b669b`, `1d15943`, `4d9ce8b`.

### 260212_review_ai_instructions_to_host.md
> Ревью реализации от Codex (17 пунктов)

**Статус:** Выполнено @turn(260212).

**Итог:** 14 замечаний исправлены, 3 сняты (LATER). Критическая находка: `[mcp.duet]` → `[mcp_servers.duet]` (Codex молча игнорировал). smol-toml вместо regex. DI для тестируемости. 115 тестов green.
