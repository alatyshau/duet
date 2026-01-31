# Host Design

**Миссия:** Превратить Duet Host из rclone-клиента в центр управления экосистемой Duet — единственный хозяин backend и точку входа для пользователя.

**Участники:** @starship

---

## Roadmap

### Фаза 1: Подготовка (текущая)

| # | Задача | Топик | Статус |
|---|--------|-------|--------|
| 1.1 | Выбор папки DuetData | — | ✅ Готово |
| 1.2 | Cleanup устаревшего кода (sync, rclone) | [topic_host_testing.md](topic_host_testing.md) | ⏳ В работе |
| 1.3 | Модуляризация main process | [topic_host_testing.md](topic_host_testing.md) | ⏳ В работе |
| 1.4 | Unit-тесты (config, app-state) | [topic_host_testing.md](topic_host_testing.md) | ⏳ В работе |

### Фаза 2: Backend Lifecycle

| # | Задача | Топик | Статус |
|---|--------|-------|--------|
| 2.1 | Дизайн state.json | [topic_host_core.md](topic_host_core.md) | 🔮 Планирование |
| 2.2 | Host запускает backend | [topic_host_core.md](topic_host_core.md) | 🔮 Планирование |
| 2.3 | Health check + restart | [topic_host_core.md](topic_host_core.md) | 🔮 Планирование |
| 2.4 | UI статуса backend | [topic_host_core.md](topic_host_core.md) | 🔮 Планирование |

### Фаза 3: Интеграции (отложено)

| # | Задача | Топик | Статус |
|---|--------|-------|--------|
| 3.1 | MCP installer | [topic_host_integrations.md](topic_host_integrations.md) | 🔮 Отложено |
| 3.2 | Auto-update backend | [topic_host_integrations.md](topic_host_integrations.md) | 🔮 Отложено |
| 3.3 | Extension helper | [topic_host_integrations.md](topic_host_integrations.md) | 🔮 Отложено |

---

## ЯДРО

| Топик | Статус | Суть |
|-------|--------|------|
| [topic_host_testing.md](topic_host_testing.md) | в работе | Cleanup + модуляризация + тесты |
| [topic_host_core.md](topic_host_core.md) | планирование | Backend lifecycle, setup, async scan |

---

## ОРБИТА

| Топик | Статус | Суть |
|-------|--------|------|
| [topic_host_integrations.md](topic_host_integrations.md) | отложено | MCP installer, auto-update, extension helper |

---

## АРХИВ

| Топик | Суть |
|-------|------|
| — | — |

---

## Ключевые решения

| Дата | Решение |
|------|---------|
| 2501 | Отмена rclone — синхронизация через Google Drive + git-repo |
| 2501 | Host = единственный хозяин backend lifecycle |
| 2501 | Extension становится тонким клиентом (читает state.json) |
| 2501 | state.json — шина коммуникации Host → Extensions |
