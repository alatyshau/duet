# SDDG Workflow

> Сократ + Дедал + Дедал + Гефест

**When:** Complex features requiring planning, independent review, and iterative fixes.

---

## Participants

| Role | Persona | Focus |
|------|---------|-------|
| Coordinator | Сократ | Requirements, synthesis, test-plans |
| Architect | Дедал-1 | Planning, structure, constraints |
| Reviewer | Дедал-2 | Independent review, edge cases |
| Implementer | Гефест | Code, tests, spec updates |

---

## Flow

```
1. Planning: Сократ + Дедал-1
   → topic file (NARRATIVE, OUTPUTS, PLAN)

2. Implementation: Гефест
   → code + tests
   → step → IN_REVIEW

3. Review cycle:
   a. Сократ creates CurrentReview.md
   b. Дедал-1, Дедал-2: independent reviews (don't read each other)
   c. Сократ: synthesis → test-plan
   d. Гефест: fixes
   e. Repeat until APPROVED

4. Testing: Human
   → runs test-plan
   → OK → step DONE, delete CurrentReview.md
   → NOT OK → feedback via chat, back to 3d

5. Spec update: Гефест
   → commit = code + spec in integrity
```

---

## Context Passing

| To | Files |
|----|-------|
| Гефест | topic (step + OUTPUTS), spec/, CurrentReview.md (if fixing) |
| Дедал | topic (step + OUTPUTS), code, spec/ |
| Сократ | CurrentReview.md (reviews), topic |

---

## Rules

**For all agents:**
- spec/ = source of truth for current state
- Update spec/ BEFORE commit (not after)
- Topic file is temporary — don't rely on it for long-term truth

**Гефест (EXECUTE):**
- Read topic step + spec/ before starting
- On fixes: read CurrentReview.md "Синтез" section
- Commit = code + spec in integrity

**Дедал (REVIEW):**
- Compare result with spec/, not with topic
- Don't read other reviewer's section until Сократ synthesizes

**Сократ (DIALOGUE):**
- Create CurrentReview.md at review start
- Compile synthesis without priority divisions (all issues must be fixed)
- Human gets info via chat — don't expect them to read files

---

## Related

- [CurrentReview.md schema](../schemas/current_review.md) — review file format
- [topic_file.md schema](../schemas/topic_file.md) — topic structure
- [core_instructions.md](../core_instructions.md) — spec-driven development rules
