# Chat-Format: DeepSeek Cleanup

Source-specific cleanup pass for DeepSeek share-page exports, invoked from `chat-format` when an export turns out to be from DeepSeek. Turns HTML message bodies into clean Markdown so the main skill's Q-numbering pipeline produces a usable file.

The conversion logic lives in a runnable script — [`scripts/deepseek_cleanup.js`](scripts/deepseek_cleanup.js) — not inline in this file. This file is the map: *why* DeepSeek needs a special pass, *what* artifacts the script handles (so you can recognise them and extend the script when a new one appears), and *how* to run it. Run the script; only open it when an export contains something it doesn't yet handle.

## Why DeepSeek needs its own pass

A DeepSeek export looks like Markdown — `### User` / `### DeepSeek AI` markers separate turns — but the body of every AI response is HTML, not Markdown. Run the main skill's marker substitution on it directly and you get a wall of `<p class="ds-markdown-paragraph">`, `<span class="">`, `<blockquote>`, KaTeX spans, and code-block chrome. The TOC works; the document is unreadable. So: clean the bodies to Markdown first, *then* hand off to Q-numbering.

## Running the cleanup

From the skill directory (or with an absolute path to the script):

```bash
node scripts/deepseek_cleanup.js <path/to/export.md>
```

What it does:

- Backs the original up to `<export.md>.bak` — but only if no `.bak` exists yet, so re-running never clobbers the pristine source.
- Rewrites the file in place: each `### DeepSeek AI` body becomes clean Markdown, the `### User` / `### DeepSeek AI` role markers stay put, decorative inter-message `---` lines are stripped.
- Prints a summary and **exits non-zero if any HTML or thinking blocks survive** — your signal that the export contains an artifact the script doesn't handle yet (the message lists the leftover tag kinds).

The output is still a flat chat with role markers — but now readable. It's idempotent: re-running on an already-clean file is a no-op.

Why a separate technical pass at all: drafting Q-titles means reading every user question, and doing that on clean Markdown is far cheaper than wading through `<p class="ds-markdown-paragraph">` chrome. Technical pass first, semantic (titles) last.

## Artifacts the script handles

Each entry is something the converter deals with. When an export breaks, it's usually because it contains a *new* variant of one of these (a drifted class hash, a tag not yet covered) — this catalog is where you orient before extending.

1. **Thinking blocks (deleted) — two shapes.** Every AI response opens with the model's reasoning, and the export wraps it one of two ways. The common form is inline: `<p>思考：</p><blockquote>…</blockquote><br/>`. The opening turn sometimes uses the **collapsible UI form** instead — a `<div>` tree with an English header "Thought for N seconds" and the reasoning under `<div class="…ds-think-content…">` — and this one carries **no `思考` marker**, so the inline regex misses it (that's the `Thought for 10 seconds` leak that surfaced on the Бурбаки export). `stripThinkCollapsible` handles it by deleting the outermost `<div>` enclosing the `ds-think-content` class — keyed on that stable semantic class, **not** the build-hash wrapper class (`_245c867`-style, which drifts). The user almost always wants only the final answer, so the script drops both. If a user wants the reasoning kept, that's a manual exception — say so before running. **Watch:** the collapsible form can be the *entire* body of a turn (the final answer never made it into the share page) — after stripping, that turn has an empty answer; flag it, don't fabricate one.

2. **Code blocks with Copy/Download chrome.** Fenced code is wrapped in nested div banners with buttons, SVG icons, and a language label (in `<span class="d813de27">`). The actual code is in `<pre>`. **Quirk:** the closing `</div>` of the code block is *not* adjacent to `</pre>` — Copy/Download SVG and div fragments sit between them, so the converter matches from `<div class="md-code-block">` through `</pre>` only and lets a general chrome-sweep kill the trailing leftovers. Don't tighten the regex to `</pre>\s*</div>` — it will silently fail on any response containing code.

3. **Empty span wrappers.** Every text chunk is wrapped in `<span class="">text</span>` (sometimes with non-empty classes for syntax highlighting). The script strips the tags, keeps the content.

4. **Decorative `---` separators.** The exporter emits a literal `---` after every message segment. Redundant once each body sits under a `## Q##` heading — stripped during segmentation.

5. **Inconsistent heading levels.** One chat's top-level response sections are `<h3>`, another's are `<h2>`; some go a level deeper with `<h4>`. To avoid colliding with the `## Q##` headings, the script shifts unconditionally: `<h2>` → `###`, `<h3>` → `####`, `<h4>` → `#####`. The relative hierarchy stays valid either way. If a future export reaches `<h5>`, extend the same one-line pattern.

6. **KaTeX math.** When the chat has math, every formula is a `<span class="katex">` wrapping two children: `<span class="katex-mathml">` (semantic MathML carrying `<annotation encoding="application/x-tex">` — the **original LaTeX**) and `<span class="katex-html">` (a deep tree of visual `<span>`s). Naive span-stripping is a disaster — it keeps the *visual* glyph fragments and produces garbled doubled text (`KK`, `K,V` split across struts). The script instead replaces each whole katex span with `$<latex>$` pulled from the annotation, discarding the rest. Because katex-html nests same-class spans, it can't be matched with a non-greedy regex — the script scans span tags with a depth counter. All observed math is inline; if a chat ever uses display math, KaTeX marks it `katex-display` — wrap those in `$$…$$`.

7. **HTML tables.** Comparison tables come as real `<table><thead><tbody><tr><th>/<td>` with `<span>`- (and possibly `katex`-) wrapped cells. The script converts them to GitHub-flavoured Markdown tables.

8. **Blockquotes wrapping block-level content.** A `<blockquote>` may wrap not just paragraphs but block-level `<ul>`/`<ol>`/`<p>` (DeepSeek uses this to set off a formal definition). This is the subtle one: the blockquote pass **must run after** lists and paragraphs are already Markdown. Run it earlier and the inner `<ul><li>` are still raw HTML when lines get their `>` prefix — the list pass then converts them with no `>` and the `</p>`→blank-line expansion sprays orphan `>` lines through the quote. Convert lists and paragraphs first, then prefix the already-Markdown lines and squeeze runs of empty quote lines.

## Extending the script for a new artifact

When the script exits non-zero with leftover tags, or you eyeball something the converter mangled:

1. Find where it fits in `deepseekHtmlToMd`'s ordered steps. **Ordering is load-bearing** — math and tables run *before* the generic span-strip (so their inner spans aren't flattened first); the blockquote pass runs *after* lists and paragraphs (artifact 8). When in doubt, add structural converters before the span-strip and prefixing passes after the block-level ones.
2. Keep it dependency-free — no cheerio/jsdom. The existing regex/depth-scanner converters are the template.
3. Add an entry to the catalog above so the next person recognises it.
4. Re-run on a *fresh* copy from `.bak` — never patch corrupted output in place.

## Hand-off to the main skill

After cleanup, the file is plain Markdown with `### User` / `### DeepSeek AI` markers. Continue with the main `SKILL.md` pipeline: draft titles on the clean file, then Q-numbering with `--prompt-marker "### User" --response-marker "### DeepSeek AI"`.

Watch the marker order: a DeepSeek export can start with an orphan `### DeepSeek AI` (the opening user prompt didn't make it into the share page) or otherwise not alternate cleanly. When that happens the simple alternating substitution from SKILL.md step 4 won't fit — map the markers to Q-headings explicitly instead, and give the orphan answer a title from its own content.

## Known quirks to watch for

- **`<span class="d813de27">` language label is a build-generated hash.** It may change in a future DeepSeek revision; if it drifts, code blocks emit without a language tag. Verify on the first run after a known DeepSeek UI update.
- **Russian-language exports still use the Chinese `思考：` thinking marker** (as of late 2025). If the thinking regex stops matching, inspect the raw export for whatever opens the leading `<blockquote>`.
