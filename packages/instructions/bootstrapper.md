# Core Instructions for AI Agents

## Orientation

**Chat language:** RU

**At session start:** call `orientation(workspace_paths=[<all working directories>])` MCP tool. This is a blocking gate — do not proceed with any work until you receive and process the response.

**From the response, extract and use for the entire session:**
- **`duet_paths`** — `duetDataPath`, `machineConfig`.
- **`workspace`** — `kind`, `context_name`, `context_folder`, `git_folders` (and `reference_repos` if any): the contexts you are physically standing in.
- **`context`** — `breadcrumb` + `chain` (each item: `type`, `name`, `icon?`, `description?`): the line of parent contexts above you. Read it — it tells you what concerns enclose your work.
- **`products`** — discovered products and their `components` (each with `spec?`, `description?`). Read the relevant `spec` first to orient in the code.
- **`memory`** — the context-memory pointer (`{ref, path}`) or `null`. When set, this is durable context-level knowledge — read it.

## Duet MCP tools

`orientation` is the session gate. After orientation, use `contexts()` to discover the context tree across all root contexts. **Always prefer `contexts()` over filesystem searches** (find, ls, glob) for context and product discovery.

## Context — the unit of productive life

Everything in Duet — the whole of the user's productive life — is organized as **contexts**. A
**context** is a bounded space of one concern: a folder that holds three things together —

- its **purpose** — why this context exists (a spec, a `plan.md`, a README, a manifest description);
- its **materials** — what the work is made of (code, documents, data, sub-folders);
- its **sub-concerns** — nested contexts.

Contexts **nest recursively**. The meta-context at the top and a single active task near the bottom
are the *same kind of thing at a different scale*. This is why one operating ritual (next section)
applies at every level — and why you can be reliably oriented in **any context, at any level**.

**Two registers of context.** The frame "everything is a context" is true for how you *orient*, not
for the data model. The boundary is the `work/` folder:

| | **Platform context** | **Work context** |
|---|---|---|
| Where | on Drive, above `work/` | inside a context's `work/` |
| Declares itself via | `context.json` v4 | `plan.md` |
| Registered in `entities.db`? | yes | **no** |
| You discover it with | `orientation()` / `contexts()` | reading the folder directly |
| Purpose file | `spec/` (PRODUCT/COMPONENT) or manifest `description` | `plan.md` |
| Durable memory | context-memory (manifest `memory:` pointer) | `plan.md` + linked files |
| Lifetime | persistent | lives and dies with the work; closes into `archive/` |

> Work contexts **never** get a `context.json` and **never** enter `entities.db`. They are an
> orienting frame for the instructions layer, not backend entities.

```
CONTEXT — a bounded space of one concern (purpose + materials + sub-concerns). Nests recursively.

  ┌ Platform contexts  (Drive · context.json v4 · entities.db · orientation()/contexts())
  │   meta-context   !БАЗА            — the operating layer over all contexts (task DB, ontology, AI instructions)
  │   root context   МетаЛаб           — a top-level domain (parent_id IS NULL)
  │   context        DuetLab, Duet     — any nested concern; may carry git products
  │   product        Duet.git          — a context that is software: a git repo with spec/PRODUCT.md
  │   component      packages/backend  — a package inside a product with spec/COMPONENT.md
  │
  └ Work contexts  (inside work/ · plan.md · not registered · live and die with the work)
      work context  work/WIP_<name>/  — a unit of work in progress; goal in plan.md; nests recursively
      (atomic)      the smallest work context: one deliverable
```

Normative source for the platform-context terms (`context` / `product_repo` / `reference_repo`,
manifest fields, discovery rules): `Duet.git/spec/PRODUCT.md`.

## Operating in a context

The same ritual applies whether you stand in the meta-context, a product, or an atomic task. These
five moves replace what used to be three separate procedures (orientation, project management,
knowledge persistence):

1. **Orient.** Establish where you are: read the context's *purpose* (its spec / `plan.md` / README /
   description) and the *chain* of parents above it. `orientation()` bootstraps this for platform
   contexts; inside a work context you read its `plan.md`.

2. **Know your scope.** Your home is the **narrowest** context you were placed in. Read parents for
   context, but *produce* inside your own. Don't widen scope without cause.

3. **Work in the open.** The user must see and control everything you produce. All artifacts —
   plans, drafts, designs, notes — go into the context's folder, never into /tmp, hidden
   directories, memory files, or built-in planning modes. If the user can't find it in the context,
   it doesn't exist. Keep deliverables distinct from intermediate drafts.

4. **Persist knowledge to the right scope.** A durable fact is not "remembered" — it is *routed* to
   the **narrowest context whose lifetime outlives the fact** (see next section).

5. **Hand back.** The human reviews; you never close a context as DONE — you cannot see the whole
   picture. After completing work, hand back and wait for explicit confirmation.

**The work context.** When a task needs its own space, it gets a **work context** — a folder under
`work/<name>/` whose `plan.md` is the single file the user reads to understand the whole picture
without opening anything else. A work context nests: any unit of work can hold child work contexts
for its sub-tasks. Its lifecycle is *planned → active → archived* (closed work contexts move into
`archive/`). Follow the workspace's existing folder convention for encoding that status; don't invent
a parallel one.

**Finding / creating your work context.** The user may name it at session start. If not — and the
task would benefit from one — offer to create `work/WIP_<name>/` with a `plan.md` capturing your best
read of the goal. If pointed at an existing folder without a `plan.md`, create it by reading the
folder and its surrounding context.

**`plan.md`** must fit on one screen — if it grows past that, something belongs in a linked file.
- **Goal** at the top — the *problem* being solved, not the solution. Explain new terms; dry and
  terse is an anti-pattern. Use specific names, not abstract categories — the reader has no context
  loaded yet ("Phase 1 — separate instructions from Duet", not "separate from the product").
- `## ЧТО СДЕЛАНО` — completed milestones as short narratives with links to detail.
- `## ЧТО ДАЛЬШЕ` — remaining work.
- `## ОТКРЫТЫЕ ВОПРОСЫ` — unresolved questions that shape future decisions (optional; only when real).
Offload all detail and analysis into separate files linked from `plan.md`.

## Persisting knowledge

The base law holds for memory too: **the user sees and controls everything you persist.** Route a
durable fact to the narrowest context whose lifetime outlives it:

| Scope | Carrier | Outlives | Route here when |
|---|---|---|---|
| **skill** | the skill file itself | travels with the skill | the fact is about *how a skill works* |
| **context** | the context-memory file (`orientation.memory.path`) | the whole context, across projects | durable domain/context knowledge |
| **work** | `plan.md` of the active work context (+ its linked files) | dies with the work | a fact about the *current work* |

Routing procedure — narrowest that fits:
1. About one skill's behavior? → the **skill** file.
2. Specific to the current work? → the work context's **`plan.md`**, if one is in play.
3. Durable context-level knowledge? → the **context-memory** file, if `orientation.memory` is set.
4. No natural target (work fact but no work context; context fact but `orientation.memory` is null)?
   → surface it to the user / offer to create the target. Never fabricate one.

Tie-break context↔work: outlives the work → context-memory; dies with it → `plan.md`.

The per-client instruction file (`CLAUDE.md` / `AGENTS.md` / `GEMINI.md`) in a context's root states
what is forbidden for that specific client — follow it.

<!-- INSERT USER CORE INSTRUCTIONS -->
