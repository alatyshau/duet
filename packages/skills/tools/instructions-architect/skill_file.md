# Schema: Skill File

Format for `skills/**/*.md` files.

## Structure

```markdown
---
name: skill-name
description: One-line description of the domain expertise
shortcuts: ["shortcut1", "shortcut2"]
trigger: "When to activate automatically"
noTrigger: "When NOT to activate"
---
# Skill: Name

One-line description (same as frontmatter, for human readers).

## Quality Criteria

- criterion 1 (what makes output world-class)
- criterion 2
- criterion 3

## [Domain-specific sections]

Examples, patterns, idioms relevant to this skill.

## Anti-patterns

- what NOT to do
```

## YAML Frontmatter

Machine-readable metadata. Backend scans this to build the dynamic catalog in workspace_info.

| Field | Required | Type | Purpose |
|-------|----------|------|---------|
| `name` | yes | string | Unique skill identifier (kebab-case) |
| `description` | yes | string | One-line description for catalog |
| `shortcuts` | no | list | Invocation aliases. `!prefix` = standalone, no `!` = via `!skill=X` |
| `trigger` | no | string | When agent should auto-activate this skill |
| `noTrigger` | no | string | When agent should NOT activate (disambiguation) |

**Without valid frontmatter (name + description), the file won't appear in the catalog.**

## Required Sections

| Section | Purpose |
|---------|---------|
| Title + description | What this skill is (human-readable) |
| Quality Criteria | Rubric for world-class output (3-5 items) |
| Anti-patterns | Common mistakes to avoid |

## Optional Sections

- Principles
- Checklist
- Examples / Patterns
- Sources / References

## Shortcut Types

```yaml
shortcuts: ["!упакуй"]        # standalone: user types !упакуй directly
shortcuts: ["py", "пай"]      # via prefix: user types !skill=py
shortcuts: ["SA", "СА"]       # mixed language aliases
```

## Complex Skills

Skills with companion resources or Python scripts:

```
scriptor          <- skill file (loaded by agent)
skills/tools/scriptor/            <- resources: prompts, templates
scripts/scriptor/                 <- Python code (separate directory)
```

Markdown and Python don't mix — skills in `skills/`, scripts in `scripts/`.
