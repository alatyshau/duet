# Host Design

**Миссия:** Превратить Duet Host из rclone-клиента в центр управления экосистемой Duet — единственный хозяин backend и точку входа для пользователя.

**Участники:** @starship

---

## Roadmap

### Фаза 1: Подготовка ✅

| # | Задача | Статус |
|---|--------|--------|
| 1.1 | Выбор папки DuetData | ✅ Готово |
| 1.2 | Cleanup устаревшего кода (sync, rclone) | ✅ Готово |
| 1.3 | Модуляризация main process | ✅ Готово |
| 1.4 | Unit-тесты (config, app-state) | ✅ Готово |

### Фаза 2: Backend Lifecycle ✅

| # | Задача | Статус |
|---|--------|--------|
| 2.1 | Deploy service (bundled → DuetData, version comparison) | ✅ Готово |
| 2.2 | Host запускает backend | ✅ Готово |
| 2.3 | Health check + auto-restart | ✅ Готово |
| 2.4 | UI статуса backend (AppPage, process cards) | ✅ Готово |

### Фаза 3: Интеграции — частично

| # | Задача | Статус |
|---|--------|--------|
| 3.1 | AI clients config (Claude Code, Codex) | ✅ Готово |
| 3.2 | Auto-update backend (deploy service) | ✅ Готово |
| 3.3 | Extension helper | ❌ Не нужно (Extension — thin MCP client) |

---

## ЯДРО

| Топик | Статус | Суть |
|-------|--------|------|
| [topic_host_e2e.md](topic_host_e2e.md) | законсервировано | E2E тесты — нестабильны, инфраструктура есть |
| [topic_host_integrations.md](topic_host_integrations.md) | бэклог | Другие AI-клиенты + Extension в форках VS Code |

---

## АРХИВ

### 260220_topic_host_core.md
> Backend Lifecycle, Setup, Async Scan

**Статус**: Выполнено @turn(260220).

**Итог**: Backend lifecycle (start/stop/health/auto-start), deploy service (atomic swap, version comparison), AI clients config, UI (AppPage, process cards) — всё реализовано. Пошли без state.json — Extension стал thin MCP client.

### 260220_topic_host_testing.md
> Cleanup + модуляризация + unit-тесты

**Статус**: Выполнено @turn(260220).

**Итог**: Удалён устаревший код (sync, rclone). Структура src/: core/, main/, platform/. 15+ unit-тестов (config, app-state, deploy, backend, apps, ai-clients, mappers). Platform/ проверен вручную.

### 260220_topic_host_integrations.md (частично)
> MCP installer + Auto-update backend

**Статус**: Частично снято @turn(260220).

**Итог**: AI Clients config (Claude Code + Codex) реализован в `core/ai-clients.ts`. Auto-update → deploy service с version comparison в `core/deploy.ts`. Живые направления (другие клиенты, VS Code форки) остались в оригинальном топике.

### 260220_draft.md
> Фрагменты чата о конфиге ~/.org.ve68.duet

**Статус**: Снято @turn(260220). Pointer file с 3 полями реализован.

### 260220_host-roadmap.md
> Старый роудмап с rclone (шаги 1-7)

**Статус**: Снято @turn(260220). Шаг 1 реализован, шаги 2-5 (rclone) отменены, шаги 6-7 реализованы иначе (Backend + Extension пакеты).

---

## Ключевые решения

| Дата | Решение |
|------|---------|
| 2501 | Отмена rclone — синхронизация через Google Drive + git-repo |
| 2501 | Host = единственный хозяин backend lifecycle |
| 2502 | Без state.json — Extension подключается через MCP, не file watcher |
| 2502 | AI clients config — прямая запись в конфиг-файлы клиентов |
