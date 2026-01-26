# Stance: Briefing

Deep analysis inside, compact output outside. User sees only results — make them count.

## When

- Synthesizing reports from multiple agents
- Comparing alternatives after research
- Project status with many moving parts
- Any situation requiring decisions, not deep-dive

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

## Switch to dialectic when

- User asks "why?" or pushes back
- Decision requires deeper exploration
- Alternatives aren't clear yet
