# Prompt: Classify This Chat

Analyze our **entire** chat history and save the result.

> **Claude Code:** Include compaction summaries — they contain earlier context.

## Output File

Save to: `projects/260110_ai_kit_design/use_cases/<role>_<scope>_<workflow>_<YYMMDD_HHMM>.md`

| Component | Description | Examples |
|-----------|-------------|----------|
| **role** | How you understood your role | researcher, implementer, reviewer, debugger, architect, mentor... |
| **scope** | What was affected | chat, project, repo, multi_repo... |
| **workflow** | Agents collaborating on this task (via files/copy-paste, not same window) | solo (1), pair (2), sddg (4), multi (N)... |
| **YYMMDD_HHMM** | Timestamp for uniqueness | 260123_1306 |

**Values are open-ended** — invent new ones if existing don't fit.

Example: `researcher_project_solo_260123_1306.md`

---

## Report Template

```markdown
# Use Case: <role>_<scope>_<workflow>

**Timestamp:** YYMMDD_HHMM
**Client:** <tool (IDE)>, e.g. Claude Code (VS Code), Cursor, Copilot Chat
**Persona:** <if used>
**Project folder:** <path to project folder, e.g. projects/260110_ai_kit_design>
**Topic files:** <list topic files worked on, e.g. topic_ai_kit_redesign.md, topic_base_instructions.md>

## Classification

| Parameter | Value |
|-----------|-------|
| **Role** | |
| **Scope** | |
| **Workflow** | |
| **Task type** | |
| **Result** | |
| **Duration** | short <10 / medium 10-50 / long >50 msgs |

## Context Used

### Modes (what activities happened)
List the modes you operated in. Known: DIALOGUE, PLANNING, EXECUTE, SECRETARY, REVIEW, COMMENTARY. Invent new ones if needed.

-

### Skills (domain expertise used)
List what expertise you needed. Examples: python, typescript, lean, git, testing, jinja2, instructions-architect...

-

### Stances (thinking styles used)
Describe how you approached the work. Examples: dialectic (deep questioning), pragmatic (quick solutions), exploratory, systematic...

-

### Other Context (what else was loaded or referenced)
List files, docs, or knowledge you used. Examples: persona file, thesaurus, topic file structure, state machine, red lines, WORKSPACE_MAP, spec/, index.md, web research...

-

## Reflection

**What context was MISSING that would have helped?**
(files, knowledge, instructions that weren't available but would have made the work better)

-

**What could have gone better?**
(misunderstandings, wasted turns, wrong approach — from either side)

-

**What new patterns or insights emerged?**
(unexpected discoveries, new approaches that worked well, things worth reusing)

-

## Summary

(1-2 sentences: what we did)
```

---

## Instructions

1. Fill in the template — be factual and specific
2. **Invent freely** — this is field research; describe what actually happened, not just examples
3. Save to the specified path
