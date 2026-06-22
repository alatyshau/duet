---
name: chat-format
description: Format an exported AI chat (Prompt/Response markdown) into Q-numbered sections with brief titles for a navigable TOC
---
# Skill: Chat-Format

Turn a flat exported chat file into a navigable document with numbered Q-sections and meaningful titles.

## Why

A raw export from Gemini/ChatGPT/Claude/DeepSeek is a linear stream of prompt/response markers. Twenty turns in, the sidebar TOC is just "Prompt, Response, Prompt, Response..." — useless. The user can't jump to "where did we discuss SAP migration?" without scrolling.

The fix is structural:

- Each prompt/response pair collapses into one H2: `## Q01 — Brief title`. The TOC reads like a real table of contents.
- The user's message and the assistant's reply are separated inside the section by a horizontal rule. Visually distinct turns, no decorative labels needed.
- Subheadings inside answers nest under the Q-heading. If a response uses `##` (or HTML `<h2>` in HTML-bodied sources), shift it down a level so it doesn't collide with the Q-marker. `<h3>` shifts to `####` in the same pass.

After this, `!рендер` gives a PDF with proper bookmarks and a clickable sidebar by topic.

## Quality Criteria

- **Titles are concrete and specific.** "Миграция Google с Oracle на SAP" — not "Вопрос про SAP" or "Корпоративный софт". A reader scanning the TOC should recognize each turn.
- **Titles match what the USER asked**, not what the assistant covered. The user navigates their own chat by how they remember the question, not by the answer's structure.
- **Length: 2-6 words.** Long enough to disambiguate, short enough to scan in a sidebar.
- **All pairs numbered, none skipped.** Even one-liner exchanges get their own Q-heading.
- **Body text untouched.** Only the headings change. Never rewrite, paraphrase, or re-flow prompt/response content.

## Pipeline

The bundled scripts run on Node (`node scripts/<name>.js`). `deepseek_cleanup.js` and `qnumber.js` are dependency-free; only the optional math check (step 6) needs `katex` (`npm install katex`). If a package is missing, the script says exactly what to install — install it and re-run.

### 1. Detect the markers and the body format

Different sources use different markers. Inspect the file before writing the script:

```bash
grep -nE "^(## Prompt:|## Response:|### You:|### Assistant:|### User|### DeepSeek AI|\*\*You:\*\*|\*\*ChatGPT:\*\*)" file.md | head -20
```

Common patterns:

- Gemini export: `## Prompt:` / `## Response:`
- ChatGPT markdown export: often `### You:` / `### ChatGPT:` or bold variants
- Claude.ai export: varies — inspect first
- DeepSeek share-page export: `### User` / `### DeepSeek AI`

Also check what's *inside* the message bodies. The marker substitution logic stays the same across sources, but the body may not be plain markdown:

```bash
grep -oE "<[a-zA-Z][^>]*>" file.md | sort -u | head -20   # HTML tags?
grep -c "思考" file.md                                     # DeepSeek thinking blocks?
grep -c 'tikzcd' file.md                                  # math diagrams that won't render?
```

If the chat is mathy, also note whether it carries LaTeX — especially `\begin{tikzcd}` commutative diagrams, which assistants emit without `$$` delimiters and which KaTeX can't render at all. That's handled by a separate optional pass at the end (step 6, `latex-formatting.md`), not during cleanup.

If the bodies are HTML, you need a source-specific cleanup pass before the marker substitution. Currently documented:

- **DeepSeek** (HTML bodies with `<p class="ds-markdown-paragraph">`, thinking blocks `<p>思考：</p><blockquote>...</blockquote>`, KaTeX math, code-block chrome): run `scripts/deepseek_cleanup.js <file>`. See `deepseek-cleanup.md` for what it handles and how to extend it.

Other sources (ChatGPT/Claude/Gemini) currently export plain-ish markdown; if you encounter HTML in their bodies, write a sibling cleanup pass following the DeepSeek script/companion as template.

**Two-pass principle: technical first, semantic last.** The pipeline below runs cleanup before naming because drafting titles by reading messy HTML is wasteful — every `<p class="ds-markdown-paragraph">` and `<span class="">` you scan to extract the user's actual question is attention spent on chrome instead of substance. Convert to clean Markdown first, then read the clean file to draft titles, then apply Q-numbering.

### 2. Back up and run the technical cleanup pass

Always copy the file to `<file>.bak` before writing anything. Regex-based cleanup — especially the source-specific HTML passes — can miss an edge case on an unfamiliar export shape. With a backup, you restore and adjust; without one, you re-export from the source (if the source even still has the chat available).

```bash
cp "file.md" "file.md.bak"
```

If step 1 detected HTML in the bodies, run the source-specific cleanup pass now. It rewrites each body to clean Markdown, leaves the role markers (`### User` / `### DeepSeek AI` / etc.) in place, and strips decorative inter-message `---` separators. For DeepSeek, run `node scripts/deepseek_cleanup.js <file>` — it makes its own `.bak`, writes the cleaned file back to the same path, and exits non-zero if any HTML survives (see `deepseek-cleanup.md`).

If the bodies are already plain Markdown (Gemini-style export), skip the cleanup and proceed.

### 3. Read every pair, draft titles

Now the file is clean Markdown. Read it in full. For each prompt/response pair, write down a 2-6 word title capturing what the user asked. Verify the title against the question: would the user, scanning their own TOC, recognize this turn? If the title could fit any of three different turns, it's too generic — sharpen it.

This step is semantic and goes last among the read-and-think phases for a reason: doing it after cleanup means you read substance, not HTML.

### 4. Run the Q-numbering substitution

The substitution is mechanical (count markers, swap in numbered headings, replace the response marker with `---`); the titles are the only bespoke part. So write the titles to a file and let `scripts/qnumber.js` do the plumbing — one title per line, in chat order, one line per pair:

```bash
cat > titles.txt <<'EOF'
Title for Q01
Title for Q02
# ... one line per prompt/response pair, in order; blank/`#` lines ignored
EOF

node scripts/qnumber.js file.md \
    --prompt-marker "### User" \
    --response-marker "### DeepSeek AI" \
    --titles titles.txt
```

Pass the markers your source actually uses (`## Prompt:` / `## Response:` for Gemini, `### User` / `### DeepSeek AI` for DeepSeek, etc.). The script edits the file in place, picks the zero-padding from the pair count (`Q01` vs `Q001` past 99), and **refuses to run unless the prompt count, response count, and title count all agree** — that guard is load-bearing, because a mismatch means a malformed pair (orphan marker, stray segment), and failing loudly beats emitting a half-numbered file. `titles.txt` is a throwaway; delete it after.

**When the markers don't alternate cleanly.** Some exports don't fit the prompt-then-response rhythm `qnumber.js` assumes, and it will (correctly) refuse. A DeepSeek share page can start with an orphan assistant answer (the opening user prompt never made it into the export), or two same-role segments can sit back to back. Don't force the script — map the markers to Q-headings by hand: walk the segments in order, assign the next `## Q##` at the start of each turn, and put `---` between the user message and the assistant reply within a turn. For an orphan answer with no preceding question, still give it a Q-heading, titled from the answer's own content — the reader navigating the TOC needs that entry to exist.

### 5. Verify

```bash
grep -nE "^## " file.md             # Q-headings sequential?
grep -cE "<[a-zA-Z/]" file.md       # 0 if no orphan HTML left
```

Visual sanity check that H2 headings are now `Q01 — ...`, `Q02 — ...`, sequential, with sensible titles.

If `<[a-zA-Z` shows orphan HTML on an HTML-bodied source, the source-specific cleanup pass missed something — restore from `.bak`, fix the cleanup, re-run.

### 6. Make the math render (only if the chat has LaTeX)

The structure is now correct, but a mathy chat can still *look* broken in the preview: assistants emit commutative diagrams as `\begin{tikzcd}` with no `$$` delimiters, and KaTeX — what VS Code's Markdown preview and `!рендер` use — can't render `tikzcd` at all, so it shows as raw text. Skip this step entirely if `grep -c 'tikzcd' file.md` is 0 and the math otherwise renders.

The gate is general, not a `tikzcd` special-case: `scripts/check_math.js` renders every formula through KaTeX and flags whatever won't draw — malformed math *and* LaTeX left outside `$…$` (how bare `tikzcd` slips in) — as a line-numbered list. Run it, fix what it lists, re-run until it prints `OK`:

```bash
cd /tmp && npm install katex
NODE_PATH=/tmp/node_modules node scripts/check_math.js file.md
```

`latex-formatting.md` is the fix catalog for what the checker surfaces: converting `tikzcd` diagrams to KaTeX's `CD` environment (folding diagonals into equivalent squares, since `CD` has no diagonal arrows), fixing math glued to adjacent prose, and so on. This is the one step that touches inside the bodies, so it's deliberately last and deliberately conditional.

## Format conventions

- `## Q01 — Title` — em dash (`—`, U+2014), zero-padded (two digits ≤99 pairs, three past that — `qnumber.js` picks the width).
- Horizontal rule is `---` on its own line, with blank lines above and below. Two blank lines around it prevents accidental setext-heading interpretation in CommonMark.
- Subheadings inside answers must stay deeper than the `## Q##` markers. `###` / `####` are kept as-is; `##` (or HTML `<h2>`) is shifted to `###` and `<h3>` to `####` in the same pass. Never promote a subheading up to `##` — that shadows the Q-numbering and breaks the TOC.

## Anti-patterns

| Don't | Why |
|-------|-----|
| Generate titles without reading the body | "Вопрос N", "Уточнение", "Продолжение" defeat the entire point — the TOC is the deliverable |
| Title from the answer instead of the question | The user navigates by what they asked. "Three levels of languages" feels disconnected when the actual prompt was "Правильно ли я понимаю что у нас выходит три уровня языков?" |
| Use sed/awk for the substitution | Per-occurrence counter with Unicode titles → Python `re.sub(callback)` is the clean path |
| Skip the horizontal rule between prompt and response | Without the visual break, where the user message ends and the assistant reply begins becomes a guess |
| Write `## Q01:` or `## Q01.` instead of `## Q01 — ` | Em dash reads naturally in both Russian and English; consistency across docs |
| Edit prompt or response text | Out of scope. Restructuring markers is not an editorial pass. If the user wants the chat condensed, that's a different task |
| Force `qnumber.js` past its count guard | A prompt/response/title mismatch means a malformed pair. The script refusing is the signal to fix the file or map markers by hand (step 4) — not to bypass it |
| Render to PDF inside this skill | Out of scope — `!рендер` is a separate, composable step. Don't bundle |
| Run cleanup without a `.bak` backup | HTML-bodied sources can throw edge cases at any regex; restoring is cheap, re-exporting may be impossible |
| Treat HTML body as plain markdown and substitute markers naively | Leaves a mess of `<div>`, `<span>`, thinking blocks in the output. Detect HTML in step 1; route to the source-specific companion |
| Leave `<h2>` in response bodies untouched | Collides with `## Q##` headings and breaks the TOC. Always shift HTML-body headings down a level |
| Leave `\begin{tikzcd}` as-is (or just wrap it in `$$`) | KaTeX can't render `tikzcd` either way — it shows as raw text. Convert to the `CD` environment (step 6 / `latex-formatting.md`) |
| Call the math done without a KaTeX render check | A malformed `CD` block fails silently in the preview. Render each through KaTeX with `throwOnError: true` before finishing |
