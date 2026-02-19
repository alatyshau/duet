# Architecture

> Shared model (pointer, DuetData, DuetConfig, entities): see [/spec/ECOSYSTEM.md](/spec/ECOSYSTEM.md)

## Layer Separation

| Layer | Rule | Why |
|-------|------|-----|
| `core/` | No vscode imports | Testable with vitest, no VS Code runtime |
| `vscode/` | Wraps core/ with VS Code APIs | Thin glue layer |

## Engineering Principles

| Principle | Rule |
|-----------|------|
| **Thin shell** | `vscode/` — only wiring. All non-trivial logic lives in `core/`. If logic in shell grows beyond a one-liner → extract to `core/`. |
| **No framework imports in core/** | `core/` has zero VS Code imports. Testable with plain Node.js + vitest. |
| **Unit tests for core/ only** | Don't mock VS Code APIs. Test pure `core/` functions directly. Shell is validated by TypeScript + integration tests. |
| **Pure functions over state** | Prefer pure functions with explicit args over closures capturing module state. Makes testing trivial. |
| **FileSystem DI** | `core/` uses `FileSystem` interface for all file I/O. Tests inject mock FS — no disk access. |
| **Spec-driven** | Code + spec changes go in same commit. Read `spec/` before changes, update after. |

## Key Decisions

| Decision | Rationale |
|----------|-----------|
| Pointer-based config (`pointer.ts`) | Reads `~/.org.ve68.duet` for paths, `{machine}.json` for port |
| Backend HTTP API as data source | `DuetApiClient` → all entity data via `/streams`, `/projects`, `/scan` |
| `StreamEntity[]` sync pattern | Load once on activation, pass to providers, update on refresh. No per-node HTTP calls |
| FileSystem interface (`fs.ts`) | Dependency injection for testing without mocks |
| Deterministic scan order | Backend scanner: `readdir` sorted by name for reproducible results |
| git clone via spawn | System git handles auth (ssh-agent, credential helper) |
| Workspace files | Multi-root workspace for repo + Drive folder |

## Data Flow

```
activation → apiClient.streams() → StreamEntity[]
           → pass to BusinessTreeProvider, ContextProvider
           → ProjectsProvider gets apiClient for async /projects calls

refresh    → apiClient.scan() + apiClient.streams() → new StreamEntity[]
           → updateStreams() on all providers → fire onDidChangeTreeData
```

Tree providers work synchronously over `StreamEntity[]` (filter, find, sort).
Only `ProjectsProvider.getChildren()` is async (calls `/projects/{id}`).

## Launcher (openFolder.ts)

| Entity Type | Action |
|-------------|--------|
| Business/Stream | Open Drive folder directly |
| Product (no git_url) | Open Drive folder |
| Product (with git_url) | Clone if needed → generate workspace → open workspace |

Git clone UX:
- `withProgress` notification (cancellable)
- Output to "Duet Git" channel
- Uses `--progress` flag for real-time output
- Finalize pattern: single `resolved` flag prevents duplicate logs on cancel/error/close race

Implementation: `vscode/commands/openFolder.ts`, `core/workspace.ts`

## Workspace Generation

| Workspace | When Generated | Where |
|-----------|----------------|-------|
| `{Product}.code-workspace` | On each product open | `openFolder.ts` |
| `all-businesses.code-workspace` | After scan completes | `refresh.ts` |

## Tree Decorations

`TreeDecorationProvider.ts` uses VS Code FileDecorationProvider API to style tree items.

| URI Scheme | Format | Purpose |
|------------|--------|---------|
| `duet-tree` | `duet-tree:/<type>/<entityId>?active` | Enables color styling for tree nodes |

| Decoration | Color | When |
|------------|-------|------|
| Business | `charts.blue` | All business nodes |
| Active | `charts.red` | Currently loaded node (`?active` in URI) |

Note: Active color takes priority over business color.

## Build & Release

> Full pipeline: see [/spec/ECOSYSTEM.md](/spec/ECOSYSTEM.md) → Build & Release

```bash
npm run vsix   # bump + build + package → dist/duet-{version}.vsix
```

`build-vsix.js`: bump patch → update UI title → esbuild --production → vsce package

| Script | What |
|--------|------|
| `esbuild.js` | Bundle extension to `dist/extension.js` |
| `build-vsix.js` | Orchestrates: version bump + package + vsce |

## Backend Health Monitoring

Host owns the full backend lifecycle (start, stop, health). Extension is a pure consumer:

| Step | What |
|------|------|
| 1. Read pointer | `readPointer()` → `duetDataPath`, set `duet.hasPointer` |
| 2. Read port | `readPort()` → port (default 19680), create `DuetApiClient` |
| 3. Set initializing | `duet.initializing=true`, `duet.ready=false` → spinner in status view |
| 4. Load streams | `apiClient.streams()` → `StreamEntity[]` |
| 5. Register providers | Create and register all tree providers |
| 6. Set ready | `duet.ready=true`, `duet.initializing=false` → main views appear |

**On failure** (no pointer, no port, backend offline):
- `duet.ready=false` → status view shows "Установите и запустите Duet Host"
- User clicks "Перезагрузить окно" → `workbench.action.reloadWindow`

**Extension contracts:**
- No spawn, no venv, no install — all managed by Host
- Single check on activation (no polling, no retry command)
- `duet.ready=true` set AFTER providers registered (prevents "no data provider" flash)
- Backend-independent commands (`openDataFolder`, `showContextHelp`) work regardless of backend state

## Navigation

| Concept | File |
|---------|------|
| Pointer reading (sync) | `core/pointer.ts` |
| DuetData paths | `core/paths.ts` |
| Backend API client | `core/api-client.ts` |
| Business tree logic | `core/tree/businessTree.ts` |
| Context breadcrumb | `core/tree/contextBreadcrumb.ts` |
| Projects list | `core/tree/projectsList.ts` |
| Sidebar state (context keys) | `core/sidebar-state.ts` |
| Workspace generation | `core/workspace.ts` |

## Testing

| Layer | Tool | Approach |
|-------|------|----------|
| `core/` | vitest | Unit tests with mock StreamEntity[] and DuetApiClient |
| `vscode/` | @vscode/test-electron | Integration tests (planned) |
