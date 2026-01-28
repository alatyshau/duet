# Domain

## Entity Hierarchy

```
business (root)
└── stream (0..N nesting)
    └── product (leaf)
        └── project (inside projects/)
```

## Business Rules

| Rule | Rationale |
|------|-----------|
| Names globally unique | Single namespace for lookups, no ambiguity |
| Product is always leaf | No streams inside products |
| Streams can nest | Flexible organization depth |
| Projects only in products | Projects belong to code, not to streams |

## Name Conflict Resolution

When duplicate name found during scan:
- Priority: business > stream > product > project
- Higher priority keeps original name
- Lower priority gets suffix: `Name (1)`, `Name (2)`

## Markers

| Type | File | Required fields |
|------|------|-----------------|
| business | `business.json` | name |
| stream | `stream.json` | name |
| product | `product.json` | name (git_url optional) |
| project | — | subfolder of `projects/` |

## Implementation

| Concept | File |
|---------|------|
| Entity types, markers | `scanner.ts` |
| Name conflict resolution | `scanner.ts` |
| DB schema (name unique) | `db/index.ts` |

## Bilingual Terms

| EN | RU |
|----|-----|
| business | бизнес |
| stream | дело |
| product | продукт |
| project | проект |
