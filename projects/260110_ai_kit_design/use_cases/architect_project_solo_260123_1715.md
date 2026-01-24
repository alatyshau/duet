# Use Case: architect_project_solo

**Timestamp:** 260123_1715
**Client:** Claude Code (VS Code)
**Persona:** Сократ (Socrates)
**Project folder:** projects/260110_ai_kit_design
**Topic files:** topic_instructions_quality.md

## Classification

| Parameter | Value |
|-----------|-------|
| **Role** | Architect-implementer: designed modular architecture, made architectural decisions with user, implemented core file |
| **Scope** | Project (ai-kit package) |
| **Workflow** | Solo (1 agent) |
| **Task type** | Architecture refactoring + implementation |
| **Result** | core_instructions.md (EN, 386 lines), refactored plan (8 steps), use case template improvement |
| **Duration** | Long (>50 msgs) |

## Context Used

### Modes (what activities happened)

- DIALOGUE — discussing architecture options (includes vs standalone, where to put spec-driven)
- PLANNING — refactoring step structure, updating topic file with detailed plan
- EXECUTE — creating core_instructions.md, updating topic file
- GIT_HELPER — explaining VS Code git UI (Branch → Rebase, Push Force)

### Skills (domain expertise used)

- instructions-architect — designing modular instruction system
- jinja2 — understanding existing template structure
- git — worktree workflow, rebase after PR merge, force push
- markdown — structuring documentation
- bilingual — translating RU→EN while preserving terminology

### Stances (thinking styles used)

- dialectic — exploring alternatives ("where to put spec-driven?", "includes vs standalone?")
- pragmatic — simplifying when user suggested (removing sub-steps, making files standalone)
- systematic — maintaining consistent structure across files
- adaptive — adjusting plan based on user feedback (sub-steps → proper steps)

### Other Context (what else was loaded or referenced)

- topic file structure (5 sections: МОТИВАЦИЯ, ССЫЛКИ, НАРРАТИВ, ВЫХОДЫ, ПЛАН ВНЕДРЕНИЯ)
- state machine (TODO → WIP → IN_REVIEW → DONE)
- thesaurus (EN↔RU: stream=дело, project=проект GTD)
- red lines (no destructive overwrites, no silent deletions)
- draft_sddg.md — spec-driven development workflow
- _instructions/ partials — existing content structure
- COLLECT_PROMPT.md — use case template (evolved during session)

## Reflection

**What context was MISSING that would have helped?**

- Clear mapping of existing _instructions/ partials to new structure upfront
- Example of ideal "standalone mode file" to use as reference
- User's git workflow preferences (UI vs terminal) earlier in session

**What could have gone better?**

- Initial classification of session as "pair" was wrong — misunderstood workflow meaning (agents count, not collaboration style)
- Sub-step structure (3.1, 3.2...) added complexity — user correctly suggested using proper steps instead
- Multiple iterations on use case template — could have asked clarifying questions earlier

**What new patterns or insights emerged?**

- **Standalone > includes** for modular architecture — simpler, no Jinja2 dependency, easier to understand
- **Workflow = agent count** — useful classification dimension for use cases
- **VS Code git UI path**: Branch → Rebase (not Pull Rebase) for syncing after GitHub merge
- **Spec-driven principle belongs in core** — it's universal; workflow defines *when* commits happen

## Summary

Designed and implemented new modular instruction architecture: migrated from monolithic INSTRUCTIONS.md.j2 with Jinja2 includes to standalone EN files. Created core_instructions.md with decision tree, spec-driven principle, and EN↔RU thesaurus. Refactored implementation plan from sub-steps to proper steps (now 8 steps total).
