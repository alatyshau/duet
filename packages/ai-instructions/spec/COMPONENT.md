# AI Instructions

Transitional package — bootstrapper (core_instructions.md) lives here until it moves to Host (Phase 2). User instructions have moved to a separate git repo owned by the user.

## Architecture: Two Layers

| Layer | Where | What | Who owns |
|-------|-------|------|----------|
| **Bootstrapper** | This package → Host (Phase 2) | Platform rules (L7+, glossary, spec-driven, observable rules), orientation (workspace_info call) | Duet |
| **User instructions** | Separate git repo (e.g. Duet-Instructions.git) | Personas, skills (modes, stances, tools, workflows), schemas | User |

## Core Concepts

Only two concepts:

| Concept | Question | Duration | Example |
|---------|----------|----------|---------|
| **Persona** | WHO am I? | Entire session | Socrates, Hephaestus, Ariadna |
| **Skill** | WHAT do I know / do? | Loaded on demand | python, planning, dialectic |

Modes, stances, workflows — categories of skills, not separate concepts.

## User Instructions Workspace

User-owned git repo with `index.json` at root declaring structure:

```json
{
  "personas": { "path": "personas" },
  "skill_folders": [
    { "name": "Coding", "path": "skills/coding" },
    { "name": "Tools", "path": "skills/tools" }
  ]
}
```

Each .md file has YAML frontmatter:
- **Required:** `name`, `description`
- **Optional:** `shortcuts` (list), `trigger`, `noTrigger` (skills only)

Backend scans `index.json` + frontmatter → builds dynamic catalog in workspace_info response (`instructions` block).

Path to workspace: `instructionsPath` in `DuetConfig/{machine}.json`.

## Bootstrapper (core_instructions.md)

Compact instructions loaded as system prompt. Contains platform rules, not user content.

| Section | What |
|---------|------|
| **Core Rules** | L7+, observable rules, propose responsibly, spec-driven |
| **Glossary** | Entity hierarchy, terms |
| **Orientation** | `workspace_info(workspace_paths=[...])` call at session start |

**Claude Code:** Loaded via `output-styles/duet.md` (system-level, better adherence).

## Contracts

**Edit rule:** Edit `packages/ai-instructions/src/`, never `DuetData/ai-instructions/` directly.

**Adding skills/personas:** Add to user instructions workspace (separate repo), not this package. Ensure YAML frontmatter for catalog discovery.

## Deploy Chain

```
packages/ai-instructions/src/  →  DuetData/ai-instructions/  (deployer: Host)
```

Phase 2: bootstrapper moves into Host directly. This package shrinks and eventually disappears.

## Decisions

| Decision | Rationale |
|----------|-----------|
| User-owned instructions repo | Users customize their own personas/skills. No starter repo — clone author's or create own |
| `index.json` not `index.md` | Declarative structure, machine-readable. Catalog built dynamically from frontmatter |
| Persona + Skill only | Simpler model. Modes/stances/workflows are skill categories, not separate concepts |
| PyYAML for frontmatter | Standard, reliable. Not python-frontmatter (overkill) or manual parsing (bugs) |
| No fallback for instructionsPath | Missing config → error. No silent degradation |

## Navigation

| Concept | File |
|---------|------|
| Bootstrapper | `src/core_instructions.md` |
| Archived full version | `src/old/core_instructions_long.md` |
| Output style (Claude Code) | `src/core_instructions.md` → deployed as `output-styles/duet.md` |
