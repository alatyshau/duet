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
| `core/` | Config, app state, deploy, backend, AI clients, instructions, business folders, wizard status, app registry | `config.ts`, `app-state.ts`, `deploy.ts`, `backend.ts`, `ai-clients.ts`, `instructions.ts`, `business-folders.ts`, `wizard-status.ts`, `apps.ts` |
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

**Version comparison:** Uses `compareSemver(appVersion, deployed)` — deploy only when app version is newer (not on downgrade or same version).

**Flow:** VERSION check (semver) -> skip if not newer -> **stop backend** (POST /stop -> SIGTERM -> SIGKILL) -> deploy backend (atomic swap) -> Python check -> venv + pip -> write VERSION (only on full success).

**VERSION file:** `DuetData/backend/VERSION` contains `app.getVersion()`. Newer app version triggers deploy. VERSION is NOT written if any step fails (Python not found, pip failed, etc.).

**Backend stop before deploy:** `stopBackend(port, proc)` — POST `/stop` (2s timeout) -> SIGTERM -> SIGKILL fallback. Errors don't abort deploy (backend may not be running).

**Pure functions (extracted from Electron shell):**
- `resolveDeployStatus(appState, appVersion, activeStatus)` -> DeployStatus — used by IPC handler `deploy:get-status`
- `isDeployWarning(appState, appVersion)` -> boolean — used by `main/index.ts` for tray icon

Implementation: `core/deploy.ts`

## Backend Lifecycle

Host is the single owner of backend process lifecycle (start, stop, health monitoring).

**Start:** `startBackend(duetDataPath, port)` — spawn venv Python with `server.py`, detached + stdio: 'ignore' + unref. Poll `/health` until ready. Kill process if health check fails after all retries.

**Stop:** `stopBackend(port, proc?, opts?)` — graceful: POST `/stop` -> wait -> SIGTERM -> SIGKILL. No PID file — uses process reference from `startBackend`. Never throws (backend may not be running).

**Health:** `checkHealth(port)` — GET `/health` with 2s timeout. Returns `{version, uptime}` or null.

**Status:** `getBackendStatus(duetDataPath, port)` -> `BackendStatus` (stopped | starting | running | stopping | error).

**File watcher:** `main/index.ts` watches `DuetData/data/` via `fs.watch` (debounce 500ms). Detects external changes (Backend CLI scan/merge) and triggers `updateAppState()` → tray icon refresh. Lifecycle managed by `updateAppState()`: starts when `duetDataPath` appears, restarts on path change, retries when `data/` directory appears after deploy. Stopped on quit. Non-critical: silently handles missing directory or watch errors.

**Auto-start on startup:** When `status === 'ready'` and deployed (no VERSION mismatch) -> `ensureBackendRunning()`.

**Auto-start after deploy:** `runDeploy()` calls `startBackend()` after writing VERSION.

**Stop on quit:** `before-quit` handler calls `ensureBackendStopped()` with re-entrance guard.

**Concurrent start guard:** In-memory `isStarting` flag in `ipc-handlers.ts` prevents race between auto-start and user click (single-instance lock guarantees one Host process).

**IPC push:** `backend:status-changed` broadcasts `BackendStatus` during start/stop operations.

Implementation: `core/backend.ts`

## AI Clients

Detects and configures AI clients via direct file writes (no CLI). Merged instructions are read from `DuetData/duet-instructions.md` (generated by Backend `POST /merge-duet-instructions`).

| Client | Config files | What |
|--------|-------------|------|
| Claude Code | `~/.claude/output-styles/duet.md` | Merged instructions as output style (system prompt) |
| Claude Code | `~/.claude/settings.json` | `outputStyle: "Duet"` |
| Claude Code | `~/.claude.json` | MCP server (mcpServers.duet, HTTP) |
| Codex | `~/.codex/duet_instructions.md` | Merged instructions file |
| Codex | `~/.codex/config.toml` | `model_instructions_file` + `[mcp_servers.duet]` |
| Antigravity | `~/.gemini/GEMINI.md` | Merged instructions file |
| Antigravity | `~/.gemini/antigravity/mcp_config.json` | MCP server (mcpServers.duet, HTTP) |

**Pattern:** read merged content from disk (DuetData/duet-instructions.md) -> detect (config dir exists?) -> configure (write files) -> show result. Not found = info, not error. Content not generated = MCP configured, instructions skipped (needs_setup).

**Content freshness:** detect compares installed content against `DuetData/duet-instructions.md`. Stale content -> needs_setup.

**Issues:** `AgentIssue[]` — actionable problems beyond basic config (e.g. `additionalDirectories` in Claude Code settings.json). Each issue has `reason_code`, `description`, `fixable`. Fix via `fixAgentIssue(agentId, reasonCode)`.

**additionalDirectories check:** Claude Code settings.json may contain `additionalDirectories` which pollutes VS Code multi-root workspace, breaking orientation. Detect reports issue with `reason_code: "additional_directories"`, fixable by removing the key.

Implementation: `core/ai-clients.ts`

## Instructions

Manages merged AI instructions lifecycle. Backend generates `DuetData/duet-instructions.md` via `POST /merge-duet-instructions`.

**Operations:**
- `triggerMerge(port)` — calls Backend endpoint, returns `InstructionsMergeResult`
- `readMergedInstructions(duetDataPath)` — reads cached file from disk
- `readCachedErrors(duetDataPath)` — reads errors from `DuetData/data/duet-instructions-errors.json`
- `fixInstructionsError(instructionsPath, relativePath, reasonCode)` — auto-fix source file (add/replace frontmatter, add missing fields). Returns true if fix applied.
- `isFixableError(reasonCode)` — check if error can be auto-fixed. Fixable: `no_frontmatter`, `invalid_yaml`, `missing_fields`.

Implementation: `core/instructions.ts`

## Business Folders

Manages business folder configuration (stored in `DuetConfig/settings.json`).

**Operations:**
- `getBusinessFolders()` / `saveBusinessFolders(folders)` — CRUD on `settings.json`
- `triggerScan(port)` — calls Backend `POST /scan`, returns `ScanResult` with errors
- `readCachedScan(duetDataPath)` — reads cached `DuetData/data/scan.json`. Used by main process for wizard status without IPC.
- `readCachedStreams(duetDataPath)` — reads entity tree from `DuetData/data/streams.json`. Returns `StreamsCache` with flat entity list (build tree via `parent_id`).

Implementation: `core/business-folders.ts`

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
| `instructions:merge` | renderer -> main | Trigger POST /merge-duet-instructions |
| `instructions:get-errors` | renderer -> main | Read cached instruction errors |
| `instructions:fix-error` | renderer -> main | Auto-fix instruction error (by relativePath + reasonCode) |
| `business-folders:get` | renderer -> main | Get business_folders from settings.json |
| `business-folders:save` | renderer -> main | Save business_folders to settings.json |
| `business-folders:scan` | renderer -> main | Trigger POST /scan |
| `business-folders:get-cached-scan` | renderer -> main | Read cached scan.json from DuetData/data/ |
| `business-folders:get-cached-streams` | renderer -> main | Read cached streams.json (entity tree) from DuetData/data/ |

**Contract:** `config:save-pointer` supports partial updates — missing fields are preserved from existing config. Creates default DuetConfig files only when both `duetConfigPath` and `machine` are present (`ensureConfigDefaults`). Calls `updateAppState()`, returns new AppState. `deploy:start` runs async deploy, broadcasts status + log events. `config:set-deploy-channel` writes `deployChannel` to `{machine}.json`, calls `updateAppState()`, returns new AppState. `config:set-instructions-path` validates machine config is writable (throws if DuetConfig/machine not configured). `agents:configure` and `agents:fix-issue` call `updateAppState()` after mutations to refresh tray icon.

**Config defaults:** `ensureConfigDefaults(duetConfigPath, machine)` — creates `settings.json` (`{ business_folders: [], timestampTZ: { id: "Z", value: "UTC" } }`) and `{machine}.json` (`{ port: 19680 }`) only if files don't exist. Never overwrites. Implementation: `core/config.ts`.

**Machine config write:** `setMachineConfigKey(key, value)` — read-modify-write single field in `{machine}.json`. Validates machine name. Implementation: `core/config.ts`.

## Pages

### Wizard Pages (Settings tab)

7 self-contained pages in `pages/wizard/`. Each manages its own state, calls `window.api` directly, and reports status via `onStatusChange` callback to App.tsx.

| # | Page | File | Key operations |
|---|------|------|----------------|
| 1 | DuetData | `DuetDataPage.tsx` | Folder picker, partial save via `savePointer` |
| 2 | DuetConfig + machine | `DuetConfigPage.tsx` | Folder picker + text input, partial save |
| 3 | Python 3.10+ | `PythonPage.tsx` | Auto-detect on mount, manual file picker, `savePythonPath` |
| 4 | Backend | `BackendPage.tsx` | Deploy status/button, channel toggle (visible when `hasDevBackendPath`), logs |
| 5 | Business Folders | `BusinessFoldersPage.tsx` | Folder list CRUD, manual Scan button, error table with Fix |
| 6 | Instructions | `InstructionsPage.tsx` | Folder picker for `instructionsPath`, Regenerate, error table, auto-configure agents on success |
| 7 | AI Agents | `AgentsPage.tsx` | Agent detection cards, Configure All, Fix issue buttons |

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

## Build & Release

> Full pipeline: see [/spec/PRODUCT.md](/spec/PRODUCT.md) -> Build & Release

```bash
npm run release [-- --mac|--win|--linux]   # default: --mac
```

`build-release.cjs`: bump patch -> `electron-vite build` -> `electron-builder` -> `dist/Duet-{version}.dmg`

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
| Unit | `__tests__/unit/core/`, `__tests__/unit/shared/`, `__tests__/unit/renderer/` | core-flow, config, app-state, deploy, backend, apps, ai-clients, instructions, business-folders, wizard-status, mappers, navigation |
| E2E | Disabled (CI) | WebdriverIO, monorepo symlink issues |

### Testability

| Module | Testable without Electron |
|--------|--------------------------|
| `core/config.ts` | Yes — pure fs, env override via `DUET_CONFIG_FILE` |
| `core/app-state.ts` | Yes — pure functions, depends only on config + fs |
| `platform/tray.ts` | No — requires Electron (manual testing) |
| `main/window.ts` | No — requires Electron |

## Wizard Status & Severity

### StepStatus

`StepStatus = 'done' | 'error' | 'warning' | 'skipped' | null`

Pure function `computeStepStatuses()` in `core/wizard-status.ts` computes sidebar step icons from system state. Used by renderer (App.tsx) and main process (tray).

**Input sources:**
| Steps | Source | Severity mapping |
|-------|--------|-----------------|
| 1-2 | AppState (duetDataPath, duetConfigPath, machine) | null (not configured) or done |
| 3 | AppState (pythonPath from machine.json) | null or done |
| 4 | DeployStatus (deployed/up_to_date) | null or done |
| 5 | Cached scan.json (errors count) | error (broken manifests) |
| 6 | Cached instruction errors (errors count) | error (broken files) |
| 7 | Agent detection (needs_setup vs configured) | **warning** (works but not configured) |

Steps 5-7 also report status dynamically via `onStatusChange` callbacks from individual pages, which override computed values.

### Severity Aggregation

`Severity = 'error' | 'warning'` — first-class type in `shared/types.ts`.

**Semantic distinction:**
- `error` — something is broken, cannot function (backend crashed, broken manifests, corrupt config)
- `warning` — works but needs attention (agent not configured, deploy needed, stale version)

**Aggregation model:** each UI level shows `maxSeverity()` of its children (error > warning > null):

```
Step statuses  ──┐
                  ├─→ Settings tab severity (getSettingsSeverity)  ──┐
Process states ──┐                                                   │
                  ├─→ Apps tab severity (processStateToSeverity)  ──┼─→ Tray severity
Deploy check   ────────────────────────────────── (deploySeverity) ──┘
```

Four UI levels (visual details in [UI.md](UI.md)):

| Level | What | Severity source |
|-------|------|-----------------|
| 4. Page | Error/warning tables inside page | Individual problems |
| 3. Sidebar item | Step icon or process dot | `StepStatus` / `ProcessState` |
| 2. Tab button | Colored dot indicator | `maxSeverity` of children |
| 1. Tray icon | System tray icon + tooltip | `maxSeverity` of all sources |

**Key functions** (all pure, in `core/wizard-status.ts`):
- `maxSeverity(severities[])` — pick highest (error > warning > null). Single aggregation primitive for all levels.
- `stepStatusToSeverity(status)` — error→error, warning→warning, rest→null
- `processStateToSeverity(state)` — error→error, rest→null
- `getSettingsSeverity(statuses)` — aggregate all wizard steps

**Tray integration** (`main/index.ts`):
- `deploySeverity` — from `isDeployWarning()` (VERSION mismatch → warning)
- `settingsSeverity` — from `getSettingsSeverity(computeStepStatuses(...))`
- `overallSeverity = maxSeverity([deploySeverity, settingsSeverity])`
- `updateTrayIcon(appStatus, overallSeverity)` — AppStatus != ready forces warning; otherwise uses severity

Implementation: `core/wizard-status.ts`, `platform/tray.ts`

## File Map

Quick lookup for concepts not obvious from file names. For layer responsibilities see [Layers](#layers).

| When you need to find… | Look in |
|------------------------|---------|
| All IPC types (single source of truth) | `shared/types.ts` |
| Severity type + aggregation functions | `shared/types.ts` (type), `core/wizard-status.ts` (functions) |
| Pointer file path / machine config | `core/config.ts` |
| What triggers tray icon change | `main/index.ts:updateAppState()` |
| How IPC channels are registered | `main/ipc-handlers.ts:setupIpcHandlers()` |
| What renderer exposes to pages | `preload/index.ts` (window.api shape) |
| Step status computation | `core/wizard-status.ts:computeStepStatuses()` |
| How pages override computed status | `renderer/src/App.tsx` (pageStatuses + createStatusCallback) |
| Tray icon file selection (per platform) | `platform/tray.ts:getTrayIconPath()` |

