---
name: pragmatic-design
description: Consumer-first design — create or review artifacts from the consumer's perspective
---
# Skill: Pragmatic Design

DRAFT — raw observations and cases, not a ready skill. To be refined later.

Two modes:
- **Create** — before designing: set the frame (who is the consumer, what's their task, what criteria), then design through that lens
- **Review** — after designing: take the artifact, run it through the same criteria, find where you wrote "for yourself" instead of "for the consumer"

## Observed principles

### 1. Design from the consumer, not from implementation

Before writing — ask: who reads/calls this and what do they need to do? Every sentence/field/endpoint either helps the consumer accomplish their task, or it's noise.

**Case:** Designing topology field for orientation API response. Consumer — AI agent starting a session. Wrote: "meta_context_folder is the context folder with meta=true in its manifest — a peer to other root contexts, not their parent." This is correct architecture documentation. But the agent doesn't work with manifests, doesn't make architectural decisions about Duet, doesn't think about parent/peer relations. It needs: "default folder for paths, starting points for navigation, here's where data lives — go work."

Wrote **what it is** instead of **what to do with it**. Described the system instead of guiding the consumer.

### 2. Understand intent before changing

When asked to change an artifact — first ask: what exactly is the problem? Classify each element: part of the problem, or working fine? Change only what's broken.

**Case:** User asked to remove technical details from meta-context topology ("meta=true in manifest", "peer to other root contexts"). Removed everything — including "Meta-context — multi-root workspace covering everything" which perfectly captured the purpose in one line. User returned it.

The request was to remove **implementation details**. "Multi-root workspace covering everything" is not an implementation detail — it's the purpose. Applied the operation mechanically without understanding why the change was requested. Didn't distinguish load-bearing (purpose) from decorative (implementation).

### 3. Solutions must be actionable — two checks

A proposed solution must pass two checks:

**Check 1 — Operationalization.** Walk the user's path to the end: Where will they see the problem? How will they understand what to do? What tool will they use to fix it? If any answer is "somehow" — the solution isn't ready.

**Check 2 — Availability.** Before proposing "show it in X" — verify X exists and can do this. Don't design for an imaginary system. The solution is born from the real state of the product, not from the desired one.

**Case:** Discovered that entity/reference_repo name collisions aren't validated. Proposed: "warning at scan time." User: "not operationalizable." Who reads scanner logs? Nobody. A collision would silently tick until something breaks.

Then proposed: "let's surface through Host UI." But didn't know the current Host UI design. Instead of investigating, offered abstract "we'll note it as a requirement." User insisted — we dug into host_ui.md, found the wizard, discovered there's no suitable page. Result: a new root-context-folders step in the wizard — config panel for root context folders (moved from Extension) + error table below with description, advice, and Fix button for each collision.

The path was: "warning in log" (non-operationalizable) → "surface in Host" (without checking availability) → "note as requirement" (deferral) → actually investigate Host UI → find concrete place → design concrete solution. Should have gone straight from problem to investigation.

## Notes for future skill design

- The skill should work for any persona (Socrates, Hephaestus, Daedalus) — it's a lens, not a role
- Two activation modes: create (before designing) and review (after designing)
- Category TBD (tools? stances? new category?)
- `pragmatic` stance already exists — it's about "act, don't talk". This skill is different: "design for the consumer, not for yourself"
