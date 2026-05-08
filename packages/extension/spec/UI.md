# UI

## Views

| View | Purpose | Provider |
|------|---------|----------|
| DUET (status) | Shown when backend not ready — welcome message or spinner | Stub `TreeDataProvider` (empty array) |
| КОНТЕКСТ | Current workspace position in the context hierarchy | `ContextProvider.ts` |
| ДЕЛА | Full context tree for navigation | `ContextTreeProvider.ts` |

## Visibility Contract

| View | Condition (`when` in package.json) |
|------|-----------------------------------|
| DUET (status) | `!duet.ready` |
| КОНТЕКСТ, ДЕЛА | `duet.hasPointer && duet.ready` |

**Context keys:**

| Key | Type | Set by |
|-----|------|--------|
| `duet.ready` | boolean | `SidebarStateManager.setFromHealthCheck()` — true after providers registered |
| `duet.hasPointer` | boolean | `extension.ts` activation — true if `~/.org.ve68.duet` exists |
| `duet.initializing` | boolean | `SidebarStateManager.setInitializing()` — true during backend connection |

**How it works:** Extension reads pointer → sets `duet.hasPointer`. Tries to connect to backend → on success, registers providers, sets `duet.ready=true`. On failure, `duet.ready` stays false → status view shows "Установите и запустите Duet Host".

**viewsWelcome content:**

| View | When | Content |
|------|------|---------|
| DUET (status) | `duet.initializing` | `$(sync~spin) Подключение к backend...` |
| DUET (status) | default | `Установите и запустите Duet Host` + reload button |
| КОНТЕКСТ | default (no folder open) | `Нет открытой папки` + open folder button |

## Behavioral Contracts

Things that are easy to accidentally break:

| View | Behavior | Why it matters |
|------|----------|----------------|
| ДЕЛА | **Accordion**: one root context expanded at a time | Reduces visual noise, focus on active work |
| ДЕЛА | Expand root context → expands to leaves | User sees full hierarchy without extra clicks |
| ДЕЛА | Auto-expand active root context on startup | Opens the root the user is working in |
| ДЕЛА | Solid `────` line between root contexts; blank spacer row between first-level children of a root | Visual separation between roots and inside an expanded root, without competing dotted clutter |
| ДЕЛА | Header `[МОИ ДЕЛА]` not collapsible | Visual anchor, not a real node |
| ДЕЛА | Header has hover icon → open root-contexts.code-workspace | Quick access to multi-root |
| ДЕЛА | Placeholder when empty: "Добавьте root-контекст в Duet Host" | User is pointed to the Host (which owns root-context configuration), not to a non-existent in-Extension button |
| ДЕЛА | Icons: emoji from manifest in label (e.g. `🔬 МетаЛаб`) | Custom icons from manifests, no ThemeIcon |
| ДЕЛА | Description: contextual label (мета-контекст / контекст / контекст [git]) | User sees role at a glance |
| ДЕЛА | Description: `[git]` marker for contexts with git_url | User sees which contexts have repos |
| ДЕЛА | **Chain highlighting**: 🟠 for active node + all ancestors | User sees path to current work |
| ДЕЛА | Root status: 🔹/🟦/🔸/🟧 (collapsed/expanded × inactive/active) | User sees state at a glance |
| ДЕЛА | Toggle button (fold icon) | Single button to expand/collapse all |
| ДЕЛА | Click = select, arrow = toggle | User can select without collapsing |
| КОНТЕКСТ | Welcome view when no folder open | User knows how to open folder |
| КОНТЕКСТ | Settings via submenu (not QuickPick) | Faster access, no intermediate dialog |
| КОНТЕКСТ | Nodes always expanded | Breadcrumb should show full path |
| КОНТЕКСТ | Error nodes clickable → show help | User needs guidance on how to fix |

## Error Codes (КОНТЕКСТ)

| Code | Meaning | User action |
|------|---------|-------------|
| `orphan` | Repo in repos/ but no matching git-backed context in DB | Add `context.json` with `git_url` on Drive |
| `name_conflict` | Repo name matches a context that has no `git_url` | Rename repo or set `git_url` on the matching context |
| `outside_repos` | Repo not in DuetData/repos/ | Move to repos/ |
| `outside_hierarchy` | Folder not in any context | Add a root context via ДЕЛА |

## ДЕЛА Accordion Behavior

The context tree uses **accordion** pattern: only one root context can be expanded at a time.

### State Transitions

```
[All collapsed] --click root--> [Root expanded to leaves]
[Root A expanded] --click root B--> [A collapsed, B expanded to leaves]
[Root expanded] --click collapse arrow--> [All collapsed]
```

### Visual Indicators

Root context status circles encode two dimensions:

| Circle | Expanded | Active |
|--------|----------|--------|
| 🔹 | No | No |
| 🔸 | No | Yes |
| 🟦 | Yes | No |
| 🟧 | Yes | Yes |

Non-root nodes use:
- 🟠 = in active chain (current OR has active descendant)
- ◻️ = inactive

### Implementation

- `AccordionController.ts` — expand/collapse orchestration
- `ContextTreeProvider.ts` — state tracking, label generation
- `ContextTree.ts` — `getDescendants()` for expand-to-leaves

## Future

- Worktree support in КОНТЕКСТ
