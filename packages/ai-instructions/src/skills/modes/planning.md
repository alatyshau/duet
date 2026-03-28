# PLANNING Mode

> Read this file when entering PLANNING mode.
> After completion — return to DIALOGUE.

---

## When to Enter

### Explicit (user command)

User switches mode:
- `!режим=ПЛАНИРОВАНИЕ` or `!режим=ПЛАН`
- `@mode(PLANNING)`
- "режим ПЛАНИРОВАНИЕ", "mode PLANNING"

Context is already in chat + NARRATIVE + OUTPUTS. Generate IMPLEMENTATION PLAN from that.

### Implicit (agent-initiated)

User requests something complex without a plan:
- Multiple files to change
- Non-trivial architecture decision
- Risk of breaking existing code

**Threshold:** Only for significant work. Simple fixes don't need a plan.

**Pattern:**
```
User: "Добавь авторизацию в API"
Agent: "Это затронет несколько файлов. Сначала составлю план."
       [switches to PLANNING, formulates plan]
       "Вот план. Выполнять?"
```

---

## What Agent Does

1. **Load context** — if topic exists, read the entire topic file
2. **Create/update topic file** — following `schemas/topic_file.md`
3. **Formulate IMPLEMENTATION PLAN** — completion criteria FIRST, then steps
4. **Propose plan** — "Is this what you want?"
5. **Wait for permission** — transition to EXECUTE only after explicit "yes" / `/next`

---

## What to Read

| Source | Why |
|--------|-----|
| **NARRATIVE** | Decision context, history of thought |
| **OPEN QUESTIONS** | What needs resolution |
| **OUTPUTS** | Specification of what we're building |
| **IMPLEMENTATION PLAN** | Current state, existing criteria |
| **spec/** folder | Baseline of what's already implemented |

> **Deep context:** PLANNING is bound to ONE topic file. Read it entirely before formulating a plan.

---

## Open Questions First

> **Все ОТКРЫТЫЕ ВОПРОСЫ должны быть ✅ РЕШЕНО перед формированием плана.**

ОТКРЫТЫЕ ВОПРОСЫ = Шаг 0 (фаза планирования). Пока есть нерешённые вопросы — план писать рано.

**Question statuses:**
- `TODO` — не начинали обсуждать
- `ОБСУЖДЕНИЕ` — активно обсуждаем
- `✅ РЕШЕНО` — финальное решение принято

**Workflow:**
1. Закрыть все вопросы (статус → ✅ РЕШЕНО)
2. Определить ВЫХОДЫ
3. Написать ПЛАН ВНЕДРЕНИЯ (критерии + шаги)
4. Коммит Шага 0: `docs(topic): topic_xxx — planning complete`

> После коммита Шага 0 — переход к EXECUTE для Шагов 1+.

---

## Definition of Done First

> **Completion criteria are the PRIMARY focus of planning.**

Before writing steps, answer:
- What must happen for this topic to be archivable?
- How will we know it's done?

Steps are HOW to achieve criteria. Criteria are WHAT we're achieving.

---

## Step Granularity

> **One step = one commit.**

- Steps are commit-sized (not micro-tasks)
- If step requires multiple commits → split it
- If step is too small to commit alone → merge with another

---

## Topic File Structure

See `schemas/topic_file.md` for:
- Canonical structure (6 H2 sections)
- IMPLEMENTATION PLAN format
- Plan lifecycle (unclear → planning → in progress → done)

---

## Rule: Steps Link to OUTPUTS

> Every step in IMPLEMENTATION PLAN must contain **link to corresponding OUTPUT** (or topic file).

**Why:**
- Reviewer can quickly jump to specification
- Connection "what we do" ↔ "how it should look" is explicit
- No need to read all OUTPUTS upfront

**Format:**
```markdown
**Output:** [Section name](#anchor)
```

---

## Transition PLANNING → EXECUTE

Transition happens **only after explicit permission**:

| User | Agent reaction |
|------|----------------|
| `/next` or "Yes, execute" | Transition to EXECUTE |
| "No" / clarifying questions | Stay in PLANNING, refine plan |
| Interjections ("ok", "good", "cool") | **Do not transition** — ask: "Should I start execution?" |

**Key rule:** interjections are feedback, NOT `/next` command.

