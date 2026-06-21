# UI

> Process behaviors (window close, tray icon driver, AppState transitions, Severity Framework): [COMPONENT.md](COMPONENT.md). This file covers visual structure, navigation, per-page UX, and shared components.

## Navigation

Two-level: **tabs** select a category, **sidebar list** selects a page within that category.

```
┌──────────────────┬─────────────────────────────┐
│ Duet             │                             │
│ [Open DuetData]  │                             │
│ ──────────────── │                             │
│  [⚙🔴] [▶]      │  ← icon-only tabs + severity│
│ ──────────────── │                             │
│ ✅ Duet: пути    │  Content (current page)     │
│ ✅ Python        │                             │
│ ✅ Backend       │                             │
│ 🔴 Воркспейсы    │  ← error (red)             │
│ 🟡 AI Агенты     │  ← warning (amber)         │
└──────────────────┴─────────────────────────────┘
```

### Tabs

| Tab | Icon | Tooltip | Content |
|-----|------|---------|---------|
| Settings | ⚙ | Настройки | Wizard — 5-step setup |
| Apps | ▶ | Приложения | Running processes |

Icon-only tab buttons (no labels) — label shown as tooltip on hover. Severity indicator next to icon when children have issues. Switching tab navigates to the first item in that tab's list.

### Typed Routing

All navigation types defined in `renderer/src/navigation.ts`:

| Type | Values |
|------|--------|
| `Tab` | `'settings'` \| `'apps'` |
| `WizardPage` | `'duet-paths'` \| `'python'` \| `'backend'` \| `'workspaces'` \| `'agents'` |
| `AppPage` | `'app:duet-backend'` |
| `Page` | `WizardPage` \| `AppPage` |

`tabForPage(page)` derives tab from page. `DEFAULT_PAGE` = `'duet-paths'`.

## Layout

| Component | File | Responsibility |
|-----------|------|----------------|
| `App.tsx` | `renderer/src/App.tsx` | Root: AppState subscription, deploy subscription, page status computation, page routing |
| `Layout` | `components/layout/Layout.tsx` | Two-column: sidebar + content. Passes `pageStatuses` to Sidebar |
| `Sidebar` | `components/layout/Sidebar.tsx` | Tabs, wizard/apps list, status icons |

## Settings — Wizard

5-step configuration wizard. Each step is a self-contained page with its own state and IPC calls. Status icons in sidebar reflect live configuration state.

### Steps

| # | Page | Label | Required | Depends on |
|---|------|-------|----------|------------|
| 1 | `duet-paths` | Duet: пути | yes | — |
| 2 | `python` | Python 3.10+ | yes | — |
| 3 | `backend` | Backend | yes | 1, 2 |
| 4 | `workspaces` | Воркспейсы | yes | 1, 3 |
| 5 | `agents` | AI Агенты | yes | 3 |

Dependencies declared in `WIZARD_STEPS[].dependsOn`. Enforced at runtime:
- **Sidebar:** unavailable steps (deps not `ok` or `warning`) rendered with dimmed text. Navigation still allowed (user can read help text). Warning deps are satisfied — warning means "works but not ideal".
- **Pages:** action buttons disabled when dependencies unmet; dependency banner shown when a step's dependencies are not yet configured.
- Helpers: `isStepAvailable(page, statuses)`, `getMissingDeps(page, statuses)` in `navigation.ts`.

### Page Status Icons

`PageStatusIcon` in `Sidebar.tsx` — renders sidebar icon per `PageStatus` (Severity Framework: see [COMPONENT.md](COMPONENT.md)):

| PageStatus | Icon | Meaning |
|-----------|------|---------|
| `'ok'` | Green circle + checkmark | Page completed correctly |
| `'error'` | Red circle + X (via `SeverityIcon`) | Page has errors |
| `null` | Hollow gray circle | Not yet configured (blocks user) |
| `'warning'` | Amber triangle + ! (via `SeverityIcon`) | Page has warnings |
| `'skipped'` | Gray circle + arrows | Not relevant |

`error` and `warning` icons rendered via shared `SeverityIcon` component — same icons used in `StatusTable` rows and tab severity indicators.

Status computed by `computePageStatuses()` in `core/wizard-status.ts` (pure) merged with dynamic page callbacks.

### Page Architecture

Each wizard page:
- Produces `StatusItem[]` — rendered via shared `<StatusTable />`.
- Receives `appState: AppState` prop (for config values).
- Receives `onStatusChange: (status: PageStatus) => void` callback.
- Calls `window.api.*` directly for its own IPC operations.
- Manages its own local state (no state lifting to `App.tsx`).

Pointer saves use partial updates: each page passes only its field(s) to `savePointer`, others are preserved.

### Step Details

**Step 1 — Duet: пути.** Four sections: DuetData (folder picker), DuetConfig (folder picker), Machine name (text input), Root contexts (add / remove / drag-reorder). Status = `ok` when all three base paths set (root contexts are optional). Operations use `root-contexts:get` (load), `root-contexts:add` (picker → alias-aware add), `root-contexts:save` (remove + reorder rewrite the full list). Drag-to-position-0 atomically swaps the meta flag — see [COMPONENT.md → Root Contexts](COMPONENT.md). Persist-then-update-UI: handlers await IPC success before mutating local state and surface errors via inline `folderError` text.

**Step 2 — Python 3.10+.** Auto-detect on mount, manual file picker, `savePythonPath` to `{machine}.json`.

**Step 3 — Backend.** Deploy status/button, channel toggle (DEV/PROD, visible when `hasDevBackendPath`), deploy logs. VERSION displayed with full build metadata (e.g. `0.1.8+prod_abc1234`). Shows "(актуальна)" only when semver matches AND channel matches current mode. Channel mismatch warning: "Установлена DEV-версия — переустановите для PROD" (or vice versa). `VersionInfo` sub-component handles parsing and display.

**Step 4 — Воркспейсы.** Manual Scan button + results. Shows entity tree from cached `contexts.json` (built via `parent_id`, with icons and types). Error table is informational — scanner auto-heals collisions and missing manifests, errors are notifications with file paths. No Fix buttons for scan errors. If no root contexts configured, shows message directing user to step 1.

**Step 5 — AI Агенты.** "Настроить все" button runs merge→configure in one action (`configureAllAgents()` merges the bundled platform instructions, then deploys to the AI clients). Agent cards show checked files list and issues. Fix button for fixable issues (e.g. `additionalDirectories`). Not-found agents show description + clickable install link (Claude Code, Codex, Antigravity). No `dark:` classes (light-only theme).

## Apps Tab

| Page | Label | Indicator |
|------|-------|-----------|
| `app:duet-backend` | Duet Backend | `StatusDot` showing `ProcessState` |

Per-application page with process cards. Navigate via sidebar → Приложения → {app name} (route: `app:{app-id}`).

Process card shows: state badge, version, uptime, Start/Stop/Restart buttons. States: stopped, starting, running, stopping, error.

Currently only Duet Backend (builtin, one HTTP process on port 19680). Types: `AppInfo`, `ProcessInfo`, `ProcessStatus` in `shared/types.ts`. Mapper: `backendStatusToProcessStatus()` in `shared/mappers.ts`. Registry: `BUILTIN_APPS` in `core/apps.ts`.

## Tray

| Aspect | Value |
|--------|-------|
| Click on icon | Shows window |
| Context menu | "Открыть Duet", "Запускать при старте" (checkbox), "Выйти" |
| Icon: normal | Template icon (adapts to light/dark on macOS) |
| Icon: warning | Warning template icon. Tooltip: "требуется обновление" |
| Icon: error | Colored icon with red dot (non-template on macOS). Tooltip: "требуется внимание" |
| Tooltip (AppStatus) | "Duet" (ready), "требуется настройка" (`no_config`), "папка не найдена" (`path_lost`) |

`updateTrayIcon(status: AppStatus, severity: Severity | null)` — AppStatus != ready forces warning icon. Otherwise uses severity from the aggregation chain (see [COMPONENT.md → Severity Framework](COMPONENT.md)).

### Tray Icon Files

| Platform | Normal | Warning | Error |
|----------|--------|---------|-------|
| macOS | `trayTemplate.png` | `trayWarningTemplate.png` | `trayError.png` (non-template) |
| Windows | `tray.ico` | `tray-warning.ico` | `tray-error.ico` |
| Linux | Same as macOS PNG | Same as macOS PNG | Same as macOS PNG |

macOS: normal/warning are template images (adapt to light/dark). Error is non-template — red dot stays red regardless of menu bar appearance.

Location: `resources/tray/{mac,win}/`.

### Tab Severity Indicators

Each tab button shows a `SeverityIcon size="sm"` when its children have issues:
- **Settings** tab: `getSettingsSeverity(pageStatuses)` — max of all wizard pages.
- **Apps** tab: `processStateToSeverity(backendProcessState)` — from process state.

Tray aggregates **only** `settingsSeverity` and `deploySeverity` via `maxSeverity()`. Apps-tab severity is visible in the sidebar tab indicator but does not propagate to the tray icon.

## Shared Components

| Component | File | Purpose |
|-----------|------|---------|
| `SeverityIcon` | `components/ui/severity-icon.tsx` | Unified severity icon for all UI levels. Props: `severity: Severity`, `size?: 'sm' \| 'md'`. Error = `XCircle` red, Warning = `AlertTriangle` amber |
| `StatusTable` | `components/ui/status-table.tsx` | Renders `StatusTableItem[]` on pages. Each row: `SeverityIcon` + message + optional detail (file path) + optional Fix button. Border color from severity (red/amber) |
| `StatusDot` | `components/ui/status-dot.tsx` | Process state indicator (colored dot or spinner). Props: `state: ProcessState`, `size: 'sm' \| 'md'` |
| `ProcessStateLabel` | `components/ui/process-state-label.tsx` | Text badge with process state. Props: `state: ProcessState` |
| `Button` | `components/ui/button.tsx` | shadcn/ui button with CVA variants |
| `PageStatusIcon` | Inline in `Sidebar.tsx` | Page status icon: `ok`/`null`/`skipped` own icons, `error`/`warning` via `SeverityIcon` |

## Styling

Tailwind CSS v4 with `@theme` tokens in `main.css`. Light-only theme (Google Drive-inspired). No dark mode.

| Token category | Examples |
|----------------|----------|
| Colors | `--color-primary`, `--color-background`, `--color-sidebar` |
| Radius | `--radius-lg`, `--radius-md`, `--radius-sm` |

shadcn/ui patterns via CVA (Class Variance Authority). Utility merging via `cn()` (`clsx` + `tailwind-merge`).
