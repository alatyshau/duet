#!/usr/bin/env node
'use strict';

// Q-numbering substitution for chat-format.
//
// Collapse each prompt/response pair into a single `## Q## — Title` heading, and
// replace the response marker with a `---` rule separating the user's turn from
// the assistant's reply. The titles are the bespoke, semantic part (you draft
// them by reading the chat); everything else here is mechanical plumbing, which
// is why it lives in a script instead of being retyped each run.
//
// Usage:
//   node qnumber.js <file.md> \
//       --prompt-marker "### User" \
//       --response-marker "### DeepSeek AI" \
//       --titles titles.txt
//
// `titles.txt`: one title per line, in chat order, one line per prompt/response
// pair. Blank lines and lines starting with `#` are ignored, so you can leave
// notes to yourself. Markers are matched as whole lines (a trailing newline is
// appended automatically), so pass them without the newline.
//
// This assumes the markers ALTERNATE cleanly — prompt, response, prompt, … —
// which is the common case. It refuses to run unless the prompt count, response
// count, and title count all agree, so a malformed pair (orphan marker, stray
// segment) fails loudly instead of producing a half-numbered file. When an
// export genuinely doesn't alternate (an orphan opening answer, two same-role
// segments back to back), don't force this script — map the markers to headings
// by hand, as described in SKILL.md step 4.
//
// Zero-padding adapts to the pair count: ≤99 pairs → `Q01`, 100+ → `Q001`.

const fs = require('fs');
const { parseArgs } = require('util');

function fail(msg) { console.error(msg); process.exit(2); }

let parsed;
try {
  parsed = parseArgs({
    allowPositionals: true,
    options: {
      'prompt-marker': { type: 'string' },
      'response-marker': { type: 'string' },
      'titles': { type: 'string' },
    },
  });
} catch (e) {
  fail('usage: node qnumber.js <file.md> --prompt-marker "### User" '
    + '--response-marker "### DeepSeek AI" --titles titles.txt');
}

const file = parsed.positionals[0];
const promptOpt = parsed.values['prompt-marker'];
const responseOpt = parsed.values['response-marker'];
const titlesOpt = parsed.values['titles'];
if (!file || !promptOpt || !responseOpt || !titlesOpt) {
  fail('usage: node qnumber.js <file.md> --prompt-marker "### User" '
    + '--response-marker "### DeepSeek AI" --titles titles.txt');
}

const promptMarker = promptOpt.replace(/\n+$/, '') + '\n';
const responseMarker = responseOpt.replace(/\n+$/, '') + '\n';

const titles = fs.readFileSync(titlesOpt, 'utf8')
  .split('\n')
  .filter((ln) => ln.trim() && !ln.trimStart().startsWith('#'))
  .map((ln) => ln.replace(/\n$/, ''));

let content = fs.readFileSync(file, 'utf8');

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const countOf = (needle) =>
  (content.match(new RegExp(escapeRe(needle), 'g')) || []).length;

const nPrompt = countOf(promptMarker);
const nResponse = countOf(responseMarker);
if (!(nPrompt === nResponse && nResponse === titles.length)) {
  // exit 1 = data problem (a malformed pair); exit 2 above = bad invocation.
  console.error(`Count mismatch — ${nPrompt} prompt markers, ${nResponse} response `
    + `markers, ${titles.length} titles. All three must agree before numbering. `
    + 'Fix the file or the titles list (see SKILL.md step 4).');
  process.exit(1);
}

const width = Math.max(2, String(titles.length).length);
let i = 0;
content = content.replace(new RegExp(escapeRe(promptMarker), 'g'), () => {
  const heading = `## Q${String(i + 1).padStart(width, '0')} — ${titles[i]}\n\n`;
  i += 1;
  return heading;
});
content = content.split(responseMarker).join('---\n\n');

fs.writeFileSync(file, content);

const first = String(1).padStart(width, '0');
const last = String(titles.length).padStart(width, '0');
console.log(`Done. Numbered ${titles.length} pairs (Q${first}–Q${last}).`);
