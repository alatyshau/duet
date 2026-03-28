# SECRETARY Mode

> Read this file when entering SECRETARY mode via `/secretary`.
> After completion — return to DIALOGUE.

---

## Main Task

> **Ensure no thought in chat history remains untransferred to project folder.**

This is chat archiving to disk — so you can:
- Start a fresh chat
- Not fear compaction
- Restore context from files

> ⚠️ **This is a HEAVY workflow** — similar to "extra long thinking". Take your time.

---

## When to Call

| Moment | Why |
|--------|-----|
| **Before EXECUTE** | Archive accumulated context |
| After long dialogue | Many thoughts in chat |
| Before closing chat | Lose nothing |

---

## Algorithm

```
1. Find starting point
   - Look for last @secretary_checkpoint(TIMESTAMP) in chat
   - Or compaction/summary marker (fallback)
   - If nothing — from chat beginning

2. Reassessment
   - Read index.md
   - Assess: is topic refactoring needed?

3. If refactoring needed:
   - Propose refactoring plan
   - Wait for approval
   - Execute refactoring of index.md

4. Message pass
   - For EACH message (both user and agent)
   - What's new? Is it written to file?
   - ⚠️ EDGE CASE: The message requesting /secretary also contains thoughts!

5. Verification pass
   - After first pass — check if anything was missed
   - Especially the /secretary request message itself

6. For each topic:
   - If topic_*.md doesn't exist → create
   - If exists → update (append, not overwrite)

7. Update index.md with current summaries

8. Output checkpoint to CHAT
```

---

## Report Format (pass table)

```markdown
| # | From | Gist | Recorded? |
|---|------|------|-----------|
| 1 | user | brief description of thought | ✅ in topic_xxx.md |
| 2 | agent | what was done | — (action) |
| 3 | user | next thought | ✅ / ❌ |
...
```

The table helps:
- Visualize progress
- Not miss messages
- Show user what was processed

---

## Checkpoint Format

Output to chat as H1:

```markdown
# @secretary_checkpoint(260112_210000M)
```

**Why to chat, not file:**
- After /compact, marker survives in summary
- AI will see it on next call
- Doesn't clutter files

---

## Rules

### What to Save

- ✅ **Current** thoughts
- ⚠️ Cancelled — only if valuable for narrative (dialectics)

### Scope of Work

- Entire chat from checkpoint to current moment
- Entire project folder, not one topic
- Detach from current focus, see big picture

### Creating New Topics

- Usually new topics are created in DIALOGUE
- But SECRETARY **can** create a new topic for archiving completeness
- This is exception, not norm

---

## Completion

After checkpoint — **automatic return to DIALOGUE**.

Further discussion is no longer SECRETARY.

---

## Difference from /compact

| Aspect | /compact | /secretary |
|--------|----------|------------|
| Goal | Compress context for AI | Export to files for human |
| Result | Summary in memory | Persistent topic_*.md |
| When | Auto / manual | Manual |
| Mutation | Replaces history | Append-only |
