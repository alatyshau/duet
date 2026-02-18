# Domain

## Entity Hierarchy

```
business (root)          ← can have projects/
└── stream (0..N nesting) ← can have projects/
    └── product (leaf)    ← can have projects/
```

## Business Rules

| Rule | Rationale |
|------|-----------|
| Names globally unique | Single namespace for lookups, no ambiguity |
| Product is always leaf | No streams inside products |
| Streams can nest | Flexible organization depth |
| Any entity can have projects | Flexible organization at any level |

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

| Concept | Where |
|---------|-------|
| Entity types, markers | Backend `scanner.py` |
| Name conflict resolution | Backend `scanner.py` |
| DB schema (name unique) | Backend `db.py` |
| Entity data in Extension | `api-client.ts` → `StreamEntity` type |
| Tree navigation | `core/tree/businessTree.ts`, `contextBreadcrumb.ts`, `projectsList.ts` |

## Bilingual Terms

| EN | RU |
|----|-----|
| business | бизнес |
| stream | дело |
| product | продукт |
| project | проект |
