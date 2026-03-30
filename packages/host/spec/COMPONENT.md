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
| `core/` | Config, app state, deploy, backend, AI clients, app registry | `config.ts`, `app-state.ts`, `deploy.ts`, `backend.ts`, `ai-clients.ts`, `apps.ts` |
| `platform/` | Tray, autolaunch | `tray.ts`, `autolaunch.ts` |
| `main/` | Window, IPC handlers, lifecycle | `index.ts`, `window.ts`, `ipc-handlers.ts` |
| `preload/` | Bridge main <-> renderer | `index.ts`, `index.d.ts` |
| `renderer/` | React UI | `App.tsx`, `pages/InstallPage.tsx`, `pages/AppPage.tsx`, `pages/AgentsPage.tsx`, `components/` |

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

**Flow:** VERSION check (semver) -> skip if not newer -> **stop backend** (POST /stop + kill by PID) -> deploy backend (atomic swap) -> Python check -> venv + pip -> write VERSION (only on full success).

**VERSION file:** `DuetData/backend/VERSION` contains `app.getVersion()`. Newer app version triggers deploy. VERSION is NOT written if any step fails (Python not found, pip failed, etc.).

**Tray warning:** When `status === 'ready'` but VERSION mismatch -> tray shows warning icon + "требуется обновление".

**Backend stop before deploy:** `stopBackend(duetDataPath, port, log)` — POST `/stop` (2s timeout) -> wait 3s -> kill by PID (`DuetData/.pid`) with SIGTERM -> SIGKILL fallback. Errors don't abort deploy (backend may not be running).

**Pure functions (extracted from Electron shell):**
- `resolveDeployStatus(appState, appVersion, activeStatus)` -> DeployStatus — used by IPC handler `deploy:get-status`
- `isDeployWarning(appState, appVersion)` -> boolean — used by `main/index.ts` for tray icon

Implementation: `core/deploy.ts`

## Backend Lifecycle

Host is the single owner of backend process lifecycle (start, stop, health monitoring).

**Start:** `startBackend(duetDataPath, port, log)` — spawn venv Python with `server.py`, detached + stdio: 'ignore' + unref. Poll `/health` until ready. Kill process if health check fails after all retries.

**Stop:** `stopBackend(duetDataPath, port, log)` — POST `/stop` (2s timeout) -> wait 3s -> kill by PID (`.pid` file) with SIGTERM -> SIGKILL fallback.

**Health:** `checkHealth(port)` — GET `/health` with 2s timeout. Returns `{version, uptime}` or null.

**Status:** `getBackendStatus(duetDataPath, port)` -> `BackendStatus` (stopped | starting | running | stopping | error).

**Auto-start on startup:** When `status === 'ready'` and deployed (no VERSION mismatch) -> `ensureBackendRunning()`.

**Auto-start after deploy:** `runDeploy()` calls `startBackend()` after writing VERSION.

**Stop on quit:** `before-quit` handler calls `ensureBackendStopped()` with re-entrance guard.

**Concurrent start guard:** In-memory `isStarting` flag in `ipc-handlers.ts` prevents race between auto-start and user click (single-instance lock guarantees one Host process).

**IPC push:** `backend:status-changed` broadcasts `BackendStatus` during start/stop operations.

Implementation: `core/backend.ts`

## AI Clients

Detects and configures AI clients via direct file writes (no CLI). Instructions are fetched from backend (`GET /bootstrapper`) as merged content (platform bootstrapper + user core_instructions).

| Client | Config files | What |
|--------|-------------|------|
| Claude Code | `~/.claude/output-styles/duet.md` | Merged instructions as output style (system prompt) |
| Claude Code | `~/.claude/settings.json` | `outputStyle: "Duet"` |
| Claude Code | `~/.claude.json` | MCP server (mcpServers.duet, HTTP) |
| Codex | `~/.codex/duet_instructions.md` | Merged instructions file |
| Codex | `~/.codex/config.toml` | `model_instructions_file` + `[mcp_servers.duet]` |

**Pattern:** fetch merged content from backend -> detect (config dir exists?) -> configure (write files) -> show result. Not found = info, not error. Backend unavailable = MCP configured, instructions skipped (needs_setup).

**Content freshness:** detect checks if installed content matches current merged content from backend. Stale content -> needs_setup.

Implementation: `core/ai-clients.ts`

## IPC Channels

| Channel | Direction | Purpose |
|---------|-----------|---------|
| `app:get-state` | renderer -> main | Get current AppState |
| `app-state-changed` | main -> renderer | Push state updates |
| `dialog:select-folder` | renderer -> main | Open system folder picker |
| `config:save-pointer` | renderer -> main | Save pointer file (all 3 fields) |
| `shell:open-path` | renderer -> main | Open path in Finder/Explorer |
| `config:set-deploy-channel` | renderer -> main | Set deploy channel (dev/prod) in machine config |
| `deploy:get-status` | renderer -> main | Get deploy status (idle/up_to_date/deploying/etc.) |
| `deploy:start` | renderer -> main | Start deploy (async) |
| `deploy:status-changed` | main -> renderer | Push deploy status updates |
| `deploy:log` | main -> renderer | Push deploy log messages |
| `backend:get-status` | renderer -> main | Get backend status (stopped/starting/running/error) |
| `backend:start` | renderer -> main | Start backend |
| `backend:stop` | renderer -> main | Stop backend |
| `backend:status-changed` | main -> renderer | Push backend status updates |
| `agents:detect` | renderer -> main | Detect installed AI clients |
| `agents:configure` | renderer -> main | Configure all AI clients |

**Contract:** `config:save-pointer` writes pointer file, creates default DuetConfig files if missing (`ensureConfigDefaults`), then calls `updateAppState()`, returns new AppState. `deploy:start` runs async deploy, broadcasts status + log events. `config:set-deploy-channel` writes `deployChannel` to `{machine}.json`, calls `updateAppState()`, returns new AppState.

**Config defaults:** `ensureConfigDefaults(duetConfigPath, machine)` — creates `settings.json` (`{ business_folders: [], timestampTZ: { id: "Z", value: "UTC" } }`) and `{machine}.json` (`{ port: 19680 }`) only if files don't exist. Never overwrites. Implementation: `core/config.ts`.

**Machine config write:** `setMachineConfigKey(key, value)` — read-modify-write single field in `{machine}.json`. Validates machine name. Implementation: `core/config.ts`.

## Pages

### InstallPage

Three sections:
1. **Config** — folder pickers (DuetData, DuetConfig) + machine name input. Auto-save when all 3 filled.
2. **Components** — deploy channel toggle (DEV/PROD) in header + deploy status for AI instructions + backend. DEV mode shows amber banner. "Установить" button when deploy needed.
3. **Log** — deploy log (subscribes to `deploy:log` events).

### AppPage

Per-application page with process cards. Navigate via sidebar → Приложения → {app name} (route: `app:{app-id}`).

Process card shows: state badge, version, uptime, Start/Stop/Restart buttons. States: stopped, starting, running, stopping, error.

Currently only Duet Backend (builtin, one HTTP process on port 19680). Types: `AppInfo`, `ProcessInfo`, `ProcessStatus` in `shared/types.ts`. Mapper: `backendStatusToProcessStatus()` in `shared/mappers.ts`. Registry: `BUILTIN_APPS` in `core/apps.ts`.

### AgentsPage

Detects AI clients on mount. Shows status card per client. "Настроить все" button to configure.

## Behavioral Contracts

| Behavior | Contract |
|----------|----------|
| Window close | Hides window, does NOT quit app |
| First run (no pointer file) | Shows window for onboarding |
| Status `path_lost` | Shows window (needs attention) |
| Status `ready` | Silent in tray, no window |
| Tray icon | Warning when status != ready OR deploy needed |
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
- extraResources: `resources/` (tray icons), `ai-instructions/`, `backend/`

CI: `build-host.yml` builds all 3 platforms on push to main (if `packages/host/` changed).

## Testing

```bash
npm run test:run     # vitest (unit)
npm run typecheck    # tsc
```

| Suite | Files | What |
|-------|-------|------|
| Unit | `__tests__/unit/core/`, `__tests__/unit/shared/` | core-flow, config, app-state, deploy, backend, apps, ai-clients, mappers |
| E2E | Disabled (CI) | WebdriverIO, monorepo symlink issues |

### Testability

| Module | Testable without Electron |
|--------|--------------------------|
| `core/config.ts` | Yes — pure fs, env override via `DUET_CONFIG_FILE` |
| `core/app-state.ts` | Yes — pure functions, depends only on config + fs |
| `platform/tray.ts` | No — requires Electron (manual testing) |
| `main/window.ts` | No — requires Electron |

## Navigation

| Concept | File |
|---------|------|
| Shared IPC types | `shared/types.ts` |
| IPC -> UI mappers | `shared/mappers.ts` |
| Pointer + machine config | `core/config.ts` |
| App state logic | `core/app-state.ts` |
| Deploy service | `core/deploy.ts` |
| Backend lifecycle | `core/backend.ts` |
| App registry | `core/apps.ts` |
| AI client config | `core/ai-clients.ts` |
| Tray menu + icon | `platform/tray.ts` |
| Autostart | `platform/autolaunch.ts` |
| Main lifecycle | `main/index.ts` |
| Window management | `main/window.ts` |
| IPC registration | `main/ipc-handlers.ts` |
| Preload bridge | `preload/index.ts` |
| Root React component | `renderer/src/App.tsx` |
| Install page | `renderer/src/pages/InstallPage.tsx` |
| App page | `renderer/src/pages/AppPage.tsx` |
| Agents page | `renderer/src/pages/AgentsPage.tsx` |
| Layout (sidebar) | `renderer/src/components/layout/` |

