# Skill: Commit

Generate a commit message for all workspace changes. Never commit — only present the message.

**Trigger:** `!коммит`

---

## Procedure

### Step 1: Gather context

Scope: **all changes in workspace** (staged + unstaged + untracked). No cherry-picking by default.

Run in parallel:
- `git status --short` — full picture (never use `-uall`)
- `git diff --stat` — scope overview
- `git diff HEAD` — actual changes
- `git log --oneline -5` — recent style

### Step 2: Analyze

Group related changes. Identify the **main thing** — the single most important change that everything else supports.

If changes span unrelated concerns — flag, propose splitting. Don't insist.

### Step 3: Draft message

First line = the main thing. Laconic. Max 70 chars.

```
<main change>

- <supporting change 1>
- <supporting change 2>
```

Rules:
- English, lowercase
- First line captures the essence — what matters most
- Body lists supporting changes as bullet points (only if needed)
- No filler, no ceremony

### Step 4: Present

1. Bullet summary — what changed, grouped, highlight the main thing first
2. Commit message in code block

**Then stop.** No `git add`, no `git commit`. No questions like "коммитим?" — just present the message and wait. User will say when to commit.
