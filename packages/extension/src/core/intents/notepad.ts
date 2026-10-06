/**
 * The notepad of an intent: `notepad.md` right in the ticket folder, with the
 * heading `# DUE017 · Intent Switcher · Notepad` as its first line.
 *
 * This module only decides what to change; the edit itself goes through the
 * editor's document, so text the user has not saved yet is never written over.
 */

/** Text of a notepad Duet creates: the heading and an empty line under it. */
export function newNotepadText(heading: string): string {
    return `${heading}\n\n`;
}

export type NotepadFix =
    /** The heading is in place. */
    | { kind: 'none' }
    /** Insert `text` at the start of line `line` (zero-based). */
    | { kind: 'insert'; line: number; text: string }
    /** Replace the whole of line `line` (zero-based, without its line break) with `text`. */
    | { kind: 'replace'; line: number; text: string };

/** A heading Duet itself wrote for some ticket: `# DUE017 · … · Notepad`. */
const DUET_HEADING_RE = /^# [A-Z]{3}(?:\d{3}|[A-Z]\d{2}) · (?:.* · )?Notepad\s*$/;
const H1_RE = /^#(?:\s|$)/;

/**
 * Decide how to bring the first line of a notepad to `heading`.
 *
 * The first line is looked for after the frontmatter, which counts only when
 * the very first line is exactly `---` and a closing `---` follows; empty lines
 * before the heading are skipped. No level-one heading there — it is added. A
 * wrong one is replaced, and its text is kept on the next line as a quote
 * `> …`, unless Duet wrote it itself (a renamed ticket) — then nothing is kept,
 * or quotes would pile up with every rename.
 */
export function planNotepadFix(text: string, heading: string): NotepadFix {
    const eol = text.includes('\r\n') ? '\r\n' : '\n';
    const lines = text.split(/\r?\n/);

    let bodyStart = 0;
    if (lines[0] === '---') {
        const close = lines.indexOf('---', 1);
        if (close !== -1) {
            bodyStart = close + 1;
        }
    }
    let first = bodyStart;
    while (first < lines.length && lines[first].trim() === '') {
        first++;
    }

    if (first < lines.length && H1_RE.test(lines[first])) {
        const current = lines[first];
        if (current.trimEnd() === heading) {
            return { kind: 'none' };
        }
        if (DUET_HEADING_RE.test(current)) {
            return { kind: 'replace', line: first, text: heading };
        }
        const old = current.replace(/^#\s*/, '').trim();
        return { kind: 'replace', line: first, text: old ? `${heading}${eol}> ${old}` : heading };
    }

    // An empty file becomes what a new notepad is: the heading and an empty line
    if (text === '') {
        return { kind: 'insert', line: 0, text: newNotepadText(heading) };
    }

    // No heading: put it where the body starts, with an empty line before the text that follows
    const next = lines[bodyStart];
    const gap = next === undefined || next.trim() !== '' ? eol : '';
    const lead = bodyStart >= lines.length ? eol : '';
    return { kind: 'insert', line: bodyStart, text: `${lead}${heading}${eol}${gap}` };
}

/** Apply a fix to the text — the same result the editor edit gives; used by tests and to preview. */
export function applyNotepadFix(text: string, fix: NotepadFix): string {
    if (fix.kind === 'none') {
        return text;
    }
    const eol = text.includes('\r\n') ? '\r\n' : '\n';
    const lines = text.split(/\r?\n/);
    if (fix.kind === 'replace') {
        lines[fix.line] = fix.text;
        return lines.join(eol);
    }
    if (fix.line >= lines.length) {
        return text + fix.text;
    }
    const before = lines.slice(0, fix.line).join(eol);
    const after = lines.slice(fix.line).join(eol);
    return (fix.line > 0 ? before + eol : '') + fix.text + after;
}
