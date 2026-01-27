# Schema: Skill File

Format for `skills/*.md` files.

## Structure

```markdown
# Skill: Name

One-line description of the domain expertise.

## Quality Criteria

- criterion 1 (what makes output world-class)
- criterion 2
- criterion 3
- criterion 4

## When to Use

- context 1
- context 2

## [Domain-specific sections]

Examples, patterns, idioms relevant to this skill.

## Anti-patterns

- what NOT to do
```

## Required Sections

| Section | Purpose |
|---------|---------|
| Title + description | What this skill is |
| Quality Criteria | Rubric for world-class output (3-5 items) |
| Anti-patterns | Common mistakes to avoid |

## Optional Sections

- When to Use
- Sources / References
- Principles
- Checklist
- Examples / Patterns

## Inline Description

When skill doesn't exist, use Quality Criteria as inline description:

```
skills=[new-skill*]

* new-skill — criterion1, criterion2, criterion3
```
