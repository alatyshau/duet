# UI

> Surface, providers, command behavior, decorations: [COMPONENT.md](COMPONENT.md). This file covers per-view rendering rules and behavioral contracts the user sees.

## Views

Three sidebar views, each with its own visibility gate:

| View | ID | Purpose | Provider | Data source |
|------|-----|---------|----------|-------------|
| DUET (status) | `duet.status` | Shown when backend not ready — welcome message or spinner | Stub `TreeDataProvider` (empty array) | — |
| КОНТЕКСТ | `duet.context` | Render the chain of contexts the current workspace folders resolve into, plus the products and components of the current context | `ContextProvider.ts` | `POST /orientation` (`OrientationResponse`) |
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
| Description: `[git]` marker for terminal contexts (non-empty `git_repos`); otherwise empty | Show role at a glance, no `мета-контекст` / `контекст` decoration |
| **Chain highlighting**: 🟠 for active node + all ancestors | User sees path to current work |
| Terminal-context highlight is alias-based: match `git_repos` keys against open `<alias>.git` folder names (NOT the context label) | A DuetLab-style context with aliases `Duet`, `Duet-Instructions` lights up when either repo is open; matching by label would silently miss the case |
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

## КОНТЕКСТ — current chain

Renders the chain of contexts the current workspace folders resolve into, plus products and components of the current context.

### Behavioral contracts

| Behavior | Why |
|----------|-----|
| Welcome view when no folder open | User knows how to open folder |
| Settings via submenu (not QuickPick) | Faster access, no intermediate dialog |
| Nodes always expanded | Breadcrumb should show full path |
| Single info-node fallback (no clickable error nodes) | `workspace.kind === "unknown"` rendered as one «Папка вне иерархии контекстов» node; backend already classifies, view doesn't re-classify |
| Chain labels: emoji prefix from `chain[*].icon` (e.g. `🎭 DuetLab`) | Visual parity with ДЕЛА — same manifest icon, same `Entity.icon` source on backend |
| Description column: empty for products, `comp` for components, empty for chain nodes | Suffix `.git` in product name already distinguishes git from drive-products; component path is decorative noise (already in tooltip) |

### Tree shape

Four kinds of nodes built from `OrientationResponse`:

| Kind | Source | Children |
|------|--------|----------|
| `chain` | each element of `response.context.chain[]` | next chain element; on the last chain node — top-level `products[]` |
| `product` | `response.products[]` | the product's `components[]` |
| `component` | `product.components[]` | none |
| `info` | fallback when `workspace.kind === "unknown"`, `chain` is empty, or orientation is `null` | none |

Paths in `product.path` / `component.path` are `@`-refs (`@Duet.git`, `@OntoCore/LangLab`, `packages/backend`). Resolution against `workspace.git_folders` / `workspace.context_folder` happens in `core/pathUtils.ts:resolveAtRef`; result is shown in tooltips — not in the description column, which only carries the `comp` marker for components.

The legacy КОНТЕКСТ error-code table (`orphan`, `name_conflict`, `outside_repos`, `outside_hierarchy`) was removed together with `core/tree/contextBreadcrumb.ts` — backend now exposes only the binary `kind: "context" | "unknown"` and the view honours that distinction.

## Future

- Worktree support in КОНТЕКСТ
