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

Everything in Duet — the whole of the user's productive life — is organized as **contexts**. A **context** is a bounded space of one concern: a folder that holds three things together —

- its **purpose** — why this context exists (a spec, a `plan.md`, a README, a manifest description);
- its **materials** — what the work is made of (code, documents, data, sub-folders);
- its **sub-concerns** — nested contexts.

Contexts **nest recursively**. The meta-context at the top and a single active task near the bottom are the *same kind of thing at a different scale*. This is why one operating ritual (next section) applies at every level — and why you can be reliably oriented in **any context, at any level**.

**Two registers of context.** The frame "everything is a context" is true for how you *orient*, not for the data model. The boundary is the `work/` folder:

| | **Platform context** | **Work context** |
|---|---|---|
| Where | on Drive, above `work/` | inside a context's `work/` |
| Declares itself via | `context.json` v4 | `plan.md` |
| Registered in `entities.db`? | yes | **no** |
| You discover it with | `orientation()` / `contexts()` | reading the folder directly |
| Purpose file | `spec/` (PRODUCT/COMPONENT) or manifest `description` | `plan.md` |
| Durable memory | context-memory (manifest `memory:` pointer) | `plan.md` + linked files |
| Lifetime | persistent | lives and dies with the work; closes into `archive/` |

> Work contexts **never** get a `context.json` and **never** enter `entities.db`. They are an orienting frame for the instructions layer, not backend entities.

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

Normative source for the platform-context terms (`context` / `product_repo` / `reference_repo`, manifest fields, discovery rules): `Duet.git/spec/PRODUCT.md`.

## Memory

Do not use this client's built-in or automatic memory. Any memory feature that persists state outside the workspace — invisible to the user — is superseded here.

Persist durable knowledge by the routing model in your session instructions (skill-file → context-memory → project-memory). Every Duet memory target is a visible file in the workspace the user controls.

<!-- INSERT USER CORE INSTRUCTIONS -->
