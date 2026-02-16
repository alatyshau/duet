# Duet Host — Architecture

> Shared model (pointer file format, DuetData, DuetConfig): see [/spec/ECOSYSTEM.md](/spec/ECOSYSTEM.md)

## Purpose

Electron tray app. Writes pointer file (`~/.org.ve68.duet`). Deploys AI instructions and backend to DuetData. Configures AI clients (Claude Code, Codex). See ECOSYSTEM.md → Components.

## Current State

| Feature | Status |
|---------|--------|
| Tray app (Menu Bar / System Tray) | Done |
| Pointer file creation (3 fields) | Done |
| AppState machine (no_config → path_lost → ready) | Done |
| Deploy AI instructions + backend | Done |
| AI client detection + configuration | Done |
| InstallPage UI (folders + deploy + log) | Done |
| Deploy channel toggle (DEV / PROD) | Done |
| Backend lifecycle (start, stop, health) | Done |
| Apps UI (sidebar sections, AppPage, process cards) | Done |
| AgentsPage UI (detect + configure) | Done |
| Single instance lock | Done |
| Autostart (auto-launch) | Done |
| macOS Dock hide/show | Done |

## Layers

| Layer | Responsibility | Files |
|-------|----------------|-------|
| `shared/` | Types crossing process boundary (IPC) + pure mappers | `types.ts` (single source of truth), `mappers.ts` |
| `core/` | Config, app state, deploy, backend, AI clients, app registry | `config.ts`, `app-state.ts`, `deploy.ts`, `backend.ts`, `ai-clients.ts`, `apps.ts` |
| `platform/` | Tray, autolaunch | `tray.ts`, `autolaunch.ts` |
| `main/` | Window, IPC handlers, lifecycle | `index.ts`, `window.ts`, `ipc-handlers.ts` |
| `preload/` | Bridge main ↔ renderer | `index.ts`, `index.d.ts` |
| `renderer/` | React UI | `App.tsx`, `pages/InstallPage.tsx`, `pages/AppPage.tsx`, `pages/AgentsPage.tsx`, `components/` |

## Engineering Principles

| Principle | Rule |
|-----------|------|
| **Thin shell** | `main/`, `platform/`, `preload/` — only wiring. All non-trivial logic lives in `core/`. If logic in shell grows beyond a one-liner → extract to `core/`. |
| **No framework imports in core/** | `core/` has zero Electron imports. Testable with plain Node.js. |
| **Shared types** | `shared/types.ts` — single source of truth for all types crossing process boundary (IPC). Core modules re-export from shared. No type duplication. |
| **Unit tests for core/ only** | Don't mock Electron. Test pure `core/` functions directly. Shell is validated by TypeScript + E2E. |
| **Pure functions over state** | Prefer pure functions with explicit args over closures capturing module state. Makes testing trivial. |
| **Spec-driven** | Code + spec changes go in same commit. Read `spec/` before changes, update after. |

## AppState Machine

```
┌──────────────┐
│  no_config   │ ← pointer missing OR fields incomplete
└──────┬───────┘
       │ user fills all 3 fields
       ▼
┌──────────────┐
│    ready     │ ← both paths exist on disk
└──────┬───────┘
       │ folder deleted/moved
       ▼
┌──────────────┐
│  path_lost   │ ← fields set but paths don't exist
└──────────────┘
```

| Status | Condition |
|--------|-----------|
| `no_config` | Pointer file missing, or any of 3 fields empty |
| `path_lost` | All fields set, but `duetDataPath` or `duetConfigPath` doesn't exist |
| `ready` | All fields set AND both paths exist |

**deployChannel:** AppState includes `deployChannel: 'dev' | 'prod'` (default `'prod'`). Read from `{machine}.json`. Controls whether deploy uses bundled resources (`prod`) or dev override paths (`dev`).

Implementation: `core/app-state.ts:checkAppState()`

## Deploy Service

Deploys AI instructions and backend from bundled resources to DuetData.

| Component | Source (extraResources) | Target | Method |
|-----------|------------------------|--------|--------|
| AI instructions | `ai-instructions/` | `DuetData/ai-instructions/` | Recursive copy |
| Backend | `backend/` | `DuetData/backend/` | Atomic swap (.new → rename → .old → delete) |

**Deploy channel:** When `deployChannel === 'dev'` in `{machine}.json`, deploy uses `devInstructionsPath` and `devBackendPath` from machine config instead of bundled resources. Toggle via IPC `config:set-deploy-channel`.

**Version comparison:** Uses `compareSemver(appVersion, deployed)` — deploy only when app version is newer (not on downgrade or same version).

**Flow:** VERSION check (semver) → skip if not newer → **stop backend** (POST /stop + kill by PID) → deploy instructions → deploy backend (atomic swap) → Python check → venv + pip → write VERSION (only on full success).

**VERSION file:** `DuetData/backend/VERSION` contains `app.getVersion()`. Newer app version triggers deploy. VERSION is NOT written if any step fails (Python not found, pip failed, etc.).

**Tray warning:** When `status === 'ready'` but VERSION mismatch → tray shows warning icon + "требуется обновление".

**Backend stop before deploy:** `stopBackend(duetDataPath, port, log)` — POST `/stop` (2s timeout) → wait 3s → kill by PID (`DuetData/.pid`) with SIGTERM → SIGKILL fallback. Errors don't abort deploy (backend may not be running).

**Pure functions (extracted from Electron shell):**
- `resolveDeployStatus(appState, appVersion, activeStatus)` → DeployStatus — used by IPC handler `deploy:get-status`
- `isDeployWarning(appState, appVersion)` → boolean — used by `main/index.ts` for tray icon

Implementation: `core/deploy.ts`

## Backend Lifecycle

Host is the single owner of backend process lifecycle (start, stop, health monitoring).

**Start:** `startBackend(duetDataPath, port, log)` — spawn venv Python with `server.py`, detached + stdio: 'ignore' + unref. Poll `/health` until ready. Kill process if health check fails after all retries.

**Stop:** `stopBackend(duetDataPath, port, log)` — POST `/stop` (2s timeout) → wait 3s → kill by PID (`.pid` file) with SIGTERM → SIGKILL fallback.

**Health:** `checkHealth(port)` — GET `/health` with 2s timeout. Returns `{version, uptime}` or null.

**Status:** `getBackendStatus(duetDataPath, port)` → `BackendStatus` (stopped | starting | running | stopping | error).

**Auto-start on startup:** When `status === 'ready'` and deployed (no VERSION mismatch) → `ensureBackendRunning()`.

**Auto-start after deploy:** `runDeploy()` calls `startBackend()` after writing VERSION.

**Stop on quit:** `before-quit` handler calls `ensureBackendStopped()` with re-entrance guard.

**Concurrent start guard:** In-memory `isStarting` flag in `ipc-handlers.ts` prevents race between auto-start and user click (single-instance lock guarantees one Host process).

**IPC push:** `backend:status-changed` broadcasts `BackendStatus` during start/stop operations.

Implementation: `core/backend.ts`

## AI Clients

Detects and configures AI clients via direct file writes (no CLI).

| Client | Config file | What |
|--------|-------------|------|
| Claude Code | `~/.claude/output-styles/ai-kit.md` | Output style (instructions as system prompt) |
| Claude Code | `~/.claude.json` | MCP server (mcpServers.duet) |
| Codex | `~/.codex/config.toml` | `model_instructions_file` + `[mcp.duet]` |

**Pattern:** detect (config dir exists?) → configure (write files) → show result. Not found = info, not error.

Implementation: `core/ai-clients.ts`

## IPC Channels

| Channel | Direction | Purpose |
|---------|-----------|---------|
| `app:get-state` | renderer → main | Get current AppState |
| `app-state-changed` | main → renderer | Push state updates |
| `dialog:select-folder` | renderer → main | Open system folder picker |
| `config:save-pointer` | renderer → main | Save pointer file (all 3 fields) |
| `shell:open-path` | renderer → main | Open path in Finder/Explorer |
| `config:set-deploy-channel` | renderer → main | Set deploy channel (dev/prod) in machine config |
| `deploy:get-status` | renderer → main | Get deploy status (idle/up_to_date/deploying/etc.) |
| `deploy:start` | renderer → main | Start deploy (async) |
| `deploy:status-changed` | main → renderer | Push deploy status updates |
| `deploy:log` | main → renderer | Push deploy log messages |
| `backend:get-status` | renderer → main | Get backend status (stopped/starting/running/error) |
| `backend:start` | renderer → main | Start backend |
| `backend:stop` | renderer → main | Stop backend |
| `backend:status-changed` | main → renderer | Push backend status updates |
| `agents:detect` | renderer → main | Detect installed AI clients |
| `agents:configure` | renderer → main | Configure all AI clients |

**Contract:** `config:save-pointer` writes pointer file, creates default DuetConfig files if missing (`ensureConfigDefaults`), then calls `updateAppState()`, returns new AppState. `deploy:start` runs async deploy, broadcasts status + log events. `config:set-deploy-channel` writes `deployChannel` to `{machine}.json`, calls `updateAppState()`, returns new AppState.

**Config defaults:** `ensureConfigDefaults(duetConfigPath, machine)` — creates `settings.json` (`{ business_folders: [], timestampTZ: { id: "Z", value: "UTC" } }`) and `{machine}.json` (`{ port: 19680 }`) only if files don't exist. Never overwrites. Implementation: `core/config.ts`.

**Machine config write:** `setMachineConfigKey(key, value)` — read-modify-write single field in `{machine}.json`. Validates machine name. Implementation: `core/config.ts`.

## Behavioral Contracts

| Behavior | Contract |
|----------|----------|
| Window close | Hides window, does NOT quit app |
| First run (no pointer file) | Shows window for onboarding |
| Status `path_lost` | Shows window (needs attention) |
| Status `ready` | Silent in tray, no window |
| Tray icon | Warning when status ≠ ready OR deploy needed |
| macOS Dock | Hidden by default, visible when window shown |
| Second instance | Shows window of first instance, second exits |
| Production | Cmd/Ctrl+R reload disabled |

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

## Navigation

| Concept | File |
|---------|------|
| Shared IPC types | `shared/types.ts` |
| IPC → UI mappers | `shared/mappers.ts` |
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

## Build & Release

> Full pipeline: see [/spec/ECOSYSTEM.md](/spec/ECOSYSTEM.md) → Build & Release

```bash
npm run release [-- --mac|--win|--linux]   # default: --mac
```

`build-release.cjs`: bump patch → `electron-vite build` → `electron-builder` → `dist/Duet-{version}.dmg`

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

## Future

| Feature | Status |
|---------|--------|
| Auto-deploy on startup (if ready) | TODO |
