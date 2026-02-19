# Backend Domain

> Shared model (pointer, DuetData, DuetConfig, entities, @aliases, timestamps): see [/spec/ECOSYSTEM.md](/spec/ECOSYSTEM.md)

## Glossary

| Term | Definition |
|------|------------|
| **Entity** | Node in hierarchy: business, stream, product, project |
| **Manifest** | JSON file: business.json, stream.json, product.json |
| **Chain** | Path from root business to current entity |
| **Component** | Package in product's `packages/` with optional `spec/` |

Entity hierarchy, manifests, name uniqueness, self-healing: see ECOSYSTEM.md

## Backend-Specific Business Rules

### Scanner

- Reads `business_folders` from `DuetConfig/settings.json`
- Resolves `@aliases` via `{machine}.json` (see ECOSYSTEM.md → @Alias Resolution)
- Stores results in `DuetData/data/entities.db` (native sqlite3)

### Config Reading Order

```
pointer.py → ~/.org.ve68.duet
config.py  → DuetConfig/settings.json + {machine}.json
           → DuetData/backend/VERSION
```

**Backend-specific contracts:**
- `config.py` is read-only — never writes config files
- `aliases.py:resolve_alias()` fails fast on unresolved alias (`AliasNotFoundError`)
- `config.get_version()` raises `ConfigError` if VERSION file not found

## File Paths (Backend-specific)

| Path | Purpose |
|------|---------|
| `DuetData/data/entities.db` | Backend's SQLite database |
| `DuetData/backend/VERSION` | Installed backend version |
| `DuetData/backend.log` | Backend log file |
