# Operating in a context

> Временно тут сохранено как бэкап.

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