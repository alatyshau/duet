# Host

Electron tray app that writes pointer file, deploys backend and AI instructions to DuetData, and configures AI clients.

> Shared model (pointer file format, DuetData, DuetConfig): see [/spec/PRODUCT.md](/spec/PRODUCT.md)
>
> See also: [UI.md](UI.md)

## Domain

### Role in Ecosystem

Host is the **only writer** of the pointer file. Extension and Backend only read it. See PRODUCT.md -> Pointer File.

### AppState

Single source of truth for application status.

| Status | Condition |
|--------|-----------|
| `no_config` | Pointer file missing, or any of 3 required fields empty |
| `path_lost` | All fields present, but `duetDataPath` or `duetConfigPath` doesn't exist on disk |
| `ready` | All fields present AND both directories exist |

**Derivation:** `checkAppState()` reads pointer -> checks fields -> checks `existsSync()` -> returns status.

### AppState Extended Fields

Beyond core status/path fields, AppState exposes machine config values needed by wizard pages:

| Field | Source | Purpose |
|-------|--------|---------|
| `pythonPath` | `{machine}.json` | Python interpreter path (step 3) |
| `instructionsPath` | `{machine}.json` | Duet-Instructions repo path (step 6) |
| `hasDevBackendPath` | `{machine}.json` | Controls DEV/PROD toggle visibility (step 4) |

### Config Interface

```typescript
interface Config {
  machine?: string
  duetDataPath?: string
  duetConfigPath?: string
}
```

Operations:
- `readConfig()` — reads pointer file, returns `{}` if missing or broken
- `writeConfig(config)` — writes pointer file (JSON, 2-space indent)
- `getConfigFile()` — returns pointer path (`DUET_CONFIG_FILE` env overrides for tests)

### Single Instance

Host uses Electron `requestSingleInstanceLock()`. Second instance shows window of the first and exits.

## Layers

| Layer | Responsibility | Files |
|-------|----------------|-------|
| `shared/` | Types crossing process boundary (IPC) + pure mappers | `types.ts` (single source of truth), `mappers.ts` |
| `core/` | Config, app state, deploy, backend, AI clients, instructions, instructions download, root contexts, schema migrations, atomic JSON IO, wizard status, app registry | `config.ts`, `app-state.ts`, `deploy.ts`, `backend.ts`, `ai-clients.ts`, `instructions.ts`, `instructions-download.ts`, `root-contexts.ts`, `schema-migrations.ts`, `json-io.ts`, `wizard-status.ts`, `apps.ts` |
| `platform/` | Tray, autolaunch | `tray.ts`, `autolaunch.ts` |
| `main/` | Window, IPC handlers, lifecycle | `index.ts`, `window.ts`, `ipc-handlers.ts` |
| `preload/` | Bridge main <-> renderer | `index.ts`, `index.d.ts` |
| `renderer/` | React UI | `App.tsx`, `pages/wizard/*.tsx` (7 wizard steps), `pages/apps/BackendAppPage.tsx`, `components/` |

## Engineering Principles

| Principle | Rule |
|-----------|------|
| **Thin shell** | `main/`, `platform/`, `preload/` — only wiring. All non-trivial logic lives in `core/`. If logic in shell grows beyond a one-liner -> extract to `core/`. |
| **No framework imports in core/** | `core/` has zero Electron imports. Testable with plain Node.js. |
| **Shared types** | `shared/types.ts` — single source of truth for all types crossing process boundary (IPC). Core modules re-export from shared. No type duplication. |
| **Unit tests for core/ only** | Don't mock Electron. Test pure `core/` functions directly. Shell is validated by TypeScript + E2E. |
| **Pure functions over state** | Prefer pure functions with explicit args over closures capturing module state. Makes testing trivial. |
| **Spec-driven** | Code + spec changes go in same commit. Read `spec/` before changes, update after. |

## AppState Machine

```
+----------------+
|   no_config    | <- pointer missing OR fields incomplete
+-------+--------+
        | user fills all 3 fields
        v
+----------------+
|     ready      | <- both paths exist on disk
+-------+--------+
        | folder deleted/moved
        v
+----------------+
|   path_lost    | <- fields set but paths don't exist
+----------------+
```

**deployChannel:** AppState includes `deployChannel: 'dev' | 'prod'` (default `'prod'`). Read from `{machine}.json`. Controls whether deploy uses bundled resources (`prod`) or dev override paths (`dev`).

Implementation: `core/app-state.ts:checkAppState()`

## Deploy Service

Deploys backend from bundled resources to DuetData.

| Component | Source (extraResources) | Target | Method |
|-----------|------------------------|--------|--------|
| Backend | `backend/` | `DuetData/backend/` | Atomic swap (filtered) (.new -> rename -> .old -> delete) |

AI instructions are user-owned (separate git repo, configured via `instructionsPath` in machine.json). Host does not deploy them.

**Deploy filter:** Copy operations exclude dev artifact directories: `.venv`, `__pycache__`, `.pytest_cache`, `node_modules`, `.git`. This prevents copying dev environment into DuetData when deploying from source (`devBackendPath`).

**Deploy channel:** When `deployChannel === 'dev'` in `{machine}.json`, deploy uses `devBackendPath` from machine config instead of bundled resources. Toggle via IPC `config:set-deploy-channel`.

**Version comparison:** Uses `compareSemver(appVersion, deployed)` — strips build metadata per semver spec before comparing. Deploy only when app version is newer (not on downgrade or same version).

**PROD deploy guard:** When `deployChannel === 'prod'` and Electron is not packaged (`!app.isPackaged`), deploy checks if bundled backend exists. If not -> throws human-readable error: "PROD-деплой недоступен в dev-режиме. Соберите приложение или переключитесь на DEV." Prevents cryptic "Backend source not found" errors in development.

**Flow:** PROD guard -> VERSION check (semver) -> skip if not newer -> **stop backend** (POST /stop -> SIGTERM -> SIGKILL) -> deploy backend (atomic swap) -> Python check -> venv + pip -> write VERSION (only on full success).

**VERSION file:** `DuetData/backend/VERSION` contains version with build metadata:

| Channel | Format | Example |
|---------|--------|---------|
| PROD | `{semver}+prod_{sha}` | `0.1.8+prod_abc1234` |
| DEV | `{semver}+dev_{timestamp}` | `0.1.8+dev_2604041330` |
| Fallback | `{semver}` | `0.1.8` (no BUILD_SHA, dev electron) |

SHA (PROD): `git rev-parse --short HEAD` at build time → `resources/BUILD_SHA` → baked into bundle. Timestamp (DEV): `YYMMDDHHMM` at deploy time.

VERSION is NOT written if any step fails (Python not found, pip failed, etc.).

**Deploy warning** (`isDeployWarning`): channel-aware staleness check for tray icon.
- PROD: warns on dev version deployed, SHA mismatch, or semver upgrade needed
- DEV: warns on prod version deployed, semver change, or source .py files newer than deploy timestamp
- Backward compatible: plain semver (no metadata) falls back to semver-only check

**Backend stop before deploy:** `stopBackend(port, proc)` — POST `/stop` (2s timeout) -> SIGTERM -> SIGKILL fallback. Errors don't abort deploy (backend may not be running).

**Pure functions (extracted from Electron shell):**
- `resolveDeployStatus(appState, appVersion, activeStatus)` -> DeployStatus — used by IPC handler `deploy:get-status`
- `isDeployWarning(appState, appVersion, buildSha?, devBackendPath?)` -> boolean — used by `main/index.ts` for tray icon
- `parseVersionMeta(version)` -> VersionMeta — parse `semver+channel_identifier`
- `readBuildSha(resourcesPath)` -> string | null — read bundled BUILD_SHA
- `formatDeployTimestamp(date?)` / `parseDeployTimestamp(ts)` — YYMMDDHHMM format
- `isSourceNewer(dirPath, since)` -> boolean — check if .py files changed after deploy (DEV mode)

Implementation: `core/deploy.ts`

## Backend Lifecycle

Host is the single owner of backend process lifecycle (start, stop, health monitoring).

**Start:** `startBackend(duetDataPath, port)` — spawn venv Python with `server.py`, detached + stdio: 'ignore' + unref. Poll `/health` until ready. Kill process if health check fails after all retries.

**Stop:** `stopBackend(port, proc?, opts?)` — graceful: POST `/stop` -> wait -> SIGTERM -> SIGKILL. No PID file — uses process reference from `startBackend`. Never throws (backend may not be running).

**Health:** `checkHealth(port)` — GET `/health` with 2s timeout. Returns `{version, uptime}` or null.

**Status:** `getBackendStatus(duetDataPath, port)` -> `BackendStatus` (stopped | starting | running | stopping | error).

**File watcher:** `main/index.ts` watches `DuetData/data/` via `fs.watch` (debounce 500ms). Detects external changes (Backend CLI scan/merge) and triggers `updateAppState()` → tray icon refresh. Lifecycle managed by `updateAppState()`: starts when `duetDataPath` appears, restarts on path change, retries when `data/` directory appears after deploy. Stopped on quit. Non-critical: silently handles missing directory or watch errors.

**Auto-start on startup:** When `status === 'ready'` and VERSION file exists (`readDeployedVersion() !== null`) -> `ensureBackendRunning()`. Deploy warnings (channel mismatch, stale version) do NOT block auto-start — backend is functional with warnings.

**Auto-scan on startup:** After backend auto-start succeeds, if `root_context_folders` is non-empty and `readCachedScan()` returns `null` (scan never ran) -> `triggerScan(port)`. Populates sidebar status for step 5 without manual visit.

**Auto-merge instructions on startup:** After backend auto-start and auto-scan, if `instructionsPath` is configured and `readCachedErrors()` returns `null` (merge never ran) -> `triggerMerge()` -> `configureAllAgents()` on success. Both auto-scan and auto-merge finish with a single `updateAppState()` call.

**Auto-start after deploy:** `runDeploy()` calls `startBackend()` after writing VERSION.

**Stop on quit:** `before-quit` handler calls `ensureBackendStopped()` with re-entrance guard.

**Concurrent start guard:** In-memory `isStarting` flag in `ipc-handlers.ts` prevents race between auto-start and user click (single-instance lock guarantees one Host process).

**IPC push:** `backend:status-changed` broadcasts `BackendStatus` during start/stop operations.

Implementation: `core/backend.ts`

## AI Clients

Detects and configures AI clients via direct file writes (no CLI). Backend produces one merged file per agent declared in `index.json.agents` (e.g. `DuetData/duet-executor.md`, `DuetData/duet-vizir.md`). Host reads them and deploys per platform.

| Client | Config files | What |
|--------|-------------|------|
| Claude Code | `~/.claude/output-styles/duet-executor.md` | Executor merged content as output style (system prompt) — frontmatter `name: duet-executor`, `keep-coding-instructions: true` |
| Claude Code | `~/.claude/agents/duet-executor.md` | Executor as custom subagent (kebab-case `name`, separate frontmatter without `keep-coding-instructions`) |
| Claude Code | `~/.claude/agents/duet-vizir.md` | Vizir as custom subagent |
| Claude Code | `~/.claude/settings.json` | `outputStyle: "duet-executor"` |
| Claude Code | `~/.claude.json` | MCP server (mcpServers.duet, HTTP) |
| Codex | `~/.codex/duet_instructions.md` | Host-managed instructions file |
| Codex | `~/.codex/config.toml` | `model_instructions_file` + `[mcp_servers.duet]` |
| Antigravity | `~/.gemini/GEMINI.md` | Host-managed instructions file |
| Antigravity | `~/.gemini/antigravity/mcp_config.json` | MCP server (mcpServers.duet, HTTP) |

**Platform asymmetry:** Custom subagents are deployed only for Claude Code. Codex and Antigravity use one instructions file.

**Host knows two agents:** the deployment logic is hard-coded for `executor` and `vizir` (`MergedAgents = { executor, vizir }`). Backend (`merge_duet_instructions`) accepts any agent set declared in `index.json.agents`, but additional agents would be merged to disk and ignored by host. If/when a third agent is added, host needs to be extended to read the agent set dynamically from the backend response.

**Pattern:** read per-agent merged content from disk (`DuetData/duet-{agent}.md`) -> detect (config dir exists?) -> configure (write files) -> show result. Not found = info, not error. Content not generated = MCP configured, instructions skipped (needs_setup).

**Content freshness (per-file):** for each Claude Code file, detect compares the on-disk content against the expected wrapper (frontmatter + body) for that file. Output style and each custom agent have **different** frontmatters wrapping (potentially) different bodies — staleness in any one file flips its `checkedFile.ok` to `false`.

**Issues:** `AgentIssue[]` — actionable problems beyond basic config (e.g. `additionalDirectories` in Claude Code settings.json). Each issue has `reason_code`, `description`, `fixable`. Fix via `fixAgentIssue(agentId, reasonCode)`.

**additionalDirectories check:** Claude Code settings.json may contain `additionalDirectories` which pollutes VS Code multi-root workspace, breaking orientation. Detect reports issue with `reason_code: "additional_directories"`, fixable by removing the key.

**Legacy uborka:** `cleanupLegacyClaudeFiles(duetDataPath)` removes pre-multi-agent artifacts (`~/.claude/output-styles/duet.md`, `~/.claude/agents/duet.md`, `DuetData/duet-instructions.md`). Idempotent. Does **not** touch user-personal `~/.claude/agents/vizir.md` or any non-Duet files. Currently held behind a manual gate — runs only after end-to-end verification of new layout (see migration plan).

Implementation: `core/ai-clients.ts`

## Instructions

Manages merged AI instructions lifecycle. Backend generates per-agent `DuetData/duet-{agent}.md` via `POST /merge-duet-instructions`.

**Operations:**
- `triggerMerge(port)` — calls Backend endpoint, returns `InstructionsMergeResult` (`{ status, paths: { agent → path }, errors }`)
- `readMergedAgent(duetDataPath, agent)` — reads one agent's merged file from disk; returns `null` if missing
- `readMergedAgents(duetDataPath)` — reads both agents into a `MergedAgents` bag (`{ executor, vizir }`)
- `readCachedErrors(duetDataPath)` — reads errors from `DuetData/data/duet-instructions-errors.json`
- `fixInstructionsError(instructionsPath, relativePath, reasonCode)` — auto-fix source file (add/replace frontmatter, add missing fields). Returns true if fix applied.
- `isFixableError(reasonCode)` — check if error can be auto-fixed. Fixable: `no_frontmatter`, `invalid_yaml`, `missing_fields`.

Implementation: `core/instructions.ts`

## Instructions Download

Downloads Duet-Instructions template from GitHub for onboarding (users without existing instructions).

**Operations:**
- `downloadInstructionsTemplate(targetFolder)` — fetches zip from GitHub (`/archive/refs/heads/main.zip`), extracts to targetFolder. Uses global `fetch` (Chromium network stack in Electron ≥28 — proxy, redirects). Extraction: `unzip` on macOS, `tar -xf` on Windows. No new dependencies.
- `isFolderEmpty(folderPath)` — checks if folder is empty, ignoring system files (.DS_Store, Thumbs.db, desktop.ini, .gitkeep). Returns true for non-existent folders.

Does NOT set `instructionsPath` — that's the caller's responsibility (renderer calls `setInstructionsPath` + `mergeInstructions` after successful download).

Implementation: `core/instructions-download.ts`

## Root Contexts

Manages root-context folder configuration (stored in `DuetConfig/settings.json` under
`root_context_folders`). A root context is a top-level folder in the user's bounded-context tree;
zero or one of them may be marked `meta: true` in its `context.json` (e.g. `!БАЗА`).

**Operations:**
- `getRootContextFolders()` — read raw `root_context_folders` (list of `@aliases`) from `settings.json`
- `getResolvedRootContextFolders()` — same, but each entry is `{raw, resolved, isMeta}` (resolves `@alias` via `{machine}.json` and reads `context.json/meta` flag for each folder)
- `addRootContextFolder(absolutePath)` — alias-aware add. Validates pointer (`duetConfigPath`, valid `machine`) and throws if missing. Creates `@<basename>` alias in `{machine}.json` (suffix `_2`, `_3` on collision; reuses if path already aliased). Appends alias to `root_context_folders` in `settings.json`. Calls `enforceMetaInvariant` after the append — when the list was empty, the new folder becomes meta automatically; otherwise the existing first stays meta. The IPC handler runs a scoped schema-migration sweep on the new folder to upgrade legacy `business.json/stream.json/product.json` and self-heal a missing manifest.
- `resolveAliasPath(raw, machineConfig)` — resolves a `root_context_folders` entry: passes absolute paths through; looks up bare `@alias`; for `@alias/sub/path` splits, resolves alias, and joins the rest via `path.join`. Returns `null` when alias is missing — caller is responsible for surfacing as warning (see `getResolvedRootContextFolders` `unresolved: true`).
- `saveRootContextFolders(folders)` — overwrite full `root_context_folders` array (used by reorder/remove). Throws if `settings.json` missing or invalid (no silent recreate that would lose `timestampTZ`). Calls `enforceMetaInvariant` afterwards so drag-to-position-0 and removing the current meta both atomically swap the meta flag on disk.
- `enforceMetaInvariant(folders)` — restores the invariant «position 0 = meta-context». Idempotent on already-correct state. Tolerant: folders whose `context.json` is unparseable are skipped (the migration sweep already surfaces them as per-context errors). For atomicity when two manifests need to flip simultaneously, the function stages both `.tmp` files first and then renames in sequence; on a rename failure, earlier renames are rolled back from a backup of the previous content, so the disk never settles with «two metas» or «no metas» between successful invocations.
- `normalizePath(p)` — NFC + strip trailing separators. Cross-platform: NFC fixes macOS NFD from native dialogs, on Windows is a no-op (NTFS already NFC). All path comparisons (alias reuse, dedup) and stored paths in `{machine}.json` go through this helper.
- `triggerScan(port)` — calls Backend `POST /scan`, returns `ScanResult` with errors
- `readCachedScan(duetDataPath)` — reads cached `DuetData/data/scan.json`. Used by main process for wizard status without IPC.
- `readCachedContexts(duetDataPath)` — reads entity tree from `DuetData/data/contexts.json`. Returns `ContextsCache` with flat entity list (build tree via `parent_id`).

**Meta required (invariant):** When `root_context_folders` is non-empty, the context at position 0 has `meta: true` in its `context.json`, and no other listed context does. Semantically the meta-context is the **management layer above other contexts** — a single container for the user's top-level data spanning every domain context (personal task DB, ontology, AI instructions). Three mechanisms maintain the invariant:
1. `addRootContextFolder` — adding the first folder auto-promotes it to meta. Adding to a non-empty list keeps the existing first as meta.
2. `saveRootContextFolders` — after reorder, drag-to-position-0 swaps meta to the new first; after delete of the current meta, the new first inherits meta.
3. Startup migration — `runMigrationsNow` calls `enforceMetaInvariant` after the manifest walk, so manual edits to `settings.json` or `context.json` files are normalised on the next Host start. Skipped when per-context errors are present (the user fixes those first).

Drag-to-position-0 is the only UX mechanism for switching meta. The crown icon on `DuetPathsPage` is a read-only indicator of position 0 — not toggleable, no click handler, no `root-contexts:set-meta` IPC. Direct re-meta would create rule-bypass paths that disagreed with the saved order.

**Other invariants:**
- `root_context_folders` in `settings.json` always contains `@aliases` (never absolute paths) — required for cross-machine sync via Drive.
- All path comparisons go through `normalizePath` so NFC/NFD and trailing-separator differences never produce false-distinct paths.

Implementation: `core/root-contexts.ts`

## Schema Migrations

Host owns auto-upgrade of all on-disk Duet schemas (settings.json, `{machine}.json`, context manifests).
Backend is a strict v2 reader — it never mutates files, never migrates. See unification design §6.

**Module:** `core/schema-migrations.ts`. No Electron imports — testable with plain Node.

**Schema specs:**
| Schema | File(s) | v1 → v2 transform |
|--------|---------|-------------------|
| `settings` | `settings.json` | rename key `business_folders → root_context_folders`, add `version: 2`. Other keys preserved. |
| `machine` | `{machine}.json` | add `version: 2`. No field renames. |
| `context` | `business.json` / `stream.json` / `product.json` → `context.json` | rename file to `context.json`; rename field `root → meta` (only when `root: true`); add `version: 2`. Legacy file deleted after successful write. Other fields (`name`, `icon`, `git_url`, `reference_repos`, `description`, unknown keys) preserved. |

**Triggers:**
1. **Host startup** — full sweep before backend spawn. Order: settings → machine → manifests under each root context. If settings or machine produces a critical error, the manifest walk is skipped and backend does not spawn.
2. **`config:save-pointer`** with `duetConfigPath` or `machine` change → full sweep (settings/machine of new path may be legacy or future-version).
3. **`root-contexts:add`** → full sweep (idempotent on already-v2 settings/machine; manifest walk picks up legacy/future files inside the new folder, self-heals on empty folder).
4. **DuetConfig file watcher** — `main/index.ts` watches `duetConfigPath` for changes to `settings.json` and `{machine}.json` (debounce 500ms). On any change, runs the full sweep so a runtime corruption (user edit, Drive sync overwrite) escalates to the same critical-banner mechanism that protects startup, without rewriting the many `readConfig` callers.

**Critical gate:** `MigrationResult.critical` is non-null iff the pointer file, `settings.json`, or `{machine}.json` is corrupted (`invalid_json`/`read_failed`) or future-version (`version > MAX_SUPPORTED`). While critical:
- `ensureBackendRunning` refuses to start the backend, broadcasts `BackendStatus { state: 'error', error: <description> }`.
- `backend:start` IPC throws.
- DuetPathsPage renders a blocking error banner with the file path. Title and recovery hint branch on `reason_code` and `file`: "Update Duet" for `future_version`; "Restore from backup or delete" for `invalid_json` on the pointer; "Repair manually" for `invalid_json` on settings/machine.
- Auto-start on whenReady is skipped.

**Per-context errors:** all rendered red on DuetPathsPage — every per-context code marks data corruption (the affected context is unreachable until the user repairs it). Backend still spawns; the offending context's manifest is silently ignored by Backend (`unrecognized_manifest_version` log entry). All reason codes share severity `error`:

| reason_code | Meaning |
|-------------|---------|
| `future_version` | `context.json` is `version > MAX_SUPPORTED`. Backend will skip this context. |
| `invalid_json` | `context.json` is broken JSON or has missing/non-int `version`. File untouched. |
| `migration_failed` | Legacy → v2 migration could not complete (rare; usually IO error mid-write). |
| `unresolved_alias` | `root_context_folders` entry references an `@alias` that's not registered in this machine's `{machine}.json` — folder cannot be located. |

**Atomic write:** `atomicWriteJson(path, data)` (in `core/json-io.ts`) writes `{path}.tmp` then `rename()`. On POSIX `rename(2)` is atomic on the same filesystem; a crash mid-write leaves either the original file or the new one — never a half-written file. For legacy → context migration the order is: write `context.json` → delete legacy. A crash between leaves both files; orphan resolution on the next sweep handles them.

**All Host-owned JSON writes go through `atomicWriteJson`:** pointer file (`writeConfig`), settings.json (`setSettingsConfigKey`, `ensureConfigDefaults`), `{machine}.json` (`setMachineConfigKey`, `ensureConfigDefaults`), context manifests (migration + self-heal). `enforceMetaInvariant` adds a two-phase commit on top — both manifests are staged as `.tmp` first, then renamed in sequence with rollback-on-failure — to keep the meta-required invariant from observably breaking mid-swap. Same crash-safety contract whether the write originates in startup migration, a wizard click, or the runtime config watcher.

**Pointer integrity:** `readPointerStrict()` distinguishes `missing` (legitimate first-run) from `invalid_json` / `read_failed` (recoverable corruption). Startup migration calls it before `readConfig()`'s graceful `{}` fallback would mask a corrupt pointer as no-config. A corrupt pointer surfaces as a `MigrationCriticalError { file: 'pointer' }` and blocks backend spawn until the user either restores the file or deletes it (then onboarding proceeds clean).

**Orphan resolution (context.json + legacy file coexist):** `context.json` wins, the legacy is removed without comparison (design §7). The earlier equivalence-aware variant (rename to `<name>.legacy-conflict.json` + warning) was overengineering for a single-machine install — the multi-machine Drive-sync race it protected against isn't a scenario Duet ships for today. Decision recorded in `stabilize-taxonomy-migration` (rename-taxonomy saga).

**Recursion rules** (mirror backend scanner):
- Skip directories starting with `.` (`.git`, `.venv`, etc.).
- Stop recursion at folders with `git_url` in their manifest (terminal context).

**Forward-incompatibility handling:** A future Duet version that bumps schema to v3 leaves the v2-aware Host with `version > MAX_SUPPORTED`:
- Settings/machine → critical → backend blocked → user updates Duet.
- Context manifest → per-context warning → backend skips that context only.

**No rollback:** First Host startup on an upgraded machine rewrites every legacy manifest in place. Original filename (`business/stream/product.json`) cannot be reconstructed from a v2 file. A pre-upgrade backup is recommended for users with significant data; Host does not back up automatically.

**Multi-machine sync caveat:** Drive sync between an upgraded and not-yet-upgraded machine briefly produces files at higher version on the older machine. Forward-incompatibility handling above keeps both machines safe (no corruption, no infinite loops); the older machine just shows error UI until updated.

**IPC:**
| Channel | Direction | Purpose |
|---------|-----------|---------|
| `migrations:get-status` | renderer → main | Get cached `MigrationResult` from last sweep |
| `migrations:status-changed` | main → renderer | Pushed after each sweep (startup + scoped triggers) |

Implementation: `core/schema-migrations.ts`, wired in `main/index.ts:runMigrationsNow` and `main/ipc-handlers.ts`.

## IPC Channels

| Channel | Direction | Purpose |
|---------|-----------|---------|
| `app:get-state` | renderer -> main | Get current AppState |
| `app-state-changed` | main -> renderer | Push state updates |
| `dialog:select-folder` | renderer -> main | Open system folder picker |
| `dialog:select-file` | renderer -> main | Open system file picker |
| `config:save-pointer` | renderer -> main | Save pointer file (all 3 fields) |
| `shell:open-path` | renderer -> main | Open path in Finder/Explorer |
| `config:set-deploy-channel` | renderer -> main | Set deploy channel (dev/prod) in machine config |
| `config:set-instructions-path` | renderer -> main | Save instructionsPath to machine.json |
| `deploy:get-status` | renderer -> main | Get deploy status (idle/up_to_date/deploying/etc.) |
| `deploy:start` | renderer -> main | Start deploy (async) |
| `deploy:status-changed` | main -> renderer | Push deploy status updates |
| `deploy:log` | main -> renderer | Push deploy log messages |
| `python:detect` | renderer -> main | Auto-detect Python 3.10+ (checks saved path first) |
| `python:validate` | renderer -> main | Validate a specific Python path |
| `python:save` | renderer -> main | Save pythonPath to machine.json |
| `backend:get-status` | renderer -> main | Get backend status (stopped/starting/running/error) |
| `backend:start` | renderer -> main | Start backend |
| `backend:stop` | renderer -> main | Stop backend |
| `backend:status-changed` | main -> renderer | Push backend status updates |
| `agents:detect` | renderer -> main | Detect installed AI clients |
| `agents:configure` | renderer -> main | Configure all AI clients |
| `agents:fix-issue` | renderer -> main | Fix specific agent issue (by agentId + reasonCode) |
| `instructions:merge` | renderer -> main | Trigger POST /merge-duet-instructions (writes per-agent merged files in DuetData) |
| `instructions:get-errors` | renderer -> main | Read cached instruction errors |
| `instructions:fix-error` | renderer -> main | Auto-fix instruction error (by relativePath + reasonCode) |
| `instructions:download-template` | renderer -> main | Download Duet-Instructions zip from GitHub, extract to targetFolder |
| `instructions:is-folder-empty` | renderer -> main | Check if folder is empty (ignoring system files) |
| `root-contexts:get` | renderer -> main | Get resolved root contexts (raw alias + absolute path + isMeta) |
| `root-contexts:save` | renderer -> main | Overwrite root_context_folders array in settings.json (used by remove/reorder); after save, enforces meta-required invariant so drag-to-position-0 and removing the current meta atomically flip the meta flag on disk |
| `root-contexts:add` | renderer -> main | Alias-aware add: creates `@<basename>` in `{machine}.json`, appends to `root_context_folders`, runs scoped schema migration, enforces meta-required invariant |
| `root-contexts:scan` | renderer -> main | Trigger POST /scan |
| `root-contexts:get-cached-scan` | renderer -> main | Read cached scan.json from DuetData/data/ |
| `root-contexts:get-cached-contexts` | renderer -> main | Read cached contexts.json (entity tree) from DuetData/data/ |
| `migrations:get-status` | renderer -> main | Get cached `MigrationResult` from last schema-migration sweep |
| `migrations:status-changed` | main -> renderer | Push fresh `MigrationResult` after each sweep |

**Contract:** `config:save-pointer` supports partial updates — missing fields are preserved from existing config. Creates default DuetConfig files only when both `duetConfigPath` and `machine` are present (`ensureConfigDefaults`). Calls `updateAppState()`, returns new AppState. `deploy:start` runs async deploy, broadcasts status + log events. `config:set-deploy-channel` writes `deployChannel` to `{machine}.json`, calls `updateAppState()`, returns new AppState. `config:set-instructions-path` validates machine config is writable (throws if DuetConfig/machine not configured). `agents:configure` and `agents:fix-issue` call `updateAppState()` after mutations to refresh tray icon.

**Config defaults:** `ensureConfigDefaults(duetConfigPath, machine)` — creates `settings.json` (`{ version: 2, root_context_folders: [], timestampTZ: { id: "Z", value: "UTC" } }`) and `{machine}.json` (`{ version: 2, port: 19680 }`) only if files don't exist. Never overwrites. Implementation: `core/config.ts`.

**Machine config write:** `setMachineConfigKey(key, value)` — read-modify-write single field in `{machine}.json`. Throws if pointer is incomplete, machine name is invalid, or the file is missing/contains invalid JSON. `setSettingsConfigKey(key, value)` mirrors this contract for `settings.json`. Both functions used to silently recreate the file from `{}` on missing/corrupt input — that path is removed because it lost sibling fields (`timestampTZ`, `port`, `instructionsPath`); failures now surface to the UI so the user can re-run wizard step 1 (`ensureConfigDefaults`) to recover. Implementation: `core/config.ts`.

## Pages

### Wizard Pages (Settings tab)

6 self-contained pages in `pages/wizard/`. Each manages its own state, calls `window.api` directly, and reports status via `onStatusChange` callback to App.tsx.

| # | Page | File | Key operations |
|---|------|------|----------------|
| 1 | Duet: пути | `DuetPathsPage.tsx` | DuetData/DuetConfig folder pickers, machine name input, root contexts add/remove/reorder/set-meta, schema-migration status banner |
| 2 | Python 3.10+ | `PythonPage.tsx` | Auto-detect on mount, manual file picker, `savePythonPath` |
| 3 | Backend | `BackendPage.tsx` | Deploy status/button, channel toggle (visible when `hasDevBackendPath`), logs |
| 4 | Воркспейсы | `WorkspacesPage.tsx` | Manual Scan button, entity tree, error table |
| 5 | Инструкции | `InstructionsPage.tsx` | Two states: onboarding (download template / pick existing folder) and configured (path display, Regenerate, error table). Auto-configure agents on successful merge |
| 6 | AI Агенты | `AgentsPage.tsx` | Agent detection cards, Configure All, Fix issue buttons |

### BackendAppPage (Apps tab)

Per-application page with process cards. Navigate via sidebar → Приложения → {app name} (route: `app:{app-id}`).

Process card shows: state badge, version, uptime, Start/Stop/Restart buttons. States: stopped, starting, running, stopping, error.

Currently only Duet Backend (builtin, one HTTP process on port 19680). Types: `AppInfo`, `ProcessInfo`, `ProcessStatus` in `shared/types.ts`. Mapper: `backendStatusToProcessStatus()` in `shared/mappers.ts`. Registry: `BUILTIN_APPS` in `core/apps.ts`.

## Behavioral Contracts

| Behavior | Contract |
|----------|----------|
| Window close | Hides window, does NOT quit app |
| First run (no pointer file) | Shows window for onboarding |
| Status `path_lost` | Shows window (needs attention) |
| Status `ready` | Silent in tray, no window |
| Tray icon | Severity-based: error (red dot, non-template on macOS), warning (template), normal |
| macOS Dock | Hidden by default, visible when window shown |
| Second instance | Shows window of first instance, second exits |
| Production | Cmd/Ctrl+R reload disabled |

## Development

```bash
npm run dev   # electron-vite dev — запускает Vite dev server + Electron
```

Electron GUI требует доступ к оконной системе macOS. AI-агенты: запускать с `dangerouslyDisableSandbox: true` (sandbox блокирует GUI-процессы).

## Build & Release

> Full pipeline: see [/spec/PRODUCT.md](/spec/PRODUCT.md) -> Build & Release

```bash
npm run release [-- --mac|--win|--linux]   # default: --mac
```

`build-release.cjs`: bump patch -> write `resources/BUILD_SHA` (git short SHA) -> `electron-vite build` -> `electron-builder` -> `dist/Duet-{version}.dmg`

| Tool | Role |
|------|------|
| electron-vite | Bundle main/preload/renderer |
| electron-builder | Platform installer (DMG/NSIS/AppImage) |

Config: `electron-builder.yml`
- appId: `org.ve68.duet`
- macOS: DMG, no code signing, no notarize
- Windows: NSIS installer
- extraResources: `resources/` (tray icons), `backend/`

CI: `build-host.yml` builds all 3 platforms on push to main (if `packages/host/` changed).

## Testing

```bash
npm run test:run     # vitest (unit)
npm run typecheck    # tsc
```

| Suite | Files | What |
|-------|-------|------|
| Unit | `__tests__/unit/core/`, `__tests__/unit/shared/`, `__tests__/unit/renderer/` | core-flow, config, app-state, deploy, backend, apps, ai-clients, instructions, instructions-download, root-contexts, schema-migrations, wizard-status, mappers, navigation |
| E2E | Disabled (CI) | WebdriverIO, monorepo symlink issues |

### Testability

| Module | Testable without Electron |
|--------|--------------------------|
| `core/config.ts` | Yes — pure fs, env override via `DUET_CONFIG_FILE` |
| `core/app-state.ts` | Yes — pure functions, depends only on config + fs |
| `platform/tray.ts` | No — requires Electron (manual testing) |
| `main/window.ts` | No — requires Electron |

## Severity Framework

Единая модель статусов на все 4 уровня UI: страница → sidebar → таб → tray.

### Severity — два уровня серьёзности

`Severity = 'error' | 'warning'` — first-class type in `shared/types.ts`.

| Severity | Meaning | Examples |
|----------|---------|---------|
| `error` | Cannot function, needs action | Step not configured, backend crashed, broken manifests |
| `warning` | Works, but not ideal | Deploy channel mismatch, agent not configured, stale version |

### StatusItem — единица проблемы на странице

```typescript
interface StatusItem {
  severity: Severity        // error | warning
  message: string           // "Python не найден", "Установлена DEV-версия"
  fixable?: boolean         // есть автоматическое исправление?
}
```

Each page produces `StatusItem[]` — single source of truth for all levels above. Rendered via shared `<StatusTable />` component.

### PageStatus — статус страницы

`PageStatus = 'ok' | 'error' | 'warning' | 'skipped' | null`

General model for any page (wizard, apps, future). Derived from page's `StatusItem[]`.

| PageStatus | Sidebar icon | Meaning | Severity at aggregation |
|-----------|-------------|---------|------------------------|
| `'ok'` | Green + checkmark | Page completed correctly | none |
| `'error'` | Red + X | Page has errors | **error** |
| `null` | Hollow gray circle | Not yet configured (blocks user) | **error** |
| `'warning'` | Amber + ! | Page has warnings | **warning** |
| `'skipped'` | Gray + arrows | Not relevant | none |

**Key:** `null` and `error` are visually different in sidebar (gray vs red), but both aggregate as severity `error` to tab and tray.

### Page StatusItem Sources

| Page | Situation | Severity | Message |
|------|-----------|----------|---------|
| 1. DuetData | Path not selected | error | "Выберите папку DuetData" |
| 2. DuetConfig | Path not selected | error | "Выберите папку DuetConfig" |
| 2. DuetConfig | Machine not set | error | "Укажите имя машины" |
| 2. DuetConfig | Invalid machine name | error | "Недопустимое имя: ..." |
| 3. Python | Not found | error | "Python 3.10+ не найден" |
| 3. Python | Version < 3.10 | error | "Python {version} — нужен 3.10+" |
| 4. Backend | Not deployed | error | "Backend не установлен" |
| 4. Backend | Deploy error | error | "{error message}" |
| 4. Backend | Channel mismatch | warning | "Установлена DEV-версия — переустановите для PROD" |
| 4. Backend | Stale version | warning | "Версия устарела — переустановите" |
| 1. Duet paths | Schema migration critical (settings/machine future-version or invalid) | error | "{description}" — backend blocked until resolved |
| 1. Duet paths | Schema migration per-context error | error | "{description}" (one per offending context — all per-context codes are red) |
| 5. Workspaces | Scan error | error | "{description}" (per scan error) |
| 6. Instructions | Path not selected | error | "Выберите папку инструкций" |
| 6. Instructions | Merge error | error | "{description}" (fixable for known types) |
| 7. AI Agents | needs_setup | warning | "{agent}: не сконфигурирован" |
| 7. AI Agents | Issue | warning | "{description}" (fixable issues) |

### Four-Level Aggregation

```
Level 1: Page
  StatusItem[] → rendered via <StatusTable />
       ↓ maxSeverity(items) → PageStatus

Level 2: Sidebar
  PageStatus → page icon (5 variants)
       ↓ pageStatusToSeverity() — null and error both → 'error'

Level 3: Tab
  maxSeverity(all pages) → dot on tab button
  | Severity | Dot     |
  |----------|---------|
  | error    | Red     |
  | warning  | Amber   |
  | null     | Hidden  |

Level 4: Tray
  AppStatus != ready → warning (forced)
  AppStatus == ready → maxSeverity(settingsSeverity, appsSeverity, deploySeverity)
  | Severity | Icon            |
  |----------|-----------------|
  | error    | Red dot         |
  | warning  | Warning template|
  | null     | Normal          |
```

### computePageStatuses

Pure function in `core/wizard-status.ts`. Computes sidebar PageStatus from system state. Used by renderer (App.tsx) and main process (tray).

**Input sources:**
| Pages | Source | PageStatus |
|-------|--------|-----------|
| 1-2 | AppState (duetDataPath, duetConfigPath, machine) | `null` (not configured) or `ok` |
| 3 | AppState (pythonPath from machine.json) | `null` or `ok` |
| 4 | DeployStatus + hasDeployWarning | `null` (not deployed), `warning` (channel mismatch/stale), or `ok` |
| 5 | Cached scan.json (errors count) | `error` (broken manifests) or `ok` |
| 6 | Cached instruction errors (errors count) | `error` (broken files) or `ok` |
| 7 | Agent detection (needs_setup vs configured) | `warning` (works but not configured) or `ok` |

Pages 5-7 also report status dynamically via `onStatusChange` callbacks, which override computed values.

### Key Functions

All pure, in `core/wizard-status.ts`:
- `maxSeverity(severities[])` — pick highest (error > warning > null). Single aggregation primitive for all levels.
- `pageStatusToSeverity(status)` — error→error, **null→error**, warning→warning, ok/skipped→null
- `processStateToSeverity(state)` — error→error, rest→null
- `getSettingsSeverity(statuses)` — aggregate all wizard pages

### Tray Integration

`main/index.ts`:
- `deploySeverity` — from `isDeployWarning()` (VERSION mismatch → warning)
- `settingsSeverity` — from `getSettingsSeverity(computePageStatuses(...))`
- `overallSeverity = maxSeverity([deploySeverity, settingsSeverity])`
- `updateTrayIcon(appStatus, overallSeverity)` — AppStatus != ready forces warning; otherwise uses severity

Implementation: `core/wizard-status.ts`, `platform/tray.ts`

## File Map

Quick lookup for concepts not obvious from file names. For layer responsibilities see [Layers](#layers).

| When you need to find… | Look in |
|------------------------|---------|
| All IPC types (single source of truth) | `shared/types.ts` |
| Severity type, StatusItem, PageStatus | `shared/types.ts` (types), `core/wizard-status.ts` (functions) |
| VERSION metadata parsing + writing | `core/deploy.ts` (parseVersionMeta, writeVersion, readBuildSha) |
| Deploy warning logic (channel-aware) | `core/deploy.ts:isDeployWarning()` |
| Instructions template download | `core/instructions-download.ts` |
| Pointer file path / machine config | `core/config.ts` |
| What triggers tray icon change | `main/index.ts:updateAppState()` |
| How IPC channels are registered | `main/ipc-handlers.ts:setupIpcHandlers()` |
| What renderer exposes to pages | `preload/index.ts` (window.api shape) |
| Page status computation | `core/wizard-status.ts:computePageStatuses()` |
| How pages override computed status | `renderer/src/App.tsx` (pageStatuses + createStatusCallback) |
| Severity icons (unified) | `renderer/src/components/ui/severity-icon.tsx` |
| Status table for pages | `renderer/src/components/ui/status-table.tsx` |
| Tray icon file selection (per platform) | `platform/tray.ts:getTrayIconPath()` |

