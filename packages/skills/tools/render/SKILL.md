---
name: render
description: Render Markdown to a polished HTML and PDF — sidebar TOC, native emoji, Mermaid diagrams, code highlighting
---
# Skill: Render

Markdown → self-contained HTML + print-ready PDF. Sidebar TOC, emoji, Mermaid, code highlighting, Cyrillic, math — all out of the box.

**Trigger:** `!рендер`, `!render`, or any «сделай PDF/HTML из этого MD».

---

## Why this stack

The obvious first attempt — `pandoc --pdf-engine=xelatex` — is a trap. Emoji require obscure font configuration that often fails anyway; Mermaid needs a separate filter; the result still looks like a thesis from 2008. Hours of yak-shaving.

The pipeline that just works is two commands:

1. **Quarto** parses MD → self-contained HTML with Bootstrap theme, sidebar TOC, embedded `mermaid.js`, code highlighting, math.
2. **Headless Chrome** opens that HTML, runs the JS (Mermaid renders to SVG in the DOM), prints to PDF. Anything Chrome can show — emoji, web fonts, SVG — lands in the PDF identically.

Mermaid always needs a browser engine somewhere (it renders via JavaScript). Tools that hide it — `md-to-pdf`, `mmdc`, VS Code «Markdown PDF» — wrap Puppeteer/Chromium internally. Here the engine is explicit, debuggable, and version-independent.

## Setup (one-time per machine)

**Quarto:** `brew install --cask quarto` if sudo is available. Otherwise download tarball from `https://github.com/quarto-dev/quarto-cli/releases`, extract to `~/Applications/quarto/`, the binary is at `~/Applications/quarto/bin/quarto`. Add to PATH or call by full path.

**Chrome:** typically already at `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome` on macOS. Chromium and Edge work too. On Linux: `google-chrome` / `chromium` in PATH.

## Pipeline

For input `file.md` next to which you want `file.html` and `file.pdf`:

```bash
# 0. Per-folder print settings, if the folder carries them
[ -f "$(dirname file.md)/render.css" ] && CSS="--metadata css:render.css"

# 1. Markdown → HTML
quarto render file.md --to html \
  --metadata toc:true \
  --metadata toc-location:left \
  --metadata toc-depth:3 \
  --metadata theme:cosmo \
  --metadata embed-resources:true \
  --metadata fontsize:1.05em ${CSS:-}

# 2. HTML → PDF
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless --disable-gpu --no-pdf-header-footer \
  --generate-pdf-document-outline \
  --virtual-time-budget=15000 \
  --print-to-pdf="$(pwd)/file.pdf" \
  "file://$(pwd)/file.html"
```

Chrome needs an **absolute** `file://` URL — relative paths silently produce empty PDFs.

## `render.css` — a folder carries its own print settings

**Always check for a `render.css` next to the markdown, and pass it.** When a document has been
tuned for print — page size, margins, measure, typeface, page-break rules — that tuning belongs
with the document, not in whoever renders it next. A folder holding one keeps rebuilding to the
same book a year later, from the folder alone, with no notes and no memory of this session.

Copy it alongside the markdown when rendering out of a temporary directory: Quarto resolves `css:`
relative to the source file.

Write the settings there rather than in flags whenever they are properties of *this* document
(`@page` size and margins, `max-width` for the measure, `font-family`, `break-inside` rules).
Flags stay for properties of *this run* (theme, TOC).

Nothing is required: with no `render.css` the pipeline behaves exactly as before.

**What each Chrome flag does:**

- `--headless --disable-gpu` — run without UI
- `--no-pdf-header-footer` — drop the `file://...` URL and date that Chrome prints by default at the top/bottom of every page
- `--generate-pdf-document-outline` — emit PDF bookmarks from `<h1>..<h6>`. Without this flag the PDF has no outline panel
- `--virtual-time-budget=15000` — give the page's JavaScript 15 seconds of virtual time before printing. Mermaid needs this to render diagrams to SVG before the snapshot

## Mermaid in `.md` — make a `.qmd` shim

Quarto refuses to execute `{mermaid}` blocks unless the file has the `.qmd` extension. The fix is invisible to the user: copy the source to a hidden `.qmd`, render, rename the output back, delete the shim.

```bash
if grep -q '^```{mermaid}' file.md; then
  cp file.md .file.render.qmd
  quarto render .file.render.qmd --to html [...metadata flags...]
  mv .file.render.html file.html      # Quarto names HTML after the source stem
  rm .file.render.qmd
fi
```

The diagram syntax must be ` ```{mermaid} ` (curly braces). Plain ` ```mermaid ` is just a syntax-highlighted code block — Quarto won't run it.

## Parameters worth knowing

| What | How |
|------|-----|
| Different theme | `--metadata theme:flatly` (also: `litera`, `lux`, `journal`, `sandstone`, `cosmo`-default) |
| TOC on the right | `--metadata toc-location:right` |
| Drop TOC | omit the `toc:true` line |
| Bigger font | `--metadata fontsize:1.1em` (default `1.05em` is slightly larger than Bootstrap base) |
| Per-doc settings | YAML frontmatter in the `.md` file — wins over `--metadata` flags. Useful when one specific doc needs custom theme without changing how the skill is invoked |
| Print tuning that must survive | `render.css` beside the markdown — see above. Page size, margins, measure, typeface, page-break rules |

Frontmatter example:

```yaml
---
title: "My doc"
format:
  html:
    toc: true
    toc-location: left
    theme: flatly
    code-fold: true       # collapse long code blocks
    code-tools: true      # add a "view source" button
---
```

## Quality criteria

A render is world-class when:

- **Emoji render as glyphs** in both HTML and PDF — 🐺🔮🦴⚔, not missing-glyph boxes. Chrome uses Apple Color Emoji on macOS, Noto Color Emoji on Linux.
- **Mermaid blocks are diagrams** — flowcharts, sequence, gantt, etc. SVG in HTML, the same SVG baked into PDF.
- **Sidebar TOC is present and clickable** in HTML; **PDF bookmarks panel** mirrors the heading tree (verify in Preview: View → Table of Contents).
- **Code blocks are syntax-highlighted** with language detection.
- **Cyrillic and math** (`≤ ≠ × → A→B`) render with no font warnings, no `.notdef` boxes.
- **Self-contained HTML** — file opens correctly when emailed, copied to a USB stick, or thrown into Drive. No external CDN.

## Anti-patterns

| Don't | Why |
|-------|-----|
| Reach for `pandoc --pdf-engine=xelatex` first | Cannot render emoji without exotic font configs that often fail anyway; Mermaid needs a separate filter; multi-hour rabbit hole. |
| Install TeX Live or Symbola to «fix» emoji in xelatex | Symbola was withdrawn from CTAN; even a complete TeX install won't render Apple Color Emoji. Wrong fix to the wrong problem. |
| Use `quarto render --to pdf` (typst path) | Quarto's native PDF goes through typst/LaTeX. Emoji in headings disappear because typst has no emoji font. The HTML→Chrome path keeps them. |
| Render Mermaid through `mmdc` and embed PNGs into MD | Adds a build step the user has to remember and lossy PNGs instead of crisp SVG. The `.qmd` shim handles it natively. |
| Use online «MD to PDF» services | Privacy (file uploaded) and unreliable for non-trivial docs. |
| Hand-edit the generated HTML to «fix» the PDF | Touch the source or the flags. The HTML is a build artifact; edits get lost on re-render. |
| Keep a document's print tuning in your own script or in chat | It is lost the moment either goes away, and the document silently renders differently. Put it in `render.css` beside the markdown. |
| Forget `--generate-pdf-document-outline` on Chrome | The PDF will have no bookmarks — sidebar in Preview/Acrobat will be empty even though the HTML had a sidebar TOC. |
| Pass a relative `file://` URL to Chrome | Silently produces an empty PDF. Always absolute path. |
