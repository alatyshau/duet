# Schema: CurrentStepWork.md

**What:** Temporary file for coordinating work on the current step.
**Why:** Context transfer between agents in multi-agent workflows.
**Used by:** Daedalus (creates), Hephaestus (executes), Daedalus-reviewer (reviews).

---

## When Used

- **SDDG workflow** (Socrates + Daedalus + Daedalus + Hephaestus)
- **Pair workflow** (planner + implementer)
- Any multi-agent scenario with task handoff

**NOT used:**
- Solo workflow (single agent)
- Simple tasks without planning

---

## Canonical Structure

```markdown
# CurrentStepWork

**Топик:** [topic_xxx.md](topic_xxx.md)
**Шаг:** N — Название шага
**Статус:** WIP | IN_REVIEW
**Исполнитель:** Гефест (ClaudeCode)
**Ревьювер:** Дедал (Copilot)

---

## Задание

Краткое описание что нужно сделать.
Ссылка на секцию ВЫХОДЫ в топике: [Выход N](topic_xxx.md#выход-n)

---

## Контекст

Что нужно знать исполнителю:
- Ссылки на spec/
- Ключевые ограничения
- Предыдущие решения

---

## Чеклист

- [ ] Пункт 1
- [ ] Пункт 2
- [ ] Пункт 3

---

## Результат

> Заполняется исполнителем после выполнения

**Что сделано:**
- ...

**Артефакты:**
- `path/to/file.ts`
- `path/to/another.ts`

---

## Ревью

> Заполняется ревьювером

**Статус:** ✅ Принято | ❌ Требует доработки

**Замечания:**
1. ...
2. ...
```

---

## Lifecycle

```
1. Daedalus creates file (Assignment, Context, Checklist)
   → Status: WIP

2. Hephaestus executes
   → Fills Result
   → Status: IN_REVIEW

3. Daedalus-reviewer checks
   → Fills Review
   → If OK: step → DONE, file cleared
   → If not: return to step 2

4. After DONE
   → File cleared or deleted
   → Next step — new cycle
```

---

## Rules

1. **One file per project** — don't create CurrentStepWork_1.md, _2.md
2. **Clear after DONE** — don't accumulate history
3. **Reference topic** — details in topic file, only assignment here
4. **Minimal context** — only what implementer needs

---

## Relationship with Topic File

| Aspect | topic_*.md | CurrentStepWork.md |
|--------|------------|-------------------|
| Full plan | ✅ All steps | ❌ Only current |
| History | ✅ НАРРАТИВ | ❌ None |
| Specification | ✅ ВЫХОДЫ | Link only |
| Temporary | ❌ Persistent | ✅ Cleared |
