import { describe, it, expect } from 'vitest';
import {
    draggedIdentity,
    insertNextTo,
    mergeOrderBlock,
    parseOrder,
    placeNextTo,
    serializeOrder,
    sortByOrder
} from '../../core/intents/order';
import { applyNotepadFix, newNotepadText, planNotepadFix } from '../../core/intents/notepad';

describe('order file', () => {
    it('round-trips a list of numbers', () => {
        expect(parseOrder(serializeOrder(['DUE017', 'DUE008']))).toEqual(['DUE017', 'DUE008']);
    });

    it('accepts a bare array too', () => {
        expect(parseOrder('["DUE017", "DUE008"]')).toEqual(['DUE017', 'DUE008']);
    });

    it('drops repeats and what is not a number string', () => {
        expect(parseOrder('{"order": ["DUE017", 5, "", "DUE017", "DUE008"]}')).toEqual(['DUE017', 'DUE008']);
    });

    it('is null for unreadable text, so the last good order can stay', () => {
        expect(parseOrder('{ broken')).toBeNull();
        expect(parseOrder('{"other": 1}')).toBeNull();
        expect(parseOrder('"text"')).toBeNull();
    });
});

describe('sortByOrder', () => {
    const rows = ['DUE013', 'DUE004', 'DUE017', 'DUE008'];

    it('listed numbers first in the listed sequence, the rest after by number', () => {
        expect(sortByOrder(rows, ['DUE017', 'DUE008'], r => r)).toEqual(['DUE017', 'DUE008', 'DUE004', 'DUE013']);
    });

    it('no order: by number', () => {
        expect(sortByOrder(rows, [], r => r)).toEqual(['DUE004', 'DUE008', 'DUE013', 'DUE017']);
    });

    it('two rows with one number keep a stable order by the tie-break', () => {
        const twins = [{ n: 'DUE004', p: '/b' }, { n: 'DUE004', p: '/a' }];
        expect(sortByOrder(twins, ['DUE004'], r => r.n, r => r.p).map(r => r.p)).toEqual(['/a', '/b']);
    });
});

describe('placeNextTo — the drag rule of both views', () => {
    const seq = ['A', 'B', 'C', 'D'];

    it('a row dragged up lands before the target', () => {
        expect(placeNextTo(seq, 'D', 'B')).toEqual(['A', 'D', 'B', 'C']);
        expect(placeNextTo(seq, 'B', 'A')).toEqual(['B', 'A', 'C', 'D']);
    });

    it('a row dragged down lands after the target', () => {
        expect(placeNextTo(seq, 'A', 'C')).toEqual(['B', 'C', 'A', 'D']);
        expect(placeNextTo(seq, 'A', 'B')).toEqual(['B', 'A', 'C', 'D']);
    });

    it('a drop past the rows puts the row at the end', () => {
        expect(placeNextTo(seq, 'B', null)).toEqual(['A', 'C', 'D', 'B']);
    });

    it('a drop on itself changes nothing', () => {
        expect(placeNextTo(seq, 'B', 'B')).toEqual(seq);
    });
});

describe('insertNextTo', () => {
    it('puts a newcomer before or after the target', () => {
        expect(insertNextTo(['A', 'B'], 'X', 'B', false)).toEqual(['A', 'X', 'B']);
        expect(insertNextTo(['A', 'B'], 'X', 'B', true)).toEqual(['A', 'B', 'X']);
    });

    it('a target the sequence does not hold sends the source to the end', () => {
        expect(insertNextTo(['A', 'B'], 'A', 'Z', false)).toEqual(['B', 'A']);
    });
});

describe('mergeOrderBlock', () => {
    it('the first drag in a group lists all its visible rows in the shown order', () => {
        expect(mergeOrderBlock([], ['DUE008', 'DUE006', 'DUE011'])).toEqual(['DUE008', 'DUE006', 'DUE011']);
    });

    it('rewrites the block where its first number stood and leaves other groups as they were', () => {
        const order = ['X1', 'DUE006', 'X2', 'DUE008', 'X3'];
        expect(mergeOrderBlock(order, ['DUE008', 'DUE006', 'DUE011']))
            .toEqual(['X1', 'DUE008', 'DUE006', 'DUE011', 'X2', 'X3']);
    });

    it('a block none of whose numbers is listed goes to the end', () => {
        expect(mergeOrderBlock(['X1', 'X2'], ['A', 'B'])).toEqual(['X1', 'X2', 'A', 'B']);
    });
});

describe('draggedIdentity', () => {
    const key = (row: Record<string, unknown>) => row.key;

    it('reads the string the drag put in', () => {
        expect(draggedIdentity('ticket:/a', key)).toBe('ticket:/a');
    });

    it('reads a dragged row and a list of dragged rows', () => {
        expect(draggedIdentity({ key: 'ticket:/a' }, key)).toBe('ticket:/a');
        expect(draggedIdentity([{ key: 'ticket:/a' }, { key: 'ticket:/b' }], key)).toBe('ticket:/a');
        expect(draggedIdentity(['ticket:/a'], key)).toBe('ticket:/a');
    });

    it('is null for anything else', () => {
        expect(draggedIdentity(undefined, key)).toBeNull();
        expect(draggedIdentity('', key)).toBeNull();
        expect(draggedIdentity([], key)).toBeNull();
        expect(draggedIdentity({ other: 1 }, key)).toBeNull();
        expect(draggedIdentity(7, key)).toBeNull();
    });
});

describe('notepad heading', () => {
    const H = '# DUE017 · Intent Switcher · Notepad';
    const fixed = (text: string) => applyNotepadFix(text, planNotepadFix(text, H));

    it('a new notepad is the heading and an empty line', () => {
        expect(newNotepadText(H)).toBe(`${H}\n\n`);
    });

    it('a right heading leaves the file alone', () => {
        expect(planNotepadFix(`${H}\n\nnotes`, H)).toEqual({ kind: 'none' });
        expect(planNotepadFix(`${H}  \nnotes`, H)).toEqual({ kind: 'none' });
    });

    it('an empty file becomes a new notepad', () => {
        expect(fixed('')).toBe(`${H}\n\n`);
    });

    it('no heading: it is added above the text', () => {
        expect(fixed('first note\nsecond')).toBe(`${H}\n\nfirst note\nsecond`);
        expect(fixed('## smaller heading\ntext')).toBe(`${H}\n\n## smaller heading\ntext`);
        expect(fixed('#tag is not a heading')).toBe(`${H}\n\n#tag is not a heading`);
    });

    it('a wrong heading is replaced and kept as a quote on the next line', () => {
        expect(fixed('# My thoughts\n\nnotes')).toBe(`${H}\n> My thoughts\n\nnotes`);
    });

    it('a heading Duet wrote itself is replaced without a quote', () => {
        expect(fixed('# DUE017 · Intent Switch · Notepad\n\nnotes')).toBe(`${H}\n\nnotes`);
        expect(fixed('# DUE009 · Notepad\nnotes')).toBe(`${H}\nnotes`);
        expect(fixed('# DUEX01 · Shell Prototype · Notepad\n')).toBe(`${H}\n`);
    });

    it('fixing twice changes nothing more', () => {
        const once = fixed('# My thoughts\nnotes');
        expect(planNotepadFix(once, H)).toEqual({ kind: 'none' });
    });

    it('the heading goes after the frontmatter', () => {
        expect(fixed('---\na: 1\n---\nnotes')).toBe(`---\na: 1\n---\n${H}\n\nnotes`);
        expect(fixed('---\na: 1\n---\n\n# Old\nnotes')).toBe(`---\na: 1\n---\n\n${H}\n> Old\nnotes`);
        expect(planNotepadFix(`---\na: 1\n---\n\n${H}\n`, H)).toEqual({ kind: 'none' });
    });

    it('a frontmatter that ends the file gets the heading after it', () => {
        expect(fixed('---\na: 1\n---')).toBe(`---\na: 1\n---\n${H}\n\n`);
        expect(fixed('---\na: 1\n---\n')).toBe(`---\na: 1\n---\n${H}\n`);
    });

    it('a first line `---` without a closing one is not a frontmatter', () => {
        expect(fixed('---\nnotes')).toBe(`${H}\n\n---\nnotes`);
    });

    it('empty lines before the heading are skipped, not doubled', () => {
        expect(planNotepadFix(`\n\n${H}\n`, H)).toEqual({ kind: 'none' });
        expect(fixed('\n# Old\n')).toBe(`\n${H}\n> Old\n`);
    });

    it('keeps Windows line breaks', () => {
        expect(fixed('# Old\r\nnotes\r\n')).toBe(`${H}\r\n> Old\r\nnotes\r\n`);
        expect(fixed('notes\r\nmore')).toBe(`${H}\r\n\r\nnotes\r\nmore`);
    });
});
