# REVIEW Mode

> Read this file when entering REVIEW mode.
> After completion — return to DIALOGUE.

---

## When to Enter

Transition to REVIEW happens by **explicit user request** specifying:
- What to review (which agent/step)
- Which topic file

---

## What Reviewer Does

1. **Read results** of another agent's work
2. **Compare with specification** in OUTPUTS section
3. **Find discrepancies** between plan and implementation
4. **Update spec** (if decision changed) or point out error
5. **Record review result** in topic file

---

## Reviewer = Co-Author

> **After review, reviewer shares full responsibility for the artifact.**

Not enough to check "file exists" — must understand integration:
- Paths in templates
- Dependencies
- Side effects

---

## Reviewer Boundaries

**Reviewer does NOT:**
- Manage step status (TODO/WIP/DONE)
- Ask "should I mark as DONE?"
- Write verdict

**Reviewer ONLY:**
- Lists what was checked
- Records issues (if any)
- Returns to DIALOGUE

---

## Threat Model for AI

Look for places where agent might:
- "Jump ahead" without permission
- Confuse triggers
- Break the process
- Interpret ambiguously

These are review issues.

---

## All Issues Are Equal

**No "blockers/non-blockers" division.** AI writes code — fixing is cheap.

Forbidden phrases in review:
- "not critical", "minor", "cosmetic"
- "nice-to-have", "tech debt"
- "can do later", "doesn't block"
- "low priority"
- "в целом хорошо", "overall good", "looks good"
- "рекомендую", "suggest", "consider"

**No evaluations.** Reviewer lists issues, not opinions. Never write "the code is good/bad" — just list what's wrong (if anything).

Every issue = fix it.

---

## Review Report Format

```markdown
#### Review #N: Persona(Model) @turn(TIMESTAMP)

**Checked:**

| Item | Status |
|------|--------|
| Artifact 1 | ✓ |
| Artifact 2 | ⚠ |
| Artifact 3 | ✓ |

**Issues:**

1. ⚠ **Issue title** — problem description
   - **Fix:** ...
```

### Rules

1. **Number reviews** — `#1`, `#2`, ... for traceability
2. **Issue status** — `⚠ OPEN` or `✓ FIXED` (reviewer updates after re-check)
3. **Empty section if no issues** — don't write "no issues found", just leave section empty and tell user in chat
4. **Never write verdict** — only user decides ACCEPTED/REJECTED
5. **Don't update, don't delete** — old reviews stay, statuses update in-place

### After Executor Fixes

Reviewer re-checks and updates issue statuses:

```markdown
**Issues:**

1. ✓ ~~**Issue title**~~ — FIXED @turn(...)
2. ⚠ **Another issue** — remains open
```

---

## Different Personas — Different Focus

| Persona | Review focus |
|---------|--------------|
| **Daedalus** | Architecture, structure, patterns |
| **Socrates** | Decisions, alternatives, "why?" |
| **Loki** | Provocation, edge cases, "what if?" |

---

## Context for REVIEW

| What to load | Why |
|--------------|-----|
| Entire topic file | NARRATIVE + OUTPUTS + IMPLEMENTATION PLAN |
| Created artifacts | Code files, configs — work result |
| Previous reviews | If any — for discussion context |

---

## Homonym: REVIEW (mode) ≠ IN_REVIEW (status)

| Term | Context | Meaning |
|------|---------|---------|
| **REVIEW** | Agent mode | What agent does: reviewing another's work |
| **IN_REVIEW** | Step status | Technical label: step done, awaiting check |

> Agent works in REVIEW mode to check a step with IN_REVIEW status.

---

## Collective Review

Multiple agents can review the same thing:
- Different personas give different focus (Daedalus vs Socrates)
- Different models give different "brains" (GPT-5.2 vs Opus)
- "Council of sages" — parallel review for important decisions

---

## Completion

After recording review — return to DIALOGUE.

If there are issues — executor agent fixes them.
