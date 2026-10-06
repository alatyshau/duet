/* eslint-disable @typescript-eslint/naming-convention -- VS Code setting keys are dotted */
import { parseJsonc } from '../jsonc';
import { backdropColor, chooseIntentColor, isPaletteColor, normalizeRemembered } from './colors';

/**
 * The workspace file of an intent: `DuetData/workspaces/<business>/<ticket
 * folder>.code-workspace`. Duet owns it whole — it is rebuilt on every open by
 * button and holds nothing but what Duet writes now; only the colours the
 * intent remembers survive a rebuild.
 */

/** Setting that holds the colours an intent remembers, main first. */
export const INTENT_COLORS_KEY = 'duet.intent.colors';
/** Setting that holds the version of the file's canon. */
export const INTENT_CANON_KEY = 'duet.intent.canon';
/**
 * Version of what Duet writes into the file. A Duet that meets a newer version
 * opens the file as it is: several programs may carry different Duet versions,
 * and they must not rewrite the file after each other.
 *
 * 2 — the colour block also sets the selection of lists (see `windowColorBlock`).
 * 3 — and the backdrop of highlighted text.
 * 4 — the tab label of the notepad carries the intent's emoji by the three
 *     steps of its row (`naming.ts:intentIcon`), not always the business's.
 */
export const INTENT_CANON_VERSION = 4;

const WINDOW_COLOR_KEY = 'titleBar.activeBackground';

export interface IntentWorkspaceSpec {
    /** Absolute path of the business folder — the first folder of the window. */
    businessPath: string;
    /** `git_repos` aliases in declared order. */
    aliases: string[];
    /** Additional folders of a meta business (`core/workspace.ts:metaExtraFolders`); absent or empty otherwise. */
    extraFolders?: Array<{ path: string; name?: string }>;
    /** Ticket folder name: `DUE017_IntentSwitcher`. */
    ticketFolder: string;
    /** Label of the notepad tab: `🧰 Intent Switcher` (`naming.ts:intentTabLabel`). */
    tabLabel: string;
}

/**
 * `workbench.colorCustomizations` of a window Duet colours — everything in the
 * window that carries its colour:
 *
 * - the title bar and the status bar: the colour itself, the dark version, under white text;
 * - the selection of lists: the same dark version for the saturated fill of
 *   the selected row while its list has the focus, and for the outline of the
 *   focused row. The pale selection of a list without focus stays the theme's;
 * - the backdrop of highlighted text in lists — what marks the name in this
 *   window's own row of «Активная Работа» and in the row of its ticket in
 *   Корзина, and a match found by typing in any tree of the window: the light
 *   version, `backdropColor`. Its outline is left to the theme, which draws
 *   one only in high-contrast themes.
 *
 * The activity bar is not coloured.
 */
export function windowColorBlock(color: string): Record<string, string> {
    return {
        'titleBar.activeBackground': color,
        'titleBar.activeForeground': '#ffffff',
        'statusBar.background': color,
        'statusBar.foreground': '#ffffff',
        'titleBar.inactiveBackground': color,
        'titleBar.inactiveForeground': '#ffffff',
        'list.activeSelectionBackground': color,
        'list.activeSelectionForeground': '#ffffff',
        'list.focusOutline': color,
        'list.filterMatchBackground': backdropColor(color)
    };
}

/**
 * Text of the workspace file. Deterministic: the same input gives the same
 * bytes, so an unchanged file is never rewritten. Repo paths are relative to
 * `workspaces/<business>/`, two levels below DuetData.
 */
export function buildIntentWorkspaceText(
    spec: IntentWorkspaceSpec,
    color: string,
    remembered: string[]
): string {
    const folders = [
        { path: spec.businessPath },
        ...spec.aliases.map(alias => ({ path: `../../repos/${alias}.git` })),
        ...(spec.extraFolders ?? [])
    ];
    const settings = {
        'workbench.editor.customLabels.patterns': {
            [`**/${spec.ticketFolder}/notepad.md`]: spec.tabLabel
        },
        'symbols.files.associations': {
            'notepad.md': 'sanity',
            'INDEX.md': 'text',
            'AGENDA.md': 'notebook'
        },
        'workbench.editor.pinnedTabsOnSeparateRow': true,
        'workbench.editor.showTabIndex': true,
        'workbench.colorCustomizations': windowColorBlock(color),
        [INTENT_COLORS_KEY]: remembered,
        [INTENT_CANON_KEY]: INTENT_CANON_VERSION
    };
    return JSON.stringify({ folders, settings }, null, 2);
}

export interface IntentWorkspaceState {
    /** Colours the file remembers; a file of an older Duet with a palette colour counts it as the main one. */
    remembered: string[];
    /** Canon version the file was written with, null when the key is absent. */
    canon: number | null;
    /** Window colour the file sets, null when it sets none. */
    color: string | null;
}

/** Read what a rebuild must keep. Returns null when the text is not a workspace file Duet can read. */
export function readIntentWorkspaceState(text: string): IntentWorkspaceState | null {
    let data: unknown;
    try {
        data = parseJsonc(text);
    } catch {
        return null;
    }
    if (!isRecord(data)) {
        return null;
    }
    const settings = isRecord(data.settings) ? data.settings : {};
    const colors = settings['workbench.colorCustomizations'];
    const windowColor = isRecord(colors) && typeof colors[WINDOW_COLOR_KEY] === 'string'
        ? (colors[WINDOW_COLOR_KEY] as string)
        : null;

    let remembered = normalizeRemembered(settings[INTENT_COLORS_KEY]);
    if (!(INTENT_COLORS_KEY in settings) && isPaletteColor(windowColor)) {
        remembered = [windowColor.toLowerCase()];
    }
    const canon = settings[INTENT_CANON_KEY];
    return {
        remembered,
        canon: typeof canon === 'number' ? canon : null,
        color: windowColor
    };
}

export type IntentWorkspacePlan =
    /** Write `text`: the file is new or differs from what Duet writes now. */
    | { action: 'write'; text: string; color: string }
    /** The file already holds exactly these bytes. */
    | { action: 'keep'; color: string }
    /** Open the file as it is: it cannot be read, or a newer Duet wrote it. */
    | { action: 'as-is'; reason: 'unreadable' | 'newer'; color: string | null };

/**
 * Decide what opening an intent by button does to its workspace file.
 *
 * @param existing - current text of the file, null when there is none (first open)
 * @param occupied - colours of the open windows of this program
 */
export function planIntentWorkspace(
    existing: string | null,
    spec: IntentWorkspaceSpec,
    occupied: string[],
    random: () => number = Math.random
): IntentWorkspacePlan {
    let remembered: string[] = [];
    if (existing !== null) {
        const state = readIntentWorkspaceState(existing);
        if (!state) {
            // Rebuilding would roll the intent's main colour again.
            return { action: 'as-is', reason: 'unreadable', color: null };
        }
        if (state.canon !== null && state.canon > INTENT_CANON_VERSION) {
            return { action: 'as-is', reason: 'newer', color: state.color };
        }
        remembered = state.remembered;
    }

    const choice = chooseIntentColor(remembered, occupied, random);
    const text = buildIntentWorkspaceText(spec, choice.color, choice.remembered);
    return text === existing
        ? { action: 'keep', color: choice.color }
        : { action: 'write', text, color: choice.color };
}

/**
 * What opening a business by button does to the colour of its window. The
 * workspace file of a business — `DuetData/workspaces/<business>.code-workspace`
 * — keeps its folders as before and gains a `settings` block: the colour of the
 * window and the colours the business remembers, by the same rules as an intent.
 */
export type BusinessColorPlan =
    /** Write the file with these `settings`; undefined means "without a settings block", as before colours. */
    | { action: 'write'; settings: Record<string, unknown> | undefined; color: string | null }
    /** Leave the file as it is: a newer Duet wrote it. */
    | { action: 'as-is'; color: string | null };

/**
 * @param existing - current text of the business's workspace file, null when there is none
 * @param occupied - colours of the open windows of this program
 * @param windowOpen - true when a window of this program has the file open: its colour is then kept as
 *                     it is, so the folders can be refreshed without recolouring a living window
 */
export function planBusinessColor(
    existing: string | null,
    occupied: string[],
    windowOpen: boolean,
    random: () => number = Math.random
): BusinessColorPlan {
    const state = existing === null ? null : readIntentWorkspaceState(existing);
    if (state && state.canon !== null && state.canon > INTENT_CANON_VERSION) {
        return { action: 'as-is', color: state.color };
    }
    if (windowOpen) {
        return state?.color
            ? { action: 'write', settings: businessSettings(state.color, state.remembered), color: state.color }
            : { action: 'write', settings: undefined, color: null };
    }
    const choice = chooseIntentColor(state?.remembered ?? [], occupied, random);
    return { action: 'write', settings: businessSettings(choice.color, choice.remembered), color: choice.color };
}

function businessSettings(color: string, remembered: string[]): Record<string, unknown> {
    return {
        'workbench.colorCustomizations': windowColorBlock(color),
        [INTENT_COLORS_KEY]: remembered,
        [INTENT_CANON_KEY]: INTENT_CANON_VERSION
    };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
