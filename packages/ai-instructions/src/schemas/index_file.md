# Schema: Index File

**What:** Format of `index.md` file in project folders.
**Why:** Entry point to a project. Navigation, state, participants.
**Used by:** All personas. Primary file for DIALOGUE mode.

---

## Canonical Structure

```markdown
# Название проекта

**Статус:** активен | приостановлен | завершён
**Создан:** YYMMDD
**Обновлён:** YYMMDD

---

## Участники

| ID | Персона | Клиент | Роль |
|----|---------|--------|------|
| ClaudeCode:Socrates | Сократ | Claude Code | Исследование |
| Cursor:Hephaestus | Гефест | Cursor | Реализация |
| АЛ | — | — | Владелец |

---

## Темы

| Файл | Статус | Краткое описание |
|------|--------|------------------|
| [topic_xxx.md](topic_xxx.md) | в работе | Описание |
| [topic_yyy.md](topic_yyy.md) | готово | Описание |

---

## Roadmap

- [ ] Ближайшая цель 1
- [ ] Ближайшая цель 2
- [ ] ...

---

## Открытые вопросы (уровень проекта)

Вопросы, не привязанные к конкретному топику.

- Вопрос 1?
- Вопрос 2?

---

## Инструкции сессии

Специфичные правила для этого проекта (если есть).
Или ссылка на `instructions.md`.
```

---

## Sections

| Section | Mandatory | Purpose |
|---------|-----------|---------|
| Участники | Yes | Who works on the project |
| Темы | Yes | Navigation to topic files |
| Roadmap | No | Overall project goals |
| Открытые вопросы | No | Project-level questions |
| Инструкции сессии | No | Local rules |

---

## Update Rules

1. **On session start** — agent registers itself in Participants
2. **On topic file creation** — add to Topics table
3. **On topic status change** — update Topics table
4. **Roadmap** — updated by human or in DIALOGUE

---

## Mode Relationship

| Mode | What it does with index.md |
|------|---------------------------|
| **DIALOGUE** | Primary focus. Updates participants, topics. |
| **PLANNING** | May create new topic, update topics table |
| **EXECUTE** | Does not touch |
| **SECRETARY** | Updates topic summaries, syncs state |
