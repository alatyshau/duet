# Поддержка Codex в AI Kit

**Статус:** в работе

---

## МОТИВАЦИЯ

### Проблема

Сейчас `packages/ai-kit/install.py` умеет настраивать Claude Code (MCP + `~/.claude/CLAUDE.md`), но Codex остаётся “ручной” настройкой.

Итог:
- Нет единого “one-shot” инсталла для Codex.
- Настройка не идемпотентна и не версионируется вместе с системой (забывается/ломается при переезде).
- Для работы “во всех воркспейсах” приходится плодить `AGENTS.md` по репозиториям.

### Цель

Сделать Codex first-class клиентом AI Kit:
- `install.py` настраивает `~/.codex/config.toml` → `model_instructions_file = "<installed_ai_kit_dir>/core_instructions.md"` (root-level entrypoint, без копирования).
- `install.py` настраивает MCP для Codex → `codex mcp add ai-kit -- <venv_python> <server.py>` (tools).
- Работает глобально на машине (во всех воркспейсах) без репо-специфичных файлов.
- Идемпотентно: повторный запуск `install.py` приводит систему в ожидаемое состояние.

---

## ССЫЛКИ

- [packages/ai-kit/install.py](../../packages/ai-kit/install.py) — текущий установщик (Claude Code)
- [packages/ai-kit/docs/manual_setup.md](../../packages/ai-kit/docs/manual_setup.md) — ручная установка
- [packages/ai-kit/spec/ARCHITECTURE.md](../../packages/ai-kit/spec/ARCHITECTURE.md) — архитектура + описание install.py
- Codex config: `~/.codex/config.toml`
- Codex MCP: `codex mcp list/add/remove`

---

## НАРРАТИВ

### @turn(260128) — Выбор направления

**Решение:** для “везде на машине” предпочтительнее интеграция через `~/.codex/config.toml` (root-level `model_instructions_file`) + MCP, а не через `AGENTS.md` в каждом репозитории.

**Следствие:** поддержку Codex нужно добавить в `install.py`, чтобы установка AI Kit сразу включала Codex.

---

## ВЫХОДЫ

### Выход 0: Варианты настройки Codex через `~/.codex`

Ниже — “поверхности конфигурации” Codex, которые реально живут в `~/.codex`, и насколько каждая подходит под нашу цель:
**использовать установленные инструкции в `~/DuetData/...` через ссылки/пути, без копирования**.

**Выбранный путь (в рамках этого топика):**
- Инструкции: root-level entrypoint через `~/.codex/config.toml` → `model_instructions_file = "<installed_ai_kit_dir>/core_instructions.md"`
- Tools: MCP через `codex mcp add ...`
- Не делаем: skills как механизм подключения инструкций; профили (Вариант B / CLI-only)

#### М1: Skills (`~/.codex/skills/<skill>/SKILL.md`)

**Что это:** механизм “подключаемых пакетов инструкций” Codex. Skill содержит краткие правила и навигацию “что читать дальше” (progressive disclosure).

**Возможности:**
- Глобально на машине: один раз установленный skill работает во всех воркспейсах.
- Можно сделать “тонкий” слой: хранить только `SKILL.md` в `~/.codex`, а сами инструкции читать из `~/DuetData/ai-kit/*`.
- Хорошо ложится на AI Kit: `SKILL.md` становится “лоадером”, а канон инструкций остаётся в `DuetData`.

**Ограничения / риски:**
- Skill не гарантированно “всегда включён”: он должен **триггериться** (по названию пользователем или по совпадению с описанием/задачей).
- Skill — это инструкции, а не декларативный “import”: он не заменяет надёжный автоподключаемый system prompt.
- Если Codex sandbox будет запрещать чтение файлов вне workspace, чтение `~/DuetData/ai-kit/*` может потребовать отдельной настройки (см. М2).

**Статус для AI Kit:** не используем как основной механизм подключения (см. “Выбранный путь” выше).

#### М2: Глобальная конфигурация (`~/.codex/config.toml`) + профили + `-c key=value`

**Что это:** глобальный конфиг Codex. CLI явно говорит, что подхватывает значения из `~/.codex/config.toml`, а `-c` позволяет точечно переопределять ключи на запуск.

**Возможности:**
- Выбор модели/режима рассуждения по умолчанию (пример: `model = "gpt-5.2"`, `model_reasoning_effort = "high"`).
- Подключение глобальных “модельных инструкций” через `model_instructions_file = "/abs/path/to/file.md"` (важно: это прямой кандидат на роль AI Kit entrypoint без копирования).
- Profiles: `codex --profile <name>`/`codex exec --profile <name>` для разных сценариев (например, “строго sandboxed” vs “полный доступ”).
- Тонкая настройка sandbox/permissions через `-c ...` (в help есть пример `-c 'sandbox_permissions=["disk-full-read-access"]'`).
- Управление feature flags (`codex features ...`, `--enable/--disable`).

**Ограничения / риски (важно для нашей цели “читать из DuetData”):**
- `config.toml` — надёжная точка подключения entrypoint (`model_instructions_file`), но:
  - этот файл должен быть доступен Codex с учётом sandbox/permissions
  - путь должен быть абсолютным и стабильным (что хорошо совпадает с “установка в `~/DuetData/...` расширением”)
- Sandbox/permissions могут стать блокером: если политика чтения ограничена workspace, то “не копируя” нам потребуется либо разрешение на чтение `~/DuetData/ai-kit`, либо fallback к копированию/симлинку внутри разрешённой зоны.
- Некоторые ключи/структуры config зависят от версии Codex; опираться стоит на публично поддерживаемые флаги CLI + минимальные значения.

**Как это применимо к AI Kit:**
- Если наша цель — **вообще без копирования** и “всегда включено”, то предпочтительный entrypoint:
  - `~/.codex/config.toml`: `model_instructions_file = "<installed_ai_kit_dir>/core_instructions.md"`
  - а не skills.
- Профили полезны для “2 режима работы” (например, safe vs full-access), но не должны быть единственным способом включения AI Kit, если мы хотим поддержки IDE extension (см. ниже).

##### Профили: подробнее (как работает и что можно настраивать)

**Что такое профиль:** именованный набор настроек внутри `config.toml`, который накладывается поверх базовых значений.

**Как выбирать:**
- CLI: `codex --profile ai-kit` / `codex exec --profile ai-kit`
- “По умолчанию” (CLI): `profile = "ai-kit"` в корне `config.toml` (если так сделаем, нужно осторожно, чтобы не сломать другие сценарии).

**Порядок применения (идея):**
1) CLI flags (`--profile`, `-c ...`)
2) Значения профиля
3) Значения в корне `config.toml`
4) Built-in defaults

**Что мы можем вынести в профиль для AI Kit:**
- “поведенческие” настройки: модель/effort, approvals/sandbox policy, разрешения на чтение `~/DuetData/...` (если требуется)
- (опционально) `model_instructions_file` (но см. важное ограничение ниже)

**Ограничение (важное для нашей архитектуры с расширением):**
- Profiles в Codex сейчас помечены как experimental и **не поддерживаются в IDE extension**.
  Поэтому профили не используем для подключения AI Kit (только как возможный будущий тюнинг для CLI).

#### М3: MCP servers (через `codex mcp add ...`, хранится в `~/.codex`)

**Что это:** конфигурация внешних инструментов (MCP) для Codex. Это отдельная ось от “инструкций” — про tools, а не про поведение.

**Возможности:**
- Можно подключить AI Kit MCP сервер (например, timestamp) к Codex так же, как сейчас подключаем к Claude Code.
- Можно ссылаться на установленный сервер в `DuetData` (venv python + `.../mcp-server/server.py`), без копирования в `~/.codex`.

**Ограничения / риски:**
- В CLI помечено как `[experimental]` — интерфейс/поведение может меняться.
- Не решает задачу “подключить инструкции”; это только tools.

**Применимость к AI Kit:**
- Отличный кандидат для следующего шага: сделать одинаковый набор инструментов во всех клиентах.

#### М4: История/сессии (`~/.codex/sessions`, `codex resume`, `codex fork`)

**Что это:** хранение состояний прошлых сессий (для продолжения/форка).

**Возможности:**
- Ускоряет повторные задачи в одном и том же контексте.

**Ограничения:**
- Не является механизмом “всегда загружай инструкции” — это не гарантирует единый baseline поведения.

#### М5: Служебные файлы (`~/.codex/auth.json`, `~/.codex/models_cache.json`, `shell_snapshots/`)

**Что это:** внутренние данные Codex (аутентификация, кэш моделей, снимки окружения).

**Ограничения:**
- Не трогаем руками. Это не поверхность для нашей интеграции.

### Выход 1: Спецификация Codex-интеграции

**Что делает `install.py`:**
- Настраивает Codex так, чтобы AI Kit был “всегда включён” и без копирования:
  1) `~/.codex/config.toml`: выставляет `model_instructions_file = "<output_dir>/core_instructions.md"` (абсолютный путь).
  2) добавляет MCP server `ai-kit` для Codex (timestamp и др.) через `codex mcp add ...` (с путём на установленный `DuetData/ai-kit/mcp-server/server.py` и venv python).

**Поведение при отсутствии Codex:**
- Если `~/.codex` не найден и `codex` CLI не обнаружен — `install.py` печатает “skipped” + короткую инструкцию как включить (или флаг для принудительного создания).

### Выход 2: CLI-контракт install.py

Добавить флаги (точные названия согласовать):
- `--codex/--no-codex` — включить/выключить настройку Codex
- (опционально) `--codex-dir <path>` — переопределить базовую директорию Codex (по умолчанию `~/.codex`)
- (опционально) `--codex-instructions/--no-codex-instructions` — настроить `model_instructions_file` (entrypoint AI Kit) в `config.toml`
- (опционально) `--codex-mcp/--no-codex-mcp` — настроить MCP сервер AI Kit для Codex через `codex mcp add ...`

### Выход 4: Канонический `config.toml` для AI Kit (без копирования)

**Цель:** Codex всегда загружает AI Kit из установленной директории `DuetData`, которую будет ставить расширение (заменит временный `install.py`).

**Вариант A (предпочтительный, не зависит от профилей):** root-level entrypoint.

```toml
# AI Kit entrypoint (managed)
model_instructions_file = "/Users/<you>/DuetData/ai-kit/core_instructions.md"
```

Плюсы:
- Работает без `--profile` и без “experimental profiles”.
- Потенциально совместим с IDE extension (он не должен передавать `--profile`).

Минусы:
- Один глобальный entrypoint: если захочется “выключать AI Kit”, это придётся делать вручную или отдельной командой/флагом.

**Вариант B (CLI-only / экспериментальный):** профили.

В рамках текущей интеграции **не делаем** (см. “Выбранный путь” выше).

### Выход 5: MCP-интеграция для Codex (tools)

**Цель:** подключить инструменты AI Kit (например, timestamp) в Codex, ссылаясь на установленный `DuetData/ai-kit/mcp-server/server.py` и venv python (без копирования).

**Канон настройки:** через CLI Codex (он сам сохраняет конфиг в `~/.codex`):

```bash
codex mcp add ai-kit -- /path/to/venv/bin/python3 /Users/<you>/DuetData/ai-kit/mcp-server/server.py
```

**Как установить Codex CLI (кратко):**

```bash
# вариант 1
npm i -g @openai/codex
codex --version

# вариант 2 (если доступно в твоей системе)
brew install codex
codex --version
```

**Ограничения:**
- `codex mcp` помечен как experimental → возможны изменения CLI/API.
- Установка должна быть идемпотентной: если сервер уже существует, делаем remove+add или update-ветку (если появится).

### Выход 3: Документация

Обновить:
- `packages/ai-kit/docs/manual_setup.md` — добавить шаг “Codex”
- `packages/ai-kit/spec/ARCHITECTURE.md` — добавить Codex в список шагов install.py

---

## ПЛАН ВНЕДРЕНИЯ

**Статус:** в работе

### Критерии завершённости

- [ ] `install.py` настраивает `~/.codex/config.toml` (или `--codex-dir ...`) так, чтобы `model_instructions_file` указывал на `-o/--output` (AI Kit всегда включён)
- [ ] `install.py` добавляет MCP server `ai-kit` в Codex (если `codex` CLI доступен)
- [ ] Поведение идемпотентно (повторный запуск ничего “лишнего” не ломает)
- [ ] Есть ясное поведение “Codex не установлен” (skip + инструкция)
- [ ] Документация и архитектура обновлены (manual_setup + ARCHITECTURE)

---

### Шаг 1: Зафиксировать требования и решения
**Статус:** IN_REVIEW
**Выход:** [Выход 1: Спецификация Codex-интеграции](#выход-1-спецификация-codex-интеграции)

**Открытые решения:**
- `model_instructions_file` — **always-on** (root-level entrypoint).
- MCP для Codex — **включён по умолчанию**, если установлен `codex` CLI.

---

### Шаг 2: Спроектировать API install.py
**Статус:** IN_REVIEW
**Выход:** [Выход 2: CLI-контракт install.py](#выход-2-cli-контракт-installpy)

---

### Шаг 3: Реализовать Codex config + MCP
**Статус:** IN_REVIEW
**Выход:** [Выход 1: Спецификация Codex-интеграции](#выход-1-спецификация-codex-интеграции)

Подзадачи:
- [x] Добавлена настройка `~/.codex/config.toml` → `model_instructions_file = "<output>/core_instructions.md"` (идемпотентно)
- [x] Добавлена настройка MCP для Codex через `codex mcp add ...` (remove+add при конфликте)
- [x] Добавлены флаги: `--no-codex`, `--codex-dir`, `--no-codex-instructions`, `--no-codex-mcp`

---

### Шаг 4: Обновить документацию
**Статус:** IN_REVIEW
**Выход:** [Выход 3: Документация](#выход-3-документация)

---

### Шаг 5: Валидация (ручная)
**Статус:** TODO

Чеклист:
- `python3 packages/ai-kit/install.py -o ~/DuetData/ai-kit` настраивает `~/.codex/config.toml`
- Новый Codex-чат автоматически подхватывает `model_instructions_file = "~/DuetData/ai-kit/core_instructions.md"` (или абсолютный путь)
- MCP: `codex mcp list` показывает `ai-kit`, и tools доступны в сессии
