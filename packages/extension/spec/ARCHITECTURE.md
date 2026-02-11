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
| sql.js (WASM) | Works in VS Code extension sandbox, no native deps |
| FileSystem interface (`fs.ts`) | Dependency injection for testing without mocks |
| `atomicWriteFile()` in FileSystem | Prevents config.json corruption on crash |
| Deterministic scan order | `readdir` sorted by name for reproducible results |
| git clone via spawn | System git handles auth (ssh-agent, credential helper) |
| Workspace files | Multi-root workspace for repo + Drive folder |
| Backend `stdio: 'ignore'` | Backend logs to file, avoids BrokenPipe/SIGPIPE |
| VERSION file (not config.json) | Backend version in `DuetData/backend/VERSION` |

## Scanner Behaviors

| Behavior | Description |
|----------|-------------|
| Self-healing | Auto-creates `business.json` at roots, renames misplaced manifests |
| Recursive descent | Scans nested streams until product found |
| Product is terminal | On `product.json` found → stop, no manifests below product |
| Projects detection | Any entity with `projects/` subfolder |

Implementation: `scanner.ts` (legacy — reads `config.json`). Name conflict resolution → see ECOSYSTEM.md

**Legacy note:** Scanner still reads `DuetData/config.json` via `ConfigManager`. Will migrate to Backend API when Extension stops doing its own scan.

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

`build-vsix.js`: bump patch → update UI title → esbuild --production → bundle-backend → vsce package

| Script | What |
|--------|------|
| `esbuild.js` | Bundle extension + MCP server. Copies `sql-wasm.wasm` to dist/ |
| `bundle-backend.js` | Copy `packages/backend/` → `dist/backend/` (excludes tests, `__pycache__`) |
| `build-vsix.js` | Orchestrates: version bump + package + vsce |

**Backend is embedded in VSIX** — Extension deploys it to `DuetData/backend/` on activation.

## File Safety

All file writes use atomic pattern: tmp + rename.

| File | Module | Method |
|------|--------|--------|
| `config.json` | `ConfigManager` | `fs.atomicWriteFile()` |

**Contract:** `fs.atomicWriteFile(path, data, encoding)` — writes to `.{basename}.{pid}.tmp` then `fs.rename()`. Never `fs.writeFile()` for config.

## Backend Lifecycle

Extension spawns backend. Spawn details: see ECOSYSTEM.md → Backend Spawn.

Extension-specific logic in `backend-lifecycle.ts`:

| Step | What |
|------|------|
| 1. Check `/health` | If backend alive + version matches → ready |
| 2. Check VERSION file | If matches extension version → skip install |
| 3. `install()` | Copy backend files, create venv, write VERSION |
| 4. `startup()` | Spawn backend process |

**Extension-specific contracts:**
- Port read via `pointer.ts:readPort()` (default 19680)
- Backend output channel shows startup/shutdown events only
- `ensureRunning()` called on activation

## Navigation

| Concept | File |
|---------|------|
| Pointer reading (sync) | `core/pointer.ts` |
| DuetData paths | `core/paths.ts` |
| Legacy config.json read/write | `core/config.ts` (ConfigManager) |
| Backend lifecycle | `core/backend-lifecycle.ts` |
| DB schema, queries | `db/index.ts` |
| Workspace generation | `core/workspace.ts` |
| MCP server | `mcp-server/index.ts` |

## Testing

| Layer | Tool | Approach |
|-------|------|----------|
| `core/` | vitest | Unit tests with mock FileSystem |
| `vscode/` | @vscode/test-electron | Integration tests (planned) |
