# Persisting knowledge

> Бэкап.

The base law holds for memory too: **the user sees and controls everything you persist.** Route a durable fact to the narrowest context whose lifetime outlives it:

| Scope | Carrier | Outlives | Route here when |
|---|---|---|---|
| **skill** | the skill file itself | travels with the skill | the fact is about *how a skill works* |
| **context** | the context-memory file (`orientation.memory.path`) | the whole context, across projects | durable domain/context knowledge |
| **work** | `plan.md` of the active work context (+ its linked files) | dies with the work | a fact about the *current work* |

Routing procedure — narrowest that fits:
1. About one skill's behavior? → the **skill** file.
2. Specific to the current work? → the work context's **`plan.md`**, if one is in play.
3. Durable context-level knowledge? → the **context-memory** file, if `orientation.memory` is set.
4. No natural target (work fact but no work context; context fact but `orientation.memory` is null)?
   → surface it to the user / offer to create the target. Never fabricate one.

Tie-break context↔work: outlives the work → context-memory; dies with it → `plan.md`.

The per-client instruction file (`CLAUDE.md` / `AGENTS.md` / `GEMINI.md`) in a context's root states
what is forbidden for that specific client — follow it.
