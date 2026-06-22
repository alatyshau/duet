#!/usr/bin/env node
'use strict';

// Technical review of math rendering for chat-format.
//
// Reports every formula the target renderer (KaTeX — VS Code's Markdown preview
// and !рендер) can't render, plus LaTeX environments left OUTSIDE math
// delimiters (the `\begin{tikzcd}` case, where the diagram is emitted as bare
// text with no `$$`). Run it after Q-numbering on any chat that contains math —
// it's a general gate, not a check for one known failure mode. Whatever it
// flags, fix it (latex-formatting.md catalogs the common classes), then re-run
// until it's clean.
//
// Usage:
//   cd /tmp && npm install katex
//   NODE_PATH=/tmp/node_modules node <skill>/scripts/check_math.js <file.md>
//
// Exit 0 = all math renders. Exit 1 = problems found (listed with line + error).
// Exit 2 = setup problem (katex missing / no file arg).

let katex;
try {
  katex = require('katex');
} catch (e) {
  console.error(
    'katex not found. Install it and point NODE_PATH at it:\n' +
    '  cd /tmp && npm install katex\n' +
    '  NODE_PATH=/tmp/node_modules node ' + __filename + ' <file.md>'
  );
  process.exit(2);
}

const fs = require('fs');

const file = process.argv[2];
if (!file) {
  console.error('usage: node check_math.js <file.md>');
  process.exit(2);
}
const src = fs.readFileSync(file, 'utf8');

// Mask fenced code blocks and inline code so we never scan math inside them.
// Replace masked characters with spaces but keep newlines, so byte offsets and
// line numbers stay aligned with the original.
function maskCode(text) {
  const buf = text.split('');
  const blank = (start, end) => {
    for (let i = start; i < end; i++) if (buf[i] !== '\n') buf[i] = ' ';
  };
  let m;
  const fence = /^([ \t]*)(```+|~~~+)[^\n]*\n[\s\S]*?^\1\2[^\n]*$/gm;
  while ((m = fence.exec(text))) blank(m.index, m.index + m[0].length);
  const inlineCode = /`+[^`\n]*`+/g;
  while ((m = inlineCode.exec(text))) blank(m.index, m.index + m[0].length);
  return buf.join('');
}
const masked = maskCode(src);

const lineOf = (idx) => src.slice(0, idx).split('\n').length;

const problems = [];
const mathRanges = []; // [start, end) of every detected math span

// Display math: $$ ... $$ (may span lines).
const display = /\$\$([\s\S]*?)\$\$/g;
let m;
while ((m = display.exec(masked))) {
  mathRanges.push([m.index, m.index + m[0].length]);
  const tex = src.slice(m.index + 2, m.index + m[0].length - 2);
  try {
    katex.renderToString(tex, { displayMode: true, throwOnError: true, strict: false });
  } catch (e) {
    problems.push({
      line: lineOf(m.index),
      kind: 'display $$…$$',
      msg: e.message.split('\n')[0],
      snippet: tex.trim().replace(/\s+/g, ' ').slice(0, 70),
    });
  }
}

const inDisplay = (idx) => mathRanges.some(([s, e]) => idx >= s && idx < e);

// Inline math: $ ... $ on a single line, not escaped, not part of $$.
const inline = /(?<![\\$])\$(?!\$)([^\n$]+?)(?<![\\])\$(?!\$)/g;
while ((m = inline.exec(masked))) {
  if (inDisplay(m.index)) continue;
  mathRanges.push([m.index, m.index + m[0].length]);
  const tex = src.slice(m.index + 1, m.index + m[0].length - 1);
  try {
    katex.renderToString(tex, { displayMode: false, throwOnError: true, strict: false });
  } catch (e) {
    problems.push({
      line: lineOf(m.index),
      kind: 'inline $…$',
      msg: e.message.split('\n')[0],
      snippet: tex.trim().replace(/\s+/g, ' ').slice(0, 70),
    });
  }
}

// LaTeX environments sitting outside any math delimiter — they render as raw
// text. This is how bare `\begin{tikzcd}` slips through: it's never inside `$`.
const env = /\\begin\{([a-zA-Z*]+)\}/g;
while ((m = env.exec(masked))) {
  if (inDisplay(m.index)) continue;
  problems.push({
    line: lineOf(m.index),
    kind: 'bare LaTeX',
    msg: `\\begin{${m[1]}} is outside math delimiters — wrap it in $$…$$ (and convert if KaTeX can't render it)`,
    snippet: src.slice(m.index, m.index + 70).replace(/\s+/g, ' '),
  });
}

problems.sort((a, b) => a.line - b.line);

if (problems.length === 0) {
  const n = mathRanges.length;
  console.log(`OK — ${n} math span${n === 1 ? '' : 's'} checked, all render in KaTeX.`);
  process.exit(0);
}

console.log(`${problems.length} render problem${problems.length === 1 ? '' : 's'}:\n`);
for (const p of problems) {
  console.log(`  line ${p.line}  [${p.kind}]  ${p.msg}`);
  console.log(`      ${p.snippet}`);
}
console.log('\nFix each (see latex-formatting.md), then re-run until clean.');
process.exit(1);
