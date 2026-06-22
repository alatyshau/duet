#!/usr/bin/env python3
"""DeepSeek share-page export -> clean Markdown (technical pass, no Q-numbering).

A DeepSeek export looks like Markdown — `### User` / `### DeepSeek AI` markers
separate turns — but every AI body is HTML: `<p class="ds-markdown-paragraph">`
chrome, KaTeX math, code-block banners, thinking blocks. This script rewrites
each AI body to clean Markdown in place, leaving the role markers untouched so
the main chat-format skill can do Q-numbering afterwards.

Usage:
    python deepseek_cleanup.py <export.md>

It backs the original up to `<export.md>.bak` (only if no .bak exists yet, so a
re-run never clobbers the pristine source), rewrites the file, prints a summary,
and exits non-zero if any HTML or thinking blocks survive — your signal that the
export contains an artifact this script doesn't handle yet.

Hit an unhandled artifact? The exit message lists the leftover tags. Add a
converter alongside the existing ones (stdlib only, no BeautifulSoup) and mind
the ordering documented in deepseek-cleanup.md: math and tables must run BEFORE
the generic span-strip; the blockquote pass must run AFTER lists and paragraphs.
Then document the new artifact in deepseek-cleanup.md so the next person knows.
"""

import html
import re
import sys


def convert_katex(text: str) -> str:
    """Replace each <span class="katex">…</span> with $<x-tex annotation>$.

    Depth-aware span scan: katex-html nests many <span>s, so a non-greedy regex
    can't find the matching outer close. We pull the LaTeX from the annotation
    node and drop the visual subtree entirely. Run BEFORE the generic span-strip,
    or the visual glyphs survive as garbled doubled text.
    """
    open_tag = '<span class="katex">'
    span_re = re.compile(r'<span\b[^>]*>|</span>')
    out, i = [], 0
    while True:
        j = text.find(open_tag, i)
        if j == -1:
            out.append(text[i:])
            break
        out.append(text[i:j])
        depth, end = 1, None
        for mm in span_re.finditer(text, j + len(open_tag)):
            depth += -1 if mm.group().startswith('</span') else 1
            if depth == 0:
                end = mm.end()
                break
        if end is None:                      # malformed — bail, don't loop
            out.append(text[j:])
            break
        am = re.search(
            r'<annotation encoding="application/x-tex">(.*?)</annotation>',
            text[j:end], flags=re.DOTALL,
        )
        out.append('$' + (html.unescape(am.group(1)).strip() if am else '') + '$')
        i = end
    return ''.join(out)


def convert_tables(text: str) -> str:
    """HTML <table> -> GitHub-flavoured Markdown table.

    Run AFTER convert_katex (so cells already hold $math$) and BEFORE the generic
    span-strip (cells are still wrapped in <span>s here).
    """
    def conv_table(m):
        rows = re.findall(r'<tr>(.*?)</tr>', m.group(0), flags=re.DOTALL)
        md = []
        for row in rows:
            cells = re.findall(r'<t[hd][^>]*>(.*?)</t[hd]>', row, flags=re.DOTALL)
            clean = [re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]+>', '', c)).strip())
                     for c in cells]
            md.append('| ' + ' | '.join(clean) + ' |')
        if md:
            ncol = md[0].count('|') - 1
            md.insert(1, '| ' + ' | '.join(['---'] * ncol) + ' |')
        return '\n\n' + '\n'.join(md) + '\n\n'
    return re.sub(r'<table>.*?</table>', conv_table, text, flags=re.DOTALL)


def deepseek_html_to_md(text: str) -> str:
    """Convert one DeepSeek AI HTML body to Markdown. Order is load-bearing —
    see the inline notes and deepseek-cleanup.md before reshuffling steps."""
    # 1. Drop thinking blocks (the model's reasoning, almost never wanted)
    text = re.sub(
        r'<p>\s*思考：\s*</p>\s*<blockquote>.*?</blockquote>\s*<br\s*/?>',
        '', text, flags=re.DOTALL,
    )

    # 1a. KaTeX math -> $tex$  (BEFORE generic span strip)
    text = convert_katex(text)

    # 1b. HTML tables -> Markdown (cells now hold $math$; BEFORE span strip)
    text = convert_tables(text)

    # 2. Code blocks: language label is in <span class="d813de27">.
    #    Do NOT anchor on </div> after </pre> — it's not adjacent (Copy/Download
    #    SVG and div fragments sit between </pre> and the closing </div>).
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

    # 8. Lists — process innermost first, iterate until none left
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

    # 9. Remaining <p>
    text = re.sub(r'<p[^>]*>', '', text)
    text = re.sub(r'</p>', '\n\n', text)

    # 10. Blockquote -> "> " prefix. MUST run AFTER lists/paragraphs (steps 8–9)
    #     so a <blockquote> wrapping block-level <ul>/<ol>/<p> keeps its nested
    #     list intact instead of spraying orphan ">" lines.
    def conv_bq(m):
        lines = [('> ' + l) if l.strip() else '>' for l in m.group(1).strip().split('\n')]
        collapsed = []
        for l in lines:                      # squeeze runs of empty quote lines
            if l == '>' and collapsed and collapsed[-1] == '>':
                continue
            collapsed.append(l)
        return '\n\n' + '\n'.join(collapsed) + '\n\n'
    text = re.sub(r'<blockquote>(.*?)</blockquote>', conv_bq, text, flags=re.DOTALL)

    # 11. HTML entities + whitespace normalization
    text = html.unescape(text)
    text = re.sub(r'[ \t]+\n', '\n', text)
    text = re.sub(r'\n{3,}', '\n\n', text)
    return text.strip()


def clean_export(content: str) -> str:
    """Segment a full DeepSeek export and clean each AI body. Role markers stay
    in place; decorative inter-message '---' lines are stripped."""
    parts = re.split(r'^### (User|DeepSeek AI)\s*$', content, flags=re.MULTILINE)
    if parts[0].strip():
        raise ValueError(f"Unexpected content before first role marker: {parts[0][:200]!r}")
    chunks = []
    for i in range(1, len(parts), 2):
        role = parts[i]
        body = re.sub(r'\n*---\s*$', '', parts[i + 1].strip()).strip()
        if role == 'DeepSeek AI':
            body = deepseek_html_to_md(body)
        chunks.append(f"### {role}\n")
        chunks.append(body + "\n")
    return '\n'.join(chunks).rstrip() + '\n'


def main(argv):
    if len(argv) != 2:
        print(__doc__)
        return 2
    path = argv[1]
    with open(path, 'r', encoding='utf-8') as f:
        content = f.read()

    bak = path + '.bak'
    import os
    if not os.path.exists(bak):
        with open(bak, 'w', encoding='utf-8') as f:
            f.write(content)
        print(f"Backed up original -> {bak}")
    else:
        print(f"Backup already exists ({bak}); leaving it untouched.")

    cleaned = clean_export(content)
    with open(path, 'w', encoding='utf-8') as f:
        f.write(cleaned)

    leftover = sorted(set(re.findall(r'<[a-zA-Z/][^>]*>', cleaned)))
    thinking = cleaned.count('思考')
    markers = len(re.findall(r'^### (?:User|DeepSeek AI)$', cleaned, flags=re.MULTILINE))
    print(f"Cleaned {markers} segments.")
    if leftover:
        print(f"  WARNING: {len(leftover)} leftover HTML tag kinds: {leftover[:20]}")
    if thinking:
        print(f"  WARNING: {thinking} thinking marker(s) (思考) survived")
    if leftover or thinking:
        print("Export contains an artifact this script doesn't handle — see the "
              "module docstring on how to extend it, then re-run on a fresh copy.")
        return 1
    print("Clean: no HTML, no thinking blocks. Ready for Q-numbering.")
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
