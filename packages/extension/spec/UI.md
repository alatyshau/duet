# UI

> Surface, providers, command behavior, decorations: [COMPONENT.md](COMPONENT.md). This file covers per-view rendering rules and behavioral contracts the user sees.

## Views

Six sidebar views, top to bottom, each with its own visibility gate:

| View | ID | Purpose | Provider | Data source |
|------|-----|---------|----------|-------------|
| Активная Работа | `duet.intents` | The windows Duet opened in this program: business windows first, then the active intents of every business — tickets that have a window open. One click switches to the window | `IntentsProvider.ts` | window markers in `DuetData/intents/<program>/` — no Backend |
| Корзина | `duet.bin` | All tickets of the current business from `work/` and `backlog/`; opens an intent, moves a ticket between the two, keeps their order. Never switches windows | `BinProvider.ts` | ticket folders of the business on disk + window markers |
| Рабочая папка | `duet.work` | The files of one ticket, as Explorer shows the folder of a project: the ticket of the window, or another ticket of the same business picked in Корзина. Rows by the alphabet with pinned ones first, what is expanded remembered per ticket, files hidden as Explorer hides them | `work/WorkView.ts` | the ticket folder on disk + the files of the view — no Backend |
| DUET (status) | `duet.status` | Shown when backend not ready — welcome message or spinner | Stub `TreeDataProvider` (empty array) | — |
| КОНТЕКСТ | `duet.context` | **Deprecated, hidden by default** (`"visibility": "hidden"`; shown again from the «…» menu of the panel). Show where the window stands: the venture, the current business, the businesses directly under it | `ContextProvider.ts` | `GET /contexts` (`ContextEntity[]`, the list «Все Бизнесы» already holds) |
| Все Бизнесы | `duet.contexts` | Full forest of root contexts and descendants for navigation | `ContextTreeProvider.ts` | `GET /contexts` (`ContextEntity[]`) |

### Visibility

| View | Condition (`when` in package.json) |
|------|-----------------------------------|
| Активная Работа, Рабочая папка | `duet.hasPointer` — as soon as the DuetData path is known, Backend or not |
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

«Активная Работа», Корзина and «Рабочая папка» have no welcome content: an empty one is empty, without text.

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

A separate collapsible view under «Активная Работа» with its own refresh button, which re-reads the business folders. The rows follow the business folder by themselves: a ticket created, archived, moved or re-parented by an agent, by hand or in another window appears in every window that shows the bin, and so does a changed order; the button is for the case when that did not happen. The current business is found as in КОНТЕКСТ, and the title names it — «Корзина DuetLab» (`intents/naming.ts:binTitle`); in a window without a business the title is the bare «Корзина» and the view is empty, without text.

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
| A click on a ticket row — also a click on the row already selected, Enter and the space bar — shows that ticket in «Рабочая папка»; so do the keys that move the focus: the arrows, Home, End, PageUp, PageDown, on macOS Ctrl+N and Ctrl+P. Rows of groups, a right click, a drag and a vanished selection show nothing | The row carries the command `duet.bin.select`; the keys are bound to «move the focus, then run that command for the focused row» (`runCommands`). The selection event is not the signal: it is silent on a second click and comes empty every time the bin is shown |
| The context menu of a ticket row has «Копировать @-путь» — the short ticket reference, `` `@DUE018` ``; rows of groups have no menu | The same reference Copy @-Path gives for the ticket folder |
| A ticket without an open window shows two buttons on hover — «open in the current window», «open in a new window» — the same as a business in «Все Бизнесы» | One habit for both |
| Opening a ticket from the backlog first moves its folder to `work/` | An open intent is work in progress |
| A ticket from `work/` without an open window has a third button — «to the backlog». A ticket with an open window has no buttons | An empty «Backlog» is not shown, so a drop target may be missing |
| A container row is a ticket with the same buttons; moving a container to the backlog does not touch its tickets | Containers are tickets too |
| A ticket is dragged only inside its group: between its «Backlog» and its work (the folder moves) and to reorder its tickets. Up — before the target, down — after it. A drop on the header puts the ticket first in work; on «Backlog» from work — first in the backlog, from the backlog — last in work | The tree reports only the row a drop landed on |
| A process or a program is dragged to change its place among the containers of its level — those of the root, or those under the root «Backlog»; its folder never moves. A drop on a row inside another container counts as a drop on that container; on «Unsorted» or past the rows — last; on the root «Backlog» from inside it — first | The order of programs and processes is the top level of the order of work. One sequence for both kinds: a program may stand before a process |
| Not dragged: tickets between programs, a container between the root and the root «Backlog», a ticket with an open window into «Backlog», the rows «Unsorted» and «Backlog», rows between the two views | Each would change more than an order: a ticket in another program means another `parent` in its `INDEX.md`, which the extension only reads |
| A refused drop is told in one line | The tree cannot forbid a drop in advance: a forbidden target is highlighted like an allowed one |
| Before any action the disk is read; the tree never shows a result ahead of the disk | The folders may have been moved by an agent or by sync |

## Рабочая папка — the files of a ticket

The third view of the Duet side bar, right under Корзина. It shows the folder of one ticket and nothing above it: no row for the ticket itself — its files and folders come first, and the title names the ticket.

```
РАБОЧАЯ ПАПКА DUE018                 [eye] [↻] [−/+] [⋯]
› 01_Дизайн
⌄ 02_Замысел
    задание.md
    Замысел.md
  INDEX.md
  AGENDA.md
  notepad.md
```

What the view must do is set by the accepted model of behaviour of ticket DUE018 and its list of decisions; this section states the contracts the code holds. Wiring: [COMPONENT.md → Work view](COMPONENT.md#work-view).

### Which ticket is shown

| Behavior | Why it matters |
|----------|----------------|
| At the start of a window: the ticket the window is opened on. A business window and a window Duet did not open start empty — a bare title «Рабочая папка», no text. The folder is never guessed from the editor | The view is «the files of the window's ticket, always in place» |
| A ticket row of Корзина shows that ticket (see the bin's contracts); the title then reads «Рабочая папка DUE017» with the muted note «другой тикет». It is shown in full: rows are reordered, files acted on, all of it kept | Looking into another ticket is a full view, only a temporary one |
| A click on the ticket already shown does not start its view again | A double click runs the row's command twice |
| The refresh button returns to the ticket of the window and reads it anew; in a business window it empties the view. It resets nothing — not the order, not what is expanded, not the settings | Most of the time the ticket of the window is what is wanted |
| A ticket of another business is not shown: one line says so, the view stays | Tickets of other businesses are another project |
| The title changes the moment a ticket is chosen; until its folder is read the body shows only «Загрузка…», never the rows of the ticket before. A reading that ends after another ticket was chosen is dropped | An old tree must not pass for the new one |
| The shown folder moved between `work/`, `backlog/` and the archive: the view follows it by the ticket number, with the same order and expansion. Gone altogether: for the window's ticket — an empty body with the reason; for another ticket — one line and a single return to the window's ticket. Several folders carry the number: no rows, the number and the reason in the header; the row of Корзина names the folder to show | The state of a ticket is kept by its number, so a move loses nothing; an ambiguity is never resolved by a guess |
| The same ticket read again keeps its rows on the screen while the disk answers. When that reading fails, the rows stay under the line «Данные не обновлены: …» and nothing that changes files is available until a reading succeeds. A folder inside that cannot be read shows one row with the reason instead of content | An error is told as an error, never shown as an empty folder |

### Rows

| Behavior | Why it matters |
|----------|----------------|
| A file row carries its address — the icon and the name come from the icon theme — and the command `vscode.open` with exactly one argument | Only then does the tree add its opening event: one click a preview tab with the focus left in the tree, a double click a kept tab — as in Explorer, and under the same user settings |
| A folder row has no command: a click on its name toggles it. Every folder has the twistie | The twistie is how a folder is told from a file |
| An expanded folder with no shown rows shows one empty row — also when hidden files lie in it. It is a place to drop on and nothing else: no menu, and every command drops it from its targets. The root of an empty ticket has no such row | Inside a folder one gets by dropping on a row in it; an empty folder needs a row to drop on |
| Folder chains are not folded into one row, related files are not nested, git marks are not built | Decided for this view |
| The tree follows the disk by itself: file events of the ticket folder are answered 250 ms after the first one — the count is not restarted, or an agent that keeps writing would hold the tree back — by reading the folders they name; a folder whose listing did not change is not redrawn. A file that comes or goes expands and collapses nothing | Agents change the folder past the view |

### Hidden files and the eye

| Behavior | Why it matters |
|----------|----------------|
| With the eye closed a row is hidden exactly when Explorer of the same window hides it: by `files.exclude` (the path judged from the workspace folder, sibling conditions included), by `.gitignore` when `explorer.excludeGitIgnore` is on, and whenever a folder above it — above the ticket too — is hidden | The user keeps a long exclude list and wants one rule in both trees. No exception of the view's own: not for service names, not for temporary files of agents |
| A hidden file shown in a visible editor is let through with the folders above it, as in Explorer; they stay collapsed. Closing the tab takes the row away | Part of «exactly as Explorer» |
| The eye button shows everything and hides again. Its state belongs to the view of this window and is remembered for it; the editor's settings are not written | A function of Duet's own, to be used in other views later |
| Hiding changes only which rows are shown: what is expanded and what is pinned stay as they are | Hiding is not collapsing |

### Order and pins

Decided by Andrei, 2026-10-06, in place of the free arrangement of rows the view had before: the order is the alphabet, and the only thing a person adds to it is pins.

| Behavior | Why it matters |
|----------|----------------|
| Folders first, then files — always, and the two are never mixed. Each by the alphabet: by stem, then by extension; digits as numbers (`2_x` before `10_x`), of two equal numbers the shorter first (`2` before `02`); letters without case by Unicode code point, not by the dictionary of the interface language; the exact name settles a tie | One order in every window and program, whatever the language; nothing to remember and nothing that goes stale |
| A folder or a file can be *pinned*: «Закрепить» in the menu of the row. Pinned folders stand before the other folders, pinned files before the other files. The pins of folders and of files are separate lists. «Открепить» returns the row to its place by the alphabet | — |
| Only pinned rows have an order of their own: a pinned row is dragged next to another pinned row of its kind. Everything else stands by the alphabet and cannot be put anywhere | The order a person sets is small and deliberate; a file an agent makes always lands where the alphabet puts it |
| The root of a ticket starts with three pinned files: `INDEX.md`, `AGENDA.md`, `notepad.md`, in that sequence. No other folder starts with pins. The three can be unpinned and reordered like any pin | The files a ticket is entered through stand first |
| A pin is a name in a folder. It follows a rename made through the view; a rename made past the view leaves the new name unpinned. A pinned name that is not on the disk is not shown and stays pinned: a file that comes back under it is pinned again | The view does not guess that two names are one file |
| The pins belong to the ticket and lie in the business folder, so they are the same in every window, program and machine. A change written elsewhere moves the rows here and touches nothing expanded | — |
| «Сбросить закрепления папки» — on a folder whose pins were changed — returns it to the pins it starts with and leaves the folders below alone; «Сбросить закрепления верхнего уровня» under «…» does the same for the root. No question asked | The root has no row to click |
| A pins file that cannot be read, or was written by a newer Duet, is never replaced: the rows are shown by the last pins read well (else by default, with a warning), and whatever would change them is refused with the reason | Lost pins are not shown as none |
| A file of the earlier model — a free arrangement, a list of names per folder — is read as «no pins»: the folder stands by the alphabet with the pins it starts with, and the file is replaced by the first change of pins | The free arrangement no longer exists; nothing is migrated and nothing is deleted |

### Dragging

| Behavior | Why it matters |
|----------|----------------|
| A drop means one of two things, told apart by what a person sees before dropping — the same folder or another one. The folder of a drop is the folder of the row under the pointer: a file, a collapsed folder and an expanded folder mean the same | The tree reports the row under the pointer, never a place between rows; a drop on a folder must not turn into a move into it |
| **The same folder — pins.** A pinned row dropped on a pinned row of its kind takes the place next to it: dragged up — before it, dragged down — after it. A row that is not pinned, dropped on a pinned row of its kind, is pinned there. Anything else changes nothing and says why in one line: a drop on a row that is not pinned, on a row of the other kind, below the rows; folders and files dragged together. Nothing is ever unpinned by a drag | One gesture pins and places; a pin cannot be lost by a slip of the hand |
| **Another folder — a move.** The row goes into that folder and stands there by the alphabet, never pinned, whatever row of the folder it was dropped on. Inside a folder one gets by expanding it and dropping on a row in it, or on its empty row; below all rows — into the root | A folder whose files are all pinned takes a file as simply as any other |
| Several rows go as one block in screen order; the direction is measured from the top row. A row whose folder is dragged too rides in the folder. A drop on a row of the block does nothing; a folder into itself refuses the whole set | — |
| A row that changes its folder is a real move of the file, told in one informational line per drop: what went where. A change of pins says nothing. When rows of several folders are dropped together, those already in the target folder stay as they are | A move must never go unnoticed |
| A name taken in the target folder — hidden names counted — or two rows of one name refuse the whole drop in one line before anything is touched. Nothing is ever replaced and nothing is asked | — |
| A folder the platform opens under a dragged row stays expanded and is remembered. With «одна папка за раз» on, nothing is collapsed and nothing is redrawn while the drag lasts; when it ends, the folder of the target stays as the one branch after a drop, the folder of the source after a cancel | The row under the hand must not move away |
| A file dragged into the editor opens as a kept tab; folders are left out | — |
| Files dropped from the system are copied into the folder of the target row and stand there by the alphabet — never moved; the original stays. Enabled per operating system (`workCommands.ts:IMPORT_CONFIRMED`) | A tree view of an extension always tells the source «move»; what a file manager does on that word is checked by hand before the system is switched on |
| Rows of Explorer, editor tabs, rows of another window's view and rows of Корзина are refused in one line | Only the view's own rows and files of the system are taken |

### Expanding

| Behavior | Why it matters |
|----------|----------------|
| What is expanded is remembered per ticket and comes back exactly as left — after a restart of the window, after looking into another ticket. On a machine that has not seen the ticket everything is collapsed | Stated as very important |
| Collapsing a folder by hand keeps what is expanded below it; «Свернуть всё» clears that too | — |
| The minus-plus button: while any folder is seen expanded it collapses all; otherwise it expands to the depth chosen under «…» — one level, two, all | One of the most used tools |
| Under «…»: collapse all, expand all, expand to exactly one level, to exactly two, collapse the deepest level seen expanded in the whole tree | Levels count from the root of the ticket |
| «Одна папка за раз» with «Начиная с уровня» 1, 2 or 3 (2 at first): expanding a folder collapses every other expanded folder of that level and deeper, but the folder itself and those above it. It acts for every source — the hand, a key, the open file. Switching it on, or changing the level, brings the view to the rule at once. It is kept with the ticket, together with what is expanded | Each tool works as stated, always, in any combination |
| While the rule is on, mass expansions that would reach its level are unavailable — «expand all» always; the depth of the plus button stays as chosen, and when it is incompatible the button is unavailable and says why. The platform's own recursive expansion then opens only the folder pointed at | The result must not depend on the order of inner events |
| «Показывать открытый файл», off at first, kept for the window: when on, the file of the active editor is shown — the way to it expanded, its row selected, the editor keeping the focus — on switching it on, on a change of the active editor, on coming back to the ticket, and when the view becomes visible. A hidden view is never raised. It is stronger than the remembered expansion and obeys «одна папка за раз». «Свернуть всё» works with it on: a tab that did not move is not a command to expand again | Following the editor is a tool switched on deliberately |

### Acting on files

Everything is in the context menu of a row; the title has no create buttons. The menu has no «open to the side», no terminal, no cut, copy or paste, no relative path, no undo of file operations.

| Behavior | Why it matters |
|----------|----------------|
| «Новый файл…», «Новая папка…»: on a file — in its folder; on an expanded folder — inside it. The new row stands by the alphabet. On a collapsed folder the item is unavailable and says «сначала раскройте папку». For the root: two items under «…». The new file opens and is selected; a new folder is collapsed and selected | Creating never expands a folder by itself |
| A file that is there is never written over by a new one: a name taken by the moment of creation is a refusal in one line. Nothing is created, moved or copied into a folder that could not be read, that is gone, or that is a link leading out of the ticket | A person's file must not be emptied because a folder did not answer |
| The name is typed in the box at the top of the window and judged while typed: empty, taken (hidden names counted), `/` and `\`, the limits of the disk. A name that would stay hidden is explained, not called an error: the eye is opened first | — |
| «Переименовать…» — also Enter and F2 on the focused row, on all three systems: the box holds the old name with the stem selected. A pinned row stays pinned under its new name | — |
| «Дублировать» — pressed and done, no box and no question: `name copy01.md`, then `copy02`, `copy03` — the first free number up to 99, the suffix before the extension; a folder is copied whole. The selection stays on the source. The copy stands by the alphabet — right under its source in most cases — and is not pinned | The most used action |
| «Удалить…» — also Delete, Cmd+Backspace on macOS: one confirmation for the whole set, into the system trash only. When the trash refuses, the object stays and the reason is told — permanent deletion is never offered. The focus goes to the next row left | — |
| Rename, move and copy are the ordinary operations of the editor's file service, as in Explorer: the tab of a renamed file follows it, the tab of a deleted one closes. Nothing stricter than Explorer is built. Links in other files are never rewritten | Decided: Explorer is the ceiling of caution |
| A file with unsaved changes — or a folder holding one — is not renamed, moved or deleted: one line says to save or revert first. This is judged at the moment of the change, not when the name box or the question was opened. A copy is made from the disk and says so | Confirmed, although Explorer acts otherwise |
| An act on several rows that stops half-way says in one line why it stopped, what was done and what was not begun | — |
| «Открыть с помощью…» for one file; «Показать в Finder» / «Показать в Проводнике» / «Открыть содержащую папку» for one file or folder | — |
| «Копировать абсолютный путь» and «Копировать @-путь» (Cmd+Shift+C, Alt+Shift+C) for any set: one path per line, top to bottom | — |
| «Выбрать для сравнения», «Сравнить с выбранным», and «Сравнить выделенные» for exactly two files; the chosen file is shared with Explorer | A file outside the ticket is chosen in Explorer |
| A right click inside the selection acts on all of it, outside it — on the clicked row alone. A key acts on the focused row by the same rule; renaming takes the focused row only | The rule of Explorer |
| One operation at a time; while one runs another is refused, not queued. An operation ends in the ticket it began in, and what it says then starts with that ticket's number | — |

### What the platform does not allow

| The model asks | What VS Code gives | What is built |
|----------------|--------------------|---------------|
| «Рабочая папка» stands right after Корзина, before «Все Бизнесы»; КОНТЕКСТ is hidden by default | The manifest gives only the starting place and the starting visibility. Once a person has dragged a view of the panel, VS Code keeps a number for every view it knew then, and a view added later is placed by its number in the manifest among those kept numbers — it may land below «Все Бизнесы». A view a person has already seen keeps the visibility they left it with (`viewContainerModel.ts`, VS Code 1.104: `getViewOrder`, `add`). An extension can set neither | The manifest declares the order and `"visibility": "hidden"`; they hold in a panel nobody has rearranged. In a rearranged one the view is dragged into place once, and the place is kept from then on. The manifest test proves the declaration, not the place on the screen |
| Selection, focus and scroll come back with the ticket | An extension reads only the selection and can set one row; the focus and the scroll are closed to it | The top surviving row of the remembered selection is selected, without taking the focus |
| A right click outside the selection gives the menu of that one row | A `when` clause sees the selection of the tree, not the clicked row | Items for one row are absent whenever several rows are selected, wherever the click lands; keys follow the model exactly |
| An unavailable item explains itself | A greyed menu item has no tooltip; a submenu cannot be disabled | The explanation is the title of a greyed twin of the item, and the tooltip of the plus button |
| Any move of the focus onto a ticket in Корзина shows it | The focus event is a proposed API | The keys named above; type-to-find shows the ticket on Enter or the space bar |
| Hidden exactly as Explorer of the same installation | Explorer's filter is not exposed | Its matcher and `.gitignore` reading of VS Code 1.104 are written out in `core/folderView/`; every `.gitignore` on the way to the ticket is read, where Explorer reads those it has walked |
| The file chosen for comparison is known | The editor keeps the choice and does not tell it | Known when chosen through this view |
| «Рабочая папка DUE018», the reason in the header | Titles of the side bar are drawn in capitals; a header holds a title and a description | A short reason in the description, the full line above the tree |
| The rule waits for the end of a drag | The start of a drag from the system and a drop taken outside the tree are not reported | For a drag from the system the rule acts at once; a drop outside counts as a cancel at the next event |

## Все Бизнесы — forest navigation

Full forest of root contexts and descendants, accordion pattern, alias-based highlighting.

### Behavioral contracts

| Behavior | Why it matters |
|----------|----------------|
| **Accordion**: one root context expanded at a time | Reduces visual noise, focus on active work |
| Expand root context → expands to leaves | User sees full hierarchy without extra clicks |
| Auto-expand active root context on startup | Opens the root the user is working in |
| Solid `────` line between root contexts; blank spacer between first-level children of a root | Visual separation between roots and inside an expanded root, no dotted clutter |
| No header row: the list starts with the first root context | The window over all ventures is the window of the meta business (`meta: true`), an ordinary row of the tree — not a separate entity |
| In the window of a meta business only that business is marked, though the folders of the other ventures are open in it | The window belongs to one business; the other ventures are shown, not worked in |
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
