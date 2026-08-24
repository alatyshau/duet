# Extension

VS Code extension — tree views, commands, and workspace management as a thin client over Backend HTTP API.

> Domain model (contexts, manifests, invariants, root_context_folders order), pointer file, file ownership: see [/spec/PRODUCT.md](/spec/PRODUCT.md). UI layout and per-view contracts: see [UI.md](UI.md). This file documents what Extension itself owns.

## Purpose

Extension is a **passive view** over the entities and orientation that Backend exposes via HTTP. It never writes config, never owns process lifecycle, never re-derives domain rules. Its job is to:

1. Read pointer file → discover Backend port.
2. Pull `/contexts` and `/orientation` from Backend.
3. Render two tree views (ДЕЛА, КОНТЕКСТ) — see [UI.md](UI.md).
4. Open contexts as multi-root VS Code workspaces (clone repos when needed).
5. Provide one editor command: Copy @-Path.

Anything beyond that — root-context editing, schema migrations, AI client configuration — lives in Host. Extension's correct response to «I want to add a root context» is to direct the user to the Host wizard.

## Architecture

### Layer Separation

| Layer | Rule | Why |
|-------|------|-----|
| `core/` | No vscode imports | Testable with vitest, no VS Code runtime |
| `vscode/` | Wraps `core/` with VS Code APIs | Thin glue layer |

### Engineering Principles

| Principle | Rule |
|-----------|------|
| **Thin shell** | `vscode/` is only wiring. All non-trivial logic in `core/`. Logic in shell beyond a one-liner → extract to `core/` |
| **No framework imports in core/** | `core/` has zero VS Code imports. Testable with plain Node.js + vitest |
| **Unit tests for core/ only** | Don't mock VS Code APIs. Test pure `core/` functions directly. Shell is validated by TypeScript + integration tests |
| **Pure functions over state** | Prefer explicit args over closures capturing module state |
| **FileSystem DI** | `core/` uses `FileSystem` interface for all file I/O. Tests inject mock FS |
| **Spec-driven** | Code + spec changes in same commit. Read `spec/` before changes, update after |

### Key Decisions

| Decision | Rationale |
|----------|-----------|
| Pointer-based config | `pointer.ts` reads `~/.org.ve68.duet` for paths, `{machine}.json` for port |
| Backend HTTP API as data source | `DuetApiClient` — all entity data via `/contexts`, `/scan`, `/orientation` |
| `ContextEntity[]` sync pattern | Load once on activation, pass to providers, update on refresh. No per-node HTTP calls |
| FileSystem interface (`fs.ts`) | DI for testing without mocks |
| git clone via spawn | System git handles auth (ssh-agent, credential helper) |
| Workspace files | Multi-root workspace for repo + Drive folder |

### Data Sources

Extension does NOT read `settings.json`. It only reads pointer + machine config:

| File | Reader | What Extension uses |
|------|--------|---------------------|
| `~/.org.ve68.duet` | `pointer.ts:readPointer()` | `duetDataPath`, `duetConfigPath`, `machine` |
| `DuetConfig/{machine}.json` | `pointer.ts:readMachineConfig()` | `port` (for backend API) |

All entity data flows from Backend:

| Source | Method | Data |
|--------|--------|------|
| `GET /contexts` | `apiClient.contexts()` | All `context` entities with `absolute_path`, `meta`, optional `git_repos` map |
| `POST /orientation` | `apiClient.orientation(paths)` | `workspace` block, `context.chain`, `products[]` with nested `components[]`, optional `memory` (`{ref, path}` or `null`) |
| `POST /scan` | `apiClient.scan()` | Triggers backend rescan |
| `POST /deploy-instructions` | `apiClient.deployInstructions(paths)` | Asks backend to deploy the owning context's `skills`/`instructions` into its Drive folder. Fire-and-forget |

`ContextEntity[]` (from `/contexts`) is kept in memory and feeds the ДЕЛА view. The single `OrientationResponse` (from `/orientation`) feeds the КОНТЕКСТ view and is re-fetched on workspace folder change. Both refresh on `duet.refresh`.

**Root context configuration is Host-only.** Extension intentionally has no add/remove/reorder commands and no write path to `settings.json` or `{machine}.json` (see /spec/PRODUCT.md → File Ownership). All edits go through the Host wizard.

### Data Flow

```
activation → apiClient.contexts()    → ContextEntity[]     → ContextTreeProvider (ДЕЛА view)
           → apiClient.orientation() → OrientationResponse → ContextProvider (КОНТЕКСТ view)

refresh    → apiClient.scan()
           → apiClient.contexts()    → updateContexts()    on ContextTreeProvider
           → apiClient.orientation() → updateOrientation() on ContextProvider
```

Both providers are synchronous wrappers around a snapshot:

- **ДЕЛА view** (`ContextTreeProvider`) works over `ContextEntity[]` — the full list of contexts loaded once on activation. Each entity carries `meta`, `git_repos` (`Record<alias,url> | null`), and `parent_id`; role differences (meta / root / has git products / regular) are derived from these fields rather than from a `type` enum. A context has git products iff `git_repos` has one or more aliases; it may still have nested Drive child contexts.
- **КОНТЕКСТ view** (`ContextProvider`) works over a single `OrientationResponse` — backend already resolved the current workspace folders into a chain, products, and components. The provider renders that shape directly. On workspace folder change it calls a `refreshOrientation` callback.

**Tree order:** owned by Backend's `/contexts` response (see /spec/PRODUCT.md → Invariants). `core/tree/contextTree.ts` is a passive view that preserves API order and never re-sorts.

## Surface

### Tree Views

| View ID | Provider | Data source | Renders |
|---------|----------|-------------|---------|
| `duet.contexts` (ДЕЛА) | `ContextTreeProvider` | `apiClient.contexts()` (`ContextEntity[]`) | Full forest of root contexts and descendants. Terminal contexts highlighted when any of their `git_repos` aliases is open in a workspace folder |
| `duet.context` (КОНТЕКСТ) | `ContextProvider` | `apiClient.orientation(currentFolderPaths)` (`OrientationResponse`) | Chain of contexts the current workspace folders resolve into → top-level products → components. `workspace.kind === 'unknown'` → single info node |

Product `path` (`@<alias>.git` for git-products, `@<context_name>[/<sub>]` for drive-products) resolves against `workspace.git_folders` / `workspace.context_folder` via `core/pathUtils.ts:resolveAtRef`. Components carry paths relative to their product. Per-view rendering rules (icons, decorations, accordion behavior) live in [UI.md](UI.md).

### Commands

#### `duet.openFolder` — open a context

| Context flavor | Action |
|----------------|--------|
| Context without `git_repos` | Open Drive folder directly |
| Terminal context (`git_repos` non-empty) | Clone every aliased repo into `paths.reposPath/<alias>.git` → generate multi-root workspace → open workspace |

For any context whose manifest declares `reference_repos`, missing clones are fetched into `paths.reposPath/<name>.git` before the folder/workspace is opened. Clone failure or user cancel aborts the open — an unreachable repo must be removed from the manifest before the context can be opened. Alias names are validated against path traversal (`isSafeRepoName`).

**Git clone UX:**
- `withProgress` notification (cancellable).
- Output to "Duet Git" channel.
- `git clone --progress -- <url> <target>` — the `--` separator disarms URLs that begin with `-`. Built by `buildGitCloneArgs`.
- Finalize pattern: single `resolved` flag prevents duplicate logs on cancel/error/close race.

Implementation: `vscode/commands/openFolder.ts`, `core/workspace.ts`.

#### `duet.copyAtPath` — copy `@`-reference

User-facing command in the Explorer right-click menu (group `6_copypath`). Copies the resource as `` `@<rootFolder>/<relative>` ``.

Example: `packages/host/spec/COMPONENT.md` inside the `Duet.git` workspace folder copies as `` `@Duet.git/packages/host/spec/COMPONENT.md` ``.

**Why it exists:**
1. **Multi-root disambiguation.** Native VS Code Copy Relative Path strips the workspace root, so `packages/host` could come from any open folder. Including the root folder name removes that ambiguity.
2. **Matches Duet's `@`-style.** Throughout Duet, paths relative to a context folder are written with a leading `@` and the context name as the first segment. Reusing this syntax keeps a single visual convention across hand-written notes, AI prompts, and Explorer-copied references.

**Decisions:**

| Decision | Rationale |
|----------|-----------|
| Root name = `path.basename(workspaceFolder.uri.fsPath)` | On-disk folder name is what the user has on the filesystem. `*.code-workspace` `name` field can override the display label, but `@`-reference points at the filesystem — basename stays stable. Falls back to `folder.name` for filesystem roots where basename is empty |
| Forward slashes always | The `@`-reference is platform-agnostic; `formatAtReference` normalizes `\` → `/` |
| Empty relative → `` `@<root>` `` | When the resource IS the workspace root, trailing `/` dropped |
| No success notification | Native Copy Path is silent; multi-select would otherwise spam toasts |
| Multi-select: newline-joined | Matches native Copy Relative Path. VS Code Explorer passes `(resource, resources)` |
| Resources outside workspace: skip with warning | Single aggregated warning (`+N more`). Clipboard receives the resolvable subset; if nothing resolves, clipboard untouched |
| Hidden from Command Palette | Command needs a resource argument — no useful effect from palette (`commandPalette: when: false`) |
| `when: workspaceFolderCount > 0` | Hides menu in single-file windows |
| Keybinding `Cmd+Shift+C` (mac) / `Alt+Shift+C` (win/linux) | Active in either Explorer tree or editor. Resolves target via `activeTextEditor`. Folders out of reach for keybinding — use right-click menu |
| Registered before pointer guard | Works even when Duet Host is not configured |

**Known limitation:** in a multi-root workspace where two folders share the same basename (e.g. `frontend/spec` and `backend/spec` added as roots), `@spec/...` is ambiguous. No detection — user expected to keep root basenames unique.

Pure logic: `core/pathUtils.ts:formatAtReference(rootName, relativePath)`. Shell: `vscode/commands/copyAtPath.ts`.

### Workspace Files

Two generated artifacts:

| Workspace | Location | When Generated | Folders |
|-----------|----------|----------------|---------|
| `{Context}.code-workspace` | `DuetData/workspaces/` | On open of a context with `git_repos` | Drive folder of the context first, then one folder per `git_repos` alias (relative `../repos/<alias>.git`, declared order preserved). Assembly is hardcoded **context-first** — the Drive folder is always the primary/first folder |
| `<context>/.kimi-code/local.toml` | context Drive folder | Same write as `{Context}.code-workspace` | Kimi Code multi-root workaround: Kimi's VS Code extension sees only the primary folder, so the cloned repos are written as `[workspace] additional_dir` (absolute paths, declared order). Duet-managed, rewritten wholesale; machine-specific — not for VCS. **Known limitation:** the file lives in the Drive-synced context folder, so on a multi-machine setup (e.g. Mac + Windows) the synced absolute paths are wrong on the other machine — no workaround; the real fix is multi-root support in Kimi's VS Code extension ([MoonshotAI/kimi-code](https://github.com/MoonshotAI/kimi-code), `apps/vscode`, MIT) |
| `root-contexts.code-workspace` | `DuetData/` (root) | After scan completes | All root context folders + `DuetData` |

```json
{
  "folders": [
    { "path": "/absolute/path/to/Drive/DuetLab" },
    { "path": "../repos/Duet.git" },
    { "path": "../repos/Duet-Instructions.git" }
  ]
}
```

| Aspect | Value |
|--------|-------|
| Context workspace location | `DuetData/workspaces/{Context}.code-workspace` |
| Root-contexts workspace location | `DuetData/root-contexts.code-workspace` (NOT under `workspaces/`) |
| Repo paths | Relative from `workspaces/` (one per `git_repos` alias) |
| Drive path | Absolute (not portable) |
| Context-workspace builder | `core/workspace.ts:writeContextWithReposWorkspace(name, aliases, drivePath)` |

Folder order is hardcoded **context-first**: the Drive folder is always emitted first, then the cloned repos in `git_repos` declared order. The builder takes no ordering argument. The first folder in a VS Code multi-root workspace is the default cwd for terminals and the anchor for file pickers — keeping the Drive folder first makes it the terminal default. Single entry point — no separate single-repo variant. A context with one `git_repos` alias produces a 2-folder workspace; two aliases produce three folders; etc.

**Alias safety:** aliases originate from user-authored manifest JSON. Before opening a context with `git_repos`, `openFolder.ts:findUnsafeAliases` checks every alias in both `git_repos` and `reference_repos`; if any name fails `isSafeRepoName` (path separators, dots-only, control characters, leading dot), the open is **aborted** with a user-visible error — no clone, no workspace file.

## Behaviors

### Backend Health Monitoring

Host owns the full backend lifecycle (start, stop, health). Extension is a pure consumer:

| Step | What |
|------|------|
| 1. Read pointer | `readPointer()` → `duetDataPath`, set `duet.hasPointer` |
| 2. Read port | `readPort()` → port (default 19680), create `DuetApiClient` |
| 3. Set initializing | `duet.initializing=true`, `duet.ready=false` → spinner |
| 4. Load contexts + orientation | `apiClient.contexts()`, `apiClient.orientation(currentFolderPaths)` |
| 5. Register providers | Create and register all tree providers |
| 6. Set ready | `duet.ready=true`, `duet.initializing=false` → main views appear |

**On failure** (no pointer, no port, backend offline):
- `duet.ready=false` → status view shows "Установите и запустите Duet Host".
- User clicks "Перезагрузить окно" → `workbench.action.reloadWindow`.

**Contracts:**
- No spawn, no venv, no install — all managed by Host.
- Single check on activation (no polling, no retry command).
- `duet.ready=true` set AFTER providers registered (prevents "no data provider" flash).
- Backend-independent command `openDataFolder` works regardless of backend state.

### Deploy Instructions Trigger

Extension asks Backend to deploy the open context's instruction components (skills / instructions) into its Drive folder via `apiClient.deployInstructions(workspacePaths)`. The call is **debounced** (500ms) and **fire-and-forget** — warnings/errors are logged to the "Duet Backend" output channel, never surfaced as blocking UI. Backend is idempotent and serializes concurrent calls per context.

Fires on:
- **Activation** — after the initial orientation fetch, with the current workspace folder paths.
- **`onDidChangeWorkspaceFolders`** — with the new folder paths.
- **`duet.refresh`** — after the rescan + orientation refresh.

Implementation: `vscode/extension.ts` (`triggerDeployInstructions`).

### Tree Decorations

`TreeDecorationProvider.ts` is a `FileDecorationProvider`. Single responsibility today: grey out separator rows so the line/spacer items read as visual gaps rather than active items.

| URI Scheme | Format | Decoration |
|------------|--------|------------|
| `duet-tree` | `duet-tree:/separator/<index>` | `disabledForeground` colour |

`SeparatorItem` in `ContextTreeProvider` is the only call site setting `resourceUri` with this scheme. Active-node / root-context colouring is NOT wired here — node labels carry their own emoji-based status (see UI.md). If colour decoration becomes needed, both the provider and the matching `resourceUri` assignment have to land together.

## Engineering

### Build & Release

Per-package pipeline (full release contract: see /spec/PRODUCT.md → Pre-commit Verification):

```bash
npm run vsix   # bump + build + package → dist/duet-{version}.vsix
```

`build-vsix.js`: bump patch → update UI title → esbuild --production → vsce package.

| Script | What |
|--------|------|
| `esbuild.js` | Bundle extension to `dist/extension.js` |
| `build-vsix.js` | Orchestrates: version bump + package + vsce |

Extension is a thin UI client — no backend bundling. Host handles backend deployment via `deploy.ts`.

### Testing

| Layer | Tool | Approach |
|-------|------|----------|
| `core/` | vitest | Unit tests with mock `ContextEntity[]` and `DuetApiClient` |
| `vscode/` | @vscode/test-electron | Integration tests (planned) |

### File Map

| Concept | File |
|---------|------|
| Pointer reading (sync) | `core/pointer.ts` |
| DuetData paths | `core/paths.ts` |
| Backend API client | `core/api-client.ts` (incl. `deployInstructions`) |
| Deploy-instructions trigger | `vscode/extension.ts` (`triggerDeployInstructions`) |
| Context tree logic (ДЕЛА view) | `core/tree/contextTree.ts` |
| КОНТЕКСТ view (orientation-driven) | `vscode/providers/ContextProvider.ts` |
| @-ref resolver | `core/pathUtils.ts` (`resolveAtRef`) |
| Sidebar state (context keys) | `core/sidebar-state.ts` |
| Workspace generation | `core/workspace.ts` (`writeContextWithReposWorkspace`) |
| Copy @-path command | `vscode/commands/copyAtPath.ts`, `core/pathUtils.ts` (`formatAtReference`) |
| Tree decorations | `vscode/providers/TreeDecorationProvider.ts` |
| Accordion controller | `core/tree/AccordionController.ts` |
| Entity types in Extension | `core/api-client.ts` → `ContextEntity` type |
