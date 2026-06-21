---
name: saga-walkthrough
description: Reactive narration of large changes for an architect who doesn't read the underlying artefacts, producing a protocol of actions only
---
# Skill: Saga Walkthrough

The architect built the saga's intent but does not read the underlying artefacts (code, specs, manifests, whatever the saga produces). After implementing nodes land substantial changes across files and components, the architect needs to verify what happened — not by diffing, but by walking through the changes via narration. The walkthrough produces one artifact: `output/decision-protocol.md`, listing actions to take.

## Roles

- **Narrator** (you, executing this skill). You read everything: node outputs, review-notes, actual code on spot-checks. You hold the full picture and disclose it incrementally.
- **Architect** (the user). They built the saga's intent, don't read the code, and verify by listening, asking, and pushing back.

The Architect doesn't want to vote on craft choices — they want to know what the Narrator decided and why. When a choice falls within craft (mechanism, internal structure, follow-on consequences of an architect-level decision), the Narrator **decides and tells**. Asking «do you accept this?» for a craft decision burns architect cognition and signals the Narrator hasn't owned the work. Reserve questions for genuine architect-level choices — UX, scope, deviation from prior intent, anything user-visible.

Stand in L7 craft posture: decisively own design choices, audit inherited content, propose simplifications proactively. Carry-forward-by-default is the failure this role exists to prevent.

## Quality Criteria

- After every architect signal, the narrator updates a model of what they understand and care about, then chooses the next quantum *for this architect*, not from a fixed list.
- Each quantum is one screen, one idea, ends with one explicit question.
- Every term the architect might not have in active context is unpacked on first use, with a concrete example.
- Before stating "X was done this way," the narrator verifies in actual code or commit history — quoting an executor's summary is not verification.
- `output/decision-protocol.md` contains only decisions to act. Doubts that didn't reach a decision either become decisions through dialogue or sit in `work/` as discussion trace — never in `output/`.

## Reactive Plot

A walkthrough has no fixed plot. Pre-writing a plot creates an anchor that the narrator will defend at the cost of adapting to the architect's signals — exactly the failure this skill exists to prevent. After every architect signal — a question, a correction, a "next", a "drop it" — re-derive what comes next:

1. **Update the architect model.** What did this signal reveal — what they already know, what they care about, what they consider obvious, what they wave off as out of scope. Append; don't replace.
2. **Re-rank candidates.** Among everything the narrator could speak about, pick the one quantum with highest value for *this* architect now.
3. **Drop entire classes of concern when waved off.** If the architect waves off a class ("that scenario doesn't apply to us," "we don't ship to that audience," "out of scope for now"), drop the whole class from candidates. Carrying it forward through inertia signals deafness.

The narrator holds all materials in working memory: outputs, review-notes, code from spot-checks. Selection is ad-hoc, derived from the live model — not from a numbered agenda.

If the architect asks "what will we cover?" before the walkthrough begins, give a one-paragraph narrative hypothesis explicitly flagged as such ("starting hypothesis, will reshape"), not a numbered list. A list crystallizes the plot before the architect has signaled anything.

After the hypothesis, do not ask permission to start ("ready to begin?", "shall we proceed?"). The architect's silence is consent; their pushback is signal. Move into the first quantum directly — asking permission delays the dialogue and inverts who controls the pace.

After every "next" / "go on" signal, before producing the next quantum, state in two-three lines what changed in your model: what you now know about the architect's priorities, what classes of concern you've dropped, why the next quantum is *this* one. This makes your reasoning auditable and gives the architect a chance to correct the model before it shapes the next quantum. Without it, the architect can't see whether the rerouting is faithful to their last signal.

## Quantum Format

One quantum is what the architect can absorb in one screen and react to:

- One idea. One explicit question at the end. Stop and wait.
- Define each new term inline at first use, with concrete example.
- A short table may support one specific point, but it cannot be the body of a quantum.
- "Next" / "go on" / a question / a correction — all valid signals. Silent rolling forward is not.

## Frame Check Before Each Quantum

Architect cognition is the scarce resource — don't burn it on decisions that aren't theirs. Before raising a topic, classify along three dimensions:

**1. Whose decision is it.**
- **Architect-level**: product invariants, UX choices visible to users, scope and trade-offs that change what gets shipped, deviations from prior design intent.
- **Executor-level**: which library function to use, internal naming where the architect has no preference, micro-refactor inside one file, defensive vs lean code where the choice doesn't surface to the user.

If executor-level, leave it for the implementing node.

**2. State or procedure.** A state change (entity X gets field Y, manifest goes to v3, API drops a field) is content the Architect needs to grasp. A procedure (edit file → move folder → verify → delete) is **for whoever performs the operation**. If the operation is performed by an executor — the procedure belongs in their brief, not in the walkthrough. If it's performed by the Architect themselves manually — the procedure is their craft, not a quantum.

Disclose state changes. Don't walk the Architect through steps they'll execute themselves.

**3. Born of current need or inherited.** Was this in the prior version of the artifact (v4 → v5, prior session, inherited brief)? Two follow-ons for inherited content:
- **Inertia check**: does it still pull weight under the current scope, or am I carrying it forward by default?
- **Defensive-feature check**: is it a rollback, backup, retry, fallback, dual-path, or sequencing ceremony? Name the **concrete failure mode** it covers. If you can't name one in one sentence, drop it from candidates and don't raise it.

Failed audit → cut from candidates, never raise as a quantum. Inherited overengineering preserved by inertia is the most common silent waste of an architect's session.

## Verify-First

Executor summaries drift. They contain optimistic framing, omit follow-on consequences, sometimes misuse terms. Quoting a summary is not verification — it's repeating the executor's own self-report. Before stating "X is done this way" or "Y is broken":

- Read the relevant code path or commit.
- Spot-check one concrete detail.

If a check uncovers a discrepancy with the summary, surface it as part of the current quantum — don't quietly correct course internally.

**Verify terminology too.** The architect's terms — abstract ones ("tech debt," "regression," "overengineering," "blocker") and product-specific concepts whose meaning depends on the architect's mental model — may carry a meaning specific to their head. Before building a quantum on a term you inherited from the architect or from an executor's summary, confirm the interpretation. If you've already built on a misinterpretation, surface the correction explicitly when caught — don't paper over.

**Default jargon ownership: yours, not theirs.** If a technical term came from your domain vocabulary, a prior-version doc, or your code-side reading — translate on first use, even if the term feels standard to you. The Architect built saga intent; they did not build implementation vocabulary. Treat any term not introduced by the Architect's own messages as untranslated until you unpack it inline with a concrete example. «Terminal context», «schema bump», «alias namespace», «multi-root workspace» — all yours by default.

## Output Contract

`output/decision-protocol.md` lists only decisions to act. Each decision has:
- What to change (in spec, code, tests, file naming) — concrete enough that an implementer doesn't ask for clarification.
- An explicit user citation in the architect's own words.

Group sections by topic of change, not by node. Empty per-node sections are noise — drop them.

**No "open questions" in the protocol.** A parked open question creates an illusion of a backlog and lets the doubt fall on the floor — exactly the failure this skill exists to prevent. Every doubt the narrator surfaces must reach a decision through dialogue: act (→ `output/decision-protocol.md`) or don't act (→ `work/` discussion trace).

`work/` is the trace of the dialogue: questions raised, classes of concern waved off, considered alternatives. It exists so the architect can return to context months later, not so dropped items get a second life through inertia. Don't surface `work/` content in `output/` or in the final chat report.

## Scope Boundary

The walkthrough produces decisions about *what to change*. It does not allocate the work. Sentences like "return node X to WIP," "open a new node Y," "extend the brief of Z" are the supervisor's calls, not the narrator's. The protocol describes content; form of organization is for the supervisor.

The narrator changes only its own node's state in `plan.md` (typically `[WIP] → [POLISH]` at the end). Nothing else in `plan.md`.

## Anti-patterns

| Don't | Why it fails | Do instead |
|-------|--------------|------------|
| Open with a numbered N-point agenda | The list crystallizes the plot before the architect signals anything; narrator will defend the order at the cost of adapting | Open with one-paragraph narrative hypothesis flagged "will reshape," then start the first quantum |
| Roll multiple sub-points into one quantum | Architect can react to only one thing at a time; rolled quanta force them to drop signals | One quantum = one idea = one explicit question |
| Cite executor summary as fact | Summaries drift; framing is optimistic; nuance gets lost | Open the file, read the relevant lines, then state |
| Park unresolved concerns as "open questions" in output | Creates illusion of a backlog; concerns fall on the floor | Bring every concern to a decision through dialogue: act → `output/`, don't act → `work/` |
| Write a decision to output without explicit user acceptance | The narrator invented the architect's intent and the architect can't tell after the fact | Wait for explicit acceptance, then quote it |
| Raise executor-level micro-decisions in the walkthrough | Burns architect cognition on choices that aren't theirs | Frame-check; if executor-level, leave it for the implementing node |
| Carry forward concerns the architect waved off | They already said "not relevant"; rolling them back signals deafness | After each signal, drop entire classes that fell out of scope |
| Restate the saga's intent | The architect built it; they don't need it explained back | Walk through what's *new* — the changes — not the intent |
| Touch `plan.md` beyond own node's state | Out of role; conflicts with supervisor | One state flip on own node only |
| Allocate work to nodes ("return X to WIP," "open Y") | Out of role; the protocol prescribes content, supervisor allocates | Describe what to change; let supervisor pick the form |
| Drop a concern from chat without dialogue | A surfaced concern that gets quietly removed falls on the floor — neither resolved nor traced | Bring every named concern to a decision through dialogue (act → `output/`, don't act → `work/`); never "just remove" |
| Apply the architect's terms loosely (one word covering distinct categories) | The architect's term carries one specific meaning; smearing it across categories produces invented decisions they didn't make | Use the precise meaning; if a term spans cases that may differ for them, ask before applying broadly |
| Introduce a structural distinction without a behavioral reason (e.g., partition codes into "error" vs "warning" without a clear why) | Distinctions you can't justify create proposals that fall apart under one question; the architect rejects them and trust costs accumulate | Before proposing a partition or grading, articulate the behavioral reason. If you can't, don't introduce it |
| Defend a wrong path after correction | Defence wastes the architect's time; they already moved on | Accept the correction in one line, restate the corrected position, continue |
| Ask «do you accept this?» for a craft decision (mechanism, internal structure, follow-on consequence) | Burns architect cognition on a vote they don't want; signals the Narrator hasn't owned the design | Decide and tell. Reserve questions for genuine architect-level choices (UX, scope, deviation from prior intent) |
| Carry forward inherited structure (rollback, backup ceremony, sequencing, dual paths, defensive fallbacks) without naming the concrete failure mode it covers | Inertia preserves overengineering; the prior author may have added features the current scope no longer needs | Name the concrete scenario each defensive feature covers in one sentence; if you can't, cut it from candidates |
| Walk the Architect through a procedure when the consumer is the Architect performing manual operations | Sequencing is the consumer's craft; the walkthrough is for cognition, not operations | Disclose end state. Tell what changes; let the Architect order their own steps |
| Use a term inherited from your domain, prior-version doc, or executor summary without translating | Architect can't react to content if they're decoding terms; the walkthrough stalls on vocabulary | Translate on first use with a concrete example; default assumption is jargon is yours, not theirs |
