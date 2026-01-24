# Use Case: reviewer_repo_sddg

**Timestamp:** 260123_1900
**Client:** Codex CLI (terminal)
**Persona:** Daedalus (Дедал)
**Project folder:** /Users/starship/DuetData/Duet
**Topic files:** projects/260117_extension_design/topic_vscode_extension.md

## Classification

| Parameter | Value |
|-----------|-------|
| **Role** | Reviewer (L6+) + field-research participant |
| **Scope** | repo (cross-folder review + writeback into project file) |
| **Workflow** | sddg (4) — 4 AI agents collaborating via files |
| **Task type** | deep code review + spec conformance review + iterative fix verification |
| **Result** | Updated review notes in `projects/260117_extension_design/CurrentStepWork.md`; produced this use-case report |
| **Duration** | medium 10-50 |

## Context Used

### Modes (what activities happened)
- REVIEW (spec vs implementation review, follow-up verification)
- COMMENTARY (pointing to file locations and concrete behaviors)
- SECRETARY (capturing the interaction as a use-case artifact)

### Skills (domain expertise used)
- VS Code extension architecture (TreeDataProvider, commands, views/menus contribution points)
- TypeScript API/UX review
- Test review (Vitest)
- Spec-to-implementation gap analysis

### Stances (thinking styles used)
- systematic (trace spec → code paths → UX behaviors)
- adversarial (look for edge cases, misleading UI states, invariants violations)
- pragmatic (accept intentional deferrals but record debt precisely)

### Other Context (what else was loaded or referenced)
- projects/260117_extension_design/topic_vscode_extension.md (spec for Context section and edge cases)
- projects/260117_extension_design/CurrentStepWork.md (work log + review sections)
- packages/extension/src/core/tree/contextBreadcrumb.ts
- packages/extension/src/vscode/providers/ContextProvider.ts
- packages/extension/src/core/db/index.ts (findClosestEntity implementation)
- packages/extension/src/test/unit/contextBreadcrumb.test.ts
- projects/260110_ai_kit_design/use_cases/COLLECT_PROMPT.md (instrument/template)

## Reflection

**What context was MISSING that would have helped?**
- A short “expected UX screenshots” pack for Context edge cases (to validate labels/icons/click targets)
- A written policy for “info states” vs “error states” in the Context tree (clickability, iconography, help UX)

**What could have gone better?**
- Fixes to satisfy review notes can unintentionally regress semantics (“state preserved end-to-end: core → UI → help”) unless that is explicitly re-checked.
- When node-shapes change (parent/child error nodes), the help payload/formatting must be re-audited (otherwise you get broken messages).

**What new patterns or insights emerged?**
- “Review loops” across multiple agents (implementation agent + reviewers + meta-reviewer) produce a distinct workflow category from “solo chat”, even if each chat window is 1:1.
- Field-research capture works best when it records both the *technical outcome* and the *coordination mechanism* (multi-agent via files).

## Summary

Reviewed the Context TreeView implementation against the spec, re-verified after fixes landed, and captured the session as a structured use-case report (workflow = multi-agent via files).

