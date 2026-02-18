# Отзыв Сократа на Codex review

**Дата:** 260218
**Контекст:** Codex провёл независимое ревью миграции Extension SQLite → Backend HTTP. Здесь — оценка качества ревью и позиция по каждому пункту.

---

## Общая оценка ревью

**Качество: высокое.** Codex реально прочитал код, запустил тесты, проследил data flow между Extension и Backend. Не поверхностный чеклист, а настоящий анализ с конкретными ссылками на файлы и строки.

**Сильные стороны:**
- Чёткая структура с приоритизацией
- B1 (addBusiness) — правильно найдено: пишем в config.json, а backend читает settings.json. Реальный разрыв.
- M1 (stale specs) — мы с Дедалом это пропустили. Codex прав.
- Запустил тесты (97/97, 164 passed) — не голословный ревью

**Слабые стороны:**
- Не видел наш plan.md с решениями R1-R8, поэтому "открыл" уже принятые решения
- Формулировки "blocker / до мержа / follow-up" — лишняя бюрократия. Мы просто делаем всё разумное.

---

## Позиция по каждому пункту

### B1 — addBusiness сломан → **СОГЛАСЕН, нужен POST /add-business**

**Факт верный.** После миграции: `addBusiness` → пишет в `config.json` → `POST /scan` → backend сканирует по `settings.json` → новый бизнес не появляется.

В плане (R7) было: "ConfigManager остаётся минимально для addBusiness, backend endpoint — отдельно". Codex показал, что этот разрыв надо закрыть, а не откладывать.

**Что делать:**
1. Backend: `POST /add-business` — принимает путь, пишет в `DuetConfig/settings.json`, запускает rescan
2. Extension: `addBusiness.ts` вызывает этот endpoint вместо ConfigManager
3. Удалить `ConfigManager`, `config.ts`, `config.json` из Extension полностью
4. Убрать `config.json` из DuetData

---

### M1 — Stale specs (MCP.md, DATA_MODEL.md) → **ПОЛНОСТЬЮ СОГЛАСЕН**

Наш пропуск. Дедал обновил ARCHITECTURE.md (оба) и ECOSYSTEM.md, но не тронул:
- `packages/extension/spec/MCP.md` — описывает удалённый Extension MCP server как "Active"
- `packages/extension/spec/DATA_MODEL.md` — ссылается на `index.db`, `db/index.ts`, `scanner.ts`

**Что делать:**
- `MCP.md` — удалить целиком (Extension MCP server удалён, Backend MCP описан в backend spec)
- `DATA_MODEL.md` — переписать: убрать index.db и scanner, оставить pointer chain + workspace files, обновить Implementation
- `DOMAIN.md` — обновить Implementation таблицу (ссылается на `scanner.ts` и `db/index.ts`)

---

### M2 — ECOSYSTEM.md vs config.json → **СОГЛАСЕН**

ECOSYSTEM.md утверждает, что `config.json` убран, но `addBusiness.ts` его ещё использует. После реализации B1 (POST /add-business) — `config.json` полностью уходит, и ECOSYSTEM.md станет корректным.

---

### M3 — repos fallback слишком широкий → **НЕ СОГЛАСЕН**

Codex предлагает:
1. Проверять `.endswith('.git')` — **brittle.** Формат имени repos — деталь реализации, не контракт.
2. Проверять `.exists()` — **I/O в горячем пути.** `_entity_to_dict()` вызывается для каждой entity в каждом HTTP-ответе. 50 entities = 50 stat() syscalls на каждый `/streams`.

**Worst case неопасен.** Несуществующий `absolute_path` → Extension попробует `openFolder` → VS Code покажет "folder not found". Не silent corruption, не security.

**В fallback попадают** только entities, чей `first_segment` не совпал ни с одним business folder. На практике — repos-проекты, для них fallback корректен.

Оставить как есть.

---

### m1 — ProjectsList глушит ошибки → **СОГЛАСЕН**

`catch → return []` превращает ошибки API в "нет проектов". Нужно логировать в OutputChannel.

---

### m2 — Валидация absolute_path → **СОГЛАСЕН**

Если `absolute_path === null`, Extension попытается открыть относительный `path` — бессмысленно. Нужен guard с понятным сообщением пользователю.

---

## Итоговая таблица

| Пункт | Codex | Сократ | Действие |
|-------|-------|--------|----------|
| B1 (addBusiness) | Blocker | Согласен | POST /add-business + удалить ConfigManager |
| M1 (stale specs) | Major | Согласен, наш пропуск | Удалить MCP.md, обновить DATA_MODEL.md, DOMAIN.md |
| M2 (ECOSYSTEM.md) | Major | Согласен | Решится с B1 |
| M3 (repos fallback) | Major | **Не согласен** | Оставить как есть |
| m1 (error silencing) | Minor | Согласен | Логировать в OutputChannel |
| m2 (null absolute_path) | Minor | Согласен | Guard в openFolder |

## Работа

1. **B1** — POST /add-business endpoint + переделать addBusiness.ts + удалить ConfigManager
2. **M1** — обновить stale specs (MCP.md, DATA_MODEL.md, DOMAIN.md)
3. **M2** — решится автоматически через B1
4. **m1** — логирование ошибок в ProjectsList
5. **m2** — guard для null absolute_path
