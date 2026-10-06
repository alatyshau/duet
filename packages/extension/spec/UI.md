# UI

> Surface, providers, command behavior, decorations: [COMPONENT.md](COMPONENT.md). This file covers per-view rendering rules and behavioral contracts the user sees.

## Views

Five sidebar views, top to bottom, each with its own visibility gate:

| View | ID | Purpose | Provider | Data source |
|------|-----|---------|----------|-------------|
| Активная Работа | `duet.intents` | The windows Duet opened in this program: business windows first, then the active intents of every business — tickets that have a window open. One click switches to the window | `IntentsProvider.ts` | window markers in `DuetData/intents/<program>/` — no Backend |
| Корзина | `duet.bin` | All tickets of the current business from `work/` and `backlog/`; opens an intent, moves a ticket between the two, keeps their order. Never switches windows | `BinProvider.ts` | ticket folders of the business on disk + window markers |
| DUET (status) | `duet.status` | Shown when backend not ready — welcome message or spinner | Stub `TreeDataProvider` (empty array) | — |
| КОНТЕКСТ | `duet.context` | Show where the window stands: the venture, the current business, the businesses directly under it | `ContextProvider.ts` | `GET /contexts` (`ContextEntity[]`, the list «Все Бизнесы» already holds) |
| Все Бизнесы | `duet.contexts` | Full forest of root contexts and descendants for navigation | `ContextTreeProvider.ts` | `GET /contexts` (`ContextEntity[]`) |

### Visibility

| View | Condition (`when` in package.json) |
|------|-----------------------------------|
| Активная Работа | `duet.hasPointer` — as soon as the DuetData path is known, Backend or not |
| DUET (status) | `!duet.ready` |
| Корзина, КОНТЕКСТ, Все Бизнесы | `duet.hasPointer && duet.ready` |

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

«Активная Работа» and Корзина have no welcome content: an empty one is empty, without text.

## Активная Работа — active intents

An *intent* is a ticket of a business; it is *active* while a window of this program is open on it. Closing the window pauses the intent; nothing is written into the ticket. The view also lists the windows of businesses, so it is the one place to switch between everything Duet opened. How the windows find each other: [COMPONENT.md → Intents](COMPONENT.md#intents).

### Row

Both intent views build a row the same way (`core/intents/naming.ts:rowText`, `vscode/providers/rowLook.ts`):

```
АКТИВНАЯ РАБОТА
🚀  1: DuetLab  biz
🧰  2: Intent Switcher  DUE017 🔴
🚀  3: Core Protocols  DUE008
```

| Part | Where | Rule |
|------|-------|------|
| Icon | the row's icon place, at the left edge | The emoji drawn as a small picture. In «Активная Работа», by three steps: the ticket's own emoji — `icon` in the frontmatter of its `INDEX.md`; else the emoji of its parent ticket, the nearest one up the `parent` chain that has an icon; else the emoji of its business from `context.json`. For a business row, the emoji of the business. In Корзина: the ticket's own emoji or nothing — no inheritance there. A row without an emoji gets an empty picture, so all names start in one column |
| Name | label | The intent name, or the business name |
| Number | in front of the name, «Активная Работа» only: `2: Intent Switcher` | The first nine rows, counted from 1 in shown order — windows of businesses and of intents alike, the way the editor numbers its tabs. It is the digit of the shortcut that switches to the row: Cmd+1 … Cmd+9. The number is the place of the row, not a property of the window: after a drag, or when a window opens or closes, the rows take new numbers, in every window. Rows past the ninth carry none. In the row of the current window the backdrop lies under the number too |
| Tag | description — the tree draws it smaller, after the name | The ticket number; `biz` for a business row. A ticket number in front, of uneven width, would push the names out of line and leave the icon no place |
| Colour | the whole text of the row | The colour of the row's window, the one in force now — only rows that have a window open. A row whose window has no colour, or one outside the palette, keeps the colour of the theme. In dark themes a lighter shade of the same colour is used: the palette is dark, chosen to carry white text |
| «🔴» | end of the row, «Активная Работа» only | Stands at the row of the window you are in |

The tab of the intent's notepad carries the same emoji as its row in «Активная Работа», by the same three steps, and in the intent's own window the name on that tab takes the colour of the window.

What the stock tree can and cannot colour:

| | Font colour | Background colour |
|---|---|---|
| The whole name | yes, each row its own — from the eight declared colours | only as a backdrop, one colour for the whole window |
| A part of the name | no | yes, as a backdrop, one colour for the whole window |
| The tag after the name | only the same as the name: it cannot get another, nor stay uncoloured | no |

The rules that follow from it. Font colour: every row of «Активная Работа», and in Корзина only the rows of tickets that have a window open — an intent is active whenever a window is open on it, not only in the window one looks at; the colour is the one in force in that window now. Backdrop: only under the name of the current window's row — its row in «Активная Работа» and, in Корзина, the row of the ticket the window is opened on — in the light version of this window's colour. The selection of a row is a state of the list, not paint; its colour is set apart (see the contracts below).

### Behavioral contracts

| Behavior | Why it matters |
|----------|----------------|
| At the very top of the Duet side bar; the title holds the name «Активная Работа» and two buttons — «новый тикет» and refresh — nothing else | The switcher is the first thing in the bar |
| «Новый тикет» (`+`, shown once Backend has answered) asks one thing — the name, in an input box — then makes the next ticket of the window's business in `work/` and opens its window, where the notepad is waiting. The number is never asked for: it is the next project number of the business. The typed name becomes the folder name after the number in strict PascalCase — `ui research` and `UI research` both give `DUE023_UiResearch`; Cyrillic stays Cyrillic. Enter on an empty box makes a ticket with the bare number; Escape makes nothing. Parent, area, a move, a rename are not asked — an agent does them later | Adding a ticket is starting active work on it, so the button is here and not in Корзина. One question keeps it one gesture; one strict rule gives the same name however carelessly it was typed |
| Flat list from the markers of this program's windows: business windows first, by name, then the active intents of all businesses | One list to switch between everything that is open; the business window is where one comes back to |
| A business window is listed whether it was opened by its workspace file or as a plain folder; it is not mentioned in Корзина — it is opened from «Все Бизнесы» | The bin is the work of a business, not the business |
| One click switches to the window of the row. Only this view switches | Switching is the purpose of the view |
| Cmd+1 … Cmd+9 switch to the row that shows this number now — a business window or an intent; the same switch as the click, from wherever the focus is: an editor, the terminal, a web panel. A digit no row carries, and the digit of the current window, do nothing. Declared by the extension (macOS), active wherever Duet is set up (`duet.hasPointer`); they take these keys from the editor's «focus editor group N» | Going to an intent without the mouse and without looking for its row. The number in the row and the key are one number, counted anew from the shown rows each time (`intents/active.ts:numberedRows`), so they cannot disagree |
| The name in the row of the current window stands on a backdrop — the light version of the window colour — and the row ends with «🔴»; the row keeps its place. The backdrop covers the whole name and nothing else: the tag after the name cannot have one. No other row of this view has a backdrop | The user sees where they are without the list jumping. The backdrop is the highlight of a search match, whose colour is one for the whole window — so it can be this window's own colour |
| The saturated selection of a row — the fill of the selected row while the list has the focus — and the outline of the focused row take the colour of the window, in every list of that window. The pale selection of a list without focus stays the theme's | The window colour is set in the workspace file, so it cannot be limited to one view |
| After a switch the selection in the window left behind returns to that window's own row — only while the view is visible | The clicked row stays selected and would outshine the highlighted one |
| Order of intents is set by dragging: a row dragged up lands before the target, a row dragged down — after it, a drop past the rows — at the end. Business rows are not dragged and always stand first; a drop on one puts the intent first among the intents | The tree reports only the row a drop landed on, not the place between rows |
| The order is remembered, the same in every window of the program, and changes in the others at once; an intent it does not hold stands after the listed ones, by number | One order per program, kept in `intents/<program>/active.json` |
| Refresh re-reads the window markers | A manual way out if a marker went stale |
| Works without Backend | An intent window marks itself and reads markers from DuetData alone |
| Only rows of this view can be dropped here | Each view accepts only the drag data of its own tree |

## Корзина — work of the current business

A separate collapsible view under «Активная Работа» with its own refresh button, which re-reads the business folders. The current business is found as in КОНТЕКСТ, and the title names it — «Корзина DuetLab» (`intents/naming.ts:binTitle`); in a window without a business the title is the bare «Корзина» and the view is empty, without text.

The bin is for managing the backlog and the order of work. It never switches windows: that is the job of «Активная Работа» alone, and every feature of the bin is measured by this.

### Tree shape

Built by `core/intents/binTree.ts:buildBinTree`. A *container* is a ticket with `work-type: process` or `program`.

```
КОРЗИНА
        Duet Lab Curation  DUEA01
  ⌄ 🐚  Shell Prototype  DUEX01
          Shell Kick Start  DUE004
          UI Research  DUE007
  ⌄ 📜  Work Doctrine  DUEX02
          Prompt Analysis  DUE006
          Core Protocols  DUE008        ← in the colour of its window
          Duet Work2  DUE011
          Duet Orientation  DUE013
    ›     Backlog
  ⌄     Unsorted
          Intent Switcher  DUE017       ← in the colour of its window
```

| Rule | Detail |
|------|--------|
| Root order | containers, «Unsorted», root «Backlog». Containers stand in the remembered order, processes and programs mixed as the user put them; those the order does not hold come after — processes, then programs, each by number |
| Under a container | its tickets from `work/`, then a «Backlog» node with its tickets from `backlog/` |
| Container of a ticket | the nearest process or program up the `parent` chain of `INDEX.md`; an empty value and `null` mean «no parent» |
| «Unsorted» | tickets whose parent is not in `work/` or `backlog/` of this business, or whose chain has no container, or whose `INDEX.md` cannot be read; the same shape as a container group |
| Containers stand flat | a container's own `parent` is ignored |
| Where a container group stands | in the root while the container lies in `work/` or at least one of its tickets does — a program does not hide in the backlog while its ticket is in work; otherwise the whole group, in the same shape, goes under the root «Backlog» |
| A container from `work/` | always in the root, even when empty |
| Empty «Backlog», empty «Unsorted» | not shown |
| Order inside a group | the remembered order; tickets it does not hold come after, by number |
| Every row appears once | two folders with one number are two rows |

### Behavioral contracts

| Behavior | Why it matters |
|----------|----------------|
| Collapsed by default (`"visibility": "collapsed"`) | It should take the least room. The default applies where VS Code has no saved state for the view; after that the view stays as the user left it — an extension cannot collapse a view |
| Each time the view becomes visible: containers and «Unsorted» expanded, every «Backlog» collapsed | A known starting shape. VS Code has no «collapse this node»; the shape is restored by giving the rows new ids, and only on becoming visible — never on a data refresh, or a «Backlog» opened to pull a ticket out would shut in mid-gesture |
| Becoming visible is all the extension learns: it cannot tell expanding the view from coming back to the Duet side bar | So the shape is restored on both |
| A ticket with an open window stays in its place and its text takes the colour of that window; there is no other mark | The bin is the full list of the business's work; being open is told by the colour, the same colour the row has in «Активная Работа» |
| The name of the ticket the current window is opened on stands on a backdrop — the same one as in its row of «Активная Работа»; without «🔴». In a business window no row has it | The colour tells which tickets are open, the backdrop tells which of them is this window. One sign for the current window wherever its row is shown (`rowLook.ts:rowLabel`) |
| A click on any row only selects it; nodes are toggled by the arrow, as in «Все Бизнесы» | A click is the start of managing a row — selecting, dragging; a jump to another window would break it. Opening is a deliberate act with a button |
| A ticket without an open window shows two buttons on hover — «open in the current window», «open in a new window» — the same as a business in «Все Бизнесы» | One habit for both |
| Opening a ticket from the backlog first moves its folder to `work/` | An open intent is work in progress |
| A ticket from `work/` without an open window has a third button — «to the backlog». A ticket with an open window has no buttons | An empty «Backlog» is not shown, so a drop target may be missing |
| A container row is a ticket with the same buttons; moving a container to the backlog does not touch its tickets | Containers are tickets too |
| A ticket is dragged only inside its group: between its «Backlog» and its work (the folder moves) and to reorder its tickets. Up — before the target, down — after it. A drop on the header puts the ticket first in work; on «Backlog» from work — first in the backlog, from the backlog — last in work | The tree reports only the row a drop landed on |
| A process or a program is dragged to change its place among the containers of its level — those of the root, or those under the root «Backlog»; its folder never moves. A drop on a row inside another container counts as a drop on that container; on «Unsorted» or past the rows — last; on the root «Backlog» from inside it — first | The order of programs and processes is the top level of the order of work. One sequence for both kinds: a program may stand before a process |
| Not dragged: tickets between programs, a container between the root and the root «Backlog», a ticket with an open window into «Backlog», the rows «Unsorted» and «Backlog», rows between the two views | Each would change more than an order: a ticket in another program means another `parent` in its `INDEX.md`, which the extension only reads |
| A refused drop is told in one line | The tree cannot forbid a drop in advance: a forbidden target is highlighted like an allowed one |
| Before any action the disk is read; the tree never shows a result ahead of the disk | The folders may have been moved by an agent or by sync |

## Все Бизнесы — forest navigation

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
| Current business = the business whose folder is among the window's folders | Same rule as the 🟠 marker in «Все Бизнесы»; a repo folder never chooses a business |
| Several business folders open → the meta-context, otherwise the first in the window's folder order | Same tie-break the Backend uses when it deploys instructions. The Backend, unlike the panel, also accepts a folder inside a business: a window opened on a ticket folder gets instructions deployed and an empty panel |
| Single info node «В окне не открыта папка бизнеса» when no window folder is a business folder | A window with only a repo, or a folder inside a business that is not the business folder itself, has no current business |
| Labels: emoji prefix from the manifest icon (e.g. `🎭 DuetLab`) | Visual parity with «Все Бизнесы» — same `icon` field of `/contexts` |
| Tooltip: description (manifest `description`, else README first sentence), then the folder path | The panel names the business; the meaning is one hover away |

### Tree shape

Built by `core/tree/contextPanel.ts:buildContextPanel` from `ContextEntity[]` and the window's folders:

| Node | Role | Children |
|------|------|----------|
| venture | root of the current business's parent chain | the current business |
| current business | the business whose folder is open | the businesses directly under it |
| child business | `parent_id` = current business | none (deeper levels are in «Все Бизнесы») |
| `info` | fallback when the window has no business folder | none |

Intermediate parents between the venture and the current business are not shown. When the current business is itself a venture, it is the root and its child businesses hang directly under it.

## Future

- Worktree support in КОНТЕКСТ
