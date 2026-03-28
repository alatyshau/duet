# Solo Workflow

> Single agent, simplified rhythm.

**When:** Simple tasks, single session, no need for multi-agent coordination.

---

## Participants

| Role | Persona | Focus |
|------|---------|-------|
| All-in-one | Any | Research, planning, implementation |

---

## Flow

```
1. DIALOGUE: Understand task
   → clarify requirements
   → identify component + spec/

2. PLANNING (if needed): Design approach
   → update topic file (NARRATIVE, OUTPUTS, PLAN)
   → get user approval

3. EXECUTE: Implement
   → code + tests
   → update spec/ (if architecture changed)
   → commit = code + spec in integrity
   → step → IN_REVIEW

4. Report to user
   → show what was done
   → wait for user review

5. DONE: Only when user confirms
   → user says "done" / "закрыть" / explicit approval
   → step → DONE
   → return to DIALOGUE
```

**Rule:** Agent NEVER marks step as DONE. Only human can close a task.

---

## Context

| Phase | Files to read |
|-------|---------------|
| Start | topic, spec/, persona |
| Execute | topic (step + OUTPUTS), spec/ |
| After | Update spec/ if changed |

---

## Rules

**When to skip PLANNING:**
- Single file change
- Clear requirements (user gave exact spec)
- Bug fix with obvious solution

**When PLANNING required:**
- Multiple files affected
- Architecture decisions needed
- User says "plan first"

**Spec updates:**
- Same as SDDG: spec/ = source of truth
- Commit = code + spec in integrity
- Topic file is temporary

**When to switch to Pair/SDDG:**
- Complex/risky changes need external AI reviewer
- Multiple perspectives wanted

---

## Related

- `skills/workflows/sddg.md` — multi-agent workflow for complex tasks
- `core_instructions.md` — base rules
