# COMMENTARY Mode

> Read this file when entering COMMENTARY mode.
> After completion — return to DIALOGUE.

---

## When to Enter

Transition to COMMENTARY happens by **explicit user request**:
- "Comment on file X"
- "Add comments to Y"

---

## Comment Syntax

```markdown
- ::: AUTHOR ::: comment text
  - nested line (part of same comment)
    - ::: OTHER ::: reply to specific line
```

---

## Attribution Format

| Context | Format | Example |
|---------|--------|---------|
| Human | Short | `::: AL :::` |
| AI agent | **Full** | `::: Socrates (Cursor@Opus) :::` |

**Full format for AI:** `::: Name (Client@Model) :::`
- `Name` — persona name (Socrates, Hephaestus, Daedalus)
- `Client` — IDE/tool (Cursor, ClaudeCode, Copilot)
- `Model` — model (Opus, GPT-5.2, Gemini3)

**Why:** traceability — later you can see what "brain" the agent had for this comment.

---

## Recognition Rules

1. **Marker** — `::: AUTHOR :::`
2. **Always in list** — comment starts with `- ::: AUTHOR :::`
3. **Nesting** — everything deeper than marker = part of comment

---

## Comment Must Be TO Something

**Wrong:** comment nested directly in another comment
```markdown
- ::: AL ::: comment
  - ::: AI ::: reply   ← WRONG (reply to what?)
```

**Right:** comments at same level (dialogue)
```markdown
- ::: AL ::: comment
- ::: AI ::: reply     ← RIGHT (reply to comment above)
```

**Right:** reply to specific line inside comment
```markdown
- ::: AL ::: comment
  - this line
    - ::: AI ::: reply to this line  ← RIGHT
```

---

## Contextual Placement

| Context | How |
|---------|-----|
| To list item | Nested (sub-item) |
| To paragraph | 1st level item |

```markdown
- document text
  - ::: AL ::: comment to this item

paragraph text
- ::: AL ::: comment to this paragraph
```

---

## Editing Rules

1. **Don't overwrite** — when editing file, preserve all comments
2. **Can reply** — add your comment with full attribution
3. **Prettify** — Secretary transforms during archiving

---

## Example: Structured Debate

```markdown
### Step 3: ...
- ::: Socrates (Cursor@Opus) ::: Why this folder?
  - ::: Daedalus (ClaudeCode@GPT-5.2) ::: This is a separation pattern...
    - ::: Socrates (Cursor@Opus) ::: Accepted.
```

Dialectics in persistent form — argument right in the file.

---

## Completion

After adding comments — return to DIALOGUE.
