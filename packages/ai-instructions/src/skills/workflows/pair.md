# Pair Workflow

> Two agents: implementer + reviewer.

**When:** Tasks needing external review but not full SDDG ceremony.

---

## Participants

| Role | Persona | Focus |
|------|---------|-------|
| Implementer | Any (usually Гефест) | Code, tests, spec updates |
| Reviewer | Any (usually Дедал) | Review, edge cases, alternatives |

---

## Flow

```
1. DIALOGUE: Understand task
   → Implementer clarifies requirements
   → Agree on approach

2. EXECUTE: Implementer works
   → code + tests
   → step → IN_REVIEW
   → create CurrentReview.md (Status: REVIEWING)

3. REVIEW: Reviewer checks
   → fill "Ревью" section in CurrentReview.md
   → Status: NEEDS_FIXES (if issues) or APPROVED

4. FIX: Implementer addresses issues
   → fill "Ответ исполнителя"
   → Status: REVIEWING (back to reviewer)

5. Repeat 3-4 until APPROVED

6. DONE: Human verifies
   → run test-plan
   → step → DONE
   → delete CurrentReview.md
```

---

## CurrentReview.md (simplified)

```markdown
# CurrentReview

**Шаг:** [Step N — Title](topic_xxx.md#шаг-n)
**Статус:** REVIEWING | NEEDS_FIXES | APPROVED

---

## Ревью: Дедал (Cursor)

**Артефакты проверены:**
- `path/to/file.ts`

**Замечания:**
1. ...

---

## Ответ исполнителя

**Исправлено:**
- [x] Замечание 1 — fixed in commit abc123

**Не исправлено (с обоснованием):**
- ...
```

No "Синтез" section — only one reviewer, no need to compile.

---

## Context Passing

| To | Files |
|----|-------|
| Implementer | topic (step + OUTPUTS), spec/, CurrentReview.md (when fixing) |
| Reviewer | topic (step + OUTPUTS), code, spec/ |

---

## Rules

⛔️ **Agent NEVER marks step as DONE** — only human after verification.

**Implementer:**
- Create CurrentReview.md when step → IN_REVIEW
- Read reviewer's замечания before fixing
- Update spec/ if architecture changed
- Commit = code + spec in integrity

**Reviewer:**
- Compare result with OUTPUTS in topic
- Don't fix code — only list issues
- No "minor/major" — all issues must be fixed

---

## When to Upgrade to SDDG

- Need multiple independent reviewers
- Complex architecture decisions
- Want "council of sages" review

---

## Related

- `skills/workflows/sddg.md` — full multi-agent workflow
- `skills/workflows/solo.md` — single agent (no external review)
- `schemas/current_review.md` — review file schema
