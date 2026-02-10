# Data Model

> Shared model (pointer, DuetData, DuetConfig, entities, timestamps): see [/spec/ECOSYSTEM.md](/spec/ECOSYSTEM.md)

## Extension Config Chain

Extension reads pointer + machine config. Does NOT read settings.json.

| File | Reader | What Extension uses |
|------|--------|---------------------|
| `~/.org.ve68.duet` | `pointer.ts:readPointer()` | `duetDataPath`, `duetConfigPath`, `machine` |
| `DuetConfig/{machine}.json` | `pointer.ts:readMachineConfig()` | `port` (for backend API) |

## index.db (Extension-specific)

Extension's own SQLite cache (sql.js WASM, in-memory).

- Saved to disk after each scan via atomic writes
- Schema: see ECOSYSTEM.md → Database Schema
- Implementation: `db/index.ts`

## Legacy: config.json

```json
{ "business_folders": ["/absolute/path/to/Business1"] }
```

**Status:** Legacy. Still used by `scanner.ts`, `addBusiness.ts`, `refresh.ts` via `ConfigManager`. Will be removed when Extension migrates to Backend API for hierarchy data.

**Contract:** NOT used by backend lifecycle. Backend reads its own config from pointer chain.

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
| Location | `DuetData/workspaces/{Product}.code-workspace` |
| Repo path | Relative from workspaces/ |
| Drive path | Absolute (not portable) |

### All-Businesses Workspace

| Aspect | Value |
|--------|-------|
| Location | `DuetData/all-businesses.code-workspace` |
| Paths | Absolute (not portable) |
| Generated | On refresh (after scan completes) |

## Implementation

| Concept | File |
|---------|------|
| Pointer reading | `pointer.ts` |
| DuetData paths | `paths.ts` |
| Legacy config.json read/write | `config.ts` |
| DB schema, queries | `db/index.ts` |
| Workspace generation | `workspace.ts` |
