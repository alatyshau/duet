# Extension

VS Code extension — tree views, commands, and workspace management as a thin client over Backend HTTP API, plus the windows of intents (tickets), which it keeps on its own.

> Domain model (contexts, manifests, invariants, root_context_folders order), pointer file, file ownership: see [/spec/PRODUCT.md](/spec/PRODUCT.md). UI layout and per-view contracts: see [UI.md](UI.md). This file documents what Extension itself owns.

## Purpose

Extension has two jobs.

**A passive view over the entities that Backend exposes via HTTP.** Here it never writes config, never owns process lifecycle, never re-derives domain rules:

1. Read pointer file → discover Backend port.
2. Pull `/contexts` from Backend.
3. Render two tree views («Все Бизнесы», КОНТЕКСТ) — see [UI.md](UI.md).
4. Open contexts as multi-root VS Code workspaces (clone repos when needed).
5. Provide one editor command: Copy @-Path.

**The keeper of intent windows.** An *intent* is a ticket of a business; it is *active* while a window of the program is open on it. Nothing in Backend or in the tickets records that — the Extension keeps it, with files of its own:

6. Mark each window Duet opened — on an intent or on a business — in `DuetData/intents/` and show them («Активная Работа» view).
7. Show the tickets of the window's business from `work/` and `backlog/` (Корзина view), open an intent from there, move a ticket between the two folders.
8. Build the workspace file of an intent and give its window a colour and a pinned notepad; give the window of a business a colour by the same rules.

This is an experiment (DUE017): only stock side-bar features, no UI of its own. Contracts: [Intents](#intents).

What the Extension still never does: write `settings.json`, `{machine}.json` or a manifest, edit a ticket's `INDEX.md` (it only reads `parent`, `work-type` and `icon` from it), create a ticket folder. Root-context editing, schema migrations, AI client configuration live in Host. Extension's correct response to «I want to add a root context» is to direct the user to the Host wizard.

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
| Backend HTTP API as data source | `DuetApiClient` — all entity data via `/contexts`, `/scan` |
| `ContextEntity[]` sync pattern | Load once on activation, pass to providers, update on refresh. No per-node HTTP calls |
| FileSystem interface (`fs.ts`) | DI for testing without mocks |
| git clone via spawn | System git handles auth (ssh-agent, credential helper) |
| Workspace files | Multi-root workspace for repo + Drive folder |
| Window markers, not ticket fields | Whether an intent is active is a fact about windows of one program on one machine; it lives in `DuetData/intents/<program>/`, never in the ticket on Drive |
| A board of tickets per window, fed by the file events of the business folder | Agents and people change the business folder past the extension, so the folder itself is the source every window shares and its file events are the signal; no message between windows could be. The board (`intents/board.ts`) owns what was read and alone decides when to read; the bin view only shows it. Ticket folders lie on a cloud drive, so nothing is read while the rows are hidden and an event about the shelves costs three `stat` calls |

### Data Sources

Extension does NOT read `settings.json`. Of the configuration it reads only pointer + machine config:

| File | Reader | What Extension uses |
|------|--------|---------------------|
| `~/.org.ve68.duet` | `pointer.ts:readPointer()` | `duetDataPath`, `duetConfigPath`, `machine` |
| `DuetConfig/{machine}.json` | `pointer.ts:readMachineConfig()` | `port` (for backend API) |

It also reads the business folder straight from disk, without Backend:

| What | Reader | What Extension uses |
|------|--------|---------------------|
| `<business>/context.json` | `pathUtils.ts:formatBusinessReference`, `intents/tickets.ts:readBusinessManifest` | `name` (Copy @-Path, window marker), `icon` (intent rows, notepad tab label), `ticket_code` (the number of a new ticket). Read from disk for two reasons: an intent window marks itself before Backend answers, and Backend puts a default icon (`📁`/`📦`) where the manifest has none, while the intent rule is «no icon — no emoji» |
| `<business>/work/`, `<business>/backlog/` | `intents/tickets.ts:TicketReader` | folders right inside them whose name fits the ticket-number rule (`pathUtils.ts:parseTicketFolderName`, the grammar Copy @-Path uses); `archive/` only to find one ticket by number and to collect the numbers a new ticket must stay clear of (`TicketReader.allNumbers`) |
| Ticket `INDEX.md` | `TicketReader` | frontmatter `parent`, `work-type` and `icon` (the ticket's emoji), from the first 2 KB, remembered by the file's mtime and size, with a timeout per file |
| `<business>/.vscode/duet-intents.json` | `intents/binOrder.ts` | order of the bin |
| `DuetData/intents/<program>/` | `intents/markers.ts:MarkerStore` | window markers, order of active intents |
| The window's `workbench.colorCustomizations` | `vscode/intents/IntentsRuntime.ts` | the colour in force, written into the window marker |

All entity data flows from Backend:

| Source | Method | Data |
|--------|--------|------|
| `GET /contexts` | `apiClient.contexts()` | All `context` entities with `absolute_path`, `parent_id`, `meta`, `description`, optional `git_repos` map |
| `POST /scan` | `apiClient.scan()` | Triggers backend rescan |
| `POST /deploy-instructions` | `apiClient.deployInstructions(paths)` | Asks backend to deploy the `skills`/`instructions` of the window's business into its Drive folder. Fire-and-forget |

`ContextEntity[]` (from `/contexts`) is kept in memory and feeds both views, «Все Бизнесы» and КОНТЕКСТ. Both rebuild on workspace folder change (no HTTP) and reload on `duet.refresh`.

**Root context configuration is Host-only.** Extension intentionally has no add/remove/reorder commands and no write path to `settings.json` or `{machine}.json` (see /spec/PRODUCT.md → File Ownership). All edits go through the Host wizard.

### Data Flow

```
activation → apiClient.contexts() → ContextEntity[] → ContextTreeProvider («Все Бизнесы» view)
                                                    → ContextProvider     (КОНТЕКСТ view)

refresh    → apiClient.scan()
           → apiClient.contexts() → updateContexts() on both providers
```

Both providers are synchronous wrappers around a snapshot:

- **«Все Бизнесы» view** (`ContextTreeProvider`) works over `ContextEntity[]` — the full list of contexts loaded once on activation. Each entity carries `meta`, `git_repos` (`Record<alias,url> | null`), and `parent_id`; role differences (meta / root / has git products / regular) are derived from these fields rather than from a `type` enum. A context has git products iff `git_repos` has one or more aliases; it may still have nested Drive child contexts.
- **КОНТЕКСТ view** (`ContextProvider`) works over the same `ContextEntity[]` and the window's folders; the tree is built by the pure function `core/tree/contextPanel.ts:buildContextPanel`. Which business is current and what the panel shows: [UI.md → КОНТЕКСТ](UI.md).

**Tree order:** owned by Backend's `/contexts` response (see /spec/PRODUCT.md → Invariants). `core/tree/contextTree.ts` is a passive view that preserves API order and never re-sorts.

## Surface

### Tree Views

| View ID | Provider | Data source | Renders |
|---------|----------|-------------|---------|
| `duet.intents` (Активная Работа) | `IntentsProvider` | window markers of the program (`MarkerStore`) | Flat list: business windows, then active intents of every business in the order set by dragging; each row in the colour of its window |
| `duet.bin` (Корзина) | `BinProvider` | ticket folders of the window's business + markers | Tickets from `work/` and `backlog/` by container; a ticket with an open window is in the colour of that window |
| `duet.contexts` (Все Бизнесы) | `ContextTreeProvider` | `apiClient.contexts()` (`ContextEntity[]`) | Full forest of root contexts and descendants. A context is highlighted when its own folder is among the window's folders |
| `duet.context` (КОНТЕКСТ) | `ContextProvider` | the same `ContextEntity[]` | Venture → current business → businesses directly under it. No business folder in the window → single info node |

Per-view rendering rules (icons, decorations, accordion behavior) live in [UI.md](UI.md).

### Commands

#### `duet.openFolder` — open a context

Every context is opened through a workspace file Duet writes for it; there is one path, and repos only add folders to it.

| Step | Action |
|------|--------|
| 1 | Clone every `git_repos` alias that is missing into `paths.reposPath/<alias>.git` (nothing to do for a context without repos) |
| 2 | Write `DuetData/workspaces/<context>.code-workspace`: the Drive folder, then one folder per alias — a context without `git_repos` gets a file of one folder — then, for a meta business, its additional folders; plus the `settings` block with the window colour |
| 3 | Open the file |

Until 0.0.48 a context without `git_repos` was opened as a plain folder and only a context with repos got a file. That was a defect, not a design: a window opened as a folder has no file of Duet's, so it could not carry a colour, and the same business behaved differently only because of whether it declared repos. The one case left where the folder is opened directly is a context whose name cannot be a file name (`isSafeRepoName`).

For any context whose manifest declares `reference_repos`, missing clones are fetched into `paths.reposPath/<name>.git` before the folder/workspace is opened. Clone failure or user cancel aborts the open — an unreachable repo must be removed from the manifest before the context can be opened. Alias names are validated against path traversal (`isSafeRepoName`).

**Git clone UX:**
- `withProgress` notification (cancellable).
- Output to "Duet Git" channel.
- `git clone --progress -- <url> <target>` — the `--` separator disarms URLs that begin with `-`. Built by `buildGitCloneArgs`.
- Finalize pattern: single `resolved` flag prevents duplicate logs on cancel/error/close race.

Implementation: `vscode/commands/openFolder.ts`, `core/workspace.ts`.

#### Intent commands

All hidden from the Command Palette (`commandPalette: when: false`): they act on a row or belong to a view's title.

| Command | Where | Action |
|---------|-------|--------|
| `duet.intents.refresh` | «Активная Работа» title | Re-read the window markers |
| `duet.intents.switch` | click on an «Активная Работа» row — and nowhere else | Bring the window of the row forward (see [Switching](#switching-to-a-window)). The bin never switches: it is for managing the backlog and the order |
| `duet.intents.switchByNumber` | Cmd+1 … Cmd+9 (macOS), `when: duet.hasPointer`; hidden from the Command Palette | The same switch for the row that shows this number in «Активная Работа» now (`intents/active.ts:rowByNumber`); the digit comes as the `args` of the keybinding. An extension's keybinding outranks the editor's own for the same keys, so these replace «focus editor group N»; the user's own keybindings still outrank them |
| `duet.intents.newTicket` | «Активная Работа» title, `when: duet.ready` | Ask for a name, create the next ticket of the window's business in `work/` and open its window (see [New ticket](#new-ticket)) |
| `duet.bin.refresh` | Корзина title | Re-read the business folders |
| `duet.bin.openHere`, `duet.bin.openNew` | inline on a bin ticket without an open window | Open the intent in the current / a new window — the same two buttons, icons and window behaviour as `duet.openInCurrentWindow` / `duet.openInNewWindow` for a business |
| `duet.bin.toBacklog` | inline on a bin ticket from `work/` without an open window | Move the ticket folder to `backlog/` |

`duet.intents.*` are registered as soon as the pointer is read; `duet.bin.*` after Backend has answered, with the rest of the backend-dependent commands — and `duet.intents.newTicket` with them: its button is in the «Активная Работа» title, but the business it needs comes from Backend, so the button is hidden until `duet.ready`. Bin commands run one at a time, and a command of a row first finds its ticket on disk by number (`intents/tickets.ts:resolveTicketNow`): a row is what the board read last, and no action runs on a stale path. Implementation: `vscode/commands/intents.ts`.

#### `duet.copyAtPath` — copy `@`-reference

User-facing command in the Explorer right-click menu (group `6_copypath`). Copies the resource as an alpha path in the first form that applies: inside a ticket folder — the short ticket form `` `@<ticket>/<relative-to-ticket>` ``; inside a business — `` `@<business name>/<relative>` `` through the nearest `context.json`; otherwise (repos under DuetData) — `` `@<rootFolder>/<relative>` ``.

Examples: `packages/host/spec/COMPONENT.md` inside the `Duet.git` workspace folder copies as `` `@Duet.git/packages/host/spec/COMPONENT.md` ``; `DuetLab/work/DUE009_AlphaPaths/Решения.md` copies as `` `@DUE009/Решения.md` ``; `!СЕМЬЯ/ЗОЖ/план.md` copies as `` `@СЕМЬЯ/ЗОЖ/план.md` ``.

**Why it exists:**
1. **Multi-root disambiguation.** Native VS Code Copy Relative Path strips the workspace root, so `packages/host` could come from any open folder. Including the root folder name removes that ambiguity.
2. **Matches Duet's `@`-style.** Throughout Duet, paths relative to a context folder are written with a leading `@` and the context name as the first segment. Reusing this syntax keeps a single visual convention across hand-written notes, AI prompts, and Explorer-copied references.

**Decisions:**

| Decision | Rationale |
|----------|-----------|
| Business head = `name` from the nearest `context.json` (walking up from the resource itself) | Alpha paths use the business name as Duet registers it, not the folder name (DUE009, decision В3): the folder `!СЕМЬЯ` is the business `СЕМЬЯ`, and `@!СЕМЬЯ/…` would not resolve. The nearest business wins, so a file of `Duet` inside `DuetLab` copies as `@Duet/…`. Read straight from disk, no Backend call; a manifest without a non-empty `name` is skipped |
| Fallback head = `path.basename(workspaceFolder.uri.fsPath)` | For resources outside any business — repos under `DuetData/repos` (`@Duet.git/…`), whose dir name is their alpha-path head. Falls back to `folder.name` for filesystem roots where basename is empty |
| Inside a ticket → `` `@DUE009/<rest>` `` | The short form stays valid when the ticket moves between `work/`, `backlog/` and `archive/`; the long `@DuetLab/work/DUE009_…/` breaks. The ticket is the outermost folder matching `^[A-Z]{3}(\d{3}\|[A-Z]\d{2})(_\|$)` below a `work`/`backlog`/`archive` folder (any grouping depth, e.g. `archive/2026/09/`), the same grammar Backend's `resolve_paths` resolves. Pure path logic, no Backend call; whether the business has declared its `ticket_code` yet is `resolve_paths`' concern (it tells the agent which line to add) |
| Forward slashes always | The `@`-reference is platform-agnostic; `formatAtReference` normalizes `\` → `/` |
| Empty relative → `` `@<root>` `` | When the resource IS the workspace root, trailing `/` dropped |
| No success notification | Native Copy Path is silent; multi-select would otherwise spam toasts |
| Multi-select: newline-joined | Matches native Copy Relative Path. VS Code Explorer passes `(resource, resources)` |
| Resources outside workspace: skip with warning | Single aggregated warning (`+N more`). Clipboard receives the resolvable subset; if nothing resolves, clipboard untouched |
| Hidden from Command Palette | Command needs a resource argument — no useful effect from palette (`commandPalette: when: false`) |
| `when: workspaceFolderCount > 0` | Hides menu in single-file windows |
| Keybinding `Cmd+Shift+C` (mac) / `Alt+Shift+C` (win/linux) | Active in either Explorer tree or editor. Resolves target via `activeTextEditor`. Folders out of reach for keybinding — use right-click menu |
| Registered before pointer guard | Works even when Duet Host is not configured |

**Known limitation:** for resources outside any business (the basename fallback), two workspace folders with the same basename give the same `@<name>/...`. No detection — user expected to keep root basenames unique.

Pure logic: `core/pathUtils.ts:formatTicketReference(absolutePath)` (ticket form or `null`), then `formatBusinessReference(absolutePath, readText)` (business form or `null`; file reading injected), then `formatAtReference(rootName, relativePath)`. Shell: `vscode/commands/copyAtPath.ts`.

### Workspace Files

Generated artifacts:

| Workspace | Location | When Generated | Folders |
|-----------|----------|----------------|---------|
| `{Context}.code-workspace` | `DuetData/workspaces/` | On open of any context | Drive folder of the context first, then one folder per `git_repos` alias (relative `../repos/<alias>.git`, declared order preserved); a context without repos — the Drive folder alone. Assembly is hardcoded **context-first** — the Drive folder is always the primary/first folder. **Meta business** (`meta: true`): after its own folder and repos come the folders of all the other ventures, in tree order, then `DuetData` as a named folder (`core/workspace.ts:metaExtraFolders`, absolute paths). The condition is the flag, not a name; the file keeps its usual address and everything else about the business is unchanged. The ventures are taken from the loaded tree, so opening needs no backend call |
| `<context>/.kimi-code/local.toml` | context Drive folder | Same write as `{Context}.code-workspace` | Kimi Code multi-root workaround: Kimi's VS Code extension sees only the primary folder, so the cloned repos are written as `[workspace] additional_dir` (absolute paths, declared order), followed by the additional folders of a meta business. Duet-managed, rewritten wholesale; machine-specific — not for VCS. **Known limitation:** the file lives in the Drive-synced context folder, so on a multi-machine setup (e.g. Mac + Windows) the synced absolute paths are wrong on the other machine — no workaround; the real fix is multi-root support in Kimi's VS Code extension ([MoonshotAI/kimi-code](https://github.com/MoonshotAI/kimi-code), `apps/vscode`, MIT) |
| `{Ticket folder}.code-workspace` | `DuetData/workspaces/{Business}/` | On open of an intent by button | The same folders as the business window: the business folder (absolute), then one per `git_repos` alias (relative `../../repos/<alias>.git`), then the additional folders of a meta business. Carries a `settings` block. A separate builder — `core/intents/workspaceFile.ts`; see [Intent workspace file](#intent-workspace-file). Does not write `.kimi-code/local.toml` |

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
| Repo paths | Relative from `workspaces/` (one per `git_repos` alias) |
| Drive path | Absolute (not portable) |
| Context-workspace builder | `core/workspace.ts:writeContextWithReposWorkspace(name, aliases, drivePath)` |

Folder order is hardcoded **context-first**: the Drive folder is always emitted first, then the cloned repos in `git_repos` declared order. The builder takes no ordering argument. The first folder in a VS Code multi-root workspace is the default cwd for terminals and the anchor for file pickers — keeping the Drive folder first makes it the terminal default. Single entry point — no separate single-repo variant and no folder-only variant. A context without `git_repos` produces a 1-folder workspace; one alias — two folders; two aliases — three; etc.

**Alias safety:** aliases originate from user-authored manifest JSON. Before opening a context with `git_repos`, `openFolder.ts:findUnsafeAliases` checks every alias in both `git_repos` and `reference_repos`; if any name fails `isSafeRepoName` (path separators, dots-only, control characters, leading dot), the open is **aborted** with a user-visible error — no clone, no workspace file.

## Behaviors

### Backend Health Monitoring

Host owns the full backend lifecycle (start, stop, health). Extension is a pure consumer:

| Step | What |
|------|------|
| 1. Read pointer | `readPointer()` → `duetDataPath`, set `duet.hasPointer` |
| 2. Read port | `readPort()` → port (default 19680), create `DuetApiClient` |
| 3. Set initializing | `duet.initializing=true`, `duet.ready=false` → spinner |
| 4. Load contexts | `apiClient.contexts()` |
| 5. Register providers | Create and register all tree providers |
| 6. Set ready | `duet.ready=true`, `duet.initializing=false` → main views appear |

**On failure** (no pointer, no port, backend offline):
- `duet.ready=false` → status view shows "Установите и запустите Duet Host".
- User clicks "Перезагрузить окно" → `workbench.action.reloadWindow`.

The intents runtime starts before this sequence, right after the pointer is read: the window's marker, then the «Активная Работа» view. It needs only `duetDataPath`, so with Backend offline the side bar shows «Активная Работа» above the status view. The Корзина view and its commands are registered in step 5.

**Contracts:**
- No spawn, no venv, no install — all managed by Host.
- Single check on activation (no polling, no retry command).
- `duet.ready=true` set AFTER providers registered (prevents "no data provider" flash).
- Backend-independent command `openDataFolder` works regardless of backend state.

### Deploy Instructions Trigger

Extension asks Backend to deploy the instruction components of the window's business (skills / instructions) into its Drive folder via `apiClient.deployInstructions(workspacePaths)`. The call is **debounced** (500ms) and **fire-and-forget** — warnings/errors are logged to the "Duet Backend" output channel, never surfaced as blocking UI. Backend is idempotent and serializes concurrent calls per context.

Fires on:
- **Activation** — after the contexts load, with the current workspace folder paths.
- **`onDidChangeWorkspaceFolders`** — with the new folder paths.
- **`duet.refresh`** — after the rescan.

Implementation: `vscode/extension.ts` (`triggerDeployInstructions`).

### Intents

An intent is a ticket of a business: a folder right inside `work/` or `backlog/` whose name fits the ticket-number rule. It is active while a window of this program is open on it; close the window and the intent is paused. Tickets carry no field for that. Pure logic: `core/intents/`; wiring: `vscode/intents/`, `vscode/providers/IntentsProvider.ts`, `vscode/providers/BinProvider.ts`, `vscode/commands/intents.ts`. What the user sees: [UI.md](UI.md).

#### Window markers

An intent window is a window opened by a workspace file Duet built for a ticket — `DuetData/workspaces/<business>/<ticket folder>.code-workspace` (`intents/window.ts:intentWindowOf`). The ticket is known by its number; where its folder lies now is a field of the marker, not part of the definition.

A business window writes a marker too, so «Активная Работа» lists it. It is recognised in two ways: by a workspace file lying right in `DuetData/workspaces/` (`intents/window.ts:businessWindowOf`) — how a business with repos is opened — or, in a window without a workspace file, by a `context.json` with `version` and `name` in its first folder — a business folder opened directly: by Duet before 0.0.48, or by hand. Such a window is listed and can be switched to, but has no colour until the business is opened by button. The key of a business among the markers is `@<name>` (`businessKey`); a ticket number never starts with `@`. A business opened both ways shares one key and one row.

| Rule | Why |
|------|-----|
| File per process: `DuetData/intents/<program>/windows/<key>-<pid>.json`, `<key>` = ticket number or `@<business>`, `<pid>` = extension host of the window | One ticket may be open twice (a window from «Recent», a conflict copy); with a file per ticket the first window to close would erase the other's marker |
| `<program>` = `vscode.env.uriScheme` (`vscode`, `vscodium`, `cursor`, …); a window reads and writes only the folder of its own program | Each program has its own windows, colours and order. Between programs the rule is «whoever acts is right»: no window checks another program before acting |
| Written first in `activate`, before anything waits on Backend; removed in `deactivate` with a synchronous unlink | A window started while Backend is down must not look closed, or its workspace file would be rebuilt under it. The extension host is shut down right after `deactivate`, an async unlink may not finish |
| Content: `subject` (`intent` or `business`), the key (field `ticket`), ticket folder name, business name, path and emoji, the ticket's emoji (`ticketIcon`: its own `icon`, else the nearest one up its `parent` chain — `tickets.ts:TicketReader.inheritedIcon`), what opening again brings the window forward (workspace file, or the folder of a business opened as a folder), where the ticket lies (`work`/`backlog`/`archive`/`missing`), colour in force, pid, time of the write | Everything the «Активная Работа» view shows — icon, name, colour — comes from markers alone, so it needs no Backend. A marker without `subject` and `ticketIcon` (written by 0.0.44) reads as an intent without an own emoji |
| Dead marker: its process is gone, or it was written before the last system boot. Any reader removes it | A crashed window cannot clean up; after a reboot a pid may belong to another process |
| On window focus, on a change of `workbench.colorCustomizations` and on a file event of the business folder the window checks its marker and writes it again when it is gone or no longer true | Restores a marker removed from outside; keeps the colour honest; a ticket moved to the backlog or the archive shows its new place in every window without waiting for its own window to be focused |
| Reservation `<key>-<pid>.reserve.json`, written by the window where «open» was clicked (an intent in Корзина, a business with repos in «Все Бизнесы»), with the chosen colour; counts for 30 s or until the real marker of the ticket appears; its pid is not checked | Between the click and the start of the new window the intent would look closed and its colour free. «Open in the current window» ends the process that wrote it |
| One watcher on `intents/<program>/` with `**/*.json`; the folder is created before the watcher; every event leads to one re-read of the whole folder, debounced 100 ms | Markers lie in the `windows/` subfolder, which a plain `*.json` does not see. The same watcher carries `active.json`, so an order changed in one window changes in the others at once |
| A row stays 1.5 s after its marker is gone (`intents/active.ts:applyLinger`) | A window reload removes the marker and writes a new one; without the delay the row would blink |

(The word «pointer» is taken by `~/.org.ve68.duet`; this thing is a *window marker*.)

#### Switching to a window

The API has no call that brings another window forward. Switching is opening the intent's workspace file again with `vscode.openFolder` — the call a business is opened with: the program brings forward the window that already has the file. Checked on VS Code 1.140: no second window opens with either value of `forceNewWindow`. The command passes `forceNewWindow: true`, so that if no window has the file after all, a new one opens instead of the current window being replaced.

#### Intent workspace file

`DuetData/workspaces/<business>/<ticket folder>.code-workspace`. The path does not change when the ticket moves between `work/`, `backlog/` and the archive, so the window, its colour and its tabs survive every move; nothing is left in the ticket or on Drive. Renaming the ticket folder gives a new file (and loses the remembered colours) — not handled.

| Rule | Why |
|------|-----|
| Duet owns the whole file: rebuilt on every open of the intent by button, and after the rebuild it holds nothing but what Duet writes now. Only the remembered colours survive | One canon for all intents; a hand edit is not a setting |
| Never written while a window has it open: a ticket with a live marker is switched to, not rebuilt | Rewriting the settings of a living window would recolour it under the user |
| Deterministic text, written only when the bytes differ, through a temporary file and a rename | No needless write; DuetData is a local disk |
| Folders: the business folder (absolute path of this machine), then `../../repos/<alias>.git` per `git_repos` alias. A business without repos gives a file of one folder. Missing repos are cloned first, exactly as for a business (`openFolder.ts:prepareBusinessRepos`) | The window shows the same folders as the business window |
| File absent → first open. File present but unreadable → opened as it is, with one line of notice | A rebuild would roll the intent's main colour again |
| Read as JSON with comments (`core/jsonc.ts`) | That is the dialect of `.code-workspace` |
| `duet.intent.canon` — version of what Duet writes (now `4`: since `2` the colour block also sets the selection of lists, since `3` the backdrop of highlighted text, since `4` the tab label carries the intent's emoji, not always the business's). A file with a newer version is opened as it is | Several programs carry their own installed Duet; two versions must not rewrite the file after each other |
| `duet.intent.colors` — the colours the intent remembers, main first. Absent key and a palette colour in the file → that colour is the main one | Files of older builds keep their colour |
| Both keys are declared in `contributes.configuration` | Otherwise VS Code marks them as unknown settings |

`settings` of the file, for ticket `DUE017_IntentSwitcher` of a business with icon 🚀:

```json
"settings": {
  "workbench.editor.customLabels.patterns": { "**/DUE017_IntentSwitcher/notepad.md": "🧰 Intent Switcher" },
  "symbols.files.associations": { "notepad.md": "sanity", "INDEX.md": "text", "AGENDA.md": "notebook" },
  "workbench.editor.pinnedTabsOnSeparateRow": true,
  "workbench.editor.showTabIndex": true,
  "workbench.colorCustomizations": {
    "titleBar.activeBackground": "#1f6f43", "titleBar.activeForeground": "#ffffff",
    "statusBar.background": "#1f6f43", "statusBar.foreground": "#ffffff",
    "titleBar.inactiveBackground": "#1f6f43", "titleBar.inactiveForeground": "#ffffff",
    "list.activeSelectionBackground": "#1f6f43", "list.activeSelectionForeground": "#ffffff",
    "list.focusOutline": "#1f6f43",
    "list.filterMatchBackground": "#1f6f4333"
  },
  "duet.intent.colors": ["#1f6f43"],
  "duet.intent.canon": 4
}
```

The colour block (`workspaceFile.ts:windowColorBlock`) is everything in the window that carries its colour. A workspace file cannot aim at one view, so each colour acts in every list of the window — which is the point: the window is painted, and everything in it is in its colour.

| What | Colour | Shade |
|------|--------|-------|
| Title bar, status bar | background | the window colour itself — the dark version, under white text |
| Selection of lists: the saturated fill of the selected row while its list has the focus; the outline of the focused row | background, outline | the dark version, white text. The pale selection of a list without focus stays the theme's |
| Backdrop of highlighted text in lists: the name in this window's own row of «Активная Работа» and in the row of its ticket in Корзина; a match found by typing in any tree | background | the light version — the window colour at one fifth strength (`colors.ts:backdropColor`). Its outline is left to the theme |

The light version is the colour with transparency, not a fixed light colour: over a light side bar it gives a light tint, over a dark one a dark tint, and over the selection in the same colour it vanishes, so the text on it is readable in every case. The shades are held by tests (`intentWorkspaceFile.test.ts`, «readability of the window colours»): contrast of text against what lies behind it, for all eight colours on the side-bar backgrounds of the stock light and dark themes — at least 4.5 everywhere, 3.5 for the one case of this window's own row on a light theme, where the text and its backdrop are two shades of one colour. The activity bar is not coloured.

**Business workspace file.** `DuetData/workspaces/<business>.code-workspace` keeps its folders (`../repos/<alias>.git`) and its `.kimi-code/local.toml` exactly as before, and gains a `settings` block of three keys: the colour block above, `duet.intent.colors` and `duet.intent.canon` (`workspaceFile.ts:planBusinessColor`). The colour is chosen on every open of the business by button, by the same rules as for an intent, and held by a reservation. When a window already has the file open, the file is written back with the colour block it has — folders are refreshed, a living window is never recoloured. A business without repos has the same file with one folder, and so the same colour rules. Without the intents runtime the file is written without a `settings` block, folders only. A program still on 0.0.44 that opens the business strips the block; the next open by a newer version rolls the main colour again.

**Intent name** (`intents/naming.ts`, one function for the view rows, the tab label and the notepad heading): the ticket folder name without the number; underscores become spaces, a space goes where PascalCase starts a word, by Unicode case — `IntentSwitcher` → «Intent Switcher», `UIResearch` → «UI Research», `DuetWork2` → «Duet Work2», `DuetWork_Full` → «Duet Work Full». The emoji of an intent is one wherever the intent is shown — its row in «Активная Работа» and the tab label of its notepad (`naming.ts:intentIcon`): the ticket's own `icon`; else the one of its nearest parent ticket that has one; else `icon` of the business's `context.json`; none of the three — no emoji. The tab label is written into the workspace file, so it takes the emoji the ticket has when the intent is opened by button.

**Window colour** (`intents/colors.ts`), eight colours that carry white text: `#1f6f43`, `#1f4f8f`, `#6b3fa0`, `#1f7a7a`, `#5a6a1f`, `#8f4a1f`, `#8f1f3f`, `#8f1f7a`. «Taken» means held by an open window of this program (markers and reservations).

1. First open: a random colour among those not taken; remembered as the main one.
2. Later opens use the main colour.
3. Main colour taken by another window → a spare, chosen the same way and remembered; two spares at most. The main colour stays the main one.
4. All three taken → a random free colour, not remembered.
5. More windows than colours → a random one among those met least often among the open windows; not remembered.

#### Bin: the board of tickets

The tickets of the business, the order and the rows built from them are held by one object per window — the board, `core/intents/board.ts:TicketBoard`. Корзина shows the board and reads no disk itself; the bin commands act through it. Shared state of windows is built the same way in both views — a folder on disk, a watcher on it, one joined reading (`intents/coalesce.ts`), a word to the view — and kept in two places on purpose: what is open is a fact about a machine and a program and lies in DuetData; where tickets lie is a fact about the business and lies in its folder.

| Rule | Why |
|------|-----|
| The signal that the tickets changed is a file event of the business folder (`vscode/intents/boardWatch.ts`): `{work,backlog}/*`, `.vscode/duet-intents.json`, `{work,backlog}/*/INDEX.md` | A ticket is archived, created, renamed or given another `parent` by an agent or by hand, past the extension; another window or program writes the order. A reading asked for by the commands of one window would never reach the others |
| The kind of an event is not looked at, only where it happened | A file written again may come as a create or a rename (checked on Google Drive for desktop, macOS) |
| Events within 300 ms give one answer. For the shelves and the order file the answer is three `stat` calls — `work/`, `backlog/`, the order file — and a reading only when they differ from the last one; for an `INDEX.md` it is a reading | A folder's modification time changes when a ticket comes or goes, not when a file inside a ticket changes. The stamps are how a move made by this window, which the command has already read, is not read a second time when its event comes |
| While the rows are hidden an event costs nothing; showing them reads the folders | Every window of the business gets every event; only the ones that show the bin read |
| A reading is two folder listings and a `stat` per ticket; file content is read only for an `INDEX.md` that changed (`TicketReader`) | The folders are on a cloud drive |
| Listeners are told only when what was read differs from what they have | No redraw, and no blink, for an event that changed nothing shown |
| The file events are the only signal: the board is not asked to look again when the window gets the focus | Decided by Andrei, 2026-10-05: such a check would hide an event that never came. Whether events arrive for changes brought by cloud sync from another machine is not verified; the refresh button of the view is there for that case |
| An intent window checks its own marker on the same kind of events, by a watcher of its own on the business folder of the window (`IntentsRuntime.watchOwnTicket`, gathered over 500 ms): the manifest, two folder listings and the emoji chain are read, and the marker is written only when it is no longer true | Where the ticket lies and its emoji are fields of the marker; they follow the folder, not the next focus of the window. The watcher belongs to the runtime, not to the board: the marker must be true without the backend and whatever business the bin shows |
| A command that changed the business folder has the board read at once | Its own window shows the result without waiting for the event |

The rows are redrawn through one gate: tree refreshes that come within 25 ms are sent as one, because two refreshes a few milliseconds apart make VS Code ask for the children of rows the second one has already replaced («No tree item with id …» in the extension host log). A window opening or closing only redraws the rows.

The order of the bin is `<business>/.vscode/duet-intents.json` — one flat list of ticket numbers per business, so it is the same for every program and machine. The order inside any group is the relative order of its numbers in the list; a list per parent would break when a ticket changes its parent. The containers — processes and programs — take their order among themselves from the same list. Written only by dragging: the first drag in a group lists all its visible rows as shown (`intents/order.ts:mergeOrderBlock`); opening and closing a window never write it. Read together with the folders; only this exact file name is read, so conflict copies are harmless; an unreadable file leaves the last order read well, and that order is then not written back — a drag is refused in one line before anything is moved, or an older order would replace the newer one in the file. Numbers found in the archive are dropped from the list on write. The file lies on Drive: written in place by a single write.

#### New ticket

`duet.intents.newTicket` (`vscode/commands/intents.ts:BinActions.create`, decisions in `intents/newTicket.ts`). The business is the one of the window, as in Корзина; a window without a business refuses in one line.

| Behavior | Why it matters |
|----------|----------------|
| The only question is the name, in an input box. Escape cancels; Enter on an empty box goes on with no name | One gesture. The number is Duet's to give, never the user's to type |
| Name → folder name by `pascalCaseName`: only letters and digits stay, everything else ends a word (an apostrophe is dropped without ending it), and in text typed together a word starts where `spaceIntentName` sees one; each word gets a capital first letter and small letters after it. `ui research`, `UI research` → `UiResearch`; `IntentSwitcher` → `IntentSwitcher`, `UIResearch` → `UiResearch`; `синхронизация корзины` → `СинхронизацияКорзины`; no transliteration. The price of finding words in text typed together: a capital after a single small letter starts a word, `iPhone` → `IPhone`. At most 100 letters and digits — the input box refuses more | One strict rule gives one name however the text was typed, and the folder name and the readable name made from it agree on the words. A slash or a dot cannot make a nested or hidden folder. The folder name also names the workspace file of the window, so it must stay a possible file name |
| Number: the code from `ticket_code` of the business's `context.json`, then one above the highest three-digit number among all tickets of `work/`, `backlog/` and `archive/` (`TicketReader.allNumbers`, to the depth `findInArchive` reads). Programs (`X`) and processes (`A`) are not counted. No `ticket_code` — refusal in one line that names the field. A folder that is there but cannot be read — a cloud drive may fail so — is an error and nothing is created | The archive holds numbers too; counting the shelves alone would hand out a taken one, and so would counting a shelf that failed to read as empty |
| The folder is `work/<number>_<Name>`, or `work/<number>` without a name, made without `recursive`: a folder of the very same name that appeared meanwhile is never written into — the command fails and the next click takes the next number | A new ticket never lands inside an existing one |
| Nothing holds the number between counting and creating, and there is no shared counter. After creating, the number is looked up again: when another folder carries it too — an agent or another window took it in the same moment — one line names both folders and no window is opened | A clash is rare and can be fixed by hand, but only when it is seen; opening by number would otherwise bring the other ticket's window forward |
| `INDEX.md` is written into it: `folder-type: work`, `work-type: project`, `opened:` the local day, empty `business-area` and `parent`, and a heading. When the write fails, the error says that the folder stays | Without it the ticket has no type in Корзина, and an agent cannot tell a fresh ticket from one that lost its map |
| Then the ticket is opened in a new window by the same path as «open in a new window» of a bin row; the board reads the folders before that, and also when creating failed. The notepad is made by that window at its start. When the window could not be opened, one line says that the ticket exists and where | One way to open an intent; the notepad belongs to the window. A ticket made without a window must not go unnoticed |
| Runs in the queue of the bin commands; the name is asked before it takes its turn. A business whose name cannot be a file name is refused before the question; when the business of the window changed while the name was being typed, one line says so and nothing is created | No interleaving with a move or a drop, and an open input box holds up nothing |

#### Notepad

In an intent window, and only there, at start (`vscode/intents/notepad.ts`, decisions in `intents/notepad.ts:planNotepadFix`):

| Rule | Why |
|------|-----|
| No `notepad.md` right in the ticket folder → created with `# DUE017 · Intent Switcher · Notepad` and an empty line. The ticket folder itself is never created | The notepad is part of the intent's window |
| File present: no level-one heading as the first line → added; a wrong one → replaced, its text kept on the next line as a quote `> …`; a right one → the file is not touched | The heading names the intent in the tab; the user's own heading is not lost |
| A wrong heading of the shape `# <number> · … · Notepad` — one Duet wrote — is replaced without a quote | Otherwise quotes pile up with every rename of the ticket |
| The first line is looked for after the frontmatter, which counts only when line one is exactly `---` and a closing `---` follows; empty lines before the heading are skipped | A notepad may carry metadata |
| The edit goes through the editor's document and is saved; a notepad with unsaved changes is left alone this time | Writing the file past an open editor would fight the user's unsaved text |
| Then, unless a pinned tab with the notepad exists, it is opened and pinned, and the tab that was active becomes active again | The notepad must not take the user out of the chat |
| Pinning happens at most once per window session: `vscode.env.sessionId` is kept in `workspaceState` | The extension may restart inside a living window; pinning again would undo the user's choice to unpin or close, which holds until the window starts again. Checked on VS Code 1.140: `sessionId` survives an extension-host restart and changes on a window reload |

### Tree Decorations

`TreeDecorationProvider.ts` is a `FileDecorationProvider`: a row names an address as its `resourceUri`, and the provider answers with the colour of the row's text. Registered at the start of activation, before Backend is asked for anything — «Активная Работа» needs it with Backend down.

| URI Scheme | Format | Decoration |
|------------|--------|------------|
| `duet-tree` | `duet-tree:/separator/<index>` | `disabledForeground` colour — separator rows of «Все Бизнесы» read as gaps |
| `duet-tree` | `duet-tree:/intent-color/<colour id>/<key>` | the colour of a window — rows of windows in «Активная Работа», rows of tickets with an open window in Корзина |

A decoration can name a colour only by a theme colour id, never by its hex value, so the eight colours of the palette are declared in `contributes.colors` as `duet.intent.color1` … `duet.intent.color8` (`intents/colors.ts:intentColorId`): in light themes the palette colour itself, in dark themes a lighter shade of it. The colour is a function of the address alone: a window that changes its colour gives its rows a new address, so no change event is needed. A row with a `resourceUri` must carry an icon of its own, or the tree draws a file icon from the icon theme; the intent views give every row an icon picture (`vscode/providers/rowLook.ts`, `intents/rowIcon.ts`) — the emoji drawn as a 16-pixel SVG, or an empty one. The user setting `explorer.decorations.colors` switches these colours off, as it does everywhere.

«Все Бизнесы» does not use the colour decoration — its node labels carry their own emoji-based status (see UI.md).

`NotepadDecorationProvider.ts` is a second `FileDecorationProvider`, for one real file: in an intent window the name of its own `notepad.md` — on the tab, and wherever else the editor lists the file — takes the colour of the window, from the same declared colours and by the same rule «the colour in force now»; a change of the window colour is told to the editor through `onDidChangeFileDecorations`. Only the notepad of the ticket the window is opened on, never its folder (`propagate: false`), and nothing in a business window. The editor gives a single file only the colour of its name; a tab's background can be set only per state of the tab, the same for every file of the window.

## Engineering

### Build & Release

Per-package pipeline (full release contract: see /spec/PRODUCT.md → Pre-commit Verification):

```bash
npm run vsix   # bump + build + package → dist/duet-{version}.vsix
```

`build-vsix.js`: bump patch → update UI title → esbuild --production → vsce package. The built VSIX is then copied into `DuetData/` (release rule in [PRODUCT.md → Pre-commit Verification](../../../spec/PRODUCT.md#pre-commit-verification)).

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
| Context tree logic («Все Бизнесы» view) | `core/tree/contextTree.ts` |
| КОНТЕКСТ view | `vscode/providers/ContextProvider.ts` |
| КОНТЕКСТ tree shape, current business | `core/tree/contextPanel.ts` (`buildContextPanel`, `findCurrentBusiness`) |
| Sidebar state (context keys) | `core/sidebar-state.ts` |
| Workspace generation | `core/workspace.ts` (`writeContextWithReposWorkspace`) |
| Copy @-path command | `vscode/commands/copyAtPath.ts`, `core/pathUtils.ts` (`formatTicketReference`, `formatBusinessReference`, `formatAtReference`) |
| Intent name, row text, notepad heading | `core/intents/naming.ts` (`rowText`) |
| Intent and business window by workspace-file path, business key, program folder name | `core/intents/window.ts` |
| Row icon picture, row colour address | `core/intents/rowIcon.ts`, `vscode/providers/rowLook.ts` |
| The runtime for commands registered apart from it | `vscode/intents/current.ts` |
| Window markers, reservations, order of active intents | `core/intents/markers.ts` (`MarkerStore`, `splitMarkers`) |
| Active windows from markers, their order, row text, linger | `core/intents/active.ts` (`orderActive`, `reorderActive`, `activeRowText`) |
| Window colour, theme colour ids | `core/intents/colors.ts` (`chooseIntentColor`, `intentColorId`) |
| Intent workspace file, colour block, colour of a business window | `core/intents/workspaceFile.ts` (`planIntentWorkspace`, `windowColorBlock`, `planBusinessColor`), `core/jsonc.ts` |
| Ticket folders, frontmatter, move between shelves, `context.json` icon | `core/intents/tickets.ts` (`TicketReader`, `resolveTicketNow`, `moveTicketFolder`, `readBusinessManifest`) |
| Bin layout and drop decision | `core/intents/binTree.ts` (`buildBinTree`, `decideBinDrop`) |
| Remembered order (both views) | `core/intents/order.ts`, `core/intents/binOrder.ts` |
| Notepad heading decision | `core/intents/notepad.ts` (`planNotepadFix`) |
| Intents state of a window (own marker, watcher) | `vscode/intents/IntentsRuntime.ts` |
| «Активная Работа» / Корзина views | `vscode/providers/IntentsProvider.ts`, `vscode/providers/BinProvider.ts` |
| Board of tickets, its watcher, joined readings | `core/intents/board.ts`, `vscode/intents/boardWatch.ts`, `core/intents/coalesce.ts` |
| Intent commands | `vscode/commands/intents.ts` (`BinActions`, `switchToIntent`) |
| Notepad at window start | `vscode/intents/notepad.ts` |
| Tree decorations (separators, window colours) | `vscode/providers/TreeDecorationProvider.ts` |
| Colour of the notepad's name on its tab | `vscode/providers/NotepadDecorationProvider.ts` |
| Accordion controller | `core/tree/AccordionController.ts` |
| Entity types in Extension | `core/api-client.ts` → `ContextEntity` type |
