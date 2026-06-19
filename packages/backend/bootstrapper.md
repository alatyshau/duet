# Core Instructions for AI Agents

## Orientation

**Chat language:** RU

**At session start:** call `orientation(workspace_paths=[<all working directories>])` MCP tool. This is a blocking gate — do not proceed with any work until you receive and process the response.

**From the response, extract and use for the entire session:**
- **`workspace.topology`** — your map of the workspace: what each folder is for, which paths are read-only, how the workspace is organized. Read carefully.
- **`context`** — breadcrumb and chain of contexts you're working in (each item: type, name, optional description)
- **`key_files`** — read these first (spec, readme) to orient in the codebase
- **`components`** — packages inside discovered products, their specs and descriptions
- **`duet_paths.instructionsPath`** — root of user instructions workspace

## Duet MCP tools

`orientation` is the session gate. After orientation, use `contexts()` to discover the context tree across all root contexts. **Always prefer `contexts()` over filesystem searches** (find, ls, glob) for context and product discovery.

## User instructions

The skills table below lists all available personas and skills. Paths are relative to `duet_paths.instructionsPath` from orientation. Load specific files via Read.

**Skill activation rules:**
- `shortcuts` — explicit user invocation → always load
- `trigger` — describes WHEN to auto-load this skill. If the current task matches → load the skill via Read without asking
- `noTrigger` — describes WHEN NOT to load (disambiguation with similar skills)
- `description` — general purpose summary. If no `trigger` field, use description to decide
- `path` — file to Read when loading the skill (relative to `duet_paths.instructionsPath`)

**`!` prefix convention:** Any word in user text starting with `!` (e.g. `!чек`, `!коммит`) is most likely a Duet skill shortcut. Treat it as an explicit invocation — look it up in the skills catalog and load the matching skill.

<!-- INSERT SKILLS TABLE -->

## Glossary

**Entity Hierarchy:**

```
meta-context (one per workspace, e.g. !БАЗА)
└── root context (top-level user context, e.g. МетаЛаб)
    └── context* (0..N nesting, e.g. ТехноЛаб)
        └── context with git_repos (git products live in repos; Drive children may still nest)
            ├── Component (package)
            │   ├── spec/
            │   └── docs/
            └── work folder
                └── topic file
                    └── step
```

A **context** is a bounded folder on Drive — `context.json` v3 + nested
contexts and resources. Roles are inferred from manifest fields:
`meta: true` marks the system meta-context; `git_repos` declares product
clones in `DuetData/repos` but does not stop Drive context recursion.

| EN | RU | Meaning | Example |
|----|-----|---------|---------|
| **meta-context** | мета-контекст | System-level context covering everything; `meta: true` in `context.json` | `!БАЗА` |
| **root context** | корневой контекст | Top-level context (no parent), listed in `root_context_folders` | `МетаЛаб`, `СоциоЛаб` |
| **context** | контекст | Any bounded context folder with `context.json` | `ТехноЛаб`, `Duet` |
| **product** | продукт | Software discovered from `git_repos`, `spec/PRODUCT.md`, or README fallback | `Duet`, `Kreator` |
| **component** | компонент | Package in a product's monorepo | `packages/ai-kit` |
| **spec** | спецификация | Source of truth for AI (in `spec/`) | `packages/ai-kit/spec/` |
| **work folder** | рабочая папка | Folder in `work/` (or legacy `projects/`) with a `plan.md` at its root; naming: `YYMMDD_name`, `WIP_name`, `TODO_name`. Nests recursively — any work folder can contain child work folders for subtasks. Synonym: `project folder` / `проектная папка` (legacy, being phased out) | `work/WIP_workspace_info/` |
| **topic file** | топик-файл | topic_*.md — sub-project with steps | `topic_ai_kit_redesign.md` |
| **step** | шаг | Unit of work in IMPLEMENTATION PLAN | Step 5, Step 6 |
| **docs** | документация | Materialized view for humans (in component) | `packages/ai-kit/docs/` |

## Project management

The user must see and control everything you produce. All working artifacts — plans, design docs, drafts, session notes — go into the **work folder** (`work/WIP_<name>/`; legacy `projects/WIP_<name>/` is an accepted synonym during migration), never into /tmp, memory files, hidden directories, or built-in planning modes. If the user can't find it in the work folder, it doesn't exist.

A work folder is a scaffold: it lives while work is in progress, then goes to archive.

**Finding your work folder:** The user may specify it at session start. If not — and the task would benefit from one — suggest creating it: "Want me to create `work/WIP_<name>/` for this?" If the user agrees, create the folder with `plan.md` containing your best guess at the goal. If the user points you to an existing folder without `plan.md` — create it by analyzing everything in the folder and surrounding context. If the product already uses `projects/` — keep using `projects/` for consistency within that product; don't mix roots.

**`plan.md`** — the user reads this to understand the full picture without opening other files. It must fit on one screen — if it grows beyond that, something belongs in a separate file.

Structure:
- Goal at the top — the problem being solved, not the solution. "Need a way to deeply analyze issues one by one" is a goal. "Skill briefing with 3-phase algorithm" is a solution. As long as needed to be clear. Explain new terms, give context. Dry and terse is an anti-pattern
- `## ЧТО СДЕЛАНО` — completed milestones as short narratives with links to details
- `## ЧТО ДАЛЬШЕ` — remaining work
- `## ОТКРЫТЫЕ ВОПРОСЫ` — unresolved questions that block or shape future decisions. Optional; include only when there actually are open questions. Keep out of `ЧТО ДАЛЬШЕ` — those are things to do, these are things to decide

Use specific names, not abstract categories — the reader has no context loaded yet.
- ✅ "Фаза 1 — Отделить инструкции от Duet"
- ❌ "Фаза 1 — Отделить инструкции от продукта" — which product?

Offload all details, designs, and analysis to separate files linked from plan.md.

**Naming conventions in `work/` (or legacy `projects/`):**
- `WIP_<name>` — active work folder
- `TODO_##_<name>` — backlog / roadmap (`##` = optional priority for sorting)
- `archive/YYMMDD_<name>/` — closed work folders, nested inside their parent. `YYMMDD` is the close date, lexicographically sortable. Legacy top-level `ARCHIVE/` or `АРХИВ/` folders may still exist — follow whatever structure is already in place

## Knowledge persistence

The base law holds for memory too: **the user sees and controls everything you persist.** A durable fact is not "remembered" — it is *routed* to a visible workspace file at the narrowest scope that fits its lifetime. There are three scopes:

| Scope | Carrier | Lifetime | Route here when |
|---|---|---|---|
| **A — skill** | the skill file itself | travels with the skill | the fact is about *how a skill works* |
| **Б — context** | the context-memory file (`orientation.memory.path`) | the whole context, across projects | durable domain/context knowledge |
| **В — project** | `plan.md` of the active work folder (+ its linked files) | dies with the project | a fact about the *current project* |

Routing procedure — top down, narrowest that fits:
1. About one skill's behavior? → **A** (the skill file).
2. Specific to the current project? → **В** (`plan.md` of the work folder), if a work folder is in play.
3. Durable context-level knowledge? → **Б** (the file at `orientation.memory.path`), if that pointer is set.
4. No natural target (project fact but no work folder; context fact but `orientation.memory` is null)? → surface it to the user / offer to create the target. Never fabricate one.

Tie-break Б↔В: outlives the project → Б; dies with it → В.

The per-client instruction file (`CLAUDE.md` / `AGENTS.md` / `GEMINI.md`) in the workspace root states what is forbidden for that specific client — follow it.

<!-- INSERT USER CORE INSTRUCTIONS -->
