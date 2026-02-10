# UI

## Pages

| Page | Purpose | Provider |
|------|---------|----------|
| Setup (Установка) | Pointer file creation/editing (3 fields) | `SetupPage.tsx` |
| Settings (Настройки) | Placeholder — future settings | — |

## Layout

```
┌────────────┬───────────────────────────────┐
│  Sidebar   │                               │
│            │        Content Area            │
│  Logo      │        (current page)          │
│  [Open]    │                                │
│  Settings  │                                │
│  Setup     │                                │
│            │                                │
└────────────┴───────────────────────────────┘
```

| Component | File |
|-----------|------|
| Layout (sidebar + content) | `components/layout/Layout.tsx` |
| Sidebar (nav + open button) | `components/layout/Sidebar.tsx` |
| SetupPage | `pages/SetupPage.tsx` |

## SetupPage Fields

| # | Field | Widget | Validation |
|---|-------|--------|------------|
| 1 | DuetData path | Folder picker (system dialog) | Required, path must exist for `ready` |
| 2 | DuetConfig path | Folder picker (system dialog) | Required, path must exist for `ready` |
| 3 | Machine name | Text input | Required, non-empty |

### Save Behavior

| Trigger | When |
|---------|------|
| Auto-save on folder select | If all 3 fields are filled |
| Manual Save button | When user clicks (validates machine name) |
| Button hidden | When status = `ready` |

### Visual States

| State | Indicator |
|-------|-----------|
| Field empty | Warning triangle (amber) |
| Field set | Green checkmark |
| Machine name empty on save | Red border + error text |

## Sidebar Behavioral Contracts

| Behavior | Contract |
|----------|----------|
| "Открыть DuetData" button | Disabled until status = `ready` |
| Settings nav item | Disabled until status = `ready` |
| Setup nav item | Always enabled |
| Active page | Highlighted with primary color |

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

## Draft State Pattern

App.tsx maintains **draft values** separate from saved AppState:
- `draftDuetDataPath`, `draftDuetConfigPath`, `draftMachine`
- Populated from AppState on load and on state change
- SetupPage sees display state (draft merged with AppState)
- Save writes draft → pointer file → triggers AppState re-check

This allows editing fields without immediately writing to disk.

## Implementation

| Concept | File |
|---------|------|
| Root component + draft state | `App.tsx` |
| Setup page | `pages/SetupPage.tsx` |
| Layout wrapper | `components/layout/Layout.tsx` |
| Sidebar navigation | `components/layout/Sidebar.tsx` |
| Button component | `components/ui/button.tsx` |
| Tray icon + menu | `platform/tray.ts` |
| Window management | `main/window.ts` |
