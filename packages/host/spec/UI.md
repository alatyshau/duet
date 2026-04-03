# UI

## Navigation

Two-level navigation: **tabs** select a category, **sidebar list** selects a page within that category.

```
┌──────────────────┬─────────────────────────────┐
│ Duet             │                             │
│ [Open DuetData]  │                             │
│ ──────────────── │                             │
│  [⚙]  [▶]       │                             │
│ ──────────────── │  Content (current page)     │
│ ○ DuetData       │                             │
│ ○ DuetConfig..   │                             │
│ ○ Python         │                             │
│ ○ Backend        │                             │
│ ○ Biz Folders    │                             │
│ ○ Инструкции     │                             │
│ ○ AI Агенты      │                             │
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

7-step configuration wizard. Each step is a sidebar item with a status icon.

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

Dependencies declared in `WIZARD_STEPS[].dependsOn`. Enforcement in Phase 6.

### Step Status Icons

| Status | Icon | Meaning |
|--------|------|---------|
| `'done'` | Green circle + checkmark | Step completed |
| `'error'` | Red circle + X | Needs attention |
| `'skipped'` | Gray circle + arrows | Not relevant (e.g. agent not installed) |
| `null` | Hollow circle | Not yet determined |

Status computed from `stepStatuses: Partial<Record<WizardPage, StepStatus>>` passed to Sidebar. Computation logic in Phase 6.

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
| `StepStatusIcon` | Inline in `Sidebar.tsx` | Wizard step status icon (done/error/skipped/null) |

## Layout

| Component | File | Responsibility |
|-----------|------|----------------|
| `App.tsx` | `renderer/src/App.tsx` | Root: AppState subscription, backend controls, page routing |
| `Layout` | `components/layout/Layout.tsx` | Two-column: sidebar + content |
| `Sidebar` | `components/layout/Sidebar.tsx` | Tabs, wizard/apps list, status icons |

## Pages

| Directory | Contains |
|-----------|----------|
| `pages/wizard/` | 7 wizard step pages (stubs in Phase 5, filled in Phase 6) |
| `pages/apps/` | App process pages (`BackendAppPage.tsx`) |
| `pages/` | Legacy pages (`InstallPage.tsx`, `AgentsPage.tsx`) — used temporarily until Phase 6 |

### Transitional State (Phase 5)

Wizard routes 1-6 temporarily render `InstallPage` (monolithic setup page). Route "agents" temporarily renders `AgentsPage`. Phase 6 replaces each with its dedicated page from `pages/wizard/`, then deletes the legacy pages.

## Tray

| Aspect | Value |
|--------|-------|
| Click on icon | Shows window |
| Context menu | "Открыть Duet", "Запускать при старте" (checkbox), "Выйти" |
| Icon: normal | Template icon (adapts to light/dark on macOS) |
| Icon: warning | Warning variant when status != `ready` |
| Tooltip | "Duet" when ready, "Duet — требуется настройка" / "Duet — папка не найдена" |

### Tray Icon Files

| Platform | Normal | Warning |
|----------|--------|---------|
| macOS | `trayTemplate.png` | `trayWarningTemplate.png` |
| Windows | `tray.ico` | `tray-warning.ico` |
| Linux | Same as macOS PNG | Same as macOS PNG |

Location: `resources/tray/{mac,win}/`

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
