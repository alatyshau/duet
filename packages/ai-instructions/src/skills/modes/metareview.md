# METAREVIEW Mode

> Read this file when entering METAREVIEW mode.
> After completion — return to DIALOGUE.

---

## When to Enter

Change touches **2+ domains** requiring different expertise (code + specs, code + instructions + security, etc.).

Single-domain change → regular REVIEW.

---

## Orchestrator Algorithm

### Step 1. Analyze scope

Two sources — **what was asked** and **what was done**:

1. **Intent**: read design document / prompt.md / topic file / task description. Understand what SHOULD have been done.
2. **Diff**: `git diff --name-status` + `git status`. Understand what WAS done.

Compare: are there parts of the intent not covered by the diff? Missing implementations → each sub-agent checks their domain against the intent, not just the diff.

### Step 2. Select reviewers

Each changed file belongs to a domain. Domain with ≥1 changed file → gets a reviewer.

**Reviewer = identity (WHO), not task label (WHAT).** Each reviewer is a professional with expertise and perspective, not a checklist runner. "Python Engineer" — yes. "Import Checker" — no.

| Domain | Files | Role |
|--------|-------|------|
| Python code | `*.py` (not `test_*`, not build scripts) | Python Engineer |
| TypeScript code | `*.ts`, `*.tsx` (not `*.test.*`) | TypeScript Engineer |
| Tests | `test_*.py`, `*.test.ts`, conftest, fixtures | Test Engineer |
| Specs | `spec/*.md` | Spec Architect |
| AI instructions | `modes/`, `stances/`, `skills/`, `personas/`, `core_instructions*` | AI Instructions Specialist |
| API contracts | Endpoints, MCP tools, response schemas | API Designer |
| Build & deploy | CI/CD, Dockerfile, build scripts | DevOps Engineer |
| UI | Components, pages, styles | UI/UX Reviewer |

**Security Analyst** — always when code touches file I/O, path handling, or external input.

One file can trigger multiple reviewers (endpoint → Python + API + Security).

**Custom reviewers** — when scope doesn't match standard domains (e.g. cross-document architecture review), define reviewers by expertise area. Same rule: identity first, focus second.

### Step 3. Present roster

Show user table: role + WHO (1-sentence identity) + scope. Wait for confirmation.

User may challenge roles — listen. "Entity Tracer" is a task, not a person. "Domain Architect — мыслит сущностями и отношениями" is a person.

### Step 4. Launch all sub-agents in parallel

### Step 5. Review of Reviews

Sub-agents find issues. Orchestrator **challenges** them:
- Read primary sources to verify claims
- Dismiss false positives (reviewer misunderstood, or behavior is by-design / explicitly deferred)
- Deduplicate across reviewers (same issue found by 3 reviewers = 1 issue, not 3)
- Group confirmed issues into action clusters

Write `metareview.md` with:
1. **Summary table** — per reviewer: submitted / confirmed / dismissed
2. **Action clusters** — deduplicated groups of confirmed issues. Mark **dependency chains** (A→B→C = sequential) vs **independent** clusters (any order). No artificial priority levels — if everything will be done, order only matters where there are dependencies
3. **Dismissed issues table** — with reason. This protects executor from "fixing" things that aren't broken
4. **Reduced priority table** (optional) — issues that are real but low-impact

### Step 6. Report

metareview.md → DIALOGUE. User decides what to fix.

**Metareview = strict spec for executor.** When user hands metareview.md to another agent:
- Confirmed clusters = do
- Dismissed = don't touch
- Nothing beyond metareview without asking

---

## Sub-Agent Prompt

Each prompt has 4 blocks. Sub-agent cannot read instruction files — inject rules verbatim.

### Example prompt

```
# REVIEW: Python Engineer

You are a senior Python engineer reviewing the workspace_info v2 implementation.

## !режим=ревью

**No "blockers/non-blockers" division.** Every issue = fix it.

Forbidden: "not critical", "minor", "cosmetic", "nice-to-have",
"looks good", "overall good", "suggest", "consider"

No evaluations. List issues, not opinions.

Report format:

  #### Review #1: PythonEngineer(Opus) @turn(TIMESTAMP)

  **Checked:**
  | Item | Status |
  |------|--------|
  | ... | ✓ or ⚠ |

  **Issues:**
  1. ⚠ **Issue title** — description
     - **Fix:** ...

## Context

This project redesigns the workspace_info endpoint.
Design document (source of truth — check implementation against it): /path/to/prompt.md
Component spec: /path/to/spec/COMPONENT.md

## Files to read

1. /path/to/description.py — (NEW, primary)
2. /path/to/workspace.py — (MODIFIED, primary)
3. /path/to/scanner.py — (MODIFIED, secondary)

## Output

Write to: /path/to/project_folder/review_python.md
Language: RU
```

### Prompt rules

| Block | Rule |
|-------|------|
| **Role** | 1 sentence — domain + focus. No lists of qualities (agents know their craft) |
| **!режим=ревью** | Verbatim from `review.md`: format, forbidden phrases, issue equality. Must be IN the prompt — sub-agent cannot read files |
| **Context** | Design doc as source of truth (reviewer checks completeness against it) + component spec + 1-sentence change description |
| **Files** | Explicit paths. Only files for this domain. Include design doc for context |
| **Output** | Explicit path + language |

---

## Output Location

Review files → **project folder** (folder with design document / prompt.md).

No project folder → next to the primary changed file.

```
{project_folder}/
  review_python.md
  review_tests.md
  review_specs.md
  review_api.md
  review_security.md
  review_instructions.md
```

Naming: `review_<lowercase_role>.md`

---

## Orchestrator Boundaries

**Does:** analyze scope, select roles, compose prompts, launch agents, challenge findings against primary sources, deduplicate, group into clusters, dismiss false positives, write metareview.md.

**Does NOT:** write verdict (user decides), fix issues (executor does).

---

## Completion

Summary table → DIALOGUE. User decides what to fix.
