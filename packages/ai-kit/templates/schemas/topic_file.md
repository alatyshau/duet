# Schema: Topic File

**What:** Format of `topic_*.md` files in project folders.
**Used by:** All personas, all modes (with different permissions).

## Writing Principle

**Write for humans first.** The primary reader is a person returning to the project after a break — not the AI agent, not a "dry technician".

- Formulations must be self-explanatory without chat context
- Each item answers: what is the problem, why it matters, what to do
- Avoid cryptic shorthand that only makes sense mid-conversation

---

## Canonical Structure

Each topic file contains **6 H2 sections** in strict order:

```markdown
# Название темы

**Статус:** черновик | в работе | готово | отложено

---

## МОТИВАЦИЯ
Зачем документ существует. Какую проблему решает.

---

## ССЫЛКИ
Ссылки на другие файлы, внешние источники.

---

## НАРРАТИВ
История развития мысли. Как пришли к текущему состоянию.
Тематические подсекции (H3) — здесь.

---

## ОТКРЫТЫЕ ВОПРОСЫ
Вопросы требующие исследования или решения.
Группируются по аспектам (H3).

---

## ВЫХОДЫ
Структурированный результат работы над темой.
Фокус на продукте, не на процессе.

---

## ПЛАН ВНЕДРЕНИЯ
Постановка задачи + критерии завершённости + шаги внедрения.
```

**All sections are mandatory.** Additional content — only as subsections (H3, H4).

---

## Section Details

| # | Section | Purpose | When to update |
|---|---------|---------|----------------|
| 1 | МОТИВАЦИЯ | Why document exists | On creation, rarely changes |
| 2 | ССЫЛКИ | External context | As they appear |
| 3 | НАРРАТИВ | History of thought (process) | In DIALOGUE, PLANNING |
| 4 | ОТКРЫТЫЕ ВОПРОСЫ | Questions for research | In DIALOGUE, PLANNING |
| 5 | ВЫХОДЫ | Structured result (product) | In PLANNING |
| 6 | ПЛАН ВНЕДРЕНИЯ | Problem + criteria + steps | In PLANNING, statuses in EXECUTE |

---

## IMPLEMENTATION PLAN Structure

### Plan Lifecycle

| Stage | Status | What it means | Git |
|-------|--------|---------------|-----|
| **Uncertainty** | `unclear` | Topic just emerged, not yet clear why it matters | — |
| **Planning (Шаг 0)** | `planning` | ОТКРЫТЫЕ ВОПРОСЫ → ВЫХОДЫ → ПЛАН | — |
| **Planning complete** | `planning` | Все вопросы ✅ РЕШЕНО, план готов | Commit Шага 0 |
| **Execution** | `in progress` | Шаги 1+ being worked on | Commit per step |
| **Completion** | `done` | All criteria met, topic can be archived | — |

> **Ключевой момент:** Переход от Planning к Execution = коммит Шага 0 (документа). Это фиксация всего обсуждения перед началом реализации.

This section has **three mandatory parts**:

### 1. Постановка задачи (H3)

Captures the essence of what we're solving:

```markdown
### Постановка задачи

#### Scope
Для кого? Что включено/исключено?

#### Фундаментальный вопрос
Главный вопрос, на который отвечает план.

#### Контекст
Ключевые решения, ограничения, принципы.
```

**Why mandatory:** Without clear problem statement, criteria become abstract and steps lose direction. This is the "contract" between planning and execution.

### 2. Критерии завершённости (H3)

```markdown
### Критерии завершённости

- [ ] Критерий 1 (трассируемый к постановке задачи)
- [ ] Критерий 2
- [ ] ...
```

**Rule:** Each criterion should be traceable to something in Problem Statement.

### 3. Шаги (H3+)

#### Шаг 0: Документ (обязательный)

```markdown
### Шаг 0: Документ
**Статус:** TODO | IN_REVIEW | DONE

Фиксация результатов планирования.

**Коммит:** `docs(topic): topic_xxx — planning complete`
```

Шаг 0 завершается когда все ОТКРЫТЫЕ ВОПРОСЫ имеют статус ✅ РЕШЕНО и ПЛАН написан.

#### Шаги 1+: Реализация

```markdown
### Фаза 1: Название

#### Шаг 1: Название
**Статус:** TODO | WIP | IN_REVIEW | DONE
**Выход:** [Ссылка на секцию ВЫХОДЫ](#якорь) или внешний файл

**Ход работы:**
- [ ] Пункт 1
- [ ] Пункт 2

**Коммит:** `type(scope): description`
```

**Правило:** Каждый шаг = один коммит. Коммит делается при переходе в IN_REVIEW.

---

## Mode Permissions

| Mode | Reads | Writes |
|------|-------|--------|
| **DIALOGUE** | All | NARRATIVE, MOTIVATION, start of PLAN |
| **PLANNING** | All | NARRATIVE, OUTPUTS, IMPLEMENTATION PLAN |
| **EXECUTE** | All | Only step statuses |
| **SECRETARY** | Headers | All (archiving from chat) |
| **REVIEW** | All + artifacts | Review results |

---

## Granularity Principle

**One document = one topic.**

If during narrative a new independent topic crystallizes — create a new `topic_*.md` file.

---

## Naming

```
topic_<short_name>.md
```

Examples:
- `topic_ai_kit_redesign.md`
- `topic_auth_flow.md`
- `topic_performance_optimization.md`
