# AI Kit — Domain

## Core Concepts

| Concept | Question | Duration | Example |
|---------|----------|----------|---------|
| **Mode** | WHAT is happening? | Switches per task | DIALOGUE, EXECUTE, BRIEFING |
| **Stance** | HOW to think? | Switches per phase | dialectic, pragmatic, critical |
| **Skill** | WHAT expertise? | Loaded on demand | python, instructions-architect |
| **Workflow** | WITH WHOM? | Entire session | solo, pair, sddg |
| **Persona** | WHO am I? | Entire session | Socrates, Hephaestus, Ariadna |

## Concept Relationships

```
Session
├── Persona (1, fixed)
├── Workflow (1, fixed)
└── Conversation
    ├── Mode (switches)
    ├── Stance (switches)
    └── Skills (accumulate)
```

## Key Distinctions

### Mode vs Stance

| Aspect | Mode | Stance |
|--------|------|--------|
| Controls | What agent DOES | How agent THINKS |
| Example | EXECUTE = write code | pragmatic = minimal ceremony |
| Mutual exclusion | Yes (one mode at a time) | Yes (one stance at a time) |

### Skill vs Stance

| Aspect | Skill | Stance |
|--------|-------|--------|
| Nature | Domain knowledge | Thinking approach |
| Combination | Multiple skills active | One stance active |
| Example | python + testing | dialectic OR pragmatic |

### Persona vs Mode

| Aspect | Persona | Mode |
|--------|---------|------|
| Duration | Entire session | Switches |
| Controls | Identity, defaults | Current activity |
| Example | Hephaestus (builder) | EXECUTE (building now) |

---

## Design Decisions

### core_instructions.md Structure

| Section | What | Why |
|---------|------|-----|
| **Glossary** | Terms, hierarchy, personas, homonyms | Agent needs shared vocabulary before algorithms |
| **Axioms** | 3 universal principles | Foundational rules that override everything else |
| **Session Start** | 4-step initialization | Runs before Main Algorithm, same after compaction |
| **Main Algorithm** | Mode/Stance/Skill selection, Spec Workflow, DIALOGUE mode | Core decision loop — what agent does each turn |
| **Response Format** | @turn(), @topic() | Output structure for parsing and traceability |

### Glossary Subsections

| Subsection | What | Why |
|------------|------|-----|
| **Core Distinctions** | Question, Duration, Example | Question = key differentiator; Duration = affects behavior |
| **Entity Hierarchy** | business→stream→product→component→project + artifacts | Agent needs workspace level context |
| **Personas RU** | EN ↔ RU mapping + Focus | RU chat requires translation |
| **Homonyms** | REVIEW (mode) vs IN_REVIEW (status) | Prevents confusion |
| **Language** | "Chat: RU" | Conversation language |
