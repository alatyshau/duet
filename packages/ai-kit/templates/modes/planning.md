# PLANNING Mode

> Read this file when entering PLANNING mode.
> After completion — return to DIALOGUE.

---

## When to Enter

Transition **DIALOGUE → PLANNING** occurs when:
- User requests changes **outside project folder** (code, configs)
- Need to create or update a topic file with a plan

**Key rule:** EXECUTE only with a plan. No plan — PLANNING first.

---

## What Agent Does

1. **Load context** — if topic exists, read the entire topic file
2. **Create/update topic file** — following canonical structure (5 H2 sections)
3. **Formulate IMPLEMENTATION PLAN** — completion criteria FIRST, then steps
4. **Propose plan** — "Is this what you want?"
5. **Wait for permission** — transition to EXECUTE only after explicit "yes" / `/next`

---

## What to Read

| Section | Why |
|---------|-----|
| **NARRATIVE** | Understand decision context, history of thought |
| **OUTPUTS** | Find specification of what we're building |
| **IMPLEMENTATION PLAN** | See current state, existing criteria |

> **Deep context:** PLANNING is bound to ONE topic file. Read it entirely before formulating a plan.

---

## Granularity Principle

> **One document = one topic/project/idea.**

If during narrative a new independent topic crystallizes — create a new `topic_*.md` file.

Don't overload one topic with unrelated concerns.

---

## Definition of Done First

> **Completion criteria are the PRIMARY focus of planning.**

Before writing steps, answer:
- What must happen for this topic to be archivable?
- How will we know it's done?

Steps are HOW to achieve criteria. Criteria are WHAT we're achieving.

---

## Topic File Structure

Every topic file contains **exactly 5 H2 sections** in strict order:

```markdown
# Topic Title

**Status:** ...

---

## MOTIVATION
Why this document exists. What problem it solves.

---

## REFERENCES
External context: links to other files, citations, references.

---

## NARRATIVE
History of thought development. How we arrived at current state.
Thematic subsections (H3) — here.

---

## OUTPUTS
Structured result of work on the topic.
Focus on product, not process.

---

## IMPLEMENTATION PLAN
Completion criteria. Implementation steps.
```

**All sections required.** Additional content — only as subsections (H3, H4).

---

## Implementation Plan Stages

| Stage | Status | Description |
|-------|--------|-------------|
| **Uncertainty** | `unclear` | Topic just emerged, unclear why |
| **Planning** | `planning` | Outputs appeared, formulating criteria |
| **Execution** | `in progress` | Steps with TODO/WIP/IN_REVIEW/DONE |
| **Completion** | `done` | All criteria met, can archive |

---

## Implementation Plan Format

```markdown
## IMPLEMENTATION PLAN

**Status:** planning | in progress | done

**Completion criteria:**
- [ ] Criterion 1
- [ ] Criterion 2

### Step 1: Title
**Status:** TODO | WIP | IN_REVIEW | DONE
**Output:** [Link to output](#anchor) or topic_xxx.md

**Work log:**
- [ ] Item 1
- [ ] Item 2

### Step 2: ...
```

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

---

## File Types in Project Folder

| File | Description |
|------|-------------|
| `index.md` | Project folder index |
| `instructions.md` | Session-specific instructions |
| `draft_*` | Personal notebook, AI doesn't touch |
| `topic_*` | Discussion of topics/projects/ideas |