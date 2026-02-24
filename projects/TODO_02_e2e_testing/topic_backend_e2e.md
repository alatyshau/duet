# Backend Integration Testing

**Статус:** бэклог

---

## МОТИВАЦИЯ

Backend — Python-процесс, который Host запускает и мониторит. Сейчас тестирование ручное: запустил, проверил health, попробовал MCP tool. Нужны автоматические integration-тесты, которые поднимают реальный backend и проверяют его API.

**Что может сломаться без E2E:**
- Backend не стартует после обновления зависимостей
- MCP tools отвечают ошибкой после рефакторинга
- БД не создаётся / не мигрируется
- Health endpoint не работает

---

## ССЫЛКИ

- [topic_host_e2e.md](topic_host_e2e.md) — E2E для Host (смежная тема: Host запускает Backend)
- `packages/backend/spec/ARCHITECTURE.md` — архитектура backend

---

## НАРРАТИВ

### Что тестируем

Backend предоставляет:
1. **HTTP API** — health check, CRUD для entities
2. **MCP tools** — timestamp, workspace_info, streams, projects, scan
3. **SQLite БД** — иерархия entities

### Подход

**pytest + httpx** — стандартный стек для Python integration-тестов.

**Два уровня:**

| Уровень | Что | Как |
|---------|-----|-----|
| **Integration** | API endpoints, MCP tools | pytest + httpx, реальный сервер |
| **Smoke** | Backend стартует, health отвечает | subprocess + health check |

---

## ОТКРЫТЫЕ ВОПРОСЫ

### 1. Как запускать backend в тестах?

Варианты:
- **subprocess** — `python -m backend` как child process, ждём health
- **TestClient** — если FastAPI, можно использовать встроенный test client (без реального сервера)
- **fixture** — pytest fixture поднимает/убивает сервер

### 2. Тестовая БД

- Каждый тест — свой temp dir с чистой БД?
- Seed data (фиксированная иерархия) для предсказуемости?

### 3. Что входит в smoke?

Минимальный набор:
- [ ] Backend стартует без ошибок
- [ ] Health endpoint отвечает 200
- [ ] `scan` tool завершается без ошибок
- [ ] `streams` tool возвращает данные
- [ ] БД файл создаётся

---

## ВЫХОДЫ

### Целевое состояние

**Integration-тесты для Backend на CI:**
- pytest поднимает реальный backend
- Тестирует HTTP API + MCP tools
- Тестовая БД с seed data
- CI на 3 платформах

---

## ПЛАН ВНЕДРЕНИЯ

### Постановка задачи

#### Scope
Integration/smoke тесты для Python backend. Не unit-тесты отдельных функций, а проверка backend как целого.

#### Фундаментальный вопрос
subprocess vs TestClient — как запускать backend в тестах?

#### Контекст
- Backend работает, API стабилен
- Unit-тестов для backend мало
- CI pipeline для backend существует (lint, type check)

### Критерии завершённости

- [ ] Smoke-тесты проходят на CI (3 платформы)
- [ ] Health + scan + streams тестируются
- [ ] Тестовая БД изолирована (не портит реальные данные)

### Шаг 0: Документ
**Статус:** TODO

Фиксация решений: подход к запуску, тестовая БД, набор smoke-тестов.

**Коммит:** `docs(topic): topic_backend_e2e — planning complete`
