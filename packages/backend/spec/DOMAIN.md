# Backend Domain

## Glossary

| Term | Definition |
|------|------------|
| **Entity** | Node in hierarchy: business, stream, product, project |
| **Business** | Root-level entity from `business_folders` |
| **Stream** | Intermediate container (can nest) |
| **Product** | Terminal entity with git repo |
| **Project** | GTD folder inside `projects/` |
| **Manifest** | JSON file: business.json, stream.json, product.json |
| **Chain** | Path from root business to current entity |
| **Component** | Package in product's `packages/` with optional `spec/` |

## Entity Hierarchy

```
Business (root)
├── Stream (intermediate, can nest)
│   ├── Stream
│   │   └── Product
│   └── Product
│       └── projects/
│           └── Project
└── projects/
    └── Project
```

## Business Rules

### Name Uniqueness (CRITICAL)

Names globally unique. Conflict resolution by priority:

| Type | Priority | On conflict |
|------|----------|-------------|
| business | 1 (highest) | Keeps name |
| stream | 2 | |
| product | 3 | |
| project | 4 (lowest) | Gets `Name (1)` |

### Self-Healing

Scanner auto-fixes manifest issues:

| Issue | Action |
|-------|--------|
| No business.json at root | Create with folder name |
| stream.json at root | Rename → business.json |
| business.json inside chain | Rename → stream.json |

## Data Contracts

### Manifest Format

```json
// business.json, stream.json
{ "name": "Name", "icon": "📁" }

// product.json
{ "name": "Name", "icon": "📦", "git_url": "https://..." }
```

**Contract:** Keys are `snake_case`. Do NOT use camelCase.

### Database Schema

```sql
CREATE TABLE entities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT,        -- 'business' | 'stream' | 'product' | 'project'
    name TEXT,        -- globally unique
    icon TEXT,
    drive_path TEXT UNIQUE,
    parent_id INTEGER REFERENCES entities(id),
    git_url TEXT
);
CREATE UNIQUE INDEX idx_name ON entities(name);
```

**Contract:** `name` has unique index. Duplicate inserts will fail.

### Config Format (config.json)

```json
{
  "version": "0.6.0",
  "port": 19680,
  "business_folders": ["/path/to/business1"],
  "timestampTZ": { "id": "M", "value": "Europe/Moscow" }
}
```

**Contracts:**
- Keys are `snake_case`. Extension writes, backend reads.
- `version` is REQUIRED. Extension writes from package.json before starting backend.
- Backend refuses to start if `version` is missing.
- `port` is REQUIRED. Extension writes before starting backend.
- Backend refuses to start if `port` is missing or invalid.
- `business_folders` is REQUIRED (can be empty array).
- Backend refuses to start if `business_folders` is missing or invalid.
- `timestampTZ` is REQUIRED.
- Backend refuses to start if `timestampTZ` is missing or invalid.

## File Paths

| Path | Purpose |
|------|---------|
| `~/DuetData/config.json` | Config incl. version (Extension writes, backend reads) |
| `~/DuetData/data/entities.db` | SQLite database |
| `~/DuetData/ai-kit/` | Instructions directory |
| `~/DuetData/.pid` | Backend PID lockfile |
| `~/DuetData/backend/` | Python code (copied from vsix) |

## Timestamp Format

Format: `YYMMDD_HHMMSS<tz>`

Examples:
- `260131_143052M` — Moscow
- `260131_103052Z` — UTC
- `260131_023052P` — Pacific

**Contract:** Timezone suffix from `timestampTZ.id` in config.
