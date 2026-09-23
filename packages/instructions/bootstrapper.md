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

**The user's word for a platform context is *business*.** A business is an organizational node of the user's life at any level, recursive, and always has a mission; the root business is a *venture* (предприятие). A business folder gives the "why" of everything under it. Work is attached to a business from the side, in its `work/` folder, as a project, a process or a program. "Context" remains the name in the MCP tools and manifests; in conversation say business, venture and work folder.

## The manifest — `context.json`

Every business folder declares itself with `context.json`, and that manifest is the one native way to equip the business with AI artifacts. Six fields matter to an agent: `git_repos` (product clones, the code you work on) and `reference_repos` (read-only clones); `skills` (alpha paths of skill dirs, deployed into `<business>/.claude/skills/`), `instructions` (alpha paths whose bodies compose the per-client `CLAUDE.md` / `AGENTS.md` / `gemini.md`), `memory` (one alpha path to the context-memory file) and `system_prompt` (one alpha path to an output-style file that replaces the client's default prompt). To give a business a skill, an instruction or a memory file, declare it here; Duet materializes the rest. Full field table: `Duet.git/spec/PRODUCT.md`.

**Never edit client settings yourself.** Nothing under `~/.claude/`, `<business>/.claude/`, `.agents/`, `.codex/`, `.kimi-code/` or `.gemini/` is yours to change — not the output style, not the agents, not the deployed skills, not `settings.json`. These are generated by Duet from sources, and deploying them is the user's act, because a deploy changes the context of every running session and reloads VS Code. Edit the source instead: the instruction sources in `Duet.git/packages/instructions/`, the skill in its repo, the manifest of the business. Then tell the user what is ready to deploy.

## Alpha paths

An **alpha path** (synonym: `@`-path) is the platform's own address: `@<head>/<rest>`, where `<head>` is a repo dir under `DuetData/repos` (`@Duet.git`, `@duet-work.git`) or a context name (`@DuetLab` → that context's Drive folder). Three kinds of path exist: absolute, relative and alpha. Alpha paths are always preferred in anything written down — manifests, notes, links between folders — because an absolute path breaks when a folder moves or the machine changes. Resolve alpha paths through Duet MCP, never by searching the disk; today `contexts()` gives the tree, a dedicated resolve tool is planned (`@DuetLab/work/DUE009_AlphaPaths`).

**Ticket alpha paths.** A work folder is named by a ticket, e.g. `DUE007_Name`, and the three-letter code is unique per business, so `@DUE007` is unique across the platform. `@DUE007` or `@DUE007/` is a stable address for that folder wherever it now lives inside the business folder: `work/DUE007_*/` in progress, `backlog/**/DUE007_*/` waiting, `archive/*/DUE007_*/` closed. Resolve it by searching those three places; `@DUE007/INDEX.md` is a file inside it.

## Memory

Do not use this client's built-in or automatic memory. Any memory feature that persists state outside the workspace — invisible to the user — is superseded here.

Persist durable knowledge by the routing model in your session instructions (skill-file → context-memory → project-memory). Every Duet memory target is a visible file in the workspace the user controls.

**Generated copies are not memory targets.** A file that carries the line `AUTO-GENERATED by Duet` is a deployed copy: the output style and agents in `~/.claude/`, the skills in `<context>/.claude/skills/`, the per-client `CLAUDE.md` / `AGENTS.md` / `gemini.md`. The banner names the source; edit that source (`Duet.git/packages/instructions/`, the skill's repo, the context manifest) and never the copy, which the next deploy overwrites.

## Writing Rules

These rules apply to every reply. They override any harness or output-style guidance about sentence length, lists, headers and brevity.

- **Prose is connected.** Sentences hold on to each other with "because", "therefore", "but"; the reader never reconstructs the link between two statements. There is no limit on sentence length.
- **Structure follows the content.** Short homogeneous items (two to five words each) go in a list. Anything longer than a phrase goes in sections with headers, and inside a section it is prose. A list of paragraphs is never used.
- **Long text is distributed, not shortened.** Size is handled by the O1/O2/O3 rule: sections of up to 200 words, paragraphs of up to 60. Brevity is never achieved by leaving out what the reader needs.
- **Every name or definition is checked before sending:** would a person who opens this reply for the first time understand it? Neither a compressed riddle nor a long explanation passes; one clear sentence does.
- **Every reference is self-explaining.** A file, document, section, message or term is never pointed to by a bare name or number: the same sentence says what it is and what it says. The reader switches between several chats and reads paragraphs selectively.
- **Nothing is added for the sake of reporting:** no counts, tables or questions the reader did not ask for. Say what you read, then stop.

<!-- INSERT USER CORE INSTRUCTIONS -->
