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
| `GET /contexts` | `apiClient.contexts()` | All `context` entities with `absolute_path`, `meta`, optional `git_repos` (`{alias: url}` map) |
| `POST /orientation` | `apiClient.orientation(paths)` | `workspace` block (`kind`, `context_name`, `context_folder`, `git_folders`), `context.chain`, top-level `products[]` with nested `components[]` |
| `POST /scan` | `apiClient.scan()` | Trigger backend rescan |

Loaded `ContextEntity[]` (from `/contexts`) is kept in memory and feeds the ДЕЛА view (`ContextTreeProvider`). The single `OrientationResponse` (from `/orientation`) feeds the КОНТЕКСТ view (`ContextProvider`) and is re-fetched on workspace folder change. Both refresh on `duet.refresh`.

**Root context configuration is Host-only.** Extension intentionally has no add/remove/reorder commands and no write path to `settings.json` or `{machine}.json` (see [/spec/PRODUCT.md](/spec/PRODUCT.md) → "Single-writer invariant"). All edits go through the Host wizard.

## Workspace Files

### Context Workspace

Generated/updated on each open of a terminal context (one with non-empty `git_repos`). One folder per declared alias (relative path from `workspaces/`) plus the Drive folder of the context. Alias order from the manifest is preserved.

```json
{
  "folders": [
    { "path": "../repos/Duet.git" },
    { "path": "../repos/Duet-Instructions.git" },
    { "path": "/absolute/path/to/Drive/DuetLab" }
  ]
}
```

| Aspect | Value |
|--------|-------|
| Location | `DuetData/workspaces/{Context}.code-workspace` |
| Repo paths | Relative from `workspaces/` (one per `git_repos` alias) |
| Drive path | Absolute (not portable) |
| Builder | `core/workspace.ts:writeContextWithReposWorkspace(name, aliases, drivePath)` |

A single-alias terminal context produces a 2-folder workspace through the same path — there is no separate single-repo builder.

### Alias safety

Aliases originate from user-authored manifest JSON. Before opening a terminal context, `openFolder.ts:findUnsafeAliases` checks every alias in both `git_repos` and `reference_repos`; if any name fails `isSafeRepoName` (path separators, dots-only, control characters, leading dot), the open is **aborted** with a user-visible error — no clone, no workspace file. This is symmetric with the spec rule that an unreachable repo must be removed from the manifest before the context can be opened.

### Root Contexts Workspace

| Aspect | Value |
|--------|-------|
| Location | `DuetData/root-contexts.code-workspace` |
| Paths | Absolute (not portable) |
| Generated | On refresh (after scan completes) |

## Implementation

| Concept | File |
|---------|------|
| Pointer reading | `pointer.ts` |
| DuetData paths | `paths.ts` |
| HTTP API client | `api-client.ts` |
| Workspace generation | `workspace.ts` |
