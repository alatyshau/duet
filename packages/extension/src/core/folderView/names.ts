/**
 * Names and paths of a folder view — a tree of one folder with an order of its
 * own. Paths inside the folder are relative, with `/`; the folder itself is `.`.
 * Nothing here knows about tickets.
 */

export const ROOT = '.';

export type EntryKind = 'file' | 'dir';

/** One name in a folder, as the disk gave it (in NFC on macOS). */
export interface Entry {
    name: string;
    kind: EntryKind;
}

export type System = 'darwin' | 'win32' | 'linux';

export function joinRel(folder: string, name: string): string {
    return folder === ROOT ? name : `${folder}/${name}`;
}

export function parentOf(rel: string): string {
    const cut = rel.lastIndexOf('/');
    return cut < 0 ? ROOT : rel.slice(0, cut);
}

export function baseOf(rel: string): string {
    return rel.slice(rel.lastIndexOf('/') + 1);
}

/** Level 1 — folders right inside the root; the root itself is 0. */
export function levelOf(rel: string): number {
    return rel === ROOT ? 0 : rel.split('/').length;
}

/** True when `rel` lies below `folder` (not the folder itself). */
export function isUnder(rel: string, folder: string): boolean {
    return folder === ROOT ? rel !== ROOT : rel.startsWith(folder + '/');
}

/** Folders above `rel`, top first; the root is not among them. */
export function ancestorsOf(rel: string): string[] {
    const result: string[] = [];
    for (let folder = parentOf(rel); folder !== ROOT; folder = parentOf(folder)) {
        result.unshift(folder);
    }
    return result;
}

/** Replace the start `from` of a path with `to`; other paths come back unchanged. */
export function rebase(rel: string, from: string, to: string): string {
    if (rel === from) {
        return to;
    }
    return isUnder(rel, from) ? to + rel.slice(from.length) : rel;
}

/**
 * The key two names are matched by — the rule of the system the disk lives
 * on: macOS ignores case and Unicode form, Windows ignores case, Linux
 * tells every name apart.
 */
export function nameKey(name: string, system: System): string {
    if (system === 'darwin') {
        return name.normalize('NFC').toLowerCase();
    }
    return system === 'win32' ? name.toLowerCase() : name;
}

/** `a.b.md` → `a.b` + `.md`; a leading dot starts no extension: `.env` → `.env` + ``. */
export function splitName(name: string): { stem: string; ext: string } {
    const dot = name.lastIndexOf('.');
    return dot > 0 ? { stem: name.slice(0, dot), ext: name.slice(dot) } : { stem: name, ext: '' };
}

function compareCodePoints(a: string, b: string): number {
    const left = Array.from(a);
    const right = Array.from(b);
    for (let i = 0; i < left.length && i < right.length; i++) {
        const diff = (left[i].codePointAt(0) as number) - (right[i].codePointAt(0) as number);
        if (diff !== 0) {
            return diff;
        }
    }
    return left.length - right.length;
}

/**
 * Compare by runs: digits as numbers — of two equal numbers the shorter run
 * comes first, `2` before `02` — everything else in lower case by code point.
 * No collator: its answer depends on the language of the program, and one
 * order must hold in every window.
 */
function compareNatural(a: string, b: string): number {
    const left = a.toLowerCase().match(/\d+|\D+/g) ?? [];
    const right = b.toLowerCase().match(/\d+|\D+/g) ?? [];
    for (let i = 0; i < left.length && i < right.length; i++) {
        const x = left[i];
        const y = right[i];
        if (/^\d/.test(x) && /^\d/.test(y)) {
            const nx = x.replace(/^0+(?=\d)/, '');
            const ny = y.replace(/^0+(?=\d)/, '');
            const diff = nx.length - ny.length || compareCodePoints(nx, ny) || x.length - y.length;
            if (diff !== 0) {
                return diff;
            }
        } else {
            const diff = compareCodePoints(x, y);
            if (diff !== 0) {
                return diff;
            }
        }
    }
    return left.length - right.length;
}

/**
 * The default order of a folder: folders first; then the files named in
 * `pinned`, in that sequence; then the rest. Folders and the rest go by stem,
 * then by extension; the exact name settles what is left.
 */
export function compareDefault(a: Entry, b: Entry, pinned: readonly string[]): number {
    if (a.kind !== b.kind) {
        return a.kind === 'dir' ? -1 : 1;
    }
    if (a.kind === 'file') {
        const pa = pinned.indexOf(a.name);
        const pb = pinned.indexOf(b.name);
        if (pa !== pb) {
            return (pa < 0 ? pinned.length : pa) - (pb < 0 ? pinned.length : pb);
        }
    }
    const left = splitName(a.name);
    const right = splitName(b.name);
    return compareNatural(left.stem, right.stem)
        || compareNatural(left.ext, right.ext)
        || compareCodePoints(a.name, b.name);
}

/** The highest number a copy may carry: the number has two digits. */
const LAST_COPY = 99;

/** `plan.md` → `plan copy07.md`; a folder and `.env` get the suffix after the whole name. */
export function copyNameOf(name: string, isDir: boolean, copyNumber: number): string {
    const { stem, ext } = isDir ? { stem: name, ext: '' } : splitName(name);
    return `${stem} copy${String(copyNumber).padStart(2, '0')}${ext}`;
}

/**
 * The name of a copy: the first free number from 01 to 99. Null when all are
 * taken — a third digit is never introduced.
 *
 * @param isTaken - true when the folder holds this name, hidden names included
 * @param from - the number to start from; a copy that lost a race tries the next one
 */
export function duplicateName(
    name: string, isDir: boolean, isTaken: (candidate: string) => boolean, from = 1
): { name: string; copyNumber: number } | null {
    for (let n = from; n <= LAST_COPY; n++) {
        const candidate = copyNameOf(name, isDir, n);
        if (!isTaken(candidate)) {
            return { name: candidate, copyNumber: n };
        }
    }
    return null;
}

/** True when `candidate` is a copy `duplicateName` made of `name`. */
export function isCopyOf(candidate: string, name: string, isDir: boolean): boolean {
    const { stem, ext } = isDir ? { stem: name, ext: '' } : splitName(name);
    return candidate.startsWith(`${stem} copy`)
        && candidate.endsWith(ext)
        && /^\d{2}$/.test(candidate.slice(`${stem} copy`.length, candidate.length - ext.length));
}

export interface NameVerdict {
    message: string;
    /** `error` and `info` hold Enter back; `warning` lets it through. */
    severity: 'error' | 'warning' | 'info';
}

export interface NameContext {
    system: System;
    /**
     * True when the folder holds this name, hidden names included. `except` is
     * the exact name of the object being renamed: that object does not count,
     * so a change of case alone passes — unless another object bears the name,
     * as two names that differ in case may on a disk that tells them apart.
     */
    isTaken: (name: string, except?: string) => boolean;
    /** The name being renamed. */
    original?: string;
    /** True when a row of this name would stay hidden; absent for a new file, which opens at once. */
    wouldBeHidden?: (name: string) => boolean;
}

const WINDOWS_FORBIDDEN = /[\\/:*?"<>|]/;
const WINDOWS_DEVICES = /^(con|prn|aux|nul|clock\$|com\d|lpt\d)(\..*)?$/i;

/**
 * Judge a name typed into the name box — the rules of Explorer, with one
 * difference: a name is one object, so `/` and `\` are refused.
 */
export function validateName(input: string, context: NameContext): NameVerdict | null {
    if (!input.trim()) {
        return { message: 'Имя не может быть пустым.', severity: 'error' };
    }
    if (input === '.' || input === '..') {
        return { message: `Имя «${input}» недопустимо.`, severity: 'error' };
    }
    if (/[\\/]/.test(input)) {
        return { message: 'В имени нельзя использовать / и \\.', severity: 'error' };
    }
    if (input.length > 255) {
        return { message: 'Имя длиннее 255 знаков.', severity: 'error' };
    }
    if (context.system === 'win32') {
        if (WINDOWS_FORBIDDEN.test(input)) {
            return { message: 'В имени нельзя использовать знаки \\ / : * ? " < > |.', severity: 'error' };
        }
        if (WINDOWS_DEVICES.test(input)) {
            return { message: `Имя «${input}» занято системой.`, severity: 'error' };
        }
        if (/[. ]$/.test(input)) {
            return { message: 'Имя не может кончаться точкой или пробелом.', severity: 'error' };
        }
    }
    if (context.isTaken(input, context.original)) {
        return { message: `В этой папке уже есть ${input}.`, severity: 'error' };
    }
    if (context.wouldBeHidden?.(input)) {
        return { message: 'Строка будет скрыта: сначала включите показ скрытых файлов.', severity: 'info' };
    }
    if (input !== input.trim()) {
        return { message: 'В начале или в конце имени стоит пробел.', severity: 'warning' };
    }
    return null;
}

/** The part of a name selected when its rename begins: the stem of a file, the whole name of a folder. */
export function renameSelection(name: string, isDir: boolean): [number, number] {
    return [0, isDir ? name.length : splitName(name).stem.length];
}
