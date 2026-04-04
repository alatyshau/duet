# Data Model

> Shared model (pointer, DuetData, DuetConfig, entities, timestamps): see [/spec/PRODUCT.md](/spec/PRODUCT.md)

## Extension Config Chain

Extension reads pointer + machine config. Does NOT read settings.json.

| File | Reader | What Extension uses |
|------|--------|---------------------|
| `~/.org.ve68.duet` | `pointer.ts:readPointer()` | `duetDataPath`, `duetConfigPath`, `machine` |
| `DuetConfig/{machine}.json` | `pointer.ts:readMachineConfig()` | `port` (for backend API) |

## Entity Data

Extension loads entities from Backend HTTP API, not from local storage.

| Source | Method | Data |
|--------|--------|------|
| `GET /streams` | `apiClient.streams()` | All business/stream/product + active projects with `absolute_path` |
| `POST /scan` | `apiClient.scan()` | Trigger backend rescan |
| `POST /add-business` | `apiClient.addBusiness(path)` | Add business folder to settings.json |

Loaded `StreamEntity[]` is kept in memory and shared across tree providers (sync access). Refreshed on `duet.refresh` command.

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
| HTTP API client | `api-client.ts` |
| Workspace generation | `workspace.ts` |
