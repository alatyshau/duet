# Host Core: Backend Lifecycle & Setup

**Статус:** в работе

---

## МОТИВАЦИЯ

Сейчас Extension управляет backend lifecycle — запускает процесс, следит за версией, перезапускает при необходимости. Это усложняет Extension и создаёт проблему: N окон VS Code могут конфликтовать при управлении одним backend.

Host должен стать **единственным хозяином backend** — запускать, останавливать, обновлять. Extensions становятся тонкими клиентами: просто читают state.json и используют HTTP API.

### Стратегия: конкурентная реализация

> **Extension УЖЕ умеет всё:** установка backend, запуск, health check, restart, версионирование — всё реализовано и работает.

Мы **дублируем** (переносим) эту реализацию в Host. Это конкурентная реализация:

1. **Не трогаем Extension** — он продолжает работать как раньше
2. **Реализуем полностью в Host** — независимо от Extension
3. **Тестируем Host** — убеждаемся что работает
4. **Только потом** — вырезаем дубликаты из Extension

**Почему так:**
- Безопасно — Extension продолжает работать пока Host не готов
- Можно тестировать Host изолированно
- Нет риска сломать рабочий Extension

---

## ССЫЛКИ

**Референс (Extension — уже реализовано):**
- [packages/extension/src/core/backend-lifecycle.ts](../../packages/extension/src/core/backend-lifecycle.ts) — **полная реализация lifecycle** (использовать как референс!)
- [packages/extension/src/core/paths.ts](../../packages/extension/src/core/paths.ts) — пути, включая statePath

**Backend:**
- [packages/backend/spec/ARCHITECTURE.md](../../packages/backend/spec/ARCHITECTURE.md) — текущая архитектура backend

**Host:**
- [apps/host/src/main/index.ts](../../apps/host/src/main/index.ts) — текущий Host main process
- [input/host-roadmap.md](input/host-roadmap.md) — старый roadmap (deprecated)

---

## НАРРАТИВ

### Эволюция концепции (2501)

Изначально Host планировался как rclone-клиент для синхронизации файлов с облаком. Концепция изменилась:

1. **Отмена rclone** — синхронизация теперь через Google Drive + git-repo (уже реализовано в Extension)
2. **Новая роль Host** — центр управления экосистемой Duet

### Текущее состояние кода

**Что уже реализовано в Host:**
- AppState: `no_config | path_lost | ready`
- Config: `~/.org.ve68.duet/config.json` с `duetDataPath`
- Tray с иконкой (normal/warning)
- IPC: getState, selectFolder, setDuetPath, openPath
- Автозапуск при старте системы
- UI: SetupPage с выбором папки

**Что устарело (удалить):**
- Sidebar: "Статус синхронизации" (sync page)
- SetupPage: заглушка "Синхронизация с облаком / rclone"
- Подсказка про Google Drive синхронизацию

**Что уже есть в системе (использовать):**
- Backend пишет `state.json` после scan (`{ "last_scan_at": timestamp }`)
- Extension имеет `paths.statePath` для доступа к state.json
- Backend имеет `/health`, `/scan`, `/stop` endpoints

### Целевая архитектура

```
┌─────────────────────────────────────────────────────────┐
│                    Duet Host (Menu Bar)                 │
│                  Всегда работает, автозапуск            │
├─────────────────────────────────────────────────────────┤
│  • Владеет DuetData path                                │
│  • Запускает/останавливает backend                      │
│  • Пишет state.json (секция backend)                    │
│  • Показывает UI статуса                                │
└─────────────────────────────────────────────────────────┘
          │                              │
          │ spawn/kill                   │ state.json
          ▼                              ▼
┌─────────────────┐           ┌─────────────────────────┐
│  Python Backend │──scan──▶│      state.json         │
│  (child process)│           │ { backend: {...},      │
└─────────────────┘           │   last_scan_at: ... }   │
                              └─────────────────────────┘
                                         │
                                         │ file watcher
                                         ▼
                   ┌─────────────┐  ┌─────────────┐
                   │  VS Code    │  │   Cursor    │ ...
                   │  Extension  │  │  Extension  │
                   └─────────────┘  └─────────────┘
```

---

## ОТКРЫТЫЕ ВОПРОСЫ

### 1. Владение state.json

**Контекст:** Сейчас backend пишет `{ last_scan_at }`. Host должен добавить статус backend. Два писателя в один файл.

**Варианты:**
- **A) Раздельные секции** — Backend пишет `scan`, Host пишет `backend`. Merge при записи.
- **B) Host — единственный писатель** — Backend возвращает результат scan по HTTP, Host пишет всё в state.json.
- **C) Два файла** — `state.json` (Host) и `scan-state.json` (Backend).

**Вопрос:** Какой вариант выбираем? Вариант B проще (один писатель), но требует изменить backend.

---

### 2. Структура state.json

**Текущая (backend пишет):**
```json
{ "last_scan_at": 1706712345000 }
```

**Предлагаемая (Host пишет):**
```json
{
  "version": 1,
  "backend": {
    "status": "running" | "stopped" | "starting" | "error",
    "pid": 12345,
    "port": 19800,
    "version": "0.2.3",
    "error": "..." | null
  },
  "duetDataPath": "/Users/user/DuetData",
  "lastScan": {
    "timestamp": 1706712345000,
    "entitiesCount": 42,
    "durationMs": 1200
  }
}
```

**Вопросы:**
- Нужен ли `version` для миграции схемы?
- Что ещё добавить? Uptime? Last error time?
- Как Extensions узнают что Host не запущен (state.json не обновляется)?

---

### 3. Backend lifecycle: failure detection

**Сценарии сбоев:**
- Backend process crash (SIGSEGV, OOM)
- Backend port busy (другой процесс занял)
- Backend не отвечает на /health (зависание)
- Python не установлен / venv сломан

**Вопросы:**
- Как часто делать health check? (1s? 5s? 10s?)
- Сколько retry перед показом ошибки?
- Restart автоматически или просить пользователя?
- Где показывать ошибку? (Tray badge? UI alert? Notification?)

---

### 4. Host startup sequence

**Текущий flow Host:**
1. Читает config.json → duetDataPath
2. Проверяет существование папки
3. Показывает tray / окно в зависимости от статуса

**Новый flow (с backend):**
1. Читает config.json → duetDataPath
2. Проверяет существование папки
3. Проверяет установлен ли backend (`.venv/`, `packages/backend/`)
4. Запускает backend → ждёт /health
5. Пишет state.json
6. Показывает tray

**Вопросы:**
- Где хранить backend? (DuetData/backend/? bundled в Host?)
- Как проверять "установлен ли backend"?
- Timeout на запуск backend? (что если venv создаётся долго?)

---

### 5. Migration path: Extension → Host ✅ РЕШЕНО

**Стратегия:** Конкурентная реализация (см. МОТИВАЦИЯ).

1. Extension продолжает работать как раньше (не трогаем)
2. Host реализуем полностью и независимо
3. Тестируем Host
4. Вырезаем дубликаты из Extension (отдельный топик)

**Оставшиеся вопросы (для этапа 4):**
- Как Extension узнаёт что Host запущен? (state.json exists + fresh?)
- Что показывать в Extension Welcome View если Host не запущен?

---

### 6. UI: новая структура экранов

**Убираем:**
- "Статус синхронизации" (sync page) — не актуально
- Заглушка rclone в SetupPage

**Добавляем:**
- Status page — статус backend, кнопка Scan
- Backend setup в SetupPage — установка/проверка backend

**Вопросы:**
- Status page = главный экран (вместо setup)?
- Или Setup показывается только при проблемах?
- Нужна ли страница Settings? (порт, автозапуск — уже есть в tray menu)

---

### 7. Backend installation

**Контекст:** Backend — это Python приложение. Нужен Python + venv + dependencies.

**Кроссплатформенность (из Extension review 260131):**
> Extension сейчас предполагает Unix: `python3`, `.venv/bin/python3`, `SIGTERM/SIGKILL`.
> Решение: Host возьмёт lifecycle → Host делает platform-aware код (Windows: `python`, `.venv\Scripts\python.exe`, `taskkill`).
> Extension станет тонким HTTP-клиентом, platform-specific код уйдёт в Host.

**Вопросы:**
- Host проверяет наличие Python в системе?
- Инструкции по установке Python? (brew install python3 / winget install python)
- Создание venv — Host делает сам или просит пользователя?
- Установка dependencies (pip install) — показывать progress?
- Где хранить backend code? (DuetData/backend/? Bundled в Host.app?)
- **Platform-aware пути:** `.venv/bin/python3` vs `.venv\Scripts\python.exe`
- **Platform-aware команды:** `python3` vs `python`, signals vs taskkill

---

### 8. Async scan UX

**Текущий flow (Extension):**
1. Extension вызывает POST /scan
2. Ждёт ответ (блокирующий)
3. Обновляет TreeView

**Новый flow (через state.json):**
1. Extension вызывает POST /scan
2. Backend сканирует, пишет state.json
3. Extension слушает state.json через file watcher
4. При изменении — обновляет TreeView

**Вопросы:**
- Нужен ли Host в этом flow? Или Extension по-прежнему вызывает /scan напрямую?
- Если Host — как Extension trigger scan? (HTTP к Host? Или писать в request file?)
- Показывать ли progress scan в Host UI? В Extension?

---

## ВЫХОДЫ

### Версионирование (из topic_config_architecture)

| Компонент | Где версия | Bump скрипт | Стратегия |
|-----------|------------|-------------|-----------|
| Extension | `packages/extension/package.json` | `build-vsix.js` (patch++) | При сборке VSIX |
| Host | `apps/host/package.json` | `build-release.js` (patch++) | При сборке release |
| Backend | `DuetData/backend/VERSION` | Нет (= Host version) | Host пишет при установке |

**Backend version = Host version** — backend bundled в Host, релизятся вместе.

**Flow проверки обновления:**
```
Host запускается (v0.2.0)
    ↓
Читает DuetData/backend/VERSION → "0.1.0"
    ↓
0.1.0 < 0.2.0 → переустанавливает backend
    ↓
Пишет DuetData/backend/VERSION → "0.2.0"
```

**Использование:**
```bash
cd apps/host
npm run release          # Bump + build для macOS (default)
npm run release -- --win # Bump + build для Windows
```

*Остальные решения заполняются после шага 0*

---

## ПЛАН ВНЕДРЕНИЯ

### Постановка задачи

**Scope:**
- Host приложение: lifecycle backend, state.json, UI обновления
- Extension изменения — отдельный топик (после Host)

**Фундаментальный вопрос:** Как Host берёт на себя lifecycle backend и сообщает о состоянии через state.json?

**Контекст:**
- Host уже умеет выбирать DuetData папку
- Backend уже работает (HTTP + MCP)
- Backend уже пишет last_scan_at в state.json
- **Extension уже имеет полную реализацию lifecycle** — используем как референс
- Нужно расширить state.json статусом backend
- Нужно продублировать lifecycle из Extension в Host

### Критерии завершённости

- [ ] Host запускает backend при своём старте
- [ ] Host пишет state.json с актуальным статусом backend
- [ ] Host корректно останавливает backend при выходе
- [ ] Host показывает статус backend в UI
- [ ] Host обнаруживает падение backend и перезапускает
- [ ] Host пишет `DuetData/backend/VERSION` при установке backend
- [ ] UI: убраны устаревшие элементы (sync, rclone)

### Шаг 0: Дизайн решений

**Статус:** WIP

Принять решения по открытым вопросам.

**Ход работы:**
- [ ] Решить: кто пишет state.json (вопрос 1)
- [ ] Определить структуру state.json (вопрос 2)
- [ ] Определить failure detection strategy (вопрос 3)
- [ ] Определить UI структуру (вопрос 6)

### Шаги 1+ — после принятия решений по Шагу 0

---

### E2E тестовая инфраструктура (backend)
**Статус:** TODO

Инфраструктура для интеграционных тестов backend — тесты запускают реальный сервер.

**Контекст:** Host будет управлять lifecycle backend, поэтому E2E инфраструктура логически связана с Host.

**Scope:**
- [ ] pytest fixture `backend_server` (scope=session):
  - Создать временную DuetData с фейковыми business_folders
  - Выбрать свободный порт (не 19680)
  - Запустить сервер через subprocess
  - Wait for /health
  - Yield URL + cleanup
- [ ] Фейковые тестовые данные:
  - Структура папок для business/stream/product
  - config.json с правильными путями
- [ ] Базовые E2E тесты:
  - `/workspace-info` для repos path
  - `/workspace-info` для drive path
  - `/scan` + `/streams`
- [ ] pytest marker `@pytest.mark.e2e` + отдельный запуск
- [ ] CI: запускать e2e тесты (отдельно от unit)

**Расположение:** `packages/backend/tests/e2e/`
