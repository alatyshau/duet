/* eslint-disable @typescript-eslint/naming-convention */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
    INTENT_COLOR_IDS,
    INTENT_PALETTE,
    backdropColor,
    chooseIntentColor,
    intentColorId,
    normalizeRemembered
} from '../../core/intents/colors';
import {
    INTENT_CANON_KEY,
    INTENT_CANON_VERSION,
    INTENT_COLORS_KEY,
    IntentWorkspaceSpec,
    buildIntentWorkspaceText,
    planBusinessColor,
    planIntentWorkspace,
    readIntentWorkspaceState,
    windowColorBlock
} from '../../core/intents/workspaceFile';

const first = () => 0;
const last = () => 0.999;

describe('chooseIntentColor', () => {
    it('first open: a random colour among those no open window holds, remembered as the main one', () => {
        expect(chooseIntentColor([], [], first)).toEqual({ color: '#1f6f43', remembered: ['#1f6f43'] });
        expect(chooseIntentColor([], [], last)).toEqual({ color: '#8f1f7a', remembered: ['#8f1f7a'] });
        expect(chooseIntentColor([], ['#1f6f43', '#1f4f8f'], first))
            .toEqual({ color: '#6b3fa0', remembered: ['#6b3fa0'] });
    });

    it('later opens use the main colour', () => {
        expect(chooseIntentColor(['#6b3fa0'], ['#1f6f43'], last))
            .toEqual({ color: '#6b3fa0', remembered: ['#6b3fa0'] });
    });

    it('main colour taken by another window: a spare is chosen and remembered, the main stays the main', () => {
        expect(chooseIntentColor(['#6b3fa0'], ['#6b3fa0'], first))
            .toEqual({ color: '#1f6f43', remembered: ['#6b3fa0', '#1f6f43'] });
    });

    it('uses the first free one of main, first spare, second spare', () => {
        const remembered = ['#6b3fa0', '#1f6f43', '#8f1f7a'];
        expect(chooseIntentColor(remembered, ['#6b3fa0'], last).color).toBe('#1f6f43');
        expect(chooseIntentColor(remembered, ['#6b3fa0', '#1f6f43'], first).color).toBe('#8f1f7a');
    });

    it('never remembers more than the main colour and two spares', () => {
        const remembered = ['#6b3fa0', '#1f6f43', '#8f1f7a'];
        const choice = chooseIntentColor(remembered, [...remembered], first);
        expect(choice).toEqual({ color: '#1f4f8f', remembered });
    });

    it('a spare is never one of the colours already remembered', () => {
        const choice = chooseIntentColor(['#1f6f43'], ['#1f6f43'], first);
        expect(choice.remembered).toEqual(['#1f6f43', '#1f4f8f']);
    });

    it('more windows than colours: one of the least used, nothing remembered', () => {
        const occupied = [...INTENT_PALETTE, '#1f6f43', '#1f4f8f'];
        expect(chooseIntentColor([], occupied, first)).toEqual({ color: '#6b3fa0', remembered: [] });
        expect(chooseIntentColor(['#1f6f43'], occupied, last)).toEqual({ color: '#8f1f7a', remembered: ['#1f6f43'] });
    });

    it('compares colours without regard to case', () => {
        expect(chooseIntentColor(['#6B3FA0'], ['#6b3fa0'], first).color).toBe('#1f6f43');
        expect(chooseIntentColor(['#6B3FA0'], [], first)).toEqual({ color: '#6b3fa0', remembered: ['#6b3fa0'] });
    });

    it('normalizeRemembered drops what is not a palette colour', () => {
        expect(normalizeRemembered(['#123456', '#1F6F43', '#1f6f43', 7, '#8f1f7a'])).toEqual(['#1f6f43', '#8f1f7a']);
        expect(normalizeRemembered('nope')).toEqual([]);
    });
});

const spec: IntentWorkspaceSpec = {
    businessPath: '/Users/test/Drive/!МетаЛаб/DuetLab',
    aliases: ['duet-work', 'duet-shell', 'Duet'],
    ticketFolder: 'DUE017_IntentSwitcher',
    tabLabel: '🚀 Intent Switcher'
};

/** The colours of lists Andrei asked to add to the colour block after he had accepted the sample. */
const SELECTION_KEYS = ['list.activeSelectionBackground', 'list.activeSelectionForeground', 'list.focusOutline'];
const LIST_KEYS = [...SELECTION_KEYS, 'list.filterMatchBackground'];

/**
 * One of the three sample files Andrei saw and accepted
 * (`DuetData/workspaces/DuetLab/DUE017_IntentSwitcher.code-workspace`), with the
 * business path of this test.
 */
const SAMPLE = `{
  "folders": [
    {
      "path": "/Users/test/Drive/!МетаЛаб/DuetLab"
    },
    {
      "path": "../../repos/duet-work.git"
    },
    {
      "path": "../../repos/duet-shell.git"
    },
    {
      "path": "../../repos/Duet.git"
    }
  ],
  "settings": {
    "workbench.editor.customLabels.patterns": {
      "**/DUE017_IntentSwitcher/notepad.md": "🚀 Intent Switcher"
    },
    "symbols.files.associations": {
      "notepad.md": "sanity",
      "INDEX.md": "text",
      "AGENDA.md": "notebook"
    },
    "workbench.editor.pinnedTabsOnSeparateRow": true,
    "workbench.editor.showTabIndex": true,
    "workbench.colorCustomizations": {
      "titleBar.activeBackground": "#1f6f43",
      "titleBar.activeForeground": "#ffffff",
      "statusBar.background": "#1f6f43",
      "statusBar.foreground": "#ffffff",
      "titleBar.inactiveBackground": "#1f6f43",
      "titleBar.inactiveForeground": "#ffffff"
    }
  }
}`;

describe('buildIntentWorkspaceText', () => {
    it('is the accepted sample byte for byte, plus the colours of lists and the two keys of Duet', () => {
        const built = JSON.parse(buildIntentWorkspaceText(spec, '#1f6f43', ['#1f6f43']));
        expect(built.settings[INTENT_COLORS_KEY]).toEqual(['#1f6f43']);
        expect(built.settings[INTENT_CANON_KEY]).toBe(INTENT_CANON_VERSION);
        const colors = built.settings['workbench.colorCustomizations'];
        expect(SELECTION_KEYS.map(key => colors[key])).toEqual(['#1f6f43', '#ffffff', '#1f6f43']);

        delete built.settings[INTENT_COLORS_KEY];
        delete built.settings[INTENT_CANON_KEY];
        expect(colors['list.filterMatchBackground']).toBe('#1f6f4333');
        LIST_KEYS.forEach(key => delete colors[key]);
        expect(JSON.stringify(built, null, 2)).toBe(SAMPLE);
    });

    it('colours the saturated selection and the focus outline, and leaves the pale selection to the theme', () => {
        const block = windowColorBlock('#6b3fa0');
        expect(block['list.activeSelectionBackground']).toBe('#6b3fa0');
        expect(block['list.activeSelectionForeground']).toBe('#ffffff');
        expect(block['list.focusOutline']).toBe('#6b3fa0');
        expect(Object.keys(block).some(key => key.includes('inactiveSelection'))).toBe(false);
    });

    it('puts the light version of the window colour behind highlighted text, and leaves its outline to the theme', () => {
        const block = windowColorBlock('#6b3fa0');
        expect(block['list.filterMatchBackground']).toBe(backdropColor('#6b3fa0'));
        expect(backdropColor('#6b3fa0')).toBe('#6b3fa033');
        expect(block['list.filterMatchBorder']).toBeUndefined();
    });

    it('a business without repos gives a file of one folder', () => {
        const built = JSON.parse(buildIntentWorkspaceText({ ...spec, aliases: [] }, '#1f6f43', []));
        expect(built.folders).toEqual([{ path: '/Users/test/Drive/!МетаЛаб/DuetLab' }]);
    });

    it('a meta business gives its additional folders after its own folder and repos', () => {
        const extraFolders = [{ path: '/Users/test/Drive/!МетаЛаб' }, { path: '/Users/test/DuetData', name: 'DuetData' }];
        const built = JSON.parse(buildIntentWorkspaceText({ ...spec, aliases: ['Duet'], extraFolders }, '#1f6f43', []));
        expect(built.folders).toEqual([
            { path: spec.businessPath },
            { path: '../../repos/Duet.git' },
            ...extraFolders
        ]);
    });

    it('does not colour the activity bar', () => {
        const text = buildIntentWorkspaceText(spec, '#1f6f43', []);
        expect(text).not.toContain('activityBar');
    });
});

describe('readIntentWorkspaceState', () => {
    it('reads the remembered colours, the canon and the window colour', () => {
        const text = buildIntentWorkspaceText(spec, '#6b3fa0', ['#1f6f43', '#6b3fa0']);
        expect(readIntentWorkspaceState(text)).toEqual({
            remembered: ['#1f6f43', '#6b3fa0'],
            canon: INTENT_CANON_VERSION,
            color: '#6b3fa0'
        });
    });

    it('a file without the colours key: its palette colour is taken as the main one', () => {
        expect(readIntentWorkspaceState(SAMPLE)).toEqual({ remembered: ['#1f6f43'], canon: null, color: '#1f6f43' });
    });

    it('a file without the key and with a colour outside the palette remembers nothing', () => {
        expect(readIntentWorkspaceState(SAMPLE.replace(/#1f6f43/g, '#123456'))?.remembered).toEqual([]);
    });

    it('reads JSON with comments', () => {
        const text = SAMPLE.replace('"settings": {', '// a note\n  "settings": {');
        expect(readIntentWorkspaceState(text)?.color).toBe('#1f6f43');
    });

    it('is null for text that is not a workspace file', () => {
        expect(readIntentWorkspaceState('{ broken')).toBeNull();
        expect(readIntentWorkspaceState('[1, 2]')).toBeNull();
    });
});

describe('planIntentWorkspace', () => {
    it('first open: writes the file with a fresh main colour', () => {
        const plan = planIntentWorkspace(null, spec, [], first);
        expect(plan.action).toBe('write');
        expect(plan.color).toBe('#1f6f43');
        if (plan.action === 'write') {
            expect(readIntentWorkspaceState(plan.text)?.remembered).toEqual(['#1f6f43']);
        }
    });

    it('same input, same bytes: an unchanged file is kept, not rewritten', () => {
        const existing = buildIntentWorkspaceText(spec, '#6b3fa0', ['#6b3fa0']);
        expect(planIntentWorkspace(existing, spec, [], last)).toEqual({ action: 'keep', color: '#6b3fa0' });
    });

    it('a file of the previous canon is rebuilt, keeping the colours it remembers', () => {
        const previous = buildIntentWorkspaceText(spec, '#6b3fa0', ['#6b3fa0'])
            .replace(`"${INTENT_CANON_KEY}": ${INTENT_CANON_VERSION}`, `"${INTENT_CANON_KEY}": 1`);
        const plan = planIntentWorkspace(previous, spec, [], first);
        expect(plan).toMatchObject({ action: 'write', color: '#6b3fa0' });
    });

    it('a sample file gains the two keys and keeps its colour as the main one', () => {
        const plan = planIntentWorkspace(SAMPLE, spec, [], last);
        expect(plan.action).toBe('write');
        expect(plan.color).toBe('#1f6f43');
    });

    it('rebuild drops everything Duet does not write now', () => {
        const edited = JSON.parse(buildIntentWorkspaceText(spec, '#6b3fa0', ['#6b3fa0']));
        edited.settings['editor.fontSize'] = 20;
        edited.folders.push({ path: '/extra' });
        const plan = planIntentWorkspace(JSON.stringify(edited, null, 2), spec, [], first);
        expect(plan.action).toBe('write');
        if (plan.action === 'write') {
            expect(plan.text).toBe(buildIntentWorkspaceText(spec, '#6b3fa0', ['#6b3fa0']));
        }
    });

    it('main colour taken by an open window: opens in a spare and remembers it', () => {
        const existing = buildIntentWorkspaceText(spec, '#6b3fa0', ['#6b3fa0']);
        const plan = planIntentWorkspace(existing, spec, ['#6b3fa0'], first);
        expect(plan.action).toBe('write');
        expect(plan.color).toBe('#1f6f43');
        if (plan.action === 'write') {
            expect(readIntentWorkspaceState(plan.text)?.remembered).toEqual(['#6b3fa0', '#1f6f43']);
        }
    });

    it('an unreadable file is opened as it is, so the main colour is not rolled again', () => {
        expect(planIntentWorkspace('{ broken', spec, [], first))
            .toEqual({ action: 'as-is', reason: 'unreadable', color: null });
    });

    it('a file written by a newer Duet is opened as it is', () => {
        const newer = buildIntentWorkspaceText(spec, '#6b3fa0', ['#6b3fa0'])
            .replace(`"${INTENT_CANON_KEY}": ${INTENT_CANON_VERSION}`, `"${INTENT_CANON_KEY}": ${INTENT_CANON_VERSION + 1}`);
        expect(planIntentWorkspace(newer, spec, [], first))
            .toEqual({ action: 'as-is', reason: 'newer', color: '#6b3fa0' });
    });
});

describe('intentColorId', () => {
    it('names the theme colour of a palette colour, whatever its case', () => {
        expect(intentColorId('#1f6f43')).toBe('duet.intent.color1');
        expect(intentColorId('#8F1F7A')).toBe('duet.intent.color8');
    });

    it('is null for a colour outside the palette and for no colour', () => {
        expect(intentColorId('#123456')).toBeNull();
        expect(intentColorId(null)).toBeNull();
        expect(intentColorId(undefined)).toBeNull();
    });

    it('package.json declares exactly these colours: the palette in light themes, a lighter shade in dark ones', () => {
        const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', '..', 'package.json'), 'utf8'));
        const declared: Array<{ id: string; defaults: Record<string, string> }> = manifest.contributes.colors;
        expect(declared.map(c => c.id)).toEqual([...INTENT_COLOR_IDS]);
        expect(declared.map(c => c.defaults.light)).toEqual([...INTENT_PALETTE]);
        expect(declared.map(c => c.defaults.highContrastLight)).toEqual([...INTENT_PALETTE]);
        const brightness = (hex: string) => [1, 3, 5].reduce((sum, i) => sum + parseInt(hex.slice(i, i + 2), 16), 0);
        declared.forEach(c => expect(brightness(c.defaults.dark)).toBeGreaterThan(brightness(c.defaults.light) + 150));
    });
});

describe('planBusinessColor', () => {
    const FOLDERS_ONLY = JSON.stringify({ folders: [{ path: '/drive/DuetLab' }, { path: '../repos/Duet.git' }] }, null, 2);
    const colourOf = (settings: Record<string, unknown> | undefined) =>
        (settings?.['workbench.colorCustomizations'] as Record<string, string> | undefined)?.['titleBar.activeBackground'];

    it('first open, and a file from before colours: a free colour by the same rules, remembered as the main one', () => {
        for (const existing of [null, FOLDERS_ONLY]) {
            const plan = planBusinessColor(existing, ['#1f6f43'], false, first);
            expect(plan).toMatchObject({ action: 'write', color: '#1f4f8f' });
            if (plan.action === 'write') {
                expect(colourOf(plan.settings)).toBe('#1f4f8f');
                expect(plan.settings?.[INTENT_COLORS_KEY]).toEqual(['#1f4f8f']);
                expect(plan.settings?.[INTENT_CANON_KEY]).toBe(INTENT_CANON_VERSION);
                expect(Object.keys(plan.settings ?? {})).toHaveLength(3);
            }
        }
    });

    it('later opens use the main colour; a taken main colour gives a spare', () => {
        const file = (settings: Record<string, unknown> | undefined) => JSON.stringify({ folders: [], settings }, null, 2);
        const opened = planBusinessColor(null, [], false, last);
        const text = file(opened.action === 'write' ? opened.settings : undefined);

        expect(planBusinessColor(text, [], false, first)).toMatchObject({ action: 'write', color: '#8f1f7a' });
        const spare = planBusinessColor(text, ['#8f1f7a'], false, first);
        expect(spare).toMatchObject({ action: 'write', color: '#1f6f43' });
        if (spare.action === 'write') {
            expect(spare.settings?.[INTENT_COLORS_KEY]).toEqual(['#8f1f7a', '#1f6f43']);
        }
    });

    it('a window that is open is never recoloured: its colour block is written back as it is', () => {
        const opened = planBusinessColor(null, [], false, last);
        const text = JSON.stringify({ folders: [], settings: opened.action === 'write' ? opened.settings : undefined }, null, 2);
        const again = planBusinessColor(text, ['#8f1f7a', '#1f6f43'], true, first);
        expect(again).toMatchObject({ action: 'write', color: '#8f1f7a' });
        if (again.action === 'write' && opened.action === 'write') {
            expect(again.settings).toEqual(opened.settings);
        }
    });

    it('an open window whose file has no colour yet stays without one — folders only, as before', () => {
        expect(planBusinessColor(FOLDERS_ONLY, [], true, first)).toEqual({ action: 'write', settings: undefined, color: null });
    });

    it('a file written by a newer Duet is left as it is', () => {
        const newer = JSON.stringify({
            folders: [],
            settings: { 'workbench.colorCustomizations': windowColorBlock('#6b3fa0'), [INTENT_CANON_KEY]: INTENT_CANON_VERSION + 1 }
        });
        expect(planBusinessColor(newer, [], false, first)).toEqual({ action: 'as-is', color: '#6b3fa0' });
    });

    it('an unreadable file is rebuilt with a fresh colour, as the business file always was rebuilt', () => {
        expect(planBusinessColor('{ broken', [], false, first)).toMatchObject({ action: 'write', color: '#1f6f43' });
    });
});

/**
 * The shades are chosen by number, not by eye: contrast of text against what
 * lies behind it (WCAG relative luminance), for every colour of the palette,
 * on the side-bar backgrounds of the stock light and dark themes.
 */
describe('readability of the window colours', () => {
    type Rgb = [number, number, number];
    const rgb = (hex: string): Rgb => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)) as Rgb;
    const luminance = (c: Rgb): number => {
        const [r, g, b] = c.map(v => (v / 255 <= 0.03928 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4));
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const contrast = (a: Rgb, b: Rgb): number => {
        const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
        return (hi + 0.05) / (lo + 0.05);
    };
    /** A colour with an alpha channel, as it looks over a background. */
    const over = (rgba: string, background: Rgb): Rgb => {
        const alpha = parseInt(rgba.slice(7, 9), 16) / 255;
        return rgb(rgba).map((v, i) => Math.round(v * alpha + background[i] * (1 - alpha))) as Rgb;
    };
    const LIGHT = ['#ffffff', '#f8f8f8', '#f3f3f3'].map(rgb);
    const DARK = ['#181818', '#1e1e1e', '#252526'].map(rgb);
    const WHITE: Rgb = [255, 255, 255];
    const declared: Array<{ defaults: Record<string, string> }> =
        JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', '..', 'package.json'), 'utf8')).contributes.colors;
    const worst = (values: number[]) => Math.min(...values);

    it('white text on the window colour — title bar, status bar, selected row: at least 4.5', () => {
        expect(worst(INTENT_PALETTE.map(c => contrast(WHITE, rgb(c))))).toBeGreaterThanOrEqual(4.5);
    });

    it('text of a row in the window colour on a light theme: at least 4.5', () => {
        expect(worst(INTENT_PALETTE.flatMap(c => LIGHT.map(bg => contrast(rgb(c), bg))))).toBeGreaterThanOrEqual(4.5);
    });

    it('text of a row in the lighter shade on a dark theme: at least 4.5', () => {
        expect(worst(declared.flatMap(c => DARK.map(bg => contrast(rgb(c.defaults.dark), bg))))).toBeGreaterThanOrEqual(4.5);
    });

    it("this window's own row — text in the window colour on the backdrop in its light version: at least 3.5 on a light theme", () => {
        const values = INTENT_PALETTE.flatMap(c => LIGHT.map(bg => contrast(rgb(c), over(backdropColor(c), bg))));
        expect(worst(values)).toBeGreaterThanOrEqual(3.5);
    });

    it("this window's own row on a dark theme — lighter text on the backdrop, which is dark there: at least 4.5", () => {
        const values = INTENT_PALETTE.flatMap((c, i) =>
            DARK.map(bg => contrast(rgb(declared[i].defaults.dark), over(backdropColor(c), bg))));
        expect(worst(values)).toBeGreaterThanOrEqual(4.5);
    });

    it('the backdrop is seen against the bare side bar, and vanishes over the selection in the same colour', () => {
        const againstBar = INTENT_PALETTE.flatMap(c => LIGHT.map(bg => contrast(over(backdropColor(c), bg), bg)));
        expect(worst(againstBar)).toBeGreaterThan(1.25);
        INTENT_PALETTE.forEach(c => expect(over(backdropColor(c), rgb(c))).toEqual(rgb(c)));
    });
});
