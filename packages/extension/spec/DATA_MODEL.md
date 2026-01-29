# Data Model

## DuetData Directory

```
~/DuetData/                      # configurable via duet.data_folder
├── config.json                  # business folder paths
├── all-businesses.code-workspace  # multi-root workspace for all businesses
├── data/
│   └── index.db                 # SQLite cache (sql.js)
├── repos/
│   └── {Product}.git/           # cloned repositories
└── workspaces/
    └── {Product}.code-workspace # multi-root: repo + Drive folder
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

## Workspace Files

### Product Workspace

Generated/updated on each open of product with `git_url`. Combines repo and Drive folder.

```json
{
  "folders": [
    { "path": "../repos/Duet.git" },
    { "path": "/absolute/path/to/Drive/Product" }
  ]
}
```

| Aspect | Value |
|--------|-------|
| Location | `workspaces/{Product}.code-workspace` |
| Repo path | Relative from workspaces/ |
| Drive path | Absolute (not portable) |

### All-Businesses Workspace

Lists all business folders for quick access.

```json
{
  "folders": [
    { "path": "/path/to/Business1" },
    { "path": "/path/to/Business2" }
  ]
}
```

| Aspect | Value |
|--------|-------|
| Location | `all-businesses.code-workspace` |
| Paths | Absolute (not portable) |
| Generated | On refresh (after scan completes) |

## Implementation

| Concept | File |
|---------|------|
| DuetData paths | `paths.ts` |
| config.json read/write | `config.ts` |
| DB schema, queries | `db/index.ts` |
| Workspace generation | `workspace.ts` |
