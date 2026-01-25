# EXECUTE Mode

> Read this file when entering EXECUTE mode.
> After completion — return to DIALOGUE.

---

## Algorithm

1. **Load context** — read entire topic file (NARRATIVE + OUTPUTS + IMPLEMENTATION PLAN)
2. **Find current step** — WIP or first TODO after `/next`
3. **Execute step** — following "Work log" items
4. **Report** — what was done, any questions
5. **Update status** — WIP → IN_REVIEW
6. **Wait** — for `/done` or `/done-next` from user

---

## What to Read

| Section | Why |
|---------|-----|
| **NARRATIVE** | Understand decision context, history |
| **OUTPUTS** | Find specification of what we're doing |
| **IMPLEMENTATION PLAN** | Find current step and its "Work log" |
| **Link in step** | `**Output:**` points to specific OUTPUTS section |

> **Rule:** Step relies on specification in OUTPUTS. Brief step title is not the full instruction.

---

## What to Modify

| Zone | Allowed |
|------|---------|
| **Repository** (code, configs) | ✅ Yes — this is EXECUTE's purpose |
| **Topic file** (step status) | ✅ Yes — update WIP → IN_REVIEW |
| **Topic file** (other sections) | ⚠️ Only if need to record a decision |
| **index.md** | ❌ No — this is DIALOGUE zone |

---

## State Machine

Each step in IMPLEMENTATION PLAN goes through 4 statuses:

```
TODO ──/next──► WIP ──(agent)──► IN_REVIEW ──/done──► DONE
                                     │
                                     └──(fixes per feedback)──┘
```

### Statuses

| Status | Owner | Agent can | Agent behavior |
|--------|-------|-----------|----------------|
| `TODO` | User | ❌ Wait for `/next` | — |
| `WIP` | Agent | ✅ Work | **Proactive** (best guess) |
| `IN_REVIEW` | User | ⛔️ HANDS OFF | **Reactive** (wait for feedback) |
| `DONE` | — | ❌ Closed | — |

> **IN_REVIEW** means ball is on user's side. Agent **WAITS** and does nothing without explicit request.
>
> ⚠️ **IN_REVIEW can last days.** It's a major work phase, not a quick check.

---

## Commands (explicit triggers)

| Command | Action | Transition |
|---------|--------|------------|
| `/next` | Start next TODO step | TODO → WIP |
| `/done` | Close current IN_REVIEW step | IN_REVIEW → DONE |
| `/done-next` | Close AND start next | IN_REVIEW → DONE + TODO → WIP |

---

## Critical Rules

### 1. `/done` ≠ `/next`

Closing a step **does NOT give** permission to start next.

```
User: /done
Agent: "Step N closed. Start step N+1?"  ← wait for explicit permission
```

### 2. Interjections ≠ command

**Interjections** ("good", "ok", "cool", "got it") are feedback, NOT a command.

```
User: "Good"
Agent: "Should I start step N?"  ← ask for confirmation
```

**Explicit triggers:**
- `/next` — start step
- "Yes, execute" — start step
- "Yes" (in context of question about starting) — start step

### 3. Usually one WIP

- Agent focuses on one WIP step
- IN_REVIEW can be many simultaneously
- Can start next step before closing previous IN_REVIEW

---

## Step Format

```markdown
### Step N: Title
**Status:** TODO | WIP | IN_REVIEW | DONE
**Output:** [Link to OUTPUTS section](#anchor)

**Work log:**
- [ ] Item 1
- [ ] Item 2
```

**"Work log"** — universal name:
- Before start: plan what to do
- After: log of what was done (checklist with ✓)

---

## Reporting

After completing a step, report:

```markdown
**Step N completed.**

**Done:**
- [x] Item 1
- [x] Item 2

**Result:** brief description

**Questions:** (if any)
- ...

Awaiting `/done` or `/done-next`.
```

---

## No Auto-Continue

### On session start

Even if agent sees WIP step:
1. Start in DIALOGUE mode
2. Report: "There's a WIP step from previous session in topic_xxx.md. Continue?"
3. Transition to EXECUTE only after explicit "yes"

**Why:** New session = loss of chat context. Automatic continuation is dangerous.

### After completing a step

Agent does not start next step automatically:
- `/done` closes step but doesn't give permission for next
- Need explicit `/next` or `/done-next`

---

## Proactivity

**Allowed:**
- Within CURRENT step (improve code, add checks, fix obvious bugs)

**Forbidden:**
- Starting next step "while at it"
- Doing work not related to current step's specification

---

## "Step Back" Rule

> ⚠️ **After making changes, re-read the file entirely.**

Common mistake: agent edits file but doesn't verify result matches intention.

**Pattern:**
1. Make edit
2. Re-read file (or relevant section)
3. Verify change is correct
4. Continue or fix

This prevents drift between intention and actual file state.

---

## Agent's Internal Checklists

If agent uses internal files for task tracking (e.g., `task.md` or session memory):
1. **ONLY current step:** Checklist may only have tasks for active WIP step
2. **No future:** Strictly forbidden to add tasks from next steps (TODO) to current checklist
3. **Cleanup:** On step change, old checklist must be cleared or archived
