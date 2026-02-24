# E2E Testing

**Миссия:** Уверенность в каждом релизе — автоматические end-to-end тесты для всех компонентов Duet.

**Участники:** @starship

---

## Видение

Три компонента Duet (Host, Backend, Extension) имеют unit-тесты, но **ни один не имеет стабильных E2E**. Это значит: после каждого изменения мы не знаем, работает ли продукт как целое.

**Ценность E2E:** Ловят то, что unit-тесты не видят — реальный lifecycle приложения, упаковку, активацию, взаимодействие с OS и средой исполнения.

| Компонент | Среда | Что тестируем | Чем |
|-----------|-------|---------------|-----|
| **Host** | Electron | Запуск, окно, tray, backend lifecycle | WebdriverIO + wdio-electron-service |
| **Backend** | Python процесс | Запуск, health check, MCP tools, БД | pytest + httpx (integration) |
| **Extension** | VS Code | Активация, TreeView, команды, VSIX упаковка | @vscode/test-electron |

**Принцип:** Каждый компонент тестируется тем инструментом, который естественен для его среды. Общее — CI pipeline на GitHub Actions (macOS + Windows + Linux).

---

## Roadmap

### Фаза 1: Host E2E (инфраструктура есть, нестабильна)
Разблокировать существующие 6 тестов. Проблема — monorepo symlink + timeout на повторных запусках.

### Фаза 2: Extension E2E (инфраструктуры нет)
Smoke-тесты: активация, команды, TreeView. Ловят проблемы упаковки (WASM, assets в VSIX).

### Фаза 3: Backend Integration (инфраструктуры нет)
Запуск backend, health check, MCP tools отвечают, БД создаётся. Ловят проблемы деплоя.

---

## Стратегия

[testing_strategy.md](testing_strategy.md) — принципы, пирамида тестов, стек, организация, рефакторинг для тестируемости.

---

## Работы

| Файл | Статус | Суть |
|------|--------|------|
| [work_host_e2e.md](work_host_e2e.md) | законсервировано | WebdriverIO + Electron. Инфра готова, тесты нестабильны |
| [topic_extension_e2e.md](topic_extension_e2e.md) | бэклог | @vscode/test-electron. Smoke-тесты для VSIX |
| [topic_backend_e2e.md](topic_backend_e2e.md) | бэклог | pytest integration. Lifecycle + MCP tools |

---

## Ключевые решения

| Дата | Решение |
|------|---------|
| 2502 | Host E2E: WebdriverIO + wdio-electron-service (не Playwright, не Spectron) |
| 2502 | Host E2E законсервированы в CI (`if: false`) — код сохранён |
| 2502 | Extension E2E: @vscode/test-electron (официальный, простой setup) |
