---
name: project-revision
description: "Deep audit and restructuring of a work folder into a tree of per-task subfolders. Use when plan.md has drifted — bloated past one screen, stale checkboxes, orphaned files, completed phases not reflected — or when the user explicitly asks to clean up a work folder."
---
# Skill: Project Revision (tree-structured)

A work folder exists so the user can open `plan.md` and understand the full picture in 30 seconds. When that stops working — when `plan.md` is a wall of checkboxes, files have piled up without links, completed work isn't reflected — the folder has drifted from its purpose. This skill reconstructs clarity by rebuilding the folder as a **tree of per-task subfolders**, with a `plan.md` at every node.

## Why a tree

A single growing `plan.md` eventually fails the clarity check: phases that were conceptually distinct end up as adjacent paragraphs, completed work and open work blur, and finding the context for one sub-chunk requires re-reading the whole. A tree solves this by giving every bounded unit of work its own address and its own `plan.md`. The reader lands at the node matching their current focus and is immediately oriented; they navigate up for broader context or down for detail.

Classify subfolders by *task*, not by file role (`deliverable/`, `analysis/`, `input/`). Tasks are how the user thinks about the work; roles are a bookkeeping concern that fragments a single task across folders.

## The core rule: one task = one folder

Every **bounded** chunk of work — with its own goal, its own done-criterion, its own artifacts — becomes its own folder. When the task is bounded, create the folder immediately, even if it initially holds only a three-line `plan.md`: carving a buried sub-chunk out of a bloated parent later costs far more than the near-zero cost of a fresh folder. When the task is **not** yet bounded — see `Decomposition discipline` below.

This applies recursively. A task's folder can contain subtask folders; those can contain their own. Depth follows the work, not a rule.

```
WIP_bigtask/
├── plan.md                       ← the task's own plan
├── WIP_subtask_a/
│   ├── plan.md
│   └── archive/
│       └── 260414_leaf/plan.md   ← closed sub-subtask
├── TODO_subtask_b/plan.md        ← queued
└── archive/
    └── 260415_subtask_c/plan.md  ← closed subtask
```

**Lifecycle of a folder:** `TODO_<slug>/` → `WIP_<slug>/` → `archive/YYMMDD_<slug>/` of the parent. Closed folders move into the parent's `archive/`, not renamed in place — this keeps the parent directory showing only active work, with closed items one click deeper and sorted by close date. `YYMMDD` is the close date (not start), lexicographically sortable.

**Single filename `plan.md` at every level.** Resist the urge to disambiguate with `plan_moex.md` or `plan_bigtask.md` — it breaks the tree's predictability (automations and readers can no longer assume `plan.md` lives in every folder) and the names inflate with depth. Editor tab labels automatically prefix the parent folder when filenames collide; that solves the ergonomics without breaking the pattern.

**`drafts/` — the only allowed role-based subfolder.** The user's raw material: hand-written notes, pasted snippets, reference inputs they haven't curated yet. This is an authorship boundary, not a file-type grouping: agents don't generate into `drafts/`, don't reorganize or rewrite its contents, don't archive files out of it during revisions. Treat it as read-only unless the user explicitly says otherwise. No other role-based groupings (`output/`, `analysis/`, `input/`) — bounded work that would fill them belongs in its own subtask folder.

## Decomposition discipline

A folder is a commitment to a boundary. Once a task has its own folder, its own `plan.md`, and its own line in the parent index, dissolving it back into text costs more than holding it in text until the boundary is clear. **If you can't state the task's goal and done-criterion in one sentence each, leave it as a topic in the parent's `plan.md` and carve the folder out when the task matures.** This is the counterpart to `one task = one folder`: create the folder eagerly when the task is bounded, hold off when it isn't.

**No more than 7 direct children at any level.** Past that, the reader stops seeing the shape of the work and starts scanning a list. If natural decomposition produces 8+ subtasks, one of three things is happening: (a) some tasks group by theme and belong consolidated one level up, (b) the split is at the wrong granularity — either too fine (collapse several into one) or too coarse (split the parent differently), or (c) not all of them are tasks yet — some are open topics that belong as text in the parent's `plan.md` until they're ready to become folders.

## File naming inside a work folder

Consistent names make the folder scannable without opening anything. Rules:

**Slug convention.** Kebab-case inside the slug (`tree-structure`, `moex-paywall`). Underscore separates a qualifier — status, type, or date — from the slug (`WIP_test-apis`, `design_tree-structure`, `archive/260415_moex-iss/`).

**Standard type prefixes** for files in the work folder root:

| Prefix | Meaning | Example |
|--------|---------|---------|
| `plan.md` | The work folder's own plan. Exactly one per folder, no prefix | `plan.md` |
| `design_<slug>.md` | Proposal/decision document, written before building | `design_tree-structure.md` |
| `review_<slug>.md` | Review or critique of an artifact or approach | `review_auth-flow.md` |
| `research_<slug>.md` | Investigation write-up — what we learned about X | `research_moex-paywall.md` |
| `handoff_<slug>.md` | Context transfer for another session or agent | `handoff_docs-review.md` |
| `notes_<slug>.md` | Running notes collected during the work | `notes_iss-quirks.md` |
| `playbook_<slug>.md` | Reusable procedure/methodology applied across many instances | `playbook_api-test.md` |

**Date-prefixed names (`YYMMDD_<slug>`) are only legal inside `archive/`** — for closed subtask folders. If you feel the urge to date-prefix live files at the root (a series of notes, iteration snapshots), that's a diagnostic: the work has grown past what a single `plan.md` can hold. Extract those files into a dedicated subtask folder with its own `plan.md`, don't paper over the overload with filenames.

**If a file doesn't fit any standard prefix — pause and reason.** It's a signal, not a free pass. One of three things is true:
1. It actually fits an existing prefix after a closer look → apply the right one.
2. It's a genuinely new recurring type → surface to the user, propose extending the prefix set or treating this as a one-off.
3. It doesn't belong in the work folder → move to the product (`packages/<x>/`), to `drafts/`, or extract into its own subtask folder.

Never silently leave an unprefixed file and move on.

## The primary rubric

> **Open any `plan.md` cold — do you understand that bounded chunk of work in full?**

Goal clear, subtasks and their status visible, links out to details (either to subfolders or to product artifacts), `ЧТО ДАЛЬШЕ` or `Наследство` actionable. If any of these fail, the plan isn't doing its job. This check applies at every level of the tree, independently.

Core conventions — one-screen rule, `Goal` / `ЧТО СДЕЛАНО` / `ЧТО ДАЛЬШЕ` sections, `WIP_/TODO_` prefixes — come from `core_instructions.md` (Project management). This skill only covers what's specific to the tree restructuring.

## How to do a revision

This is deep work, not a quick pass. A shallow revision — skimming the old plan and reformatting it — reproduces the drift in a prettier layout instead of fixing it. Reconstruct from primary sources (files, git, conversation history), not from the old plan.

### 1. Rename old plan

Rename `plan.md` → `plan_old.md` — user-side backup, invisible to you (any `*_old.*` rename means deleted from your view). Reconstruct from primary sources (step 2).

### 2. Read everything

Every file in the folder. Every design doc. If the work shipped into a git repo — relevant specs, READMEs, recent `git log`. Understand what actually happened, not what the old `plan.md` claims. The old plan is a symptom, not a source of truth; it may be wrong, stale, or incomplete.

### 3. Diagnose

Specific symptoms to look for:

- `plan.md` bloated (over one screen, implementation details, stale checkboxes).
- Subtasks visible in the old plan as paragraphs or sections but living as inline text, not as folders.
- Completed phases not reflected in `ЧТО СДЕЛАНО`.
- Goal no longer accurate — the work evolved past its original framing.
- Orphan files not linked from anywhere.
- Artifacts that belong in the product (`packages/<x>/`, `spec/`, `docs/`) still sitting in the work folder.

### 4. Propose the tree

Identify every bounded task that the current work covers. Each becomes a folder. Some will be already-closed (→ `archive/YYMMDD_<slug>/`), some active (→ `WIP_<slug>/`), some queued (→ `TODO_<slug>/`).

Report in chat, not in files. Wait for approval before touching anything.

```
## Revision: <folder name>

**State:** <one sentence — how bad is it?>

**Proposed tree:**
- WIP_<task>/ ← <one-line summary>
- archive/260414_<closed>/ ← <what it covered>
- ...

**Problems found:**
- ...

**Plan:**
- Rewrite plan.md from scratch.
- Move <files> into <subfolders>.
- Promote <inline sections> to their own folders.

Approve?
```

### 5. Work task by task

After approval — go deep into each task folder one at a time:

- Read its source material thoroughly (files, git artifacts, conversation history if relevant).
- Write that task's `plan.md` — goal, narrative milestones, links to artifacts in git and to any child folders.
- For closed tasks: phrase as a journal of what happened. For active tasks: goal + current status + next steps.
- Show the user. Get approval before moving on.

**Offload to git / product artifacts aggressively.** Component docs, API references, test scripts, test reports, specs — these belong in the product, not the work folder. The work folder's `plan.md` links to them; it doesn't duplicate their content. Implementation specifics (field names, numeric limits, JSON samples) break the one-screen rule — they live in the artifact.

### 6. Assemble the parent `plan.md`

After all child folders are written — the parent `plan.md` composes itself from them. The mapping between subfolder status and plan sections is mechanical:

- **`archive/YYMMDD_<slug>/`** → `## ЧТО СДЕЛАНО`. One narrative milestone per closed subfolder, with a link to that folder (or to the git artifact for small items that didn't earn their own folder).
- **`WIP_<slug>/`** → `## ЧТО ДАЛЬШЕ`, in an "сейчас в работе" block. Currently active subtasks.
- **`TODO_<slug>/`** → `## ЧТО ДАЛЬШЕ`, in an "в очереди" block. Queued subtasks, not yet started.

Split `ЧТО ДАЛЬШЕ` into active vs queued explicitly — the reader needs to see what's moving right now versus what's waiting.

**Every reference is a line of context, not a bare link.** This is the single rule that decides whether `plan.md` actually works. A reader opening it cold must understand, from the plan alone, why each subfolder or file exists, what its goal is, and how it connects to the work — without descending into it. A bare link is the most common failure mode of a revision.

```
❌  - [WIP_moex/](WIP_moex/)
❌  - WIP_moex/ — тест MOEX
✅  **MOEX ISS — проверка провайдера → [WIP_moex/](WIP_moex/).**
    Прогоняем каждый из 9 API эмпирически, чтобы понять что реально работает
    в гостевом режиме и где Algopack перекрывает бесплатный ISS. В работе.
```

The same rule applies to file links, not just subfolder links.

**Edge cases:**
- **Work folder with no subfolders.** Small task, no tree. `ЧТО ДАЛЬШЕ` is just a list of concrete next steps, no subtask split.
- **Closed work folder.** Replace `## ЧТО ДАЛЬШЕ` with `## Наследство` — a pointer to where the surviving artifacts live (usually in the product: `packages/<x>/...`).

If the parent doesn't fit on one screen, something belongs deeper in the tree.

Leave cleanup to the user. **The agent never deletes files in work folders** — the user handles cleanup when they want to. This is unconditional, not a revision-specific rule.

## Verify before presenting

- Every `plan.md` in the tree fits on one screen.
- `ЧТО СДЕЛАНО` at every level is narrative, not a checklist of implementation details.
- `ЧТО ДАЛЬШЕ` or `Наследство` is actionable — concrete, not vague intentions.
- Every file in the folder (except `drafts/` contents) is both linked from a `plan.md` and framed with enough context — what it is, why it exists, how it connects to the work — that a reader landing on it cold doesn't have to guess. A bare link without a sentence of framing fails this check.
- Every `plan.md` passes the clarity check independently, without requiring the reader to hold other context.

## Anti-patterns

| Don't | Why it hurts |
|-------|--------------|
| Batch several subtasks into one folder because they ran in parallel | Parallel execution is operational; each subtask still has its own goal and deserves its own folder — and retroactive splitting is expensive |
| Copy `✅/❏` checkboxes into the new `plan.md` | Reproduces the problem you're solving; narrative milestones replace checkboxes |
| Put implementation specifics (field names, limits, JSON samples) in `plan.md` | Breaks the one-screen rule and duplicates what belongs in the artifact |
| Delete any file | Agents never delete files in work folders — that's the user's call, always. Files that look obsolete usually belonged to a subtask that wasn't separated; extract that subtask retroactively into `archive/YYMMDD_<slug>/` and describe why the artifact is no longer active in its `plan.md` |
