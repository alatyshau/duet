---
name: stc
description: Manual-load skill for long IDE chats. Adds a per-turn `## 📨 К тебе #N` block, an NBA closer, and a `session_debts.md` checkout so the user can navigate a noisy chat without scrolling.
---
# Skill: STC

Session Tracking & Communication — strict context tracking for long chats with a human.

## Quality Criteria

- The user finds every message addressed to them at a glance — `## 📨 К тебе #N` is unmistakable amid tool calls and inline narration.
- Every turn closes with one concrete proposal of what to do next, with the next move attributed to the right side.
- `session_debts.md` always reflects the current state of open items — never stale, never out of sync with the chat.
- One question per post, and that question lives in `За тобой` — the user never has to scan body subblocks to find what's being asked.
- Numbering is session-wide and monotonic — `#N` never resets, never skips, never repeats; survives compaction by reading `session_debts.md`.

## Per-turn block

A chat with a human is full of noise — tool calls, inline narration, intermediate texts. The user doesn't read it all. To make the for-the-user content unmistakable, every assistant turn ends with one consolidated block — that block IS «message #N». Inline text between tool calls is allowed but stays outside the block and unnumbered.

Template (marker, dividers, NBA header — verbatim):

```
## 📨 К тебе #N
——————

<Intro: Context / Open debts / Diff / Calibration>

### N.M <Block name>
<body>

### N.M 🎯 Что самое лучше мы можем сейчас сделать
**За тобой:** <one sentence — what's on the user, and why exactly this>.

**За мной (с твоего разрешения):** <one sentence — what I'm ready to do myself>.
——————
```

**N** is a session-wide counter of assistant turns. It increments by 1 for each user post answered and never resets within a session.

**Resuming N after compaction or chat restart.** If your context no longer contains the earliest turns, do not guess. Open `session_debts.md`, find the maximum `## #M` heading, set `N = M + 1`. If the file does not exist, this is the first turn and `N = 1`. A session is the lifetime of one `session_debts.md` file: compaction within the same file is the same session; a new working location with a new file is a new session.

**Subblock numbering.** `M` counts only `### N.M` headers and starts at 1 with the first body H3 (Intro is not numbered). NBA always exists; on a short turn with no body H3, NBA is `### N.1`. With one body block, NBA is `### N.2`. And so on.

## Intro — routing and state checkout

The first paragraph under `## 📨 К тебе #N` is the routing layer. Four dense lines or one tight paragraph:

1. **Context** — which earlier blocks (H2/H3 from history) does the user's reply touch?
2. **Open debts** — which questions or proposals from prior messages did the user leave unanswered? Surface only debts the current turn touches or potentially closes; the full list lives in `session_debts.md` and the user reads that there, not here.
3. **Diff** — short line of changes for yourself: `Diff: +[3.2.1, 3.2.2], -[2.1.1]`. New items go to `+`, closed items to `-`. This line drives `session_debts.md` synchronization (see below).
4. **Calibration** — did the previous NBA prediction match what the user actually came to do? `Match: Ok` if `За тобой` named the action they took (or any reasonable variant); `Match: Nok` if they came to do something the previous NBA didn't anticipate. A useful prediction may still be Nok; honesty over flattery. Omitted on the first turn (no prior NBA to calibrate against).

Intro is for routing, not exposition. Don't recap the turn here.

**Turn #1 specifics.** Context = `Контекст: новая сессия`. Open debts = `Долги: нет`. Diff = `+[1.1.1, …]` (only `+`; `-` is empty and may be omitted). Calibration omitted entirely. The four-field shape stays — silently dropping a field removes the visual scaffold downstream turns inherit.

## Body — H3 subblocks

If the response runs longer than three paragraphs, split the body into `### N.M <Name>` subblocks. For short answers, H3 is unnecessary — the body sits directly under the Intro.

## NBA — the final H3

Last subblock of every `## 📨 К тебе #N` block. Header verbatim: `### N.M 🎯 Что самое лучше мы можем сейчас сделать`.

- **За тобой:** — one sentence, what only the user can decide and why exactly this. Reserved for choices between alternatives, approvals of irreversible actions, and judgments that depend on context the agent doesn't have. **Never put work here that the agent could do itself** — that work belongs in `За мной`. This is how the closer coexists with `[own]`: `[own]` forbids handing off agent-doable work; the closer surfaces decision-doable work. Always present.
- **За мной (с твоего разрешения):** — one sentence, what the agent is ready to do itself. If there is no good proposal, the value is `жду сигнала` (same line, same bold prefix — only the value changes; do not drop the prefix or move the phrase to a separate paragraph).

NBA describes the next turn — it does not recap the current one.

## One question per post

The user answers one question at a time. A stack of three or four in one message gets one answer at best; the rest hang silently and force a follow-up just to clear the noise — exactly the noise STC exists to prevent. Pick the single most blocking item; the rest live in `session_debts.md` and surface only when their turn comes.

The same applies to choices — one fork per post, not a menu of independent decisions.

**The single question of the post lives in `За тобой`.** Body subblocks may inform but must not ask. Any question that surfaces during the body is either deferred to `session_debts.md` or replaces the current `За тобой` candidate (whichever is more blocking). The user reads the closer for the question; finding one mid-body forces them to scroll back.

## `session_debts.md` — the open-items list

The file lives in your work folder. Pick the case that matches your session:

- **Project-management session** (working folder is `projects/WIP_<name>/`): `projects/WIP_<name>/session_debts.md` — alongside `plan.md`. Default for current chats until the saga paradigm fully replaces it.
- **Executor** (working on a saga node): `<node>/work/session_debts.md`.
- **Vizir** (working on a saga as a whole): `<saga>/session_debts.md`.
- **Ad-hoc session** (none of the above): `./session_debts.md` at whatever working location the user designated; if none, ask once at session start where to put it.

If the work folder doesn't exist yet, create it on first write — STC is the trigger.

**Hierarchy:** H2 (turn) > H3 (block) > H4 (item).

**Item naming:** `#### N.M.X <Question/debt summary>`. The H4 numbering exists in this file even when the chat itself didn't render a separate H4 — it's a stable identifier for the item.

**Sync rule.** Every item in the Intro line `Diff: +[...]` is added immediately. Every item in `Diff: -[...]` is removed (along with parent headers if they become empty). The file always shows only what is still open.

## Worked example

User asks for a tweak to a regex. The agent does the work, then closes the turn:

```
## 📨 К тебе #4
——————

Контекст: блок 3.2 (правка regex). Долги: висит вопрос 3.1.2 про переименование переменной — не закрыт. Diff: +[4.1.1], -[3.2.1]. Match: Ok.

### 4.1 Изменение

Переписал regex так, чтобы захватывал ведущий слэш — `^/(api|admin)`. Прогон тестов в `tests/routing.spec.ts` зелёный.

### 4.2 🎯 Что самое лучше мы можем сейчас сделать
**За тобой:** решить, переименовываем ли `routePattern` → `urlPattern` (ОВ 3.1.2), или это отдельной правкой.

**За мной (с твоего разрешения):** добавить негативный тест-кейс на trailing slash — сейчас не покрыт.
——————
```

`session_debts.md` after this turn (full state):

```
## #3

### 3.1
#### 3.1.2 Переименование `routePattern` → `urlPattern`

## #4

### 4.1
#### 4.1.1 Trailing slash test coverage
```

Item 3.2.1 was removed (the regex tweak that just closed); item 3.1.2 stays open under its earlier H2/H3 path. Old turn headers persist as long as they contain at least one open item; they are removed only when the last child item closes.

## Anti-patterns

| Don't | Why not |
|-------|---------|
| Skip the `## 📨 К тебе #N` block on a short turn | The user looks for that anchor every time; missing it forces them to scroll and re-read to find what was actually addressed to them |
| Open `## 📨 К тебе #N` at the start of the turn and keep it open during tool work | The block is a closer, not a wrapper — Intro and Calibration only make sense after the work is done |
| Stack multiple questions or independent choices in one post | Only one gets answered; the rest become noise and force the user to come back with a correction |
| Skip the Intro because «nothing to route this turn» | Routing is also a checkout — even a one-line «no new context, no open debts» is meaningful; a blank Intro means nothing was checked |
| Recap the turn in NBA | NBA is a forward-pointing call, not a summary — recapping wastes the closer slot |
| Reset `#N` to 1 per turn or per topic | Session-wide monotonic numbering is what makes `session_debts.md` indices stable; resetting breaks every back-reference |
| Let `session_debts.md` drift from the chat | If the file shows what isn't in Diff history or vice versa, the skill stops being trustworthy — it becomes another stale doc |
| Use H2 in your own narration outside the `## 📨 К тебе #N` block | The user's eye scans for `##` to find «to me» blocks; a stray H2 elsewhere defeats the visual anchor. H2 inside code fences or inside files you're editing is not a violation. |
| Carry `session_debts.md` across sessions without surfacing it to `!упакуй` | The file holds open commitments; if `!упакуй` builds a checkpoint that ignores it, those commitments vanish from the resumed chat |
