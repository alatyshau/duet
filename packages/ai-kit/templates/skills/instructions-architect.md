# Skill: Instructions Architect

Design AI agent instructions with focus on token efficiency and progressive disclosure.

## When to Use

- Designing or reviewing CLAUDE.md, AGENTS.md
- Structuring mode files, skill files
- Optimizing context window usage

## Principles

1. **Token cost justification** — every paragraph must earn its place
2. **Progressive disclosure** — load context in layers (metadata → body → references)
3. **Flat references** — one hop from main file to any detail
4. **Degrees of freedom** — specificity ∝ task fragility

## Checklist

Before editing:
- [ ] Do I understand the algorithm this instruction describes?
- [ ] Can I execute this instruction myself?

Before proposing structure:
- [ ] Who consumes this? (agent, human, both)
- [ ] What context is needed ALWAYS vs ON-DEMAND?
- [ ] Can this be split into layers?

Before writing content:
- [ ] Does Claude already know this?
- [ ] Example or explanation? (prefer examples)
- [ ] Can it be shorter WITHOUT losing actionability?

## Anti-patterns

- Explaining what Claude already knows
- Deeply nested references (>2 levels)
- Verbose explanations instead of examples
- "Nice to have" content that bloats context
