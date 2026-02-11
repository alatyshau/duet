# AI Instructions — Architecture

Pure content package. Source of truth for all AI agent instructions.

## Categories

| Folder | Question it answers | Example |
|--------|-------------------|---------|
| `modes/` | WHAT is agent doing? | DIALOGUE, EXECUTE, PLANNING |
| `stances/` | HOW is agent thinking? | dialectic, pragmatic, critical |
| `skills/` | WHAT does agent know? | python, typescript, spec-architect |
| `personas/` | WHO is agent? | Socrates, Hephaestus, Ariadna |
| `workflows/` | WITH WHOM? | solo, pair, sddg |
| `schemas/` | File format specs | topic_file, index, skill_file |

## Entrypoints

| File | Purpose | Who uses |
|------|---------|----------|
| `core_instructions.md` | Full instructions (~320 lines) | Claude Code (`~/.claude/output-styles/ai-kit.md`) |
| `core_instructions_short.md` | Compact version (~130 lines) | Codex (`model_instructions_file`), testing |

**Why two?** Instruction adherence. Agents follow rules more reliably with shorter instructions — long instructions get "lost" in context. Short version is the active experiment; full version is the reference.

**Claude Code specifics:** `output-styles/` loads instructions as system-level (not user-level). This significantly improves adherence vs. injecting via CLAUDE.md or conversation.

## Contracts

**File naming:** `<category>/<kebab-name>.md` (e.g. `skills/spec-architect.md`)

**Adding new files:** Create md in the right category folder. Update `core_instructions.md` tables if the new entity needs to be discoverable by agents (e.g. new skill → add row to Skills table).

**Edit rule:** Always edit `packages/ai-instructions/src/`. Never edit `DuetData/ai-instructions/` directly — changes are lost on next deploy.

**Deploy target:** `src/` → `DuetData/ai-instructions/`. Note: `DuetData/ai-kit/settings.json` lives separately in `ai-kit/` — it's a runtime config, not part of this package.

## Deploy Chain

```
packages/ai-instructions/src/  →  DuetData/ai-instructions/
                               (deployer: Host app)
```

## Decisions

| Decision | Rationale |
|----------|-----------|
| `src/` not `templates/` | No templating — files deploy as-is. `src/` consistent with monorepo convention |
| Separate package from ai-kit | Decouple content from infrastructure (MCP, install.py). Enables Host to bundle content independently |
| Separate deploy target | `ai-instructions/` for content, `ai-kit/` for legacy MCP + settings.json |
| Short version as primary | Agents adhere to rules better with compact instructions. Full version kept as reference |
| Claude: output-styles | `~/.claude/output-styles/` injects as system prompt, not user context. Better adherence than CLAUDE.md |

## Legacy Relationship

`packages/ai-kit/` contained both content and infrastructure:
- `templates/` — frozen copy of these same files
- `install.py` — legacy manual installer (replaced by Host deploy)
- `mcp-server/` — legacy Python MCP (timestamp + get_instruction_location)

This package extracts content. Install logic moved to Host.
