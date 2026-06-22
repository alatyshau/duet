# Chat-Format: LaTeX / KaTeX rendering pass

Optional final pass for chats that contain math. The Q-numbered file is correct Markdown, but some of its math won't *render* — this pass finds every render-blocking spot and fixes it so the target renderer (KaTeX) actually draws it. Skip it entirely when the file has no math.

The structure of this pass is **general gate + fix catalog**: `scripts/check_math.js` reviews *all* the math and reports whatever KaTeX can't render (any malformed formula, plus LaTeX left outside `$…$`), so you're never relying on a hardcoded list of known failures. This document then catalogs how to fix the common classes it surfaces — `tikzcd` diagrams being the frequent one, but the gate will catch others too. Run the checker, fix what it lists, re-run until clean.

Run the main `SKILL.md` pipeline first. The conversions here need judgement, not regex — read each flagged formula, don't batch-substitute.

## The target renderer is KaTeX

Both consumers of these files render with KaTeX, not full LaTeX:

- **VS Code's built-in Markdown preview** uses KaTeX for `$…$` / `$$…$$`.
- The `!рендер` step renders KaTeX-class math.

KaTeX is a *subset* of LaTeX. It has no TikZ, no `tikz-cd`, no `\usepackage`, and a limited macro set. Anything outside that subset shows as raw text in the preview. (If you ever target a full-LaTeX/Pandoc pipeline instead, this pass doesn't apply — confirm the renderer before starting.)

## The gate: `scripts/check_math.js`

After Q-numbering, run the checker. It masks code blocks, extracts every `$…$` and `$$…$$` span, renders each through KaTeX with `throwOnError`, and separately flags any `\begin{…}` sitting outside math delimiters (which is exactly how bare `tikzcd` slips in). You get a line-numbered list of what won't render — or `OK` if there's nothing to do.

```bash
cd /tmp && npm install katex          # one-time, anywhere with node
NODE_PATH=/tmp/node_modules node <skill>/scripts/check_math.js file.md
```

Example output:

```
2 render problems:

  line 338  [bare LaTeX]  \begin{tikzcd} is outside math delimiters — wrap it in $$…$$ (and convert if KaTeX can't render it)
      \begin{tikzcd} G \times G \times G \ar[r, ...
  line 512  [inline $…$]  KaTeX parse error: Undefined control sequence: \mathbb at position 3
      \mathbb{Z}
```

Work the list top to bottom using the fixes below, then **re-run until it prints `OK`**. That re-run is the real gate — it's what lets this pass catch problems you didn't anticipate, not just the `tikzcd` case.

## 1. Commutative diagrams: `tikzcd` → KaTeX `CD`

DeepSeek (and other assistants) draw commutative diagrams with `\begin{tikzcd}…\end{tikzcd}`, and emit them into the export **with no `$$` delimiters**. KaTeX can't render `tikzcd` at all, so they appear as literal text. KaTeX *does* support the AMScd environment `\begin{CD}…\end{CD}` (inside `$$…$$`). Convert each block.

### AMScd arrow cheat-sheet

| tikzcd | CD | meaning |
|---|---|---|
| `\ar[r, "f"]` | `@>{f}>>` | arrow right, label above |
| `\ar[r, "f"']` | `@>>{f}>` | arrow right, label below |
| `\ar[l, "f"]` | `@<{f}<<` | arrow left |
| `\ar[d, "f"]` | `@V{f}VV` | arrow down, label left |
| `\ar[d, "f"']` | `@VV{f}V` | arrow down, label right |
| `\ar[u, "f"]` | `@A{f}AA` | arrow up |
| identity edge (same object) | `@\|` vertical · `@=` horizontal | identity morphism |
| no arrow in a cell | `@.` | empty |

Columns are separated by the arrow tokens; rows by `\\`. Every grid position is a node — including empty ones (`@.`).

### The hard constraint: CD has no diagonals and no spanning arrows

`tikzcd` freely draws diagonals (`\ar[rd]`, `\ar[ld]`) and arrows that span cells (`\ar[rr]`, `\ar[dd]`). KaTeX `CD` can do **neither** — every arrow connects horizontally/vertically adjacent cells. The fix is not to approximate: **fold the diagram into an equivalent commutative *square* by composing arrows along an edge.** A commutative diagram is an equation of composite morphisms, so composing two arrows into one is faithful — it preserves exactly what the diagram asserts.

Three folding moves cover everything seen so far:

- **Diagonal/triangle.** `A —f→ B`, `B —g→ C` (vertical), `A —h→ C` (diagonal) asserts `g∘f = h`. Render as a square with the diagonal `h` on one side and an identity (`@|` / `@=`) closing the opposite side.
- **3-column row that's really a composite.** `A —f→ B —g→ C` where the meaningful arrow is `g∘f` → collapse to `A —g∘f→ C`, dropping the middle node.
- **2-row vertical span** (`\ar[dd]` on the right edge against a two-step left column) → collapse the left column to a single composed arrow, making a 2×2 square.

### Worked examples (group object)

Associativity — already a square, just retarget the syntax:

```
$$
\begin{CD}
G \times G \times G @>{m \times \mathrm{id}}>> G \times G\\
@V{\mathrm{id} \times m}VV @VV{m}V\\
G \times G @>>{m}> G
\end{CD}
$$
```

Unit — `tikzcd` packs left+right unit into one triangle diagram with two `\pi` diagonals. Split into two squares, each closing with an identity edge (`@|`):

```
$$
\begin{CD}
1 \times G @>{\pi_2}>> G\\
@V{e \times \mathrm{id}}VV @|\\
G \times G @>>{m}> G
\end{CD}
$$
```

(and the mirror square for the right unit: `G \times 1 @>{\pi_1}>> G … @V{\mathrm{id} \times e}VV @|`).

Inverse — the `tikzcd` is a 3-column, 2-row grid with a spanning `\ar[rr,"e"]`. Compose the top row `G —Δ→ G×G —id×i→ G×G` into one arrow and drop to a square:

```
$$
\begin{CD}
G @>{(\mathrm{id} \times i) \circ \Delta}>> G \times G\\
@V{!}VV @VV{m}V\\
1 @>>{e}> G
\end{CD}
$$
```

Same moves handle the two-sorted vector-space diagrams: scalar action `1·x = x` (triangle → square closed with `@=`), distributivity (left column `\cong` then `·×·`, with a `\ar[dd]` span on the right, folds to `(\cdot \times \cdot) \circ {\cong}` down the left of a square).

A malformed `CD` block fails silently in preview (shows nothing or raw text), so converting isn't enough — it has to parse. You don't validate diagrams separately: the gate (`check_math.js`) already renders every `$$…$$` through KaTeX, so once you've converted the `tikzcd` blocks, re-running the checker confirms each new `CD` parses. (KaTeX ≥ 0.16 has the `CD` environment; current VS Code ships a new-enough KaTeX.)

## 2. Math glued to surrounding prose

Assistants sometimes drop the space after a closing delimiter, so the export reads `…\mathcal{P}(G \times G \times G).$Это` or `$a(x+y)=ax+ay$выражается`. Inline math needs a space (or punctuation) after the closing `$`; display math needs blank lines around `$$…$$`. Add the missing whitespace so the math is cleanly delimited and the sentence reads — **do not touch the LaTeX inside the delimiters.**

## Fallback: composition equations

If a diagram resists `CD` even after folding, or the user doesn't want visual diagrams, render the axiom as a composition equality in display math — it renders in any KaTeX/MathJax build:

```
$$m \circ (m \times \mathrm{id}) \;=\; m \circ (\mathrm{id} \times m)$$
```

Faithful, always renders, but it's a formula, not a drawn square. Offer it when `CD` support is in doubt; prefer real `CD` diagrams when the source had diagrams.

## Anti-patterns

| Don't | Why |
|-------|-----|
| Wrap `tikzcd` in `$$…$$` and move on | KaTeX still can't render `tikzcd`. You must convert to `CD` (or equations). Delimiters alone change nothing |
| Approximate a diagonal with a straight `CD` arrow | It changes which composite is asserted equal. Fold by composition instead — that preserves the diagram's meaning |
| Batch-substitute `tikzcd`→`CD` with one regex | Each diagram's layout (diagonals, spans) needs reading and folding individually. There is no universal token swap |
| Declare done before `check_math.js` prints `OK` | A malformed `CD` (or any other broken formula) fails silently in preview. The clean checker run is the gate, not your eyeball |
| Edit the LaTeX while fixing the glued-text spacing | Spacing/delimiters are formatting; the math content is the author's. Only add the missing whitespace |
