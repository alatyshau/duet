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
| Glossary | "stream" = intermediate container, can nest |
| Business rules | Name globally unique, priority: business > stream > product |
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

```
spec/
├── DOMAIN.md       — glossary, business rules
├── ARCHITECTURE.md — layers, decisions, boundaries
├── DATA_MODEL.md   — constraints, persistence
└── UI.md           — view purposes, behavioral contracts
```

## Anti-patterns

- Duplicating package.json / code (read source directly)
- "For humans" (that's docs/)
- Verbose prose (use tables)
