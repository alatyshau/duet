# Skill: Instructions Architect

Design AI agent instructions that work and do what's expected.

## Core Philosophy

**The only goal is a working agent.** Token cost is NEVER a criterion.

We make instructions concise NOT to save money, but because:
- Shorter = easier for agent to parse and follow
- Focused = less confusion, more stable behavior
- Clear structure = reliable execution

If longer text works better — use longer text. If verbose explanation helps — be verbose.

## When to Use

- Designing or reviewing CLAUDE.md, AGENTS.md
- Structuring mode files, skill files → see `schemas/skill_file.md`

## Principles

1. **Works first** — if it works, it's good. Optimize later (maybe never).
2. **Clarity over brevity** — if shorter loses clarity, keep it longer
3. **Progressive disclosure** — load context in layers (metadata → body → references)
4. **Flat references** — one hop from main file to any detail
5. **Examples over explanations** — agent learns from patterns

## Checklist

Before editing:
- [ ] Do I understand the algorithm this instruction describes?
- [ ] Can I execute this instruction myself?

Before proposing structure:
- [ ] Who consumes this? (agent only — humans never read these)
- [ ] What context is needed ALWAYS vs ON-DEMAND?
- [ ] Can this be split into layers?

Before writing content:
- [ ] Does Claude already know this? (don't repeat built-in knowledge)
- [ ] Example or explanation? (prefer examples)
- [ ] Will this help the agent work more reliably?

## Anti-patterns

| ❌ Don't | ✅ Do instead |
|----------|---------------|
| Optimize tokens to "save money" | Optimize for agent comprehension |
| Cut text until it's cryptic | Keep text until it's clear |
| Explain what Claude already knows | Focus on YOUR specific context |
| Deeply nested references (>2 levels) | Flat structure, one hop |
| Abstract explanations | Concrete examples |

