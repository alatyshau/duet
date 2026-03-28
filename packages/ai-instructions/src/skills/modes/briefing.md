# Stance: Briefing

Deep analysis inside, compact output outside. User sees only results — make them count.

## When

- Synthesizing reports from multiple agents
- Comparing alternatives after research
- Project status with many moving parts
- Any situation requiring decisions, not deep-dive

## Self-Contained Principle

> **Брифинг должен быть самодостаточным.** Человек не должен читать другие документы чтобы понять вопрос.

Объясняй:
- Ход мысли — как пришёл к этим вариантам
- Контекст — что уже знаем, что ограничивает
- Последствия — что будет если выберем A vs B

## Do

1. Structure output as `## Decision N: [question]`
2. Write `**Situation:**` in 1-3 sentences — assume reader has zero context
3. **Explain technical issues in plain language** — what's broken, what's the risk, why it matters
4. Present `**Alternatives:**` as table with Pros/Cons
5. Always give `**Recommendation:**` with one-sentence rationale

## Plain Language Rule

Before stating a technical problem, answer:
- **What happens?** (observable behavior)
- **When?** (under what conditions)
- **So what?** (impact on user/product)

❌ "TZ mutation is not thread-safe"
✅ "Два запроса одновременно — оба получат неправильное время"

## Output Template

```
## Decision 1: [open question]

**Situation:** [1-3 sentences, self-contained]

**Alternatives:**
| Option | Pros | Cons |
|--------|------|------|
| A | ... | ... |
| B | ... | ... |

**Recommendation:** [pick X because Y]
```

## Don't

- ❌ Dump information without structure
- ❌ Dump walls of text — user shouldn't have to dig for the point
- ❌ Skip recommendation ("you decide")
- ❌ Write long Situation sections
- ❌ Present options without comparison
- ❌ Use jargon without explanation

## Iteration Mode

По умолчанию: все вопросы в одном брифинге.

**`!по-одному`** / **`!one-by-one`** — переключает на итерацию: один вопрос за раз.

```
Брифинг (Q1, Q2, Q3)
        ↓
    [обсуждение]
        ↓
    "сохрани в топик"  ← если обсуждение затягивается
        ↓
    ОТКРЫТЫЕ ВОПРОСЫ
        ↓
    !по-одному
        ↓
    Q1 → решение → Q2 → решение → Q3 → решение
```

**После `!по-одному`:**
- Агент берёт первый нерешённый вопрос
- Детально объясняет контекст и варианты
- Ждёт решения
- Переходит к следующему

---

## Switch to dialectic when

- User asks "why?" or pushes back
- Decision requires deeper exploration
- Alternatives aren't clear yet

