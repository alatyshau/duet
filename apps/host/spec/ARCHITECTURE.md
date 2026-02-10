# Duet Host — Architecture

> Shared model (pointer file format, DuetData, DuetConfig): see [/spec/ECOSYSTEM.md](/spec/ECOSYSTEM.md)

## Purpose

Electron tray app. Writes pointer file (`~/.org.ve68.duet`). See ECOSYSTEM.md → Components.

## Current State

| Feature | Status |
|---------|--------|
| Tray app (Menu Bar / System Tray) | Done |
| Pointer file creation (3 fields) | Done |
| AppState machine (no_config → path_lost → ready) | Done |
| SetupPage UI (3 folder pickers + machine name) | Done |
| Single instance lock | Done |
| Autostart (auto-launch) | Done |
| macOS Dock hide/show | Done |

## Layers

| Layer | Responsibility | Files |
|-------|----------------|-------|
| `core/` | Config read/write, app state logic | `config.ts`, `app-state.ts` |
| `platform/` | Tray, autolaunch | `tray.ts`, `autolaunch.ts` |
| `main/` | Window, IPC handlers, lifecycle | `index.ts`, `window.ts`, `ipc-handlers.ts` |
| `preload/` | Bridge main ↔ renderer | `index.ts`, `index.d.ts` |
| `renderer/` | React UI | `App.tsx`, `pages/SetupPage.tsx`, `components/` |

**Boundary:** `core/` has NO Electron imports. Testable with plain Node.js.

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

Implementation: `core/app-state.ts:checkAppState()`

## IPC Channels

| Channel | Direction | Purpose |
|---------|-----------|---------|
| `app:get-state` | renderer → main | Get current AppState |
| `app-state-changed` | main → renderer | Push state updates |
| `dialog:select-folder` | renderer → main | Open system folder picker |
| `config:save-pointer` | renderer → main | Save pointer file (all 3 fields) |
| `shell:open-path` | renderer → main | Open path in Finder/Explorer |

**Contract:** `config:save-pointer` writes pointer file, then calls `updateAppState()`, returns new AppState.

## Behavioral Contracts

| Behavior | Contract |
|----------|----------|
| Window close | Hides window, does NOT quit app |
| First run (no pointer file) | Shows window for onboarding |
| Status `path_lost` | Shows window (needs attention) |
| Status `ready` | Silent in tray, no window |
| macOS Dock | Hidden by default, visible when window shown |
| Tray icon | Warning (yellow) when status ≠ ready |
| Second instance | Shows window of first instance, second exits |
| Production | Cmd/Ctrl+R reload disabled |

## SetupPage UI

Three fields for pointer file:

| Field | Widget | Auto-save |
|-------|--------|-----------|
| DuetData path | Folder picker (dialog) | Yes, when all 3 filled |
| DuetConfig path | Folder picker (dialog) | Yes, when all 3 filled |
| Machine name | Text input | On explicit Save button |

**Draft state:** App.tsx maintains draft values separate from saved AppState. User can edit without immediate save.

## Navigation

| Concept | File |
|---------|------|
| Pointer read/write | `core/config.ts` |
| App state logic | `core/app-state.ts` |
| Tray menu + icon | `platform/tray.ts` |
| Autostart | `platform/autolaunch.ts` |
| Main lifecycle | `main/index.ts` |
| Window management | `main/window.ts` |
| IPC registration | `main/ipc-handlers.ts` |
| Preload bridge | `preload/index.ts` |
| Root React component | `renderer/src/App.tsx` |
| Setup page | `renderer/src/pages/SetupPage.tsx` |
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
- Resources: `resources/` (tray icons) unpacked from asar

CI: `build-host.yml` builds all 3 platforms on push to main (if `apps/host/` changed).

## Testing

```bash
npm run test:run     # vitest (unit)
npm run typecheck    # tsc
```

| Suite | Files | What |
|-------|-------|------|
| Unit | `__tests__/unit/core/` | core-flow, config, app-state |
| E2E | Disabled (CI) | WebdriverIO, monorepo symlink issues |

## Future

| Feature | Status |
|---------|--------|
| Python 3.10+ check | TODO |
| Backend spawn + lifecycle | TODO (currently Extension does this) |
| Health check of backend | TODO |
| Settings page | Placeholder exists |
