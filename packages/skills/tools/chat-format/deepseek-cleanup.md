# Chat-Format: DeepSeek Cleanup

Source-specific cleanup pass for DeepSeek share-page exports, invoked from `chat-format` when an export is detected to be from DeepSeek. Turns HTML message bodies into clean Markdown so the main skill's Q-numbering pipeline produces a usable file.

## Why DeepSeek needs its own pass

A DeepSeek share-page export looks like markdown — `### User` / `### DeepSeek AI` markers separate turns — but the body of every AI response is HTML, not markdown. Naively running the main skill's marker substitution leaves a wall of `<p class="ds-markdown-paragraph">`, `<span class="">`, `<blockquote>`, and code-block chrome in the output. The TOC works, the document is unreadable.

This file describes the artifacts DeepSeek emits and provides the conversion pipeline. Run this pass **before** the main skill's marker substitution.

## Artifacts to handle

### 1. Thinking blocks (default: delete)

Every AI response opens with the model's reasoning, wrapped as:

```
<p>思考：</p><blockquote>...thoughts...</blockquote><br/>
```

The user almost always wants only the final answer. Confirm with the user before keeping these blocks — by default, delete.

### 2. Code blocks with Copy/Download chrome

DeepSeek wraps fenced code in nested div banners with buttons, SVG icons, and a language label. Sketch of the structure:

```
<div class="md-code-block md-code-block-light">
  <div class="md-code-block-banner-wrap">
    <div class="md-code-block-banner ...">
      <div class="_121d384">
        <div class="d2a24f03">
          <span class="d813de27">lean</span>      ← language label
        </div>
        <div>...<button>Copy</button> ... <button>Download</button>...</div>
      </div>
    </div>
  </div>
  <pre>CODE</pre>      ← actual code (syntax-highlighted with inline <span>s)
</div>
```

**Quirk:** the closing `</div>` of `md-code-block` is **not** adjacent to `</pre>` — Copy/Download SVG and div fragments sit between them. Match the regex from `<div class="md-code-block">` *through* `</pre>` only, then let a general chrome-sweep step kill the trailing `</div>`/`<svg>` leftovers.

### 3. Empty span wrappers

DeepSeek wraps every text chunk in `<span class="">text</span>` (sometimes with non-empty classes for syntax highlighting). Strip the tags, keep the content.

### 4. Decorative `---` separators

The exporter emits a literal `---` line after every message segment. They're redundant once the body is wrapped in a `## Q##` heading — strip during segmentation.

### 5. Inconsistent heading levels across chats

In one chat, top-level sections in responses might be `<h3>`. In another, `<h2>`. To prevent collision with the `## Q##` headings the main skill produces, always shift by one level: `<h2>` → `###`, `<h3>` → `####`. The relative hierarchy stays valid in both cases.

## Conversion function

Python stdlib only — no BeautifulSoup required. Drop this into the script the main skill builds.

```python
import re
import html


def deepseek_html_to_md(text: str) -> str:
    # 1. Drop thinking blocks
    text = re.sub(
        r'<p>\s*思考：\s*</p>\s*<blockquote>.*?</blockquote>\s*<br\s*/?>',
        '', text, flags=re.DOTALL,
    )

    # 2. Code blocks: language label is in <span class="d813de27">.
    #    Do NOT anchor on </div> after </pre> — it's not adjacent.
    def conv_code(m):
        full, code = m.group(0), m.group(1)
        lang_m = re.search(r'<span class="d813de27">([^<]+)</span>', full)
        lang = lang_m.group(1).strip() if lang_m else ''
        code = re.sub(r'<[^>]+>', '', code)               # strip highlight spans
        code = html.unescape(code).rstrip()
        return f'\n\n```{lang}\n{code}\n```\n\n'
    text = re.sub(
        r'<div class="md-code-block[^"]*">.*?<pre[^>]*>(.*?)</pre>',
        conv_code, text, flags=re.DOTALL,
    )

    # 2b. Fallback for any standalone <pre> not wrapped in md-code-block
    def conv_pre(m):
        code = re.sub(r'<[^>]+>', '', m.group(1))
        return f'\n\n```\n{html.unescape(code).rstrip()}\n```\n\n'
    text = re.sub(r'<pre[^>]*>(.*?)</pre>', conv_pre, text, flags=re.DOTALL)

    # 3. Sweep UI chrome remnants left over from step 2
    text = re.sub(r'<svg[^>]*>.*?</svg>', '', text, flags=re.DOTALL)
    text = re.sub(r'<button[^>]*>.*?</button>', '', text, flags=re.DOTALL)
    text = re.sub(r'<path[^>]*/?>', '', text)
    text = re.sub(r'</?div[^>]*>', '', text)

    # 4. Empty span wrappers — strip tags, keep content
    text = re.sub(r'<span[^>]*>', '', text)
    text = re.sub(r'</span>', '', text)

    # 5. Inline formatting
    text = re.sub(r'<strong>(.*?)</strong>', r'**\1**', text, flags=re.DOTALL)
    text = re.sub(r'<em>(.*?)</em>', r'*\1*', text, flags=re.DOTALL)

    # 6. <br> / <hr>
    text = re.sub(r'<br\s*/?>', '\n', text)
    text = re.sub(r'<hr\s*/?>', '\n\n---\n\n', text)

    # 7. Shift heading levels (avoid collision with ## Q-headings)
    text = re.sub(r'<h2>(.*?)</h2>', r'\n\n### \1\n\n', text, flags=re.DOTALL)
    text = re.sub(r'<h3>(.*?)</h3>', r'\n\n#### \1\n\n', text, flags=re.DOTALL)

    # 8. Blockquote → "> " prefix on each line
    def conv_bq(m):
        body = re.sub(r'<p[^>]*>', '', m.group(1))
        body = re.sub(r'</p>\s*', '\n\n', body).strip()
        lines = body.split('\n')
        return '\n\n' + '\n'.join('> ' + l if l.strip() else '>' for l in lines) + '\n\n'
    text = re.sub(r'<blockquote>(.*?)</blockquote>', conv_bq, text, flags=re.DOTALL)

    # 9. Lists — process innermost first, iterate until none left
    def conv_list(m):
        list_type, body = m.group(1), m.group(2)
        items = re.findall(r'<li>(.*?)</li>', body, flags=re.DOTALL)
        out = []
        counter = 1
        for item in items:
            item = item.strip()
            item = re.sub(r'^<p[^>]*>', '', item)
            item = re.sub(r'</p>\s*$', '', item)
            item = re.sub(r'</p>\s*<p[^>]*>', '\n\n', item)
            item = re.sub(r'<p[^>]*>|</p>', '', item)
            prefix = f'{counter}. ' if list_type == 'ol' else '- '
            if list_type == 'ol':
                counter += 1
            lines = item.strip().split('\n')
            if not lines:
                continue
            formatted = prefix + lines[0]
            for l in lines[1:]:
                formatted += '\n' if l.strip() == '' else '\n  ' + l
            out.append(formatted)
        return '\n\n' + '\n'.join(out) + '\n\n'
    list_pat = re.compile(
        r'<(ul|ol)(?:\s[^>]*)?>((?:(?!<(?:ul|ol)\b).)*?)</\1>',
        flags=re.DOTALL,
    )
    while True:
        text, n = list_pat.subn(conv_list, text)
        if n == 0:
            break

    # 10. Remaining <p>
    text = re.sub(r'<p[^>]*>', '', text)
    text = re.sub(r'</p>', '\n\n', text)

    # 11. Catch orphan tags — should never fire on a clean export
    leftover = re.findall(r'<[^>]+>', text)
    if leftover:
        print(f"  WARNING: leftover HTML tags: {set(leftover)}")

    # 12. HTML entities + whitespace normalization
    text = html.unescape(text)
    text = re.sub(r'[ \t]+\n', '\n', text)
    text = re.sub(r'\n{3,}', '\n\n', text)
    return text.strip()
```

## Cleanup script (technical pass only — no Q-numbering)

This script runs **before** the main skill's Q-numbering step. It rewrites the file: each `### DeepSeek AI` body becomes clean Markdown, role markers stay in place, decorative inter-message `---` lines are stripped. The output is still a flat chat with `### User` / `### DeepSeek AI` markers — but now readable.

Why split: drafting Q-titles requires reading every user question. Doing that on the post-cleanup file is far cheaper than wading through `<p class="ds-markdown-paragraph">` chrome.

```python
PATH = "<absolute path to the DeepSeek export>"

with open(PATH, 'r', encoding='utf-8') as f:
    content = f.read()

parts = re.split(r'^### (User|DeepSeek AI)\s*$', content, flags=re.MULTILINE)
assert parts[0].strip() == '', f"Unexpected pre-marker content: {parts[0][:200]!r}"

output_chunks = []
for i in range(1, len(parts), 2):
    role = parts[i]
    body = parts[i + 1].strip()
    # Strip decorative trailing "---" between messages
    body = re.sub(r'\n*---\s*$', '', body).strip()
    if role == 'DeepSeek AI':
        body = deepseek_html_to_md(body)
    output_chunks.append(f"### {role}\n")
    output_chunks.append(body + "\n")

with open(PATH, 'w', encoding='utf-8') as f:
    f.write('\n'.join(output_chunks).rstrip() + '\n')
```

Idempotent by design: re-running it on an already-cleaned file is a no-op (no HTML tags left, no `思考` blocks, no decorative `---`).

## Verification (post-cleanup, pre-Q-numbering)

```bash
grep -cE "<[a-zA-Z/]" file.md       # should print 0 — no HTML left
grep -c "思考" file.md               # should print 0 — no thinking blocks left
grep -nE "^### (User|DeepSeek AI)" file.md   # role markers intact, ready for Q-numbering
```

If HTML or `思考` slipped through, restore from `.bak`, adjust the cleanup function above, and re-run. Don't try to patch the corrupted output in place.

## Hand-off to the main skill

After the cleanup pass succeeds, the file looks like plain Markdown with `### User` / `### DeepSeek AI` markers. From here, follow the main `chat-format.md` pipeline from step 3 (draft titles on the clean file) and step 4 (Q-numbering substitution with `PROMPT_MARKER = "### User\n"`, `RESPONSE_MARKER = "### DeepSeek AI\n"`).

## Known quirks to watch for

- **`<span class="d813de27">` for the language label.** Class hashes are auto-generated by DeepSeek's build and may change in future revisions. If the hash drifts, code blocks emit without a language tag — verify on the first run after a known DeepSeek UI update.
- **Closing `</div>` after `</pre>` is non-adjacent.** Intervening SVGs and div fragments from the Copy/Download button row sit between them. Don't tighten the code-block regex to `</pre>\s*</div>` — it will silently fail to match on responses that contain code.
- **`<h2>` vs `<h3>` inconsistency across chats.** DeepSeek doesn't pick one. The unconditional shift (h2 → ###, h3 → ####) keeps both cases valid.
- **Russian-language exports may not have `思考：`.** The Chinese marker for "thinking" appears regardless of UI language as of late 2025, but if the regex stops matching, inspect the raw export for whatever opens the leading `<blockquote>`.
