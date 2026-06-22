#!/usr/bin/env node
'use strict';

// DeepSeek share-page export -> clean Markdown (technical pass, no Q-numbering).
//
// A DeepSeek export looks like Markdown — `### User` / `### DeepSeek AI` markers
// separate turns — but every AI body is HTML: `<p class="ds-markdown-paragraph">`
// chrome, KaTeX math, code-block banners, thinking blocks. This script rewrites
// each AI body to clean Markdown in place, leaving the role markers untouched so
// the main chat-format skill can do Q-numbering afterwards.
//
// Usage:
//   node deepseek_cleanup.js <export.md>
//
// It backs the original up to `<export.md>.bak` (only if no .bak exists yet, so a
// re-run never clobbers the pristine source), rewrites the file, prints a summary,
// and exits non-zero if any HTML or thinking blocks survive — your signal that the
// export contains an artifact this script doesn't handle yet.
//
// Hit an unhandled artifact? The exit message lists the leftover tags. Add a
// converter alongside the existing ones (zero deps — no cheerio/jsdom) and mind
// the ordering documented in deepseek-cleanup.md: math and tables must run BEFORE
// the generic span-strip; the blockquote pass must run AFTER lists and paragraphs.
// Then document the new artifact in deepseek-cleanup.md so the next person knows.

const fs = require('fs');

// --- html entity decode (covers what DeepSeek realistically emits) -----------
// DeepSeek escapes the structural characters (< > &) and the odd typographic
// entity; everything else it writes as literal Unicode. Numeric refs are handled
// generally; named refs via this table. An uncovered named ref is left as-is.
const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  mdash: '—', ndash: '–', hellip: '…', middot: '·',
  laquo: '«', raquo: '»', lsquo: '‘', rsquo: '’',
  ldquo: '“', rdquo: '”', times: '×', deg: '°',
  copy: '©', reg: '®', trade: '™',
  hairsp: ' ', thinsp: ' ', ensp: ' ', emsp: ' ',
};

function unescapeHtml(s) {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z][a-zA-Z0-9]*);/g, (m, body) => {
    if (body[0] === '#') {
      const cp = body[1] === 'x' || body[1] === 'X'
        ? parseInt(body.slice(2), 16)
        : parseInt(body.slice(1), 10);
      try { return String.fromCodePoint(cp); } catch (e) { return m; }
    }
    return Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, body)
      ? NAMED_ENTITIES[body] : m;
  });
}

// --- converters --------------------------------------------------------------

// Replace each <span class="katex">…</span> with $<x-tex annotation>$.
//
// Depth-aware span scan: katex-html nests many <span>s, so a non-greedy regex
// can't find the matching outer close. We pull the LaTeX from the annotation
// node and drop the visual subtree entirely. Run BEFORE the generic span-strip,
// or the visual glyphs survive as garbled doubled text.
function convertKatex(text) {
  const openTag = '<span class="katex">';
  const spanRe = /<span\b[^>]*>|<\/span>/g;
  const out = [];
  let i = 0;
  for (;;) {
    const j = text.indexOf(openTag, i);
    if (j === -1) { out.push(text.slice(i)); break; }
    out.push(text.slice(i, j));
    let depth = 1, end = null, mm;
    spanRe.lastIndex = j + openTag.length;
    while ((mm = spanRe.exec(text)) !== null) {
      depth += mm[0].startsWith('</span') ? -1 : 1;
      if (depth === 0) { end = spanRe.lastIndex; break; }
    }
    if (end === null) { out.push(text.slice(j)); break; } // malformed — bail
    const am = /<annotation encoding="application\/x-tex">([\s\S]*?)<\/annotation>/
      .exec(text.slice(j, end));
    out.push('$' + (am ? unescapeHtml(am[1]).trim() : '') + '$');
    i = end;
  }
  return out.join('');
}

// HTML <table> -> GitHub-flavoured Markdown table. Run AFTER convertKatex (so
// cells already hold $math$) and BEFORE the generic span-strip.
function convertTables(text) {
  return text.replace(/<table>[\s\S]*?<\/table>/g, (whole) => {
    const rows = [...whole.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map((r) => r[1]);
    const md = [];
    for (const row of rows) {
      const cells = [...row.matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/g)].map((c) =>
        unescapeHtml(c[1].replace(/<[^>]+>/g, '')).trim().replace(/\s+/g, ' '));
      md.push('| ' + cells.join(' | ') + ' |');
    }
    if (md.length) {
      const ncol = (md[0].match(/\|/g).length) - 1;
      md.splice(1, 0, '| ' + Array(ncol).fill('---').join(' | ') + ' |');
    }
    return '\n\n' + md.join('\n') + '\n\n';
  });
}

// Remove DeepSeek's collapsible reasoning block ("Thought for N seconds").
//
// Distinct from the inline `思考：`/<blockquote> form: the opening turn's
// reasoning can instead arrive as the collapsible-UI form — two SIBLING top-
// level <div>s: a clickable header ("Thought for N seconds") and, separately,
// the expanded reasoning under `<div class="…ds-think-content…">`. We drop both,
// keyed on stable signals — the `ds-think-content` class and the "Thought for N
// seconds" header text — never the build-hash wrapper class, which drifts
// between DeepSeek revisions.
//
// Depth-aware div scan (divs nest, so a non-greedy regex can't find the match):
// each top-level <div>…</div> is kept verbatim unless it is one of those two.
// Identity transform when neither signal is present.
function stripThinkCollapsible(text) {
  const headerRe = /Thought for\s+\d+\s+seconds?/;
  const isThink = (block) => block.includes('ds-think-content') || headerRe.test(block);
  if (!isThink(text)) return text;
  const divRe = /<div\b[^>]*>|<\/div>/g;
  const openRe = /<div\b[^>]*>/g;
  const out = [];
  let i = 0;
  for (;;) {
    openRe.lastIndex = i;
    const m = openRe.exec(text);
    if (m === null) { out.push(text.slice(i)); break; }
    out.push(text.slice(i, m.index));
    let depth = 0, end = null, mm;
    divRe.lastIndex = m.index;
    while ((mm = divRe.exec(text)) !== null) {
      depth += mm[0].startsWith('</div') ? -1 : 1;
      if (depth === 0) { end = divRe.lastIndex; break; }
    }
    if (end === null) { out.push(text.slice(m.index)); break; } // malformed — bail
    const block = text.slice(m.index, end);
    if (!isThink(block)) out.push(block); // ordinary div — keep it whole
    i = end;
  }
  return out.join('');
}

// Convert one DeepSeek AI HTML body to Markdown. Order is load-bearing — see the
// inline notes and deepseek-cleanup.md before reshuffling steps.
function deepseekHtmlToMd(text) {
  // 1. Drop thinking blocks (the model's reasoning, almost never wanted).
  //    Two shapes: the inline 思考：/<blockquote> form, and the collapsible
  //    "Thought for N seconds" <div> (class ds-think-content) the opening turn
  //    can use instead. Strip the div form first so its spans/SVG never reach
  //    the generic chrome sweep.
  text = stripThinkCollapsible(text);
  text = text.replace(
    /<p>\s*思考：\s*<\/p>\s*<blockquote>[\s\S]*?<\/blockquote>\s*<br\s*\/?>/g, '');

  // 1a. KaTeX math -> $tex$  (BEFORE generic span strip)
  text = convertKatex(text);

  // 1b. HTML tables -> Markdown (cells now hold $math$; BEFORE span strip)
  text = convertTables(text);

  // 2. Code blocks: language label is in <span class="d813de27">.
  //    Do NOT anchor on </div> after </pre> — it's not adjacent (Copy/Download
  //    SVG and div fragments sit between </pre> and the closing </div>).
  text = text.replace(
    /<div class="md-code-block[^"]*">[\s\S]*?<pre[^>]*>([\s\S]*?)<\/pre>/g,
    (full, code) => {
      const langM = /<span class="d813de27">([^<]+)<\/span>/.exec(full);
      const lang = langM ? langM[1].trim() : '';
      const stripped = unescapeHtml(code.replace(/<[^>]+>/g, '')).replace(/\s+$/, '');
      return '\n\n```' + lang + '\n' + stripped + '\n```\n\n';
    });

  // 2b. Fallback for any standalone <pre> not wrapped in md-code-block
  text = text.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/g, (full, code) =>
    '\n\n```\n' + unescapeHtml(code.replace(/<[^>]+>/g, '')).replace(/\s+$/, '') + '\n```\n\n');

  // 3. Sweep UI chrome remnants left over from step 2
  text = text.replace(/<svg[^>]*>[\s\S]*?<\/svg>/g, '');
  text = text.replace(/<button[^>]*>[\s\S]*?<\/button>/g, '');
  text = text.replace(/<path[^>]*\/?>/g, '');
  text = text.replace(/<\/?div[^>]*>/g, '');

  // 4. Empty span wrappers — strip tags, keep content
  text = text.replace(/<span[^>]*>/g, '');
  text = text.replace(/<\/span>/g, '');

  // 5. Inline formatting
  text = text.replace(/<strong>([\s\S]*?)<\/strong>/g, '**$1**');
  text = text.replace(/<em>([\s\S]*?)<\/em>/g, '*$1*');

  // 6. <br> / <hr>
  text = text.replace(/<br\s*\/?>/g, '\n');
  text = text.replace(/<hr\s*\/?>/g, '\n\n---\n\n');

  // 7. Shift heading levels (avoid collision with ## Q-headings)
  text = text.replace(/<h2>([\s\S]*?)<\/h2>/g, '\n\n### $1\n\n');
  text = text.replace(/<h3>([\s\S]*?)<\/h3>/g, '\n\n#### $1\n\n');
  text = text.replace(/<h4>([\s\S]*?)<\/h4>/g, '\n\n##### $1\n\n');

  // 8. Lists — process innermost first, iterate until none left
  const convList = (whole, listType, body) => {
    const items = [...body.matchAll(/<li>([\s\S]*?)<\/li>/g)].map((x) => x[1]);
    const out = [];
    let counter = 1;
    for (let item of items) {
      item = item.trim();
      item = item.replace(/^<p[^>]*>/, '');
      item = item.replace(/<\/p>\s*$/, '');
      item = item.replace(/<\/p>\s*<p[^>]*>/g, '\n\n');
      item = item.replace(/<p[^>]*>|<\/p>/g, '');
      const prefix = listType === 'ol' ? `${counter}. ` : '- ';
      if (listType === 'ol') counter += 1;
      const lines = item.trim().split('\n');
      if (lines.length === 0) continue;
      let formatted = prefix + lines[0];
      for (const l of lines.slice(1)) {
        formatted += l.trim() === '' ? '\n' : '\n  ' + l;
      }
      out.push(formatted);
    }
    return '\n\n' + out.join('\n') + '\n\n';
  };
  const listPat = /<(ul|ol)(?:\s[^>]*)?>((?:(?!<(?:ul|ol)\b)[\s\S])*?)<\/\1>/g;
  for (;;) {
    let n = 0;
    text = text.replace(listPat, (...args) => {
      n += 1;
      return convList(args[0], args[1], args[2]);
    });
    if (n === 0) break;
  }

  // 9. Remaining <p>
  text = text.replace(/<p[^>]*>/g, '');
  text = text.replace(/<\/p>/g, '\n\n');

  // 10. Blockquote -> "> " prefix. MUST run AFTER lists/paragraphs (steps 8–9)
  //     so a <blockquote> wrapping block-level <ul>/<ol>/<p> keeps its nested
  //     list intact instead of spraying orphan ">" lines.
  text = text.replace(/<blockquote>([\s\S]*?)<\/blockquote>/g, (full, inner) => {
    const lines = inner.trim().split('\n').map((l) => (l.trim() ? '> ' + l : '>'));
    const collapsed = [];
    for (const l of lines) { // squeeze runs of empty quote lines
      if (l === '>' && collapsed.length && collapsed[collapsed.length - 1] === '>') continue;
      collapsed.push(l);
    }
    return '\n\n' + collapsed.join('\n') + '\n\n';
  });

  // 11. HTML entities + whitespace normalization
  text = unescapeHtml(text);
  text = text.replace(/[ \t]+\n/g, '\n');
  text = text.replace(/\n{3,}/g, '\n\n');
  return text.trim();
}

// Segment a full DeepSeek export and clean each AI body. Role markers stay in
// place; decorative inter-message '---' lines are stripped.
function cleanExport(content) {
  const parts = content.split(/^### (User|DeepSeek AI)\s*$/m);
  if (parts[0].trim()) {
    throw new Error('Unexpected content before first role marker: '
      + JSON.stringify(parts[0].slice(0, 200)));
  }
  const chunks = [];
  for (let i = 1; i < parts.length; i += 2) {
    const role = parts[i];
    let body = parts[i + 1].trim().replace(/\n*---\s*$/, '').trim();
    if (role === 'DeepSeek AI') body = deepseekHtmlToMd(body);
    chunks.push(`### ${role}\n`);
    chunks.push(body + '\n');
  }
  return chunks.join('\n').replace(/\s+$/, '') + '\n';
}

function main(argv) {
  if (argv.length !== 1) {
    console.log('usage: node deepseek_cleanup.js <export.md>');
    return 2;
  }
  const path = argv[0];
  const content = fs.readFileSync(path, 'utf8');

  const bak = path + '.bak';
  if (!fs.existsSync(bak)) {
    fs.writeFileSync(bak, content);
    console.log(`Backed up original -> ${bak}`);
  } else {
    console.log(`Backup already exists (${bak}); leaving it untouched.`);
  }

  const cleaned = cleanExport(content);
  fs.writeFileSync(path, cleaned);

  const leftover = [...new Set((cleaned.match(/<[a-zA-Z/][^>]*>/g) || []))].sort();
  const thinking = (cleaned.match(/思考/g) || []).length;
  const markers = (cleaned.match(/^### (?:User|DeepSeek AI)$/gm) || []).length;
  console.log(`Cleaned ${markers} segments.`);
  if (leftover.length) {
    console.log(`  WARNING: ${leftover.length} leftover HTML tag kinds: `
      + JSON.stringify(leftover.slice(0, 20)));
  }
  if (thinking) {
    console.log(`  WARNING: ${thinking} thinking marker(s) (思考) survived`);
  }
  if (leftover.length || thinking) {
    console.log('Export contains an artifact this script doesn\'t handle — see the '
      + 'header comment on how to extend it, then re-run on a fresh copy.');
    return 1;
  }
  console.log('Clean: no HTML, no thinking blocks. Ready for Q-numbering.');
  return 0;
}

process.exit(main(process.argv.slice(2)));
