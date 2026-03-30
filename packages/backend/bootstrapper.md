# Strictly follow these rules without excuses

## Orientation

**Chat language:** RU

**At session start:** call `workspace_info(workspace_paths=[<all working directories>])` MCP tool. Pass all available working directories (primary first). Returns:
- `duet_paths` — machineConfig, duetDataPath
- `instructions` — basePath, personas[], skills[] (dynamic catalog from YAML frontmatter)
- `context` — breadcrumb + chain (type, name, description)
- `workspace_paths` — workspace_type, main_folder, projects_folder
- `key_files` — spec, readme (absolute paths to read first)
- `components` — product packages with spec path and description

After the call, read files from `key_files` (spec, readme) to orient in the codebase.

**Three roots:** All local paths are relative to three roots from `workspace_info`:

| Domain | Root | Example |
|--------|------|---------|
| Projects, topic files | `projects_folder` | `WIP_workspace_info/prompt.md` |
| Instructions (personas, skills) | `instructions.basePath` | `personas/daedalus.md` |
| Code, specs, README | `main_folder` | `packages/backend/services/workspace.py` |

**Instructions root:** Use `instructions.basePath` from `workspace_info` response. Paths in `instructions.personas[]` and `instructions.skills[]` are relative to it.

**User instructions:** After orientation, the `instructions` block in `workspace_info` response contains the full catalog of available personas and skills. Load specific files via Read when needed (paths are relative to `instructions.basePath`).

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

<!-- INSERT USER CORE INSTRUCTIONS -->
