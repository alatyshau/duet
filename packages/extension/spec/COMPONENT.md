# Extension

VS Code extension — tree views, commands, and workspace management as thin client over Backend HTTP API.

> Shared model (pointer, DuetData, DuetConfig, entities): see [/spec/PRODUCT.md](/spec/PRODUCT.md)
>
> See also: [DATA_MODEL.md](DATA_MODEL.md), [UI.md](UI.md)

## Domain

Entity hierarchy, manifests, name uniqueness, self-healing: see [/spec/PRODUCT.md](/spec/PRODUCT.md)

## Layer Separation

| Layer | Rule | Why |
|-------|------|-----|
| `core/` | No vscode imports | Testable with vitest, no VS Code runtime |
| `vscode/` | Wraps core/ with VS Code APIs | Thin glue layer |

## Engineering Principles

| Principle | Rule |
|-----------|------|
| **Thin shell** | `vscode/` — only wiring. All non-trivial logic lives in `core/`. If logic in shell grows beyond a one-liner -> extract to `core/`. |
| **No framework imports in core/** | `core/` has zero VS Code imports. Testable with plain Node.js + vitest. |
| **Unit tests for core/ only** | Don't mock VS Code APIs. Test pure `core/` functions directly. Shell is validated by TypeScript + integration tests. |
| **Pure functions over state** | Prefer pure functions with explicit args over closures capturing module state. Makes testing trivial. |
| **FileSystem DI** | `core/` uses `FileSystem` interface for all file I/O. Tests inject mock FS — no disk access. |
| **Spec-driven** | Code + spec changes go in same commit. Read `spec/` before changes, update after. |

## Key Decisions

| Decision | Rationale |
|----------|-----------|
| Pointer-based config (`pointer.ts`) | Reads `~/.org.ve68.duet` for paths, `{machine}.json` for port |
| Backend HTTP API as data source | `DuetApiClient` -> all entity data via `/contexts`, `/scan` |
| `ContextEntity[]` sync pattern | Load once on activation, pass to providers, update on refresh. No per-node HTTP calls |
| FileSystem interface (`fs.ts`) | Dependency injection for testing without mocks |
| Deterministic scan order | Backend scanner: `readdir` sorted by name for reproducible results |
| git clone via spawn | System git handles auth (ssh-agent, credential helper) |
| Workspace files | Multi-root workspace for repo + Drive folder |

## Data Flow

```
activation -> apiClient.contexts() -> ContextEntity[]
           -> pass to ContextTreeProvider, ContextProvider

refresh    -> apiClient.scan() + apiClient.contexts() -> new ContextEntity[]
           -> updateContexts() on all providers -> fire onDidChangeTreeData
```

Tree providers work synchronously over `ContextEntity[]` (filter, find, sort).
Each entity carries `meta` (boolean), `git_url` (nullable string), and
`parent_id` (nullable string) — all role differences (meta-context, root
context, terminal git-backed context, regular context) are derived from these
fields rather than from a `type` enum.

**Tree sort order:** the meta-context appears first; everything else is sorted
alphabetically by `name` at every nesting level. `git_url` controls icon and
decoration only — it does not change ordering, so a terminal context like `Duet`
mixes with intermediate siblings purely by name. Implementation lives in
`core/tree/contextTree.ts:compareTreeNodes` and `core/tree/contextBreadcrumb.ts:bucketOrder`.

## Launcher (openFolder.ts)

| Context flavor | Action |
|----------------|--------|
| Context without `git_url` | Open Drive folder directly |
| Context with `git_url` | Clone if needed -> generate workspace -> open workspace |

For any entity whose manifest declares `reference_repos`, any missing clones are fetched into `paths.reposPath/<name>.git` before the folder/workspace is opened. Clone failure or user cancel aborts the open (symmetric to the main `git_url` clone) — an unreachable reference repo must be removed from the manifest before the context can be opened. Reference repo names are validated against path traversal before being joined with `reposPath`.

Git clone UX:
- `withProgress` notification (cancellable)
- Output to "Duet Git" channel
- Uses `--progress` flag for real-time output
- Finalize pattern: single `resolved` flag prevents duplicate logs on cancel/error/close race

Implementation: `vscode/commands/openFolder.ts`, `core/workspace.ts`

## Workspace Generation

| Workspace | When Generated | Where |
|-----------|----------------|-------|
| `{Context}.code-workspace` | On each git-backed context open | `openFolder.ts` |
| `root-contexts.code-workspace` | After scan completes (lists all root contexts) | `refresh.ts` |

## Copy @-Path Command (`duet.copyAtPath`)

User-facing command in the Explorer right-click menu (group `6_copypath`, next
to native Copy Path / Copy Relative Path). Copies the resource as a Duet
`@`-reference: `` `@<rootFolder>/<relative>` ``.

Example: `packages/host/spec/COMPONENT.md` inside the `Duet.git` workspace
folder copies as `` `@Duet.git/packages/host/spec/COMPONENT.md` ``.

### Why this exists

1. **Multi-root disambiguation.** Native VS Code Copy Relative Path strips the
   workspace root, so in a multi-root workspace the resulting path doesn't
   say *which* root it is relative to — `packages/host` could come from any
   open folder. Including the root folder name removes that ambiguity.
2. **Matches Duet's `@`-style for context-relative paths.** Throughout Duet,
   paths relative to a context folder are written with a leading `@` and the
   context name as the first segment.
   Reusing that syntax for workspace-relative paths keeps a single visual
   convention across hand-written notes, AI prompts, and Explorer-copied
   references.

### Decisions

| Decision | Rationale |
|----------|-----------|
| Root name = `path.basename(workspaceFolder.uri.fsPath)` | The on-disk folder name is what the user actually has on the filesystem and recognises across machines. Workspace files (`*.code-workspace`) can override the display label via the `name` field, but the `@`-reference is meant to point at the filesystem — basename stays stable regardless of UI renaming. Falls back to `folder.name` for filesystem roots (`/`, `C:\`) where basename is empty. |
| Forward slashes always | The `@`-reference is platform-agnostic. `path.relative` on Windows returns `\` — `formatAtReference` normalizes both `/` and `\` to `/`. |
| Empty relative → `` `@<root>` `` | When the resource IS the workspace root, the trailing `/` is dropped. |
| No success notification | Native Copy Path is silent; multi-select would otherwise spam toasts. |
| Multi-select: newline-joined | Matches native Copy Relative Path behavior. VS Code Explorer passes `(resource, resources)`. |
| Resources outside workspace: skip with warning | A single warning aggregates all skipped resources (`+N more`). The clipboard receives only the resolvable subset; if nothing resolves, the clipboard is left untouched. |
| Hidden from Command Palette | The command needs a resource argument — invoking it from the palette has no useful effect, so `commandPalette` is `when: false`. |
| `when: workspaceFolderCount > 0` | Hides the menu item in single-file windows where there is no workspace folder to compute a relative path against. |
| Keybinding `Cmd+Shift+C` (mac) / `Alt+Shift+C` (win/linux) | Active in either the Explorer tree or an editor (`(filesExplorerFocus \|\| editorTextFocus) && !inputFocus`). Semantics: **copies the @-reference of the current editor file**. VS Code does not expose Explorer selection to keybindings (only context-menu invocations receive `(resource, resources)`), so the command resolves the target via `activeTextEditor` → active tab input. **Folders are out of reach for the keybinding** because they don't open in an editor — for folders, use the right-click menu. The shortcut also pairs with system mouse remappers (Karabiner / AutoHotkey) for a middle-click workflow. |
| Registered before `if (dataFolder)` guard | Command does not depend on pointer or backend — works even when Duet Host is not configured. |

**Known limitation**: in a multi-root workspace where two folders share the
same basename (e.g. `frontend/spec` and `backend/spec` added as roots), the
resulting `@spec/...` reference is ambiguous — it defeats the multi-root
disambiguation that's the whole point of including the root name. We do not
detect or rename collisions; the user is expected to keep root basenames
unique inside one workspace.

**Pure logic**: `core/pathUtils.ts` → `formatAtReference(rootName, relativePath)`.
**Shell**: `vscode/commands/copyAtPath.ts` (resolves `getWorkspaceFolder`, writes
clipboard, surfaces warnings).

## Tree Decorations

`TreeDecorationProvider.ts` is a `FileDecorationProvider`. It currently has a single responsibility: grey out separator rows so the line/spacer items read as visual gaps rather than active items.

| URI Scheme | Format | Decoration |
|------------|--------|------------|
| `duet-tree` | `duet-tree:/separator/<index>` | `disabledForeground` colour |

`SeparatorItem` in `ContextTreeProvider` is the only call site setting `resourceUri` with this scheme. Active-node / root-context colouring is **not** wired today — node labels carry their own emoji-based status (🔹/🟦/🔸/🟧 for roots, 🟠/◻️ for nested). If colour decoration becomes needed, both the provider and the matching `resourceUri` assignment in the tree provider have to land together.

## Backend Health Monitoring

Host owns the full backend lifecycle (start, stop, health). Extension is a pure consumer:

| Step | What |
|------|------|
| 1. Read pointer | `readPointer()` -> `duetDataPath`, set `duet.hasPointer` |
| 2. Read port | `readPort()` -> port (default 19680), create `DuetApiClient` |
| 3. Set initializing | `duet.initializing=true`, `duet.ready=false` -> spinner in status view |
| 4. Load contexts | `apiClient.contexts()` -> `ContextEntity[]` |
| 5. Register providers | Create and register all tree providers |
| 6. Set ready | `duet.ready=true`, `duet.initializing=false` -> main views appear |

**On failure** (no pointer, no port, backend offline):
- `duet.ready=false` -> status view shows "Установите и запустите Duet Host"
- User clicks "Перезагрузить окно" -> `workbench.action.reloadWindow`

**Extension contracts:**
- No spawn, no venv, no install — all managed by Host
- Single check on activation (no polling, no retry command)
- `duet.ready=true` set AFTER providers registered (prevents "no data provider" flash)
- Backend-independent commands (`openDataFolder`, `showContextHelp`) work regardless of backend state

## Build & Release

> Full pipeline: see [/spec/PRODUCT.md](/spec/PRODUCT.md) -> Build & Release

```bash
npm run vsix   # bump + build + package -> dist/duet-{version}.vsix
```

`build-vsix.js`: bump patch -> update UI title -> esbuild --production -> vsce package

| Script | What |
|--------|------|
| `esbuild.js` | Bundle extension to `dist/extension.js` |
| `build-vsix.js` | Orchestrates: version bump + package + vsce |

## Testing

| Layer | Tool | Approach |
|-------|------|----------|
| `core/` | vitest | Unit tests with mock ContextEntity[] and DuetApiClient |
| `vscode/` | @vscode/test-electron | Integration tests (planned) |

## Navigation

| Concept | File |
|---------|------|
| Pointer reading (sync) | `core/pointer.ts` |
| DuetData paths | `core/paths.ts` |
| Backend API client | `core/api-client.ts` |
| Context tree logic | `core/tree/contextTree.ts` |
| Context breadcrumb | `core/tree/contextBreadcrumb.ts` |
| Sidebar state (context keys) | `core/sidebar-state.ts` |
| Workspace generation | `core/workspace.ts` |
| Copy @-path command | `vscode/commands/copyAtPath.ts`, `core/pathUtils.ts` (`formatAtReference`) |
| Entity types, markers | Backend `scanner.py` |
| Name conflict resolution | Backend `scanner.py` |
| DB schema (name unique) | Backend `db.py` |
| Entity data in Extension | `api-client.ts` -> `ContextEntity` type |
| Tree navigation | `core/tree/contextTree.ts`, `contextBreadcrumb.ts` |
