---
name: spec-architect
description: Specifications
---
# Skill: Spec Architect

Write specifications as source of truth for AI agents. Specs ≠ docs (docs/ is for humans).

## Core Principle

Spec exists when:
1. Knowledge **scattered** across many files → consolidate
2. Knowledge **not in code** (decisions, rationale, future) → capture
3. Behavior **easy to accidentally break** → contract
4. Mapping **saves search** → navigation shortcut

## What Goes in Spec

### Consolidation (agent won't read 100 files)

| Type | Example |
|------|---------|
| Glossary | "context" = bounded context, may nest; `meta` flag for system-level |
| Business rules | Name globally unique across all contexts; conflict-resolver appends `(1)` to second match |
| Boundaries | core/ never imports vscode |

### Not in Code (decisions, rationale, future)

| Type | Example |
|------|---------|
| Decision | "Why sql.js?" → works in extension sandbox |
| Rationale | "Why unique names?" → unambiguous lookups |
| Future | "collapseAll planned" → don't implement differently |

### Behavioral Contracts (easy to break, hard to notice)

| Category | Example |
|----------|---------|
| UI behavior | "Nodes expanded by default" — agent changes to Collapsed, UX breaks |
| Data format | "config.json uses `snake_case` keys" — agent uses camelCase, migration breaks |
| Schema fields | "entities table has `git_url` field" — agent renames, queries break |
| Visibility | "Onboarding shown when `!config.duet.data_folder`" — agent changes condition, UX breaks |

```
# Bad: requirement only in chat/topic, lost after implementation
# Good: contract in spec, agent checks before changing
```

### Navigation Shortcuts (saves grep)

| Mapping | Example |
|---------|---------|
| Concept → file | View "КОНТЕКСТ" → `ContextProvider.ts` |
| Feature → module | Self-healing → `scanner.ts` |

### Exclude (single source exists)

- Commands → package.json
- Interface signatures → the .ts file
- File structure → Glob

## Standard Files

Primary spec per entity type:

| Entity | Primary file | Content |
|--------|-------------|---------|
| product | `spec/PRODUCT.md` | Cross-component contracts, shared model |
| component | `spec/COMPONENT.md` | Architecture + domain (merged) |
| context | `spec/CONTEXT.md` | Context purpose, structure (when needed) |
| project | `spec/PROJECT.md` | Project goals, decisions |

Optional companion files (component only):

```
spec/
├── COMPONENT.md    — architecture, domain, decisions (ALWAYS present)
├── DATA_MODEL.md   — constraints, persistence (when relevant)
└── UI.md           — view purposes, behavioral contracts (when relevant)
```

**COMPONENT.md is the merged replacement** for the former DOMAIN.md + ARCHITECTURE.md split. First sentence becomes `description` in the `orientation` response.

**Fallback chain:** `orientation` searches for the spec file in order: primary file > COMPONENT.md > ARCHITECTURE.md > README.md > INDEX.md. First found wins.

## Anti-patterns

- Duplicating package.json / code (read source directly)
- "For humans" (that's docs/)
- Verbose prose (use tables)
