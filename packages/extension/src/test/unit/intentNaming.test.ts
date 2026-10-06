import { describe, it, expect } from 'vitest';
import { parseTicketFolderName } from '../../core/pathUtils';
import {
    BUSINESS_TAG,
    spaceIntentName,
    intentIdentity,
    rowText,
    binTitle,
    intentIcon,
    intentTabLabel,
    notepadHeading
} from '../../core/intents/naming';
import { businessKey, businessWindowOf, intentWindowOf, programFolderName } from '../../core/intents/window';
import { rowIconDataUri, rowIconSvg } from '../../core/intents/rowIcon';
import { parseJsonc } from '../../core/jsonc';

describe('parseTicketFolderName', () => {
    it('splits the number from the rest', () => {
        expect(parseTicketFolderName('DUE017_IntentSwitcher')).toEqual({ number: 'DUE017', rest: 'IntentSwitcher' });
        expect(parseTicketFolderName('DUEX01_ShellPrototype')).toEqual({ number: 'DUEX01', rest: 'ShellPrototype' });
        expect(parseTicketFolderName('DUE001_DuetWork_Full')).toEqual({ number: 'DUE001', rest: 'DuetWork_Full' });
        expect(parseTicketFolderName('DUE009')).toEqual({ number: 'DUE009', rest: '' });
    });

    it('rejects folders that are not tickets', () => {
        expect(parseTicketFolderName('notes')).toBeNull();
        expect(parseTicketFolderName('DUE17_Short')).toBeNull();
        expect(parseTicketFolderName('due017_lower')).toBeNull();
        expect(parseTicketFolderName('DUE0171_TooLong')).toBeNull();
        expect(parseTicketFolderName('INDEX.md')).toBeNull();
    });
});

describe('spaceIntentName', () => {
    // The samples Andrei gave in the agenda
    it.each([
        ['IntentSwitcher', 'Intent Switcher'],
        ['UIResearch', 'UI Research'],
        ['DuetWork2', 'Duet Work2'],
        ['DuetWork_Full', 'Duet Work Full'],
        ['DuetLabCuration', 'Duet Lab Curation'],
        ['Modes', 'Modes'],
        ['', '']
    ])('%s → %s', (raw, spaced) => {
        expect(spaceIntentName(raw)).toBe(spaced);
    });

    it('understands Cyrillic', () => {
        expect(spaceIntentName('ПланРабот')).toBe('План Работ');
        expect(spaceIntentName('ЗОЖ_План')).toBe('ЗОЖ План');
        expect(spaceIntentName('UIИсследование')).toBe('UI Исследование');
    });
});

describe('intent texts', () => {
    const intent = intentIdentity('DUE017_IntentSwitcher')!;

    it('builds the identity from the folder name', () => {
        expect(intent).toEqual({ number: 'DUE017', folder: 'DUE017_IntentSwitcher', name: 'Intent Switcher' });
        expect(intentIdentity('notes')).toBeNull();
    });

    it('row: the name in the label, the number after it in the description', () => {
        expect(rowText('', intent.name, intent.number))
            .toEqual({ label: 'Intent Switcher', description: 'DUE017', name: [0, 15] });
    });

    it('row of a business window: `biz` stands where the number would', () => {
        expect(rowText('', 'DuetLab', BUSINESS_TAG)).toEqual({ label: 'DuetLab', description: 'biz', name: [0, 7] });
    });

    it('row with the icon in the text: the icon leads and the name range skips it', () => {
        const text = rowText('🧰', intent.name, intent.number);
        expect(text.label).toBe('🧰 Intent Switcher');
        expect(text.label.slice(...text.name)).toBe('Intent Switcher');
    });

    it('a row without a name shows its number as the name, with nothing after it', () => {
        expect(rowText('', '', 'DUE009')).toEqual({ label: 'DUE009', description: undefined, name: [0, 6] });
    });

    it('tab label: emoji and name, no emoji when the business has no icon', () => {
        expect(intentTabLabel('🚀', intent)).toBe('🚀 Intent Switcher');
        expect(intentTabLabel('', intent)).toBe('Intent Switcher');
        expect(intentTabLabel('🚀', intentIdentity('DUE009')!)).toBe('🚀 DUE009');
    });

    it('notepad heading', () => {
        expect(notepadHeading(intent)).toBe('# DUE017 · Intent Switcher · Notepad');
        expect(notepadHeading(intentIdentity('DUE009')!)).toBe('# DUE009 · Notepad');
    });
});

describe('intentWindowOf', () => {
    const workspaces = '/data/DuetData/workspaces';

    it('recognises a workspace file Duet built for a ticket', () => {
        expect(intentWindowOf(`${workspaces}/DuetLab/DUE017_IntentSwitcher.code-workspace`, workspaces)).toEqual({
            ticket: 'DUE017',
            ticketFolder: 'DUE017_IntentSwitcher',
            businessDir: 'DuetLab'
        });
    });

    it('is null for a business window, a foreign file and a window without a workspace file', () => {
        expect(intentWindowOf(`${workspaces}/DuetLab.code-workspace`, workspaces)).toBeNull();
        expect(intentWindowOf(`${workspaces}/DuetLab/notes.code-workspace`, workspaces)).toBeNull();
        expect(intentWindowOf('/elsewhere/DuetLab/DUE017_X.code-workspace', workspaces)).toBeNull();
        expect(intentWindowOf(`${workspaces}/a/b/DUE017_X.code-workspace`, workspaces)).toBeNull();
        expect(intentWindowOf(undefined, workspaces)).toBeNull();
    });
});

describe('business windows', () => {
    const workspaces = '/data/DuetData/workspaces';

    it('a workspace file right in workspaces/ is the window of a business', () => {
        expect(businessWindowOf(`${workspaces}/DuetLab.code-workspace`, workspaces)).toBe('DuetLab');
        expect(businessWindowOf(`${workspaces}/Duet Instructions.code-workspace`, workspaces)).toBe('Duet Instructions');
    });

    it('the file of an intent, the root-contexts file and a foreign file are not', () => {
        expect(businessWindowOf(`${workspaces}/DuetLab/DUE017_IntentSwitcher.code-workspace`, workspaces)).toBeNull();
        expect(businessWindowOf('/data/DuetData/root-contexts.code-workspace', workspaces)).toBeNull();
        expect(businessWindowOf('/drive/DuetLab/work/DUE017_X/DUE017_X.code-workspace', workspaces)).toBeNull();
        expect(businessWindowOf(undefined, workspaces)).toBeNull();
    });

    it('the key of a business never meets a ticket number and is safe as a file name', () => {
        expect(businessKey('DuetLab')).toBe('@DuetLab');
        expect(businessKey('МетаЛаб')).toBe('@МетаЛаб');
        expect(businessKey('a/b:c')).toBe('@a_b_c');
        expect(intentIdentity(businessKey('DUE017_X'))).toBeNull();
    });
});

describe('row icon', () => {
    it('is the emoji drawn as a small picture', () => {
        expect(rowIconSvg('🧰')).toContain('>🧰</text>');
        expect(rowIconSvg('🧰')).toMatch(/^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" width="16" height="16"/);
    });

    it('is an empty picture of the same size for a row without an emoji', () => {
        expect(rowIconSvg('')).not.toContain('<text');
        expect(rowIconSvg('')).toContain('width="16"');
    });

    it('cannot be broken by markup in the icon field', () => {
        expect(rowIconSvg('<b>&')).toContain('&lt;b&gt;&amp;');
    });

    it('is handed to the tree as a data address', () => {
        const uri = rowIconDataUri('🧰');
        expect(uri.startsWith('data:image/svg+xml;base64,')).toBe(true);
        expect(Buffer.from(uri.split(',')[1], 'base64').toString('utf8')).toBe(rowIconSvg('🧰'));
    });
});

describe('programFolderName', () => {
    it('is the uri scheme of the program, safe as a folder name', () => {
        expect(programFolderName('vscode')).toBe('vscode');
        expect(programFolderName('vscodium')).toBe('vscodium');
        expect(programFolderName('Cursor')).toBe('cursor');
        expect(programFolderName('code-insiders')).toBe('code-insiders');
        expect(programFolderName('../evil/path')).toBe('-evil-path');
        expect(programFolderName('')).toBe('unknown');
    });
});

describe('parseJsonc', () => {
    it('reads plain JSON', () => {
        expect(parseJsonc('{"a": [1, 2], "b": "x"}')).toEqual({ a: [1, 2], b: 'x' });
    });

    it('skips comments and trailing commas', () => {
        const text = [
            '{',
            '  // line comment',
            '  "a": 1, /* block',
            '  comment */',
            '  "b": [1, 2, ],',
            '}'
        ].join('\n');
        expect(parseJsonc(text)).toEqual({ a: 1, b: [1, 2] });
    });

    it('leaves comment marks and commas inside strings alone', () => {
        expect(parseJsonc('{"url": "http://x/*y*/", "t": "a,}", "q": "\\"//"}'))
            .toEqual({ url: 'http://x/*y*/', t: 'a,}', q: '"//' });
    });

    it('throws on text that is not JSON', () => {
        expect(() => parseJsonc('{ not json')).toThrow();
    });
});

describe('binTitle', () => {
    it('names the business whose tickets the bin shows; the bare word without one', () => {
        expect(binTitle('DuetLab')).toBe('Корзина DuetLab');
        expect(binTitle('МетаЛаб')).toBe('Корзина МетаЛаб');
        expect(binTitle(null)).toBe('Корзина');
        expect(binTitle(undefined)).toBe('Корзина');
        expect(binTitle('')).toBe('Корзина');
    });
});

describe('intentIcon — one emoji for the row of an intent and the tab of its notepad', () => {
    it("the ticket's own or inherited emoji wins; the business's is the last resort", () => {
        expect(intentIcon('🧰', '🚀')).toBe('🧰');
        expect(intentIcon('', '🚀')).toBe('🚀');
        expect(intentIcon('', '')).toBe('');
    });

    it('the tab label is built from it', () => {
        const intent = intentIdentity('DUE017_IntentSwitcher')!;
        expect(intentTabLabel(intentIcon('🧰', '🚀'), intent)).toBe('🧰 Intent Switcher');
        expect(intentTabLabel(intentIcon('', '🚀'), intent)).toBe('🚀 Intent Switcher');
        expect(intentTabLabel(intentIcon('', ''), intent)).toBe('Intent Switcher');
    });
});
