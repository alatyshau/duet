# Data Model

## DuetData Directory

```
~/DuetData/                      # configurable via duet.data_folder
├── config.json                  # business folder paths
├── data/
│   └── index.db                 # SQLite cache (sql.js)
├── repos/
│   └── {Product}.git/           # cloned repositories
└── workspaces/                  # planned
```

## config.json Contract

```json
{ "business_folders": ["/path/to/Business1", "/path/to/Business2"] }
```

| Aspect | Value |
|--------|-------|
| Key | `business_folders` (snake_case in JSON) |
| Type | `string[]` — absolute paths |
| TS interface | `businessFolders` (camelCase) |
| Mapping | `config.ts` — `read()` / `write()` convert case |

## index.db Contract

Table `entities` — required fields:

| Field | Type | Constraint |
|-------|------|------------|
| `id` | INTEGER | PRIMARY KEY |
| `type` | TEXT | business/stream/product/project |
| `name` | TEXT | UNIQUE — globally |
| `icon` | TEXT | NOT NULL |
| `drive_path` | TEXT | UNIQUE |
| `parent_id` | INTEGER | FK → entities.id (NULL for business) |
| `git_url` | TEXT | only for products |

Implementation: `db/index.ts`

## Repository Naming

| Pattern | Meaning |
|---------|---------|
| `{Name}.git` | Main clone of product |
| `{Name}.wt-N` | Worktree N (planned) |

Lookup: strip suffix → find entity by name.

## Persistence

- In-memory SQLite (sql.js WASM)
- Saved to disk after each scan
- Atomic writes via write-file-atomic

## Implementation

| Concept | File |
|---------|------|
| DuetData paths | `paths.ts` |
| config.json read/write | `config.ts` |
| DB schema, queries | `db/index.ts` |
