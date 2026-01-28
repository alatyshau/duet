# Skill: Spec Architect

Write specifications as source of truth for a component. Specs describe WHAT EXISTS, not how to behave.

## Quality Criteria

- Clear boundaries (what's in, what's out)
- Minimal ambiguity (no guessing)
- Developer-oriented (humans read specs)
- Current vs legacy marked explicitly

## When to Use

- Creating `spec/` folder for a package or component
- Documenting domain concepts (glossary, relationships)
- Describing architecture (folder structure, modules, boundaries)
- Marking legacy vs current

## Spec vs Instructions

| Aspect | Spec | Instructions |
|--------|------|--------------|
| Question | What exists? | How to behave? |
| Audience | Developers | Agents |
| Location | `<component>/spec/` | `core_instructions.md`, `modes/` |
| Example | "These folders exist" | "When you see X, do Y" |

## Standard Files

```
spec/
├── DOMAIN.md       — concepts, glossary, relationships
├── ARCHITECTURE.md — folder structure, modules, legacy markers
├── DATA_MODEL.md   — schemas, constraints (if applicable)
└── UI.md           — states, flows (if applicable)
```

## Principles

1. **Describe, don't prescribe** — spec says what IS, not what to DO
2. **Current vs legacy** — explicitly mark deprecated parts
3. **For humans** — specs are for developers reading the codebase
4. **Minimal** — only what's needed to orient in the codebase

## Checklist

Before writing spec:
- [ ] What component am I specifying?
- [ ] Who will read this? (developers, not agents)
- [ ] Is this describing structure, not behavior?

Before each section:
- [ ] Does this belong in spec or in instructions?
- [ ] Is this WHAT EXISTS or HOW TO ACT?

## Anti-patterns

- Lookup tables (that's instructions)
- Load order (that's instructions)
- Decision trees (that's instructions)
- "When X happens, do Y" (that's instructions)

