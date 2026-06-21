---
name: problem-tracking
description: Track open problems, issues, and suggestions inside a chat with explicit state machines. Activates only by explicit user command.
---
# Skill: Problem Tracking

In long design chats, open questions and decisions drown in the message flow. The user loses track of what was discussed, what was agreed, what is still hanging. This skill turns implicit tracking into explicit: every movement is fixed by a marker, every message ends with a roll of what is still open.

## Quality Criteria

- **State visibility.** Every message gives the user the full picture of what is open without scrolling back through the chat.
- **Transition discipline.** Statuses only change by explicit rules — no quiet jumps, no silent escalation.
- **Strict problem definition.** Factual and executive requests do not become problems. The filter is strict.
- **Safety on confirmations.** Any ambiguity in the user's reply becomes an issue rather than a self-served `confirmed` or `closed`.

## Entities

| Type | What it is | Statuses |
|------|------------|----------|
| Problem (`P`) | An open task in the chat that needs a decision | `open` ↔ `clarified` → `delivered`; any → `canceled` |
| Issue (`I`) | A question or remark blocking a problem from moving to `clarified` | `open` ↔ `closed` |
| Suggestion (`S`) | A proposal awaiting the user's reaction | `open` ↔ `confirmed` ↔ `declined` |

Every `I` and `S` is attached to a specific `P`. A problem reaches `clarified` when all its issues are closed and all its suggestions are confirmed or declined.

## What counts as a Problem

A user message spawns a new `P` only when it satisfies **all three** criteria:

1. **It needs discussion.** The answer is not obvious: there are options, unknowns, context to gather. If you find yourself thinking «I need to figure out N things before I can answer or act» — that is the signal.
2. **It will create or change an artifact.** A file, a concept, a configuration, a new document, a behavioral rule that wants to live in a file.
3. **It has a scope.** It is clear what is in and what is out. Scope can expand later — then the problem returns from `clarified` to `open` with a `renamed!` marker.

**Not problems:**
- Factual questions («what is X?», «where does Y live?»).
- Obvious executive requests («show this file», «run this script»).
- Direct behavioral instructions from the user («from now on, do it this way») — those are rules, not problems. If a rule wants to land in a permanent artifact, *that* becomes a P.
- Cosmetic phrasing tweaks with no follow-on consequences.

The boundary between «discussion» and «just chat»: if the response is one action or one fact, it is not a problem.

## Numbering

Numbering is flat: `P1`, `P2`, ..., `P9`. Issues and suggestions are attached to a problem: `I3_01`, `I3_02`, `S3_01`.

When the user tries to open `P10`, do not create it. Warn instead: «You've hit the 9-problem ceiling in this chat. Open a new chat — otherwise stack overflow comes knocking.» Keep the tone playful; this is a user-facing nudge, not a strict error.

**P7 easter egg.** In the message where `P7` first appears, add ASCII art with emoji plus a four-line warning poem along the lines of «you've reached seven problems, brother, careful from here, or stack overflow draws near». Generate it fresh every time — no template stored in this file, no echo of past instances. The whole point is the surprise of a new rendition.

## Aliases

Short code (`P1`, `I3_02`, `S2_01`) and CamelCase name (`PackageSpecification`, `A0FilesPlacement`) are synonyms. The user is free to reference items in any form, including loose ones («that package thing»). Resolve the reference from any key.

## Output Format

When the skill is active, every agent message has two optional change blocks and one mandatory closing block.

### Change log

When an entity is created or its status changes — a separate line in full form, with a leading `!`:

```
! [P1 PackageSpecification (open)] <explanatory text, when useful>
! [I1_03 ScanRoot (closed)] Closed — the compiler only scans src/idef0/.
! [S1_02 OpenItemsBlockPolicy (declined)]
```

A scope expansion that returns `P` from `clarified` to `open` gets the `renamed!` marker after the new status:

```
! [P1 NewRulesForIdef0Dsl (open) renamed!]
```

### Open Items

Every message ends with a mandatory `Open Items:` line — short codes of all active entities. For `P`, include the status (`open` or `clarified`); for `I` and `S`, just the code:

```
Open Items: P1(open), P2(clarified), I1_02, I1_03, S1_01
```

### Empty Open Items

When nothing is open, replace the list with a short 3–6 word blessing in the spirit of «May the Force be with you», «All sails full, captain», «Quiet on the airwaves, commander», «Clear as morning dew». Generate it on the fly, no template, no repeats from earlier in the chat — it is a small ritual signaling «everything is closed, exhale».

## Transition Rules

### Creating P

When a new problem appears (per the three-criteria definition above) — emit `[P# Name (open)]`. The name is CamelCase and captures the essence.

### P: open ↔ clarified

`open → clarified` — when every issue on this `P` is closed and every suggestion is either confirmed or declined. This is the natural logical step; you may take it on your own.

`clarified → open` — when the scope expands: the problem grows new requirements that make it under-determined again. Mark it `renamed!` together with a new CamelCase name.

### P: clarified → delivered

Only on the user's explicit go-ahead. `clarified` means «the path is clear»; the work itself only happens when the user signals. Never deliver on your own — even if the change looks trivial and obvious.

### P: canceled — cascade

`P → canceled` automatically moves all its `I` and `S` to `canceled`. No separate steps — cancellation cascades.

### I: open ↔ closed

Close an issue on your own when the user has explicitly answered the question you posed, and the answer is logically clean. «Logically clean» means:
- No homonym (one word in the user's reply could mean two different concepts).
- No category substitution (the user is answering a neighboring question, not yours).
- No softness («probably», «I guess», «sort of»).

On any doubt, leave the issue `open` and clarify (either a follow-up issue or a direct question in chat). A closed issue may be reopened later by user command if new information surfaces.

### S: open → confirmed / declined

A self-served move is allowed only when it **strictly follows** from a direct reply. Apply this filter:

- **Strictly follows** → move. Examples: the user gave a conditional confirm («if it passes three cases, I accept»), and the condition is met; the user issued a command that is only possible under this decision; the user said «yes», «agreed», «accepted».
- **Ambiguous** → emit an issue. Examples: «probably», «maybe», «yes for the first case» (covers only part), or a homonym in the reply.
- **Silence** → leave `S` as `open`. If the user said nothing about this specific suggestion, do not turn that into an issue and do not escalate. Just let it hang.

### S: confirmed ↔ declined

A move between confirmed and declined happens only on the user's explicit command. Do not flip it yourself.

## Principles

These are the load-bearing behavioral rules that keep the skill clean.

- **No parallel backlog.** `P (open)` already is the backlog — a hanging open problem is the queue entry. Do not propose «park it», «add to TODO», «defer to later» as separate categories. If the user wants to defer, that is the `open` state already.
- **Organizational moves are suggestions.** If you find yourself proposing «let's postpone», «let's split this off», «let's track it elsewhere» — that is an `S`, and it needs `confirmed` before anything moves. No silent organizational drift.
- **One question per turn.** Do not stack lists of questions in a single message. When the user says «next», answer literally — if nothing is open, say so plainly. No invented next steps.
- **Silence is not escalation.** If the user did not say anything about an `S`, that is not a signal to invent an issue. Quiet open is a valid resting state.

## Examples

### A new problem
```
User: Why do we even need to declare the package?

Agent:
! [P1 PackageSpecification (open)] [analysis of the tradeoff]
...
Open Items: P1(open)
```

### Scope expansion on a clarified problem
```
User: There's another rule that should land in DSL.md...

Agent:
! [P1 NewRulesForIdef0Dsl (open) renamed!]
...
Open Items: P1(open)
```

### Self-served confirm on a suggestion
```
User: If it passes the three cases, I accept.
[runs the check, all three pass]

Agent:
[result of the check]
! [S1_03 ProblemDefinition (confirmed)] — user's condition is met.
Open Items: P1(open)
```

### Ambiguous reply → issue
```
Current: [S1_02 UseFormatA (open)]
User: Yeah, probably.

Agent:
! [I1_05 FormatAUncertainty (open)] The reply is soft — is this a confirm or just a tentative nod?
Open Items: P1(open), I1_05, S1_02
```

### Homonym → issue
```
Current: [S1_04 RemovePackageDeclaration (open)]
User: Agreed, drop the package.

Agent:
! [I1_06 PackageHomonym (open)] «Package» here — the concept (we decided to keep) or the in-file declaration (we decided to drop)?
Open Items: P1(open), I1_06, S1_04
```

### Cascade cancellation
```
User: Cancel P3.

Agent:
! [P3 SomeProblem (canceled)]
! [I3_01 (canceled)]
! [I3_02 (canceled)]
! [S3_01 (canceled)]
Open Items: P1(open), P2(open)
```

### Empty Open Items
```
Agent:
[substantive answer]

Quiet on the airwaves, commander.
```
(Next time, a different phrase. Do not repeat.)

## Anti-patterns

- **Spawning a P from every user message.** Most chat lines are not problems. Apply the three-criteria filter strictly.
- **Self-served `confirmed` on a soft reply.** If the reply admits a second reading, emit an issue, not a confirm.
- **Closing an issue on an ambiguous answer.** Homonyms, category substitution, hedging — all reasons to keep the issue open.
- **«Backlog» as a parallel category.** A hanging `P (open)` is the backlog. No need to invent a second layer.
- **Turning silence into an issue.** If the user did not respond to a specific `S`, leave it `open`. Do not escalate by inventing follow-ups.
- **Skipping the closing block.** Every active-skill message ends with `Open Items:` or a blessing phrase. No exceptions.
- **A stock easter egg on P7.** Do not commit any ASCII art or poem to this file, and do not recycle previous renditions — every P7 gets a fresh one.
- **Activating without an explicit user command.** The skill is opt-in. No topic-based auto-trigger.