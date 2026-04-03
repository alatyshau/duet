# Core Instructions for AI Agents

## Orientation

**Chat language:** RU

**At session start:** call `orientation(workspace_paths=[<all working directories>])` MCP tool. This is a blocking gate — do not proceed with any work until you receive and process the response.

**From the response, extract and use for the entire session:**
- **`workspace.topology`** — your map of the workspace: what each folder is for, which paths are read-only, how the workspace is organized. Read carefully.
- **`context`** — breadcrumb and chain: which business, stream, product you're working in
- **`key_files`** — read these first (spec, readme) to orient in the codebase
- **`components`** — packages in the product, their specs and descriptions
- **`instructions`** — full catalog of personas and skills. Paths relative to `instructions.basePath`

## User instructions

After orientation, the `instructions` block in the response contains the full catalog of available personas and skills. Paths are relative to `instructions.basePath`. Load specific files via Read.

**Skill activation rules:**
- `shortcuts` — explicit user invocation → always load
- `trigger` — describes WHEN to auto-load this skill. If the current task matches → load the skill via Read without asking
- `noTrigger` — describes WHEN NOT to load (disambiguation with similar skills)
- `description` — general purpose summary. If no `trigger` field, use description to decide

**`!` prefix convention:** Any word in user text starting with `!` (e.g. `!чек`, `!коммит`) is most likely a Duet skill shortcut. Treat it as an explicit invocation — look it up in the skills catalog and load the matching skill.

**Never use the system `Skill` tool for Duet skills.** The `Skill` tool is for harness-level commands only (e.g. `update-config`, `keybindings-help`). Duet skills are always loaded via Read from `instructions.basePath`. If a Duet skill shortcut collides with a system skill name — the Duet skill wins.

<!-- INSERT SKILLS TABLE -->

## Glossary

**Entity Hierarchy:**

```
Business
└── Stream* (0..N nesting)
    └── Product (git repo)
        ├── Component (package)
        │   ├── spec/
        │   └── docs/
        └── Project (GTD)
            └── project folder
                └── topic file
                    └── step
```

| EN | RU | Meaning | Example |
|----|-----|---------|---------|
| **business** | бизнес | Root-level stream | `МетаЛаб`, `Семья` |
| **stream** | дело | Intermediate level (0..N nesting) | `ТехноЛаб`, `ДомоДел` |
| **product** | продукт | Terminal stream with git repo | `Duet`, `Kreator` |
| **component** | компонент | Package in monorepo | `packages/ai-kit` |
| **spec** | спецификация | Source of truth for AI (in `spec/`) | `packages/ai-kit/spec/` |
| **project** | проект | GTD project with completion criteria | `260110_ai_kit_design` |
| **project folder** | проектная папка | Folder in `projects/` (naming: `YYMMDD_name`, `WIP_name`, `TODO_name`) | `projects/WIP_workspace_info/` |
| **topic file** | топик-файл | topic_*.md — sub-project with steps | `topic_ai_kit_redesign.md` |
| **step** | шаг | Unit of work in IMPLEMENTATION PLAN | Step 5, Step 6 |
| **docs** | документация | Materialized view for humans (in component) | `packages/ai-kit/docs/` |

## Project management

The user must see and control everything you produce. All working artifacts — plans, design docs, drafts, session notes — go into the project folder (`projects/WIP_<name>/`), never into /tmp, memory files, hidden directories, or built-in planning modes. If the user can't find it in the project folder, it doesn't exist.

Project folder is a scaffold: it lives while work is in progress, then goes to archive.

**Finding your project folder:** The user may specify it at session start. If not — and the task would benefit from one — suggest creating it: "Want me to create `projects/WIP_<name>/` for this?" If the user agrees, create the folder with `plan.md` containing your best guess at the goal. If the user points you to an existing folder without `plan.md` — create it by analyzing everything in the folder and surrounding context.

**`plan.md`** — the user reads this to understand the full picture without opening other files. It must fit on one screen — if it grows beyond that, something belongs in a separate file.

Structure:
- Goal at the top — the problem being solved, not the solution. "Need a way to deeply analyze issues one by one" is a goal. "Skill briefing with 3-phase algorithm" is a solution. As long as needed to be clear. Explain new terms, give context. Dry and terse is an anti-pattern
- `## ЧТО СДЕЛАНО` — completed milestones as short narratives with links to details
- `## ЧТО ДАЛЬШЕ` — remaining work

Use specific names, not abstract categories — the reader has no context loaded yet.
- ✅ "Фаза 1 — Отделить инструкции от Duet"
- ❌ "Фаза 1 — Отделить инструкции от продукта" — which product?

Offload all details, designs, and analysis to separate files linked from plan.md.

**Naming conventions in `projects/`:**
- `WIP_<name>` — active project
- `TODO_##_<name>` — backlog / roadmap (`##` = optional priority for sorting)
- `ARCHIVE/` or `АРХИВ/` — archive folder. Default naming: `YYMMDD_<name>`. If existing archive uses a different structure — follow it. Explore on demand, don't memorize


<!-- INSERT USER CORE INSTRUCTIONS -->
