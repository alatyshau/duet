---
name: topic-master
description: Topic files, planning
---
# Skill: Topic Master

Work with **project folders** and **topic files** (`topic_*.md`) — the primary units of planning and execution.

## Writing Principle

> **Write for humans first. Explain, don't just note.**

The primary reader is a **person returning after a break** — not an AI agent, not a "dry technician" who remembers everything.

**Test yourself:** Can someone read this in a month and understand:
1. What is the problem?
2. Why does it matter?
3. What are the options?
4. What was decided (if decided)?

If not — rewrite with more context.

---

## Core Principle

> **Open questions = Step 0. Steps ≈ commits (sizing).**

- **Step 0** — planning, design, decisions (open questions phase)
- **Steps 1+** — code, tests, refactoring (implementation phase)

Step 0 is real work, not just "preamble". One step ≈ one commit worth of work (for sizing). Human commits.

---

## Topic File Format

> **Always read `topic_file.md`** — canonical format for topic files.

---

## Project Folder Structure

```
projects/260110_ai_kit_design/
├── index.md              — mission, participants, roadmap, topic sections
├── topic_active_1.md     — active topic (ЯДРО)
├── topic_orbit.md        — topic outside mission (ОРБИТА)
└── 260127_topic_done.md  — archived topic (АРХИВ)
```

### index.md contains

- **Mission** — why the folder exists
- **Participants** — who works here
- **Roadmap** — high-level plan
- **Topic sections** — ЯДРО / ОРБИТА / АРХИВ

### Topic Categories

| Category | Criterion | In index.md |
|----------|-----------|-------------|
| **ЯДРО** | Directly related to mission | Status, key decisions, product |
| **ОРБИТА** | Not related to mission | Reason, Fate (what to do with it) |
| **АРХИВ** | Completed or decision made | Summary, file renamed with YYMMDD_ |

**Rules:**
- **Mission evolves** — adapt mission to topics, not force topics into mission
- **ОРБИТА ≠ trash** — legitimate topics waiting for their own folder

### New Folder vs New Topic

```
Project folder = one MISSION
Topic = direction of work within that mission
```

| Situation | Decision |
|-----------|----------|
| Topic directly related to mission | New topic → ЯДРО |
| Topic tangentially related / spin-off | New topic → ОРБИТА |
| Independent initiative with **separate mission** | New folder |
| Topic grew into "project within project" | Extract to new folder |

**Litmus test:** Can topic be added to folder's Roadmap? Yes → topic. No → ОРБИТА or new folder.

---

## Topic vs Spec

```
Topic = where we're going (plan, temporary)
spec/ = where we are now (implemented, source of truth)
```

| When | Read first |
|------|------------|
| DONE steps | spec/ > topic |
| TODO steps | topic > spec/ |
| Conflict | ask human |

After project completion, topic can be deleted — spec/ has everything.

---

## Commands

| Command | Action |
|---------|--------|
| `!сохрани-в-топик` | Parse chat history → distribute to topic sections |
| `!по-одному` | Load `briefing` → iterate open questions one by one |
| `!архивируй-топик` | Load `revision` → execute archiving procedure |
