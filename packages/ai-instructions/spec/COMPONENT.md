# AI Instructions

Pure content package — source of truth for all AI agent instructions deployed to DuetData.

## Domain

### Core Concepts

| Concept | Question | Duration | Example |
|---------|----------|----------|---------|
| **Mode** | WHAT is happening? | Switches per task | DIALOGUE, EXECUTE, BRIEFING |
| **Stance** | HOW to think? | Switches per phase | dialectic, pragmatic, critical |
| **Skill** | WHAT expertise? | Loaded on demand | python, instructions-architect |
| **Workflow** | WITH WHOM? | Entire session | solo, pair, sddg |
| **Persona** | WHO am I? | Entire session | Socrates, Hephaestus, Ariadna |

### Concept Relationships

```
Session
+-- Persona (1, fixed)
+-- Workflow (1, fixed)
+-- Conversation
    +-- Mode (switches)
    +-- Stance (switches)
    +-- Skills (accumulate)
```

### Key Distinctions

**Mode vs Stance:**
- Mode controls what agent DOES (EXECUTE = write code)
- Stance controls how agent THINKS (pragmatic = minimal ceremony)
- Both mutually exclusive (one at a time)

**Skill vs Stance:**
- Skill = domain knowledge, multiple active (python + testing)
- Stance = thinking approach, one active (dialectic OR pragmatic)

**Persona vs Mode:**
- Persona = identity for entire session (Hephaestus)
- Mode = current activity, switches (EXECUTE -> DIALOGUE)

### core_instructions.md Structure

| Section | What | Why |
|---------|------|-----|
| **Glossary** | Terms, hierarchy, personas, homonyms | Agent needs shared vocabulary before algorithms |
| **Axioms** | 3 universal principles | Foundational rules that override everything else |
| **Session Start** | 4-step initialization | Runs before Main Algorithm, same after compaction |
| **Main Algorithm** | Mode/Stance/Skill selection, Spec Workflow, DIALOGUE mode | Core decision loop — what agent does each turn |
| **Response Format** | @turn(), @topic() | Output structure for parsing and traceability |

## Categories

| Folder | What | Example |
|--------|------|---------|
| `personas/` | WHO is agent? | Socrates, Hephaestus, Ariadna |
| `skills/coding/` | Programming languages | python, typescript |
| `skills/modes/` | Activity modes | planning, execute, review |
| `skills/stances/` | Thinking approaches | dialectic, pragmatic, critical |
| `skills/tools/` | Domain tools | spec-architect, scriptor, checkpoint |
| `skills/workflows/` | Collaboration patterns | solo, pair, sddg |
| `schemas/` | File format specs | topic_file, index, skill_file |

## Entrypoints

| File | Purpose | Who uses |
|------|---------|----------|
| `core_instructions.md` | Compact instructions (~130 lines) | Claude Code (`output-styles/duet.md`), Codex (`model_instructions_file`) |
| `old/core_instructions_long.md` | Full version (~320 lines), archived | Reference only |

**Why compact?** Instruction adherence. Agents follow rules more reliably with shorter instructions — long instructions get "lost" in context.

**Claude Code specifics:** `output-styles/` loads instructions as system-level (not user-level). This significantly improves adherence vs. injecting via CLAUDE.md or conversation.

## Contracts

**File naming:** `<category>/<kebab-name>.md` (e.g. `skills/spec-architect.md`)

**Adding new files:** Create md in the right category folder. Update `core_instructions.md` tables if the new entity needs to be discoverable by agents (e.g. new skill -> add row to Skills table).

**Edit rule:** Always edit `packages/ai-instructions/src/`. Never edit `DuetData/ai-instructions/` directly — changes are lost on next deploy.

**Deploy target:** `src/` -> `DuetData/ai-instructions/`. Note: `DuetData/ai-kit/settings.json` lives separately in `ai-kit/` — it's a runtime config, not part of this package.

## Deploy Chain

```
packages/ai-instructions/src/  ->  DuetData/ai-instructions/
                               (deployer: Host app)
```

## Decisions

| Decision | Rationale |
|----------|-----------|
| `src/` not `templates/` | No templating — files deploy as-is. `src/` consistent with monorepo convention |
| Separate package from ai-kit | Decouple content from infrastructure (MCP, install.py). Enables Host to bundle content independently |
| Separate deploy target | `ai-instructions/` for content, `ai-kit/` for legacy MCP + settings.json |
| Single entrypoint | Compact version is the only entrypoint. Full version archived to `old/` |
| Claude: output-styles | `~/.claude/output-styles/` injects as system prompt, not user context. Better adherence than CLAUDE.md |

## Legacy Relationship

`packages/ai-kit/` contained both content and infrastructure:
- `templates/` — frozen copy of these same files
- `install.py` — legacy manual installer (replaced by Host deploy)
- `mcp-server/` — legacy Python MCP (timestamp + get_instruction_location)

This package extracts content. Install logic moved to Host.

## Navigation

| Concept | File |
|---------|------|
| Core instructions (bootstrapper) | `src/core_instructions.md` |
| User instructions index | `src/index.md` |
| Archived full version | `src/old/core_instructions_long.md` |
| Personas | `src/personas/` |
| Skills (all categories) | `src/skills/` |
| Schemas | `src/schemas/` |
| Deploy target | `DuetData/ai-instructions/` (via Host) |
