# Чат-папка: 260110_ai_talks

## Контекст

**Дело:** МетаЛаб / ТехноЛаб / Duet / ai-kit
**Суть:** Набор инструментов для работы с AI — инструкции, роли, схемы, workflows, скрипты.

## Миссия

> Разработать и специфицировать **ai-kit** — набор инструкций, режимов, ролей и форматов для эффективной работы человека с AI-агентами.

**Продукт:** `packages/ai-kit/` → генерирует `.ai/` в любом проекте.

## Участники

| ID | Тип | Персона | Суть |
|----|-----|---------|------|
| АЛ | human | — | Архитектор системы, определяет направление |
| ClaudeCode:Socrates | ai | Сократ | Исследует идеи через диалог, не торопит к решениям |
| Codex:Socrates | ai | Сократ | Исследует идеи через диалог, не торопит к решениям |
| Copilot:Socrates | ai | Сократ | Исследует идеи через диалог, не торопит к решениям |
| Antigravity:Socrates | ai | Сократ | Исследует идеи через диалог, не торопит к решениям |
| Cursor:Socrates | ai | Сократ | Исследует идеи через диалог, не торопит к решениям |
| Cursor:Hephaestus | ai | Гефест | Мастер-исполнитель, реализация планов |
| ClaudeCode:Daedalus | ai | Дедал | Архитектор, ревью работы агентов |
| Cursor:Daedalus | ai | Дедал | Архитектор, ревью работы агентов |

---

## Открытые вопросы

Нет

---

## Roadmap

> Обновлено @turn(260123_1730M). Фокус на модульной архитектуре инструкций.

### ✓ БАЗА — 260125_topic_base_instructions.md
**Статус:** DONE @turn(260125)

Первая рабочая версия базовых инструкций. Шаги 1-12 выполнены, шаг 13 → topic_instructions_quality.md.

**Продукт:** `packages/ai-kit/templates/INSTRUCTIONS.md.j2` → CLAUDE.md (legacy)

---

### ✓ П1. Модульная архитектура (EN) — 260127_topic_instructions_quality.md
**Статус:** DONE @turn(260127_122237M)
**Агент:** ClaudeCode:Socrates

Переход от монолитного INSTRUCTIONS.md.j2 к модульным standalone .md файлам на английском.

**Продукт:**
```
templates/
├── core_instructions.md    ← DONE
├── modes/*.md              ← DONE (7 файлов)
└── workflows/*.md          ← DONE (sddg, solo, pair)
```

**Итог:** Модульная архитектура создана. Шаги 6-7 (валидация) → 260129_topic_ai_kit_redesign.md.

---

### ✓ П2. Редизайн AI Kit — 260129_topic_ai_kit_redesign.md
**Статус:** DONE @turn(260129)

Системный редизайн AI Kit: модульная архитектура, legacy изолирован, документация синхронизирована.

---

---

### Остальное — позже

Остальные темы ЯДРА (topic_secretary, topic_review_mode, и т.д.) будут интегрированы в П2 или вынесены.

---

## ЯДРО

> Темы, напрямую связанные с миссией чат-папки.

### ТЕМА: topic_ai_kit_requirements.md
> AI Kit Requirements — нерешённые вопросы (бэклог)

**Статус**: Снято. **Архив:** `ARCHIVE/260220_duet_mvp/260220_topic_ai_kit_requirements.md` @turn(260220).

**Бэклог:** R1-R9 как явные критерии ревью инструкций; валидация с внешним миром.

---

### ~~topic_document_structure.md~~ → АРХИВ
> Полностью снято → `ai-instructions/schemas/topic_file.md` (5 → 6 секций). **Архив:** `ARCHIVE/260220_duet_mvp/260220_topic_document_structure.md` @turn(260220). Файл удалён.

---

### ~~topic_context_persistence.md~~ → АРХИВ
> Полностью снято → `ai-instructions/modes/execute.md`. **Архив:** `ARCHIVE/260220_duet_mvp/260220_topic_context_persistence.md` @turn(260220). Файл удалён.

---

### ТЕМА: topic_secretary.md
> Secretary — нерешённые вопросы (бэклог)

**Статус**: Основная спека снята → `ai-instructions/modes/secretary.md`. **Архив:** `ARCHIVE/260220_duet_mvp/260220_topic_secretary.md` @turn(260220).

**Бэклог:** Частота вызова (автоматика?), конфликты при ручном редактировании, regex для парсинга checkpoint.

---

### ТЕМА: topic_ai_kit_package.md
> Пакет ai-kit — нерешённые вопросы (бэклог)

**Статус**: Снято. **Архив:** `ARCHIVE/260220_duet_mvp/260220_topic_ai_kit_package.md` @turn(260220).

**Бэклог:** Пользовательская документация (README, USAGE, GLOSSARY); версионирование.

---

### ТЕМА: topic_meta_discussion_format.md
> Формат дискуссий — нерешённые вопросы (бэклог)

**Статус**: Снято → `personas/socrates.md` и методология. **Архив:** `ARCHIVE/260220_duet_mvp/260220_topic_meta_discussion_format.md` @turn(260220).

**Бэклог:** Асинхронность диалога (не кодифицирована); масштабирование личное → команда.

---

### ТЕМА: topic_comments_format.md
> Формат комментариев в документах

**Статус**: Адаптирован из 260109_roles @turn(260112_133518M).

**Суть**: Спецификация `::: АВТОР :::` для встроенных комментариев.

**Новое @turn(260112_125015M):**
- Комментирование = **режим COMMENTARY** (не просто workflow)
- Режим имеет свои правила: что разрешено, как входить/выходить
- Можно комментировать один файл, несколько или все

**Новое @turn(260112_163139M):**
- **Формат атрибуции**: `::: Сократ (Cursor@Opus) :::` — роль + client + model
- **Use case**: structured debate — споры прямо в документе
- **Параллельное ревью**: несколько ролей/моделей комментируют

**Продукт**: Стандарт разметки + спецификация режима COMMENTARY.

---

### ТЕМА: topic_review_mode.md
> Review Mode — нерешённые вопросы (бэклог)

**Статус**: Снято → `ai-instructions/modes/review.md`. **Архив:** `ARCHIVE/260220_duet_mvp/260220_topic_review_mode.md` @turn(260220).

**Бэклог:** Агрегация коллективного ревью; разрешение конфликтов ревьювер/исполнитель.

---

### ТЕМА: topic_revision_mode.md
> Revision Mode — нерешённые вопросы (бэклог)

**Статус**: Снято → `ai-instructions/modes/revision.md`. **Архив:** `ARCHIVE/260220_duet_mvp/260220_topic_revision_mode.md` @turn(260220).

**Бэклог:** Кто владелец режима; периодичность; интеграция с secretary.

---

## ОРБИТА

> Темы, не связанные напрямую с миссией.

### ~~topic_principal_feedback.md~~ → АРХИВ
> Aufgehoben → `personas/socrates.md`. **Архив:** `ARCHIVE/260220_duet_mvp/260220_topic_principal_feedback.md` @turn(260220). Файл удалён.

---

### ~~topic_softeng.md~~ → АРХИВ
> Obsolete: roles → personas + skills. **Архив:** `ARCHIVE/260220_duet_mvp/260220_topic_softeng.md` @turn(260220). Файл удалён.

---

## АРХИВ

> Темы завершённые или с принятым решением. Файлы переименованы с префиксом YYMMDD_.

### 260112_topic_migration_from_roles.md
> Миграция контекста из 260109_roles

**Статус**: Выполнено @turn(260112_171418M). **Перенесён в ARCHIVE/260220_duet_mvp/ @turn(260220).**

**Итог**: Перенесено 5 тем, merge выполнен, исходники удалены.

---

### 260112_topic_instructions_vs_role.md
> Различение: базовые инструкции ≠ роль

**Статус**: Выполнено @turn(260111_0303M). **Перенесён в ARCHIVE/260220_duet_mvp/ @turn(260220).**

**Итог**: Концептуальная основа принята. Инструкции = КАК, Персона = КТО.

---

### 260112_role_tl.md
> Роль Tech Lead — нужна ли?

**Статус**: Решение принято @turn(260112_133518M). **Перенесён в ARCHIVE/260220_duet_mvp/ @turn(260220).**

**Итог**: TL упразднён. Функции переходят к Principal (Review Mode) и SoftEng.

---

### 260113_role_to_persona_refactoring.md
> Рефакторинг: Role → Persona

**Статус**: Выполнено @turn(260113_091212M). **Перенесён в ARCHIVE/260220_duet_mvp/ @turn(260220).**

**Итог**: Понятие Роль заменено на Персона. Созданы файлы персон (.ai/personas), удалены roles. Инструкции и скрипты обновлены.

---

### 260125_topic_base_instructions.md
> Разработка базовых инструкций (CLAUDE.md)

**Статус**: Выполнено @turn(260125). **Перенесён в ARCHIVE/260220_duet_mvp/ @turn(260220).**

**Итог**: Шаги 1-12 выполнены. Создан `INSTRUCTIONS.md.j2` → CLAUDE.md (legacy). Шаг 13 → topic_instructions_quality.md.

---

### 260127_topic_instructions_quality.md
> Ревью качества системных инструкций

**Статус**: Выполнено @turn(260127_122237M). **Перенесён в ARCHIVE/260220_duet_mvp/ @turn(260220).**

**Итог**: Модульная архитектура инструкций создана: `core_instructions.md` + `modes/*.md` + `workflows/*.md`. Шаги 6-7 перенесены в 260129_topic_ai_kit_redesign.md.

---

### 260128_topic_codex_support.md
> Поддержка Codex в AI Kit

**Статус**: Выполнено @turn(260128). **Перенесён в ARCHIVE/260220_duet_mvp/ @turn(260220).**

**Итог**: Codex интеграция через config.toml + MCP. Позднее поглощено Host.

---

### 260129_topic_ai_kit_redesign.md
> Перепроектирование AI Kit

**Статус**: Выполнено @turn(260129). **Перенесён в ARCHIVE/260220_duet_mvp/ @turn(260220).**

**Итог**: Системный редизайн AI Kit. Модульная архитектура (modes/stances/skills/personas/workflows), legacy изолирован в `_legacy/`, документация синхронизирована.
