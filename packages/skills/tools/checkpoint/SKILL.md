---
name: checkpoint
description: Save context for new chat
---
# Skill: Checkpoint

Save conversation context so a new chat can continue the work without loss.

**Trigger:** `!упакуй`

---

## Key Concepts

- **Entry-point file** — the main file a new chat starts from. Usually plan.md, but could be index.md, prompt.md, topic_*.md. Determined from conversation context.
- **Project artifacts** — files that manage the project: plan, topic files, project folder.
- **Relevant documentation** — non-target files that describe the product/component and need to stay in sync: README, spec (PRODUCT.md, COMPONENT.md), docs/. Not the goal of the project, but become stale if not updated.
- **Target artifacts** — the intellectual product of the conversation, the thing the project exists to create or change: code, instructions (core_instructions.md, prompts), specs (PRODUCT.md, COMPONENT.md), knowledge files, taxonomies, README, configs.

**Note:** The same file can play different roles in different projects. E.g., COMPONENT.md is a target artifact in a design project (creating the spec) but relevant documentation in a feature project (updating it to stay in sync).

---

## Procedure

> ⚠️ **This is a thorough workflow.** "Without loss" means without loss. Walk every message, check every point. Do not skim.

### Step 1: Walk through the conversation + assess structure

**1.1. Ground yourself.** Identify all projects and areas the conversation touched. There may be more than one — e.g., research work + a tool or prompt created along the way. For each project: what project, which step, what are we doing.

**1.2. Assess completion.** For each area: is the work finished or continuing?
- **Work finished in this session** — the artifact (file) is the result. No project folder needed. Just verify the artifact is in place and reflected in README/spec.
- **Work will continue** — need a project so the new chat picks up. If no project folder exists yet — note this in the plan (section "Оценка структуры"), propose creating one.

**1.3. Read relevant files** to understand what's already saved. Without this, you can't filter new from already-captured. Which files are relevant depends on the project — determine each time from the actual structure. These are project artifacts, relevant documentation, and existing target artifacts — not source code.

**1.4. Walk through the conversation message by message** and identify what needs saving. This walk produces the **conversation pass table** (shown to the user in step 1.7). Per-message granularity is what prevents items from slipping through — don't walk "in general."
- For each user message and each substantive agent response: what's the key point? Is it already in files? Ephemeral exchanges (greetings, confirmations, tool outputs) are checked but don't produce rows in the pass table — only substantive points do.
- The only criterion: **"Without this, will a new chat work blind or repeat already-covered ground?"** If yes — take it. If no — skip.
- Intermediate reasoning, rejected hypotheses, ephemeral replies — usually not needed. But if a rejected hypothesis is important (so new chat doesn't repeat the mistake) — take it.
- **Open items are the highest-risk category.** Generated candidates, proposed alternatives, questions raised but not answered — anything the user hasn't explicitly closed is in their backlog. "No explicit decision" is NOT "rejected" — it's "pending." These are the easiest to lose and the most damaging when lost, because the user assumes they're tracked.
- Don't limit yourself to pre-known types. Any conversation can produce anything.
- Only take what's not already in files.
- **Instructions signal.** While walking, also note: rule violations by the agent, user feedback on how the agent should work, and recurring patterns. These don't go into the pass table — they feed step 3.2.4 (Instructions review).

**1.5. Long conversation risk.** In long conversations the beginning may be compressed and inaccessible. If you suspect important decisions were at the start and weren't saved along the way — note this in the output (section "Риск сжатия начала беседы").

**1.6. Assess structure.** Does the current folder/file structure fit what we've produced, or has the conversation outgrown it?

**1.7. Stop and present the conversation pass table + packing plan** to the user.

First, the **conversation pass table** — the result of step 1.4. Each row = a block of related thoughts that can be checked as one item: either it's captured or it's not. Not bound to a single message — may span several or be a subset of one. Only substantive points — ephemeral exchanges are not listed. Statuses: ✅ already in files, 🔲 needs saving (step 2 will write these). This table is the primary defense against losing content — the user can spot gaps before saving begins.

```
Проход по чату:

| # | Суть | Статус |
|---|------|--------|
| 1 | <блок мыслей> | ✅ в <файл> |
| 2 | <блок мыслей> | 🔲 → <файл> |
| ... | | |
```

Then, the **packing plan** for each project:

```
## Проект: <название> (<продолжается / завершается в этой сессии / завершён>)

Проектные артефакты:
- `<файл>` — <статус и пояснение>
- ...или «нету (<почему>)»

Релевантная документация:
- `<файл>` — <статус и пояснение>
- ...или «нету (<почему>)»

Целевые артефакты:
- `<файл>` — <статус и пояснение>
- ...или «нету (<почему>)»

(<опционально: дополнительные категории, если что-то не ложится
в три основных — например: внешние ресурсы, зависимости от других
проектов, контекст из другого воркспейса, и т.д.>)

```

After all projects:
```
Оценка структуры:
<Кратко: «структура подходит, всё ложится естественно» — или конкретные
предложения что улучшить, с обоснованием. Если нужна реорганизация —
описать: что сейчас, что предлагается, почему. Сохранение не начинать
пока пользователь не подтвердит.>

Риск сжатия начала беседы: <не выявлен / есть подозрение — что именно могло быть потеряно>

Сигналы по инструкциям:

| # | Что произошло | Тип | Что можно улучшить |
|---|--------------|-----|-------------------|
| 1 | <описание> | <нарушение / feedback / паттерн> | <предложение или "исправлено в сессии"> |

...или «не выявлено»
```

Each item on a separate line, don't compress. Statuses and "none" always with explanation. Items marked 🔲 in the pass table are what step 2 will save — anything not marked 🔲 won't be saved.

Wait for user confirmation. If user makes edits — adjust the plan and re-present. Proceed to step 2 only after explicit "ok".

### Step 2: Save — execute the plan

After user confirmation — save all items marked 🔲 in the conversation pass table from step 1.7. Decisions about "what" and "where" are already made — this is execution only.

**How to write:**
- Capture the substance, not the process. Not "we discussed X and arrived at Y" → but Y itself.
- Entries must be self-contained — a reader who wasn't in the conversation should understand without chat context.
- If a file already contains outdated information on the topic — update, don't duplicate.
- For continuing projects — mark the current step with `[ACTIVE]` in the entry-point file.

### Step 3: Test + report

Immediately after step 2, no pause.

**3.1. Test.** Re-read the updated files (the actual files, not from memory). Two tests, in this order:

**Completeness test (primary).** Verify against the conversation pass table from step 1.7: every item marked 🔲 must now be in files. Re-read the actual files and check each item. If something is missing — fix before proceeding.

**Verification pass.** After the first check, do a second pass focusing on the highest-risk items: open questions, generated-but-not-resolved candidates, and items from early in the conversation (most likely to be forgotten). If anything was missed in the pass table itself — add it and save.

**Coherence test (secondary).** Then, from a new chat's perspective:

- Do I understand what we're doing and why?
- Do I know where we stopped and what to do next?
- Do I have all the insights and decisions to not repeat already-covered ground?
- Are there contradictions or outdated information in the files?

If any answer is "no" — add what's missing and re-read.

**3.2. Report.** If all "yes" — give the user:

1. **What was done** — for each project: what was written where, what was updated, what was created. Cross-check with the plan from step 1 — is everything done.

2. **Structure assessment** — confirm the assessment from step 1 ("unchanged") or adjust if something new was discovered during saving.

3. **Initiating phrase for new chat** — only for continuing projects: `Привет, <persona>, работаем над <entry-point file>`. Substitute the persona from the current conversation and the path to the entry-point file at packing time.

4. **Instructions signals** — if step 1.4 collected any signals (rule violations, feedback, patterns), remind: "В сессии были сигналы по инструкциям: <краткое перечисление>. Хочешь вызову ИА для улучшения?"

### Step 4: Instructions improvement (optional)

Only if user says "yes" to step 3.2.4.

Load skill `instructions-architect`. IA analyzes the signals, proposes specific edits to instruction files, user confirms each change.
