# Use Case: researcher_project_solo

**Timestamp:** 260123_1155
**Client:** Claude Code (VS Code)
**Persona:** Socrates
**Project folder:** projects/260110_ai_kit_design
**Topic files:** topic_ai_kit_redesign.md

## Classification

| Parameter | Value |
|-----------|-------|
| **Role** | Researcher + prompt designer — exploring concepts, designing field research instrument |
| **Scope** | project |
| **Workflow** | solo |
| **Task type** | research + design |
| **Result** | COLLECT_PROMPT.md (field research instrument), skills/stances structure, topic file with decisions |
| **Duration** | long >50 msgs |

## Context Used

### Modes (what activities happened)
- DIALOGUE (most of the chat — exploring concepts, making decisions)
- Informal REVIEW (analyzing architect_project_solo report)

### Skills (domain expertise used)
- instructions-architect (applied explicitly with checklist at the end)
- prompt-design (designing survey instrument for field research)
- field-research methodology (understanding discovery vs confirmation)

### Stances (thinking styles used)
- dialectic (questioning assumptions, exploring alternatives — especially in naming discussion)
- pragmatic (when making quick fixes to the prompt)
- self-critical (when user pushed to re-evaluate prompt quality)

### Other Context (what else was loaded or referenced)
- Anthropic Skills repo (web fetch)
- core_instructions.md (review against progressive disclosure)
- instructions-architect.md skill file
- architect_project_solo_260123_1715.md (analyzed as sample response)
- topic_ai_kit_redesign.md (main topic file)

## Reflection

**What context was MISSING that would have helped?**
- Examples of good field research prompts from other domains
- More sample use case reports to validate the format earlier

**What could have gone better?**
- I didn't apply instructions-architect skill explicitly until user asked — should have used the checklist proactively
- Initial naming proposal (YYMMDD_client_name) showed I jumped to solution without understanding the problem
- User had to push multiple times for me to critically evaluate my own prompt

**What new patterns or insights emerged?**
- Checklists bias toward confirmation, open-ended questions enable discovery
- "Field research on agents" as framing for use case collection
- Stances can switch within a chat (dialectic → pragmatic), not one per session
- Skills should be explicitly invoked with their checklists, not just "known"

## Summary

Designed COLLECT_PROMPT.md as field research instrument for discovering new modes/skills/stances patterns. Iterated through multiple versions based on user feedback, applying instructions-architect skill to optimize token efficiency.
