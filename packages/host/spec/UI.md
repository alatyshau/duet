# UI

## Navigation

Two-level navigation: **tabs** select a category, **sidebar list** selects a page within that category.

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
│ ✅ Инструкции    │                             │
│ 🟡 AI Агенты     │  ← warning (amber)         │
└──────────────────┴─────────────────────────────┘
```

### Tabs

| Tab | Icon | Tooltip | Content |
|-----|------|---------|---------|
| Settings | ⚙ | Настройки | Wizard — 6-step setup |
| Apps | ▶ | Приложения | Running processes |

Icon-only tab buttons (no labels) — label shown as tooltip on hover. Severity indicator next to icon when children have issues. Switching tab navigates to the first item in that tab's list.

### Typed Routing

All navigation types defined in `renderer/src/navigation.ts`:

| Type | Values |
|------|--------|
| `Tab` | `'settings'` \| `'apps'` |
| `WizardPage` | `'duet-paths'` \| `'python'` \| `'backend'` \| `'workspaces'` \| `'instructions'` \| `'agents'` |
| `AppPage` | `'app:duet-backend'` |
| `Page` | `WizardPage` \| `AppPage` |

`tabForPage(page)` derives tab from page. `DEFAULT_PAGE` = `'duet-paths'`.

## Settings Tab — Wizard

6-step configuration wizard. Each step is a self-contained page with its own state and IPC calls. Status icons in sidebar reflect live configuration state.

### Steps

| # | Page | Label | Required | Depends on |
|---|------|-------|----------|------------|
| 1 | `duet-paths` | Duet: пути | yes | — |
| 2 | `python` | Python 3.10+ | yes | — |
| 3 | `backend` | Backend | yes | 1, 2 |
| 4 | `workspaces` | Воркспейсы | yes | 1, 3 |
| 5 | `instructions` | Инструкции | yes | 1 |
| 6 | `agents` | AI Агенты | yes | 3, 5 |

Dependencies declared in `WIZARD_STEPS[].dependsOn`. Enforced at runtime:
- **Sidebar:** unavailable steps (deps not `ok` or `warning`) rendered with dimmed text (`text-muted-foreground/50`). Navigation still allowed (user can read help text). Warning deps are satisfied — warning means "works but not ideal".
- **Pages:** action buttons disabled when dependencies unmet; dependency banner shown (e.g. InstructionsPage warns when DuetConfig/machine not configured).
- **IPC:** `config:set-instructions-path` throws if machine config not writable (prevents silent data loss).
- Helpers: `isStepAvailable(page, statuses)`, `getMissingDeps(page, statuses)` in `navigation.ts`.

### Page Status Icons

`PageStatusIcon` in `Sidebar.tsx` — renders sidebar icon per `PageStatus`:

| PageStatus | Icon | Meaning |
|-----------|------|---------|
| `'ok'` | Green circle + checkmark | Page completed correctly |
| `'error'` | Red circle + X (via `SeverityIcon`) | Page has errors |
| `null` | Hollow gray circle | Not yet configured (blocks user) |
| `'warning'` | Amber triangle + ! (via `SeverityIcon`) | Page has warnings |
| `'skipped'` | Gray circle + arrows | Not relevant |

`error` and `warning` icons rendered via shared `SeverityIcon` component — same icons used in `StatusTable` rows and tab severity indicators.

Status computed by `computePageStatuses()` in `core/wizard-status.ts` (pure function) merged with dynamic page callbacks.

### Page Status Sources

| Pages | Source | PageStatus |
|-------|--------|-----------|
| 1 | AppState fields (duetDataPath, duetConfigPath, machine) | `ok` when all three set, `null` otherwise |
| 2 | AppState.pythonPath | `ok` when set, `null` otherwise. Page auto-detects on mount |
| 3 | DeployStatus + hasDeployWarning | `ok` when deployed, `warning` when channel mismatch/stale, `null` otherwise |
| 4 | Scan result (cached or fresh) | `ok` when 0 errors, `error` when errors exist |
| 5 | Instructions merge result | `ok` when 0 errors, `error` when errors exist |
| 6 | Agent detection | `ok` when all found agents configured, `warning` when any needs_setup |

### Page Architecture

Each wizard page:
- Produces `StatusItem[]` — rendered via shared `<StatusTable />` component
- Receives `appState: AppState` prop (for config values)
- Receives `onStatusChange: (status: PageStatus) => void` callback
- Calls `window.api.*` directly for its own IPC operations
- Manages its own local state (no state lifting to App.tsx)

Pointer saves use partial updates: each page passes only its field(s) to `savePointer`, others are preserved.

### Step Details

**Step 4 (Backend):** Deploy status/button, channel toggle (DEV/PROD, visible when `hasDevBackendPath`), deploy logs. VERSION displayed with full build metadata (e.g. `0.1.8+prod_abc1234`). Shows "(актуальна)" only when semver matches AND channel matches current mode. Channel mismatch warning: "Установлена DEV-версия — переустановите для PROD" (or vice versa). `VersionInfo` sub-component handles parsing and display.

**Step 1 (Duet: пути):** Four sections: DuetData (folder picker), DuetConfig (folder picker), Machine name (text input), Business folders (add / remove / drag-reorder). Status = `ok` when all three base paths set (business folders are optional). Business folder operations use `business-folders:get` (load), `business-folders:add` (picker → alias-aware add), `business-folders:save` (remove + reorder rewrite the full list), `business-folders:set-root` (drag to position 0 or remove of root re-promotes position 0). Persist-then-update-UI: handlers await IPC success before mutating local state and surface errors via inline `folderError` text.

**Step 4 (Воркспейсы):** Scan button + results. Shows entity tree from `streams.json` (built via `parent_id`, with icons and types). Error table is informational — scanner auto-heals collisions and missing manifests, errors are notifications with file paths. No Fix buttons for scan errors. If no business folders configured, shows message directing user to step 1.

**Step 5 (Instructions):** Two states with bidirectional transition:

- **Onboarding** (`instructionsPath` not set): Two cards — "Скачать шаблон Duet" (primary, accent border, "Рекомендуется" badge) downloads zip from GitHub via `instructions:download-template` IPC, and "Указать существующую папку" (secondary) for users with existing repo. Expandable "Для продвинутых: fork + git clone" section with step-by-step guide. Download card handles: folder picker → emptiness check (`instructions:is-folder-empty`) → confirm overwrite if non-empty → download with spinner → auto `setInstructionsPath` + `mergeInstructions` → transition to configured state. Download errors shown inline with retry button.
- **Configured** (`instructionsPath` set): Path display with Изменить (folder picker → re-merge) and Открыть buttons. Regenerate button (full-width). On 0 errors, auto-configures AI agents (step 6) via `onAgentsUpdated` callback. Error table with Fix buttons for auto-fixable errors (`no_frontmatter`, `invalid_yaml`, `missing_fields`). "Сбросить настройку" text link at bottom (muted, with confirmation) → clears path → returns to onboarding.

Dependency banner shown when DuetConfig/machine not configured (step 1); action buttons disabled.

**Step 6 (AI Agents):** Agent cards show checked files list and issues. Fix button for fixable issues (e.g. additionalDirectories). Not-found agents show description + clickable install link (Claude Code, Codex, Antigravity). No dark: classes (light-only theme).

## Apps Tab

| Page | Label | Indicator |
|------|-------|-----------|
| `app:duet-backend` | Duet Backend | `StatusDot` showing `ProcessState` |

## Shared UI Components

| Component | File | Purpose |
|-----------|------|---------|
| `SeverityIcon` | `components/ui/severity-icon.tsx` | **Unified severity icon** for all UI levels. Props: `severity: Severity`, `size?: 'sm' \| 'md'`. Error = XCircle red, Warning = AlertTriangle amber |
| `StatusTable` | `components/ui/status-table.tsx` | Renders `StatusTableItem[]` on pages. Each row: `SeverityIcon` + message + optional detail (file path) + optional Fix button. Border color from severity (red/amber) |
| `StatusDot` | `components/ui/status-dot.tsx` | Process state indicator (colored dot or spinner). Props: `state: ProcessState`, `size: 'sm' \| 'md'` |
| `ProcessStateLabel` | `components/ui/process-state-label.tsx` | Text badge with process state. Props: `state: ProcessState` |
| `Button` | `components/ui/button.tsx` | shadcn/ui button with CVA variants |
| `PageStatusIcon` | Inline in `Sidebar.tsx` | Page status icon: `ok`/`null`/`skipped` own icons, `error`/`warning` via `SeverityIcon` |

## Layout

| Component | File | Responsibility |
|-----------|------|----------------|
| `App.tsx` | `renderer/src/App.tsx` | Root: AppState subscription, deploy subscription, page status computation, page routing |
| `Layout` | `components/layout/Layout.tsx` | Two-column: sidebar + content. Passes pageStatuses to Sidebar |
| `Sidebar` | `components/layout/Sidebar.tsx` | Tabs, wizard/apps list, status icons |

## Pages

| Directory | Contains |
|-----------|----------|
| `pages/wizard/` | 6 wizard step pages (DuetPaths, Python, Backend, Workspaces, Instructions, Agents) |
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

Each tab button shows a `SeverityIcon size="sm"` when its children have issues:
- Settings tab: `getSettingsSeverity(pageStatuses)` — max of all wizard pages
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
