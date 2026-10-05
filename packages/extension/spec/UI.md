# UI

> Surface, providers, command behavior, decorations: [COMPONENT.md](COMPONENT.md). This file covers per-view rendering rules and behavioral contracts the user sees.

## Views

Three sidebar views, each with its own visibility gate:

| View | ID | Purpose | Provider | Data source |
|------|-----|---------|----------|-------------|
| DUET (status) | `duet.status` | Shown when backend not ready — welcome message or spinner | Stub `TreeDataProvider` (empty array) | — |
| КОНТЕКСТ | `duet.context` | Show where the window stands: the venture, the current business, the businesses directly under it | `ContextProvider.ts` | `GET /contexts` (`ContextEntity[]`, the list ДЕЛА already holds) |
| ДЕЛА | `duet.contexts` | Full forest of root contexts and descendants for navigation | `ContextTreeProvider.ts` | `GET /contexts` (`ContextEntity[]`) |

### Visibility

| View | Condition (`when` in package.json) |
|------|-----------------------------------|
| DUET (status) | `!duet.ready` |
| КОНТЕКСТ, ДЕЛА | `duet.hasPointer && duet.ready` |

Context keys:

| Key | Type | Set by |
|-----|------|--------|
| `duet.ready` | boolean | `SidebarStateManager.setFromHealthCheck()` — true after providers registered |
| `duet.hasPointer` | boolean | `extension.ts` activation — true if `~/.org.ve68.duet` exists |
| `duet.initializing` | boolean | `SidebarStateManager.setInitializing()` — true during backend connection |

**How it works:** Extension reads pointer → sets `duet.hasPointer`. Tries to connect to backend → on success, registers providers, sets `duet.ready=true`. On failure, `duet.ready` stays false → status view shows "Установите и запустите Duet Host".

`viewsWelcome` content:

| View | When | Content |
|------|------|---------|
| DUET (status) | `duet.initializing` | `$(sync~spin) Подключение к backend…` |
| DUET (status) | default | "Установите и запустите Duet Host" + reload button |
| КОНТЕКСТ | default (no folder open) | "Нет открытой папки" + open folder button |

## ДЕЛА — forest navigation

Full forest of root contexts and descendants, accordion pattern, alias-based highlighting.

### Behavioral contracts

| Behavior | Why it matters |
|----------|----------------|
| **Accordion**: one root context expanded at a time | Reduces visual noise, focus on active work |
| Expand root context → expands to leaves | User sees full hierarchy without extra clicks |
| Auto-expand active root context on startup | Opens the root the user is working in |
| Solid `────` line between root contexts; blank spacer between first-level children of a root | Visual separation between roots and inside an expanded root, no dotted clutter |
| Header `[МОИ ДЕЛА]` not collapsible | Visual anchor, not a real node |
| Header has hover icon → open `root-contexts.code-workspace` | Quick access to multi-root |
| Placeholder when empty: "Добавьте root-контекст в Duet Host" | User pointed to Host (which owns root-context configuration), not to a non-existent Extension button |
| Icons: emoji from manifest in label (e.g. `🔬 МетаЛаб`) | Custom icons from manifests, no ThemeIcon |
| Description: `[git]` marker for contexts with git products (non-empty `git_repos`); otherwise empty | Show role at a glance, no `мета-контекст` / `контекст` decoration |
| **Chain highlighting**: 🟠 for active node + all ancestors | User sees path to current work |
| A context is current only when its own folder is among the window's folders; an open repo folder marks nobody | One repo may be declared by several businesses, so a repo cannot say which of them the window belongs to. The panel opens business folders, and the business folder is what identifies the window |
| Toggle button (fold icon) | Single button to expand/collapse all |
| Click = select, arrow = toggle | User can select without collapsing |

### Accordion state machine

```
[All collapsed] --click root--> [Root expanded to leaves]
[Root A expanded] --click root B--> [A collapsed, B expanded to leaves]
[Root expanded] --click collapse arrow--> [All collapsed]
```

### Status indicators

Root context status circles encode two dimensions:

| Circle | Expanded | Active |
|--------|----------|--------|
| 🔹 | No | No |
| 🔸 | No | Yes |
| 🟦 | Yes | No |
| 🟧 | Yes | Yes |

Non-root nodes:
- 🟠 — in active chain (current OR has active descendant)
- ◻️ — inactive

### Implementation

- `AccordionController.ts` — expand/collapse orchestration
- `ContextTreeProvider.ts` — state tracking, label generation
- `ContextTree.ts` — `getDescendants()` for expand-to-leaves

## КОНТЕКСТ — current business

Shows where the window stands in the tree of businesses: the venture, the current business and the businesses directly under it. Built from the `/contexts` list.

### Behavioral contracts

| Behavior | Why |
|----------|-----|
| Welcome view when no folder open | User knows how to open folder |
| Settings via submenu (not QuickPick) | Faster access, no intermediate dialog |
| Nodes always expanded | The panel should show the whole path at a glance |
| Current business = the business whose folder is among the window's folders | Same rule as the 🟠 marker in ДЕЛА; a repo folder never chooses a business |
| Several business folders open → the meta-context, otherwise the first in the window's folder order | Same tie-break the Backend uses when it deploys instructions. The Backend, unlike the panel, also accepts a folder inside a business: a window opened on a ticket folder gets instructions deployed and an empty panel |
| Single info node «В окне не открыта папка бизнеса» when no window folder is a business folder | A window with only a repo, or a folder inside a business that is not the business folder itself, has no current business |
| Labels: emoji prefix from the manifest icon (e.g. `🎭 DuetLab`) | Visual parity with ДЕЛА — same `icon` field of `/contexts` |
| Tooltip: description (manifest `description`, else README first sentence), then the folder path | The panel names the business; the meaning is one hover away |

### Tree shape

Built by `core/tree/contextPanel.ts:buildContextPanel` from `ContextEntity[]` and the window's folders:

| Node | Role | Children |
|------|------|----------|
| venture | root of the current business's parent chain | the current business |
| current business | the business whose folder is open | the businesses directly under it |
| child business | `parent_id` = current business | none (deeper levels are in ДЕЛА) |
| `info` | fallback when the window has no business folder | none |

Intermediate parents between the venture and the current business are not shown. When the current business is itself a venture, it is the root and its child businesses hang directly under it.

## Future

- Worktree support in КОНТЕКСТ
