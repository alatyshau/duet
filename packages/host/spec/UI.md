# UI

## Navigation

Two-level navigation: **tabs** select a category, **sidebar list** selects a page within that category.

```
┌──────────────────┬─────────────────────────────┐
│ Duet             │                             │
│ [Open DuetData]  │                             │
│ ──────────────── │                             │
│  [⚙ 🔴] [▶]     │  ← severity dot on tab     │
│ ──────────────── │                             │
│ ✅ DuetData      │  Content (current page)     │
│ ✅ DuetConfig..  │                             │
│ ✅ Python        │                             │
│ ✅ Backend       │                             │
│ 🔴 Biz Folders   │  ← error (red)             │
│ ✅ Инструкции    │                             │
│ 🟡 AI Агенты     │  ← warning (amber)         │
└──────────────────┴─────────────────────────────┘
```

### Tabs

| Tab | Icon | Content |
|-----|------|---------|
| Settings (Настройки) | ⚙ | Wizard — 7-step setup |
| Apps (Приложения) | ▶ | Running processes |

Switching tab navigates to the first item in that tab's list.

### Typed Routing

All navigation types defined in `renderer/src/navigation.ts`:

| Type | Values |
|------|--------|
| `Tab` | `'settings'` \| `'apps'` |
| `WizardPage` | `'duet-data'` \| `'duet-config'` \| `'python'` \| `'backend'` \| `'business-folders'` \| `'instructions'` \| `'agents'` |
| `AppPage` | `'app:duet-backend'` |
| `Page` | `WizardPage` \| `AppPage` |

`tabForPage(page)` derives tab from page. `DEFAULT_PAGE` = `'duet-data'`.

## Settings Tab — Wizard

7-step configuration wizard. Each step is a self-contained page with its own state and IPC calls. Status icons in sidebar reflect live configuration state.

### Steps

| # | Page | Label | Required | Depends on |
|---|------|-------|----------|------------|
| 1 | `duet-data` | DuetData | yes | — |
| 2 | `duet-config` | DuetConfig + машина | yes | — |
| 3 | `python` | Python 3.10+ | yes | — |
| 4 | `backend` | Backend | yes | 1, 3 |
| 5 | `business-folders` | Business Folders | yes | 1, 2, 4 |
| 6 | `instructions` | Инструкции | yes | 1, 2 |
| 7 | `agents` | AI Агенты | yes | 4, 6 |

Dependencies declared in `WIZARD_STEPS[].dependsOn`. Enforced at runtime:
- **Sidebar:** unavailable steps (deps not `done`) rendered with dimmed text (`text-muted-foreground/50`). Navigation still allowed (user can read help text).
- **Pages:** action buttons disabled when dependencies unmet; dependency banner shown (e.g. InstructionsPage warns when DuetConfig/machine not configured).
- **IPC:** `config:set-instructions-path` throws if machine config not writable (prevents silent data loss).
- Helpers: `isStepAvailable(page, statuses)`, `getMissingDeps(page, statuses)` in `navigation.ts`.

### Step Status Icons

| Status | Icon | Meaning |
|--------|------|---------|
| `'done'` | Green circle + checkmark | Step completed |
| `'error'` | Red circle + X | Broken, needs fix |
| `'warning'` | Amber circle + ! | Works, but needs attention |
| `'skipped'` | Gray circle + arrows | Not relevant (e.g. agent not installed) |
| `null` | Hollow circle | Not yet determined |

Status computed by `computeStepStatuses()` in `core/wizard-status.ts` (pure function) merged with dynamic page callbacks.

### Step Status Sources

| Steps | Source | Status logic |
|-------|--------|-------------|
| 1-2 | AppState fields | `done` when path/machine set, `null` otherwise |
| 3 | AppState.pythonPath | `done` when set, `null` otherwise. Page auto-detects on mount |
| 4 | DeployStatus | `done` when deployed/up_to_date, `null` otherwise |
| 5 | Scan result (cached or fresh) | `done` when 0 errors, `error` when errors exist |
| 6 | Instructions merge result | `done` when 0 errors, `error` when errors exist |
| 7 | Agent detection | `done` when all found agents configured, `warning` when any needs_setup |

### Page Architecture

Each wizard page:
- Receives `appState: AppState` prop (for config values)
- Receives `onStatusChange: (status: StepStatus) => void` callback
- Calls `window.api.*` directly for its own IPC operations
- Manages its own local state (no state lifting to App.tsx)

Pointer saves use partial updates: each page passes only its field(s) to `savePointer`, others are preserved.

### Step Details

**Step 5 (Business Folders):** Folder picker list with add/remove. Scan is manual (user clicks button). Shows entity tree from `streams.json` (built via `parent_id`, with icons and types). Error table is informational — scanner auto-heals collisions and missing manifests, errors are notifications with file paths. No Fix buttons for scan errors.

**Step 6 (Instructions):** Folder picker for `instructionsPath` (saved to machine.json). Auto-merge on first path set. Regenerate button for subsequent merges. On 0 errors, auto-configures AI agents (step 7) and propagates result to App.tsx via `onAgentsUpdated` callback (sidebar step 7 updates immediately). Error table shows Fix buttons for auto-fixable errors (`no_frontmatter`, `invalid_yaml`, `missing_fields`). Fix → edit source file → auto re-merge. Dependency banner shown when DuetConfig/machine not configured (step 2); folder picker disabled.

**Step 7 (AI Agents):** Agent cards show checked files list and issues. Fix button for fixable issues (e.g. additionalDirectories). Not-found agents show description + clickable install link (Claude Code, Codex, Antigravity). No dark: classes (light-only theme).

## Apps Tab

| Page | Label | Indicator |
|------|-------|-----------|
| `app:duet-backend` | Duet Backend | `StatusDot` showing `ProcessState` |

## Shared UI Components

| Component | File | Purpose |
|-----------|------|---------|
| `StatusDot` | `components/ui/status-dot.tsx` | Process state indicator (colored dot or spinner). Props: `state: ProcessState`, `size: 'sm' \| 'md'` |
| `ProcessStateLabel` | `components/ui/process-state-label.tsx` | Text badge with process state. Props: `state: ProcessState` |
| `Button` | `components/ui/button.tsx` | shadcn/ui button with CVA variants |
| `StepStatusIcon` | Inline in `Sidebar.tsx` | Wizard step status icon (done/error/warning/skipped/null) |
| `SeverityDot` | Inline in `Sidebar.tsx` | Severity indicator dot on tab buttons (red/amber) |

## Layout

| Component | File | Responsibility |
|-----------|------|----------------|
| `App.tsx` | `renderer/src/App.tsx` | Root: AppState subscription, deploy subscription, step status computation, page routing |
| `Layout` | `components/layout/Layout.tsx` | Two-column: sidebar + content. Passes stepStatuses to Sidebar |
| `Sidebar` | `components/layout/Sidebar.tsx` | Tabs, wizard/apps list, status icons |

## Pages

| Directory | Contains |
|-----------|----------|
| `pages/wizard/` | 7 wizard step pages (DuetData, DuetConfig, Python, Backend, BusinessFolders, Instructions, Agents) |
| `pages/apps/` | App process pages (`BackendAppPage.tsx`) |

## Tray

| Aspect | Value |
|--------|-------|
| Click on icon | Shows window |
| Context menu | "Открыть Duet", "Запускать при старте" (checkbox), "Выйти" |
| Icon: normal | Template icon (adapts to light/dark on macOS) |
| Icon: warning | Warning template icon. Tooltip: "требуется обновление" |
| Icon: error | Colored icon with red dot (non-template on macOS). Tooltip: "требуется внимание" |
| Tooltip (AppStatus) | "Duet" (ready), "требуется настройка" (no_config), "папка не найдена" (path_lost) |

`updateTrayIcon(status: AppStatus, severity: Severity | null)` — AppStatus != ready forces warning icon. Otherwise uses severity from aggregation chain.

### Tray Icon Files

| Platform | Normal | Warning | Error |
|----------|--------|---------|-------|
| macOS | `trayTemplate.png` | `trayWarningTemplate.png` | `trayError.png` (non-template) |
| Windows | `tray.ico` | `tray-warning.ico` | `tray-error.ico` |
| Linux | Same as macOS PNG | Same as macOS PNG | Same as macOS PNG |

macOS: normal/warning are template images (adapt to light/dark). Error is non-template — red dot stays red regardless of menu bar appearance.

Location: `resources/tray/{mac,win}/`

### Tab Severity Indicators

Each tab button shows a `SeverityDot` (small colored circle) when its children have issues:
- Settings tab: `getSettingsSeverity(stepStatuses)` — max of all wizard steps
- Apps tab: `processStateToSeverity(backendProcessState)` — from process state

Tray aggregates all tabs + deploy severity via `maxSeverity()`.

## Window Behavioral Contracts

| Behavior | Contract |
|----------|----------|
| Close button | Hides window (not quit) |
| macOS Dock | Hidden when window hidden, shown when window shown |
| New window | `show: false`, waits for `ready-to-show` (avoids flash) |
| External links | Opened in system browser (not in-app) |

## Styling

Tailwind CSS v4 with `@theme` tokens in `main.css`. Light-only theme (Google Drive-inspired). No dark mode.

| Token category | Examples |
|----------------|----------|
| Colors | `--color-primary`, `--color-background`, `--color-sidebar` |
| Radius | `--radius-lg`, `--radius-md`, `--radius-sm` |

shadcn/ui patterns via CVA (Class Variance Authority). Utility merging via `cn()` (`clsx` + `tailwind-merge`).
