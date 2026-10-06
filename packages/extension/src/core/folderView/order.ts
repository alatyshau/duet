import * as path from 'path';
import { FileSystem } from '../fs';
import { Entry, ROOT, compareDefault, rebase } from './names';

/**
 * The order of the rows of a folder. There is one rule and one thing a
 * person may add to it:
 *
 * - folders first, then files, each in the alphabetical order of
 *   `compareDefault` — folders and files are never mixed;
 * - a folder or a file may be *pinned*: the pinned folders stand before the
 *   other folders, the pinned files before the other files, each in the
 *   sequence the person gave them. Only pinned rows can be put in an order.
 *
 * So nothing but the pins is kept, a list of names per folder and per kind:
 *
 *     { "version": 2, "folders": { ".": { "dirs": ["07_Код"], "files": ["INDEX.md", "notepad.md"] } } }
 *
 * The root of the view starts with pins of its own — the file names handed in
 * as `pinned` (`INDEX.md`, `AGENDA.md`, `notepad.md` for a ticket): while the
 * root has no list of files, these are its pins. No other folder starts with any.
 * A pin is a name in a folder: a name that is not on the disk is not shown
 * and stays pinned — the file lies on a cloud drive and may come back. It
 * leaves the list by «Открепить» or a reset, and follows a rename made
 * through the view; a rename made past the view leaves the new name unpinned.
 *
 * The file is kept the way the order of the bin is (`intents/binOrder.ts`):
 * only the exact file name is read, the file is read again before every write
 * and written in place by a single write.
 */
export const ORDER_VERSION = 2;

/** The pins of one folder. An absent list means the pins the folder starts with: for the files of the root — `pinned`, else none. */
export interface FolderPins {
    dirs?: string[];
    files?: string[];
}

export interface OrderFile {
    version: number;
    folders: Record<string, FolderPins>;
    [other: string]: unknown;
}

export type OrderRead =
    | { state: 'none' }
    | { state: 'ok'; file: OrderFile }
    /** Written by a newer Duet: shown when its shape is understood, never written. */
    | { state: 'newer'; file: OrderFile | null }
    | { state: 'corrupt' }
    | { state: 'unreadable'; reason: string };

/** Names are matched in NFC on every system: a list written on a Mac must find its files on Windows. */
const key = (name: string) => name.normalize('NFC');

function parseNames(list: unknown): string[] | undefined {
    return Array.isArray(list)
        ? [...new Set(list.filter((item): item is string => typeof item === 'string' && !!item).map(key))]
        : undefined;
}

export function parseOrder(text: string): OrderRead {
    let data: unknown;
    try {
        data = JSON.parse(text);
    } catch {
        return { state: 'corrupt' };
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
        return { state: 'corrupt' };
    }
    const raw = data as Record<string, unknown>;
    const folders: Record<string, FolderPins> = {};
    const shapeKnown = !!raw.folders && typeof raw.folders === 'object' && !Array.isArray(raw.folders);
    if (shapeKnown) {
        for (const [folder, value] of Object.entries(raw.folders as Record<string, unknown>)) {
            // Version 1 kept a free arrangement, a list of names per folder; there is none any more, and such a folder starts anew
            if (value && typeof value === 'object' && !Array.isArray(value)) {
                const pins: FolderPins = {};
                const dirs = parseNames((value as Record<string, unknown>).dirs);
                const files = parseNames((value as Record<string, unknown>).files);
                if (dirs) {
                    pins.dirs = dirs;
                }
                if (files) {
                    pins.files = files;
                }
                folders[folder] = pins;
            }
        }
    }
    if (typeof raw.version === 'number' && raw.version > ORDER_VERSION) {
        return { state: 'newer', file: shapeKnown ? { ...raw, version: raw.version, folders } : null };
    }
    if (!shapeKnown) {
        return { state: 'corrupt' };
    }
    return { state: 'ok', file: { ...raw, version: ORDER_VERSION, folders } };
}

/** Deterministic text: folder keys sorted, two spaces, a newline at the end. */
export function serializeOrder(file: OrderFile): string {
    const folders: Record<string, FolderPins> = {};
    for (const folder of Object.keys(file.folders).sort()) {
        folders[folder] = file.folders[folder];
    }
    return JSON.stringify({ ...file, folders }, null, 2) + '\n';
}

export function emptyOrder(): OrderFile {
    return { version: ORDER_VERSION, folders: {} };
}

/** The file pins a folder starts with: those of the view for its root, none anywhere below. */
export function startingPins(folder: string, pinned: readonly string[]): string[] {
    return folder === ROOT ? pinned.map(key) : [];
}

/** The pins in force for a folder: its saved ones, or the ones it starts with. */
export function pinsOf(order: OrderFile | null, folder: string, pinned: readonly string[]): { dirs: string[]; files: string[] } {
    const saved = order?.folders[folder];
    return { dirs: saved?.dirs ?? [], files: saved?.files ?? startingPins(folder, pinned) };
}

export function isPinned(order: OrderFile | null, folder: string, pinned: readonly string[], name: string, isDir: boolean): boolean {
    const pins = pinsOf(order, folder, pinned);
    return (isDir ? pins.dirs : pins.files).includes(key(name));
}

/**
 * The rows of a folder in order: pinned folders, the other folders by the
 * alphabet, pinned files, the other files by the alphabet. A pin speaks of
 * its own kind only — a file that bears the name of a pinned folder is not pinned.
 */
export function mergeOrder<T extends Entry>(present: readonly T[], pins: { dirs: readonly string[]; files: readonly string[] }): T[] {
    const ofKind = (kind: Entry['kind'], list: readonly string[]) => {
        const entries = present.filter(entry => entry.kind === kind).sort((a, b) => compareDefault(a, b, []));
        const place = new Map(list.map((name, i) => [name, i]));
        const first = entries.filter(entry => place.has(key(entry.name)))
            .sort((a, b) => (place.get(key(a.name)) as number) - (place.get(key(b.name)) as number));
        return [...first, ...entries.filter(entry => !place.has(key(entry.name)))];
    };
    return [...ofKind('dir', pins.dirs), ...ofKind('file', pins.files)];
}

export type OrderOp =
    /** Pin a name: it goes to the end of the pins of its kind. */
    | { kind: 'pin'; folder: string; name: string; isDir: boolean }
    | { kind: 'unpin'; folder: string; name: string; isDir: boolean }
    /** Put pinned names next to another pinned name of the same kind, in the sequence they must stand in. */
    | { kind: 'place'; folder: string; isDir: boolean; block: string[]; anchor: string; after: boolean }
    /** Back to the pins the folder starts with. */
    | { kind: 'reset'; folder: string }
    /** A pinned name was renamed through the view: the pin follows it. */
    | { kind: 'rename'; folder: string; from: string; to: string }
    /** A folder got another path: its key and the keys below it follow. */
    | { kind: 'moveFolder'; from: string; to: string }
    /** A copy of a folder gets the pins of the folder it was made of. */
    | { kind: 'copyFolder'; from: string; to: string };

function applyOp(folders: Record<string, FolderPins>, op: OrderOp, pinned: readonly string[]): void {
    /** Change the list of one kind; the list of files is written out from the starting pins when first changed. */
    const change = (folder: string, isDir: boolean, next: (list: string[]) => string[]) => {
        const pins = pinsOf({ version: ORDER_VERSION, folders }, folder, pinned);
        const before = isDir ? pins.dirs : pins.files;
        const after = next(before);
        if (after.length !== before.length || after.some((name, i) => name !== before[i])) {
            folders[folder] = { ...folders[folder], [isDir ? 'dirs' : 'files']: after };
        }
    };
    switch (op.kind) {
        case 'pin':
            change(op.folder, op.isDir, list => (list.includes(key(op.name)) ? list : [...list, key(op.name)]));
            return;
        case 'unpin':
            change(op.folder, op.isDir, list => list.filter(name => name !== key(op.name)));
            return;
        case 'place':
            change(op.folder, op.isDir, list => {
                const block = op.block.map(key);
                const anchor = key(op.anchor);
                // Only pinned names have a place: anything else leaves the list as it is
                if (block.includes(anchor) || !list.includes(anchor) || block.some(name => !list.includes(name))) {
                    return list;
                }
                const rest = list.filter(name => !block.includes(name));
                const at = rest.indexOf(anchor) + (op.after ? 1 : 0);
                return [...rest.slice(0, at), ...block, ...rest.slice(at)];
            });
            return;
        case 'reset':
            delete folders[op.folder];
            return;
        case 'rename': {
            const from = key(op.from);
            const to = key(op.to);
            for (const isDir of [true, false]) {
                change(op.folder, isDir, list => (list.includes(from) && !list.includes(to) ? list.map(name => (name === from ? to : name)) : list));
            }
            return;
        }
        case 'moveFolder':
            for (const folder of Object.keys(folders)) {
                const moved = rebase(folder, op.from, op.to);
                if (moved !== folder) {
                    folders[moved] = folders[folder];
                    delete folders[folder];
                }
            }
            return;
        case 'copyFolder':
            for (const folder of Object.keys(folders)) {
                const copied = rebase(folder, op.from, op.to);
                if (copied !== folder) {
                    folders[copied] = { ...folders[folder] };
                }
            }
            return;
    }
}

/**
 * Apply operations to an order; the given file is not changed. A folder
 * whose pins are again the ones it starts with loses its key: the file holds
 * only what a person changed.
 */
export function applyOrderOps(file: OrderFile, ops: readonly OrderOp[], pinned: readonly string[]): OrderFile {
    const folders: Record<string, FolderPins> = {};
    for (const [folder, pins] of Object.entries(file.folders)) {
        folders[folder] = { ...pins };
    }
    ops.forEach(op => applyOp(folders, op, pinned));
    for (const [folder, pins] of Object.entries(folders)) {
        const start = startingPins(folder, pinned);
        if (pins.dirs?.length === 0) {
            delete pins.dirs;
        }
        if (pins.files && pins.files.length === start.length && pins.files.every((name, i) => name === start[i])) {
            delete pins.files;
        }
        if (!pins.dirs && !pins.files) {
            delete folders[folder];
        }
    }
    return { ...file, version: ORDER_VERSION, folders };
}

export async function readOrder(fs: FileSystem, filePath: string): Promise<OrderRead> {
    let text: string;
    try {
        text = await fs.readFile(filePath, 'utf8');
    } catch (error) {
        return (error as NodeJS.ErrnoException).code === 'ENOENT'
            ? { state: 'none' }
            : { state: 'unreadable', reason: error instanceof Error ? error.message : String(error) };
    }
    return parseOrder(text);
}

/** Why an order in this state may not be written; null when it may. */
export function orderLock(read: OrderRead): string | null {
    switch (read.state) {
        case 'newer': return 'файл порядка записан более новым Duet';
        case 'corrupt': return 'файл порядка не разбирается';
        case 'unreadable': return `файл порядка не читается (${read.reason})`;
        default: return null;
    }
}

export type OrderChange =
    | { ok: true; file: OrderFile; written: boolean }
    | { ok: false; why: string };

/**
 * Change the order file: read it afresh, apply the operations to what was
 * read, write once in place. A file that cannot be read or was written by a
 * newer Duet is never written over — the change is refused with the reason.
 */
export async function changeOrder(
    fs: FileSystem, filePath: string, ops: readonly OrderOp[], pinned: readonly string[]
): Promise<OrderChange> {
    const read = await readOrder(fs, filePath);
    const lock = orderLock(read);
    if (lock) {
        return { ok: false, why: lock };
    }
    const before = read.state === 'ok' ? read.file : emptyOrder();
    const after = applyOrderOps(before, ops, pinned);
    const text = serializeOrder(after);
    if (read.state === 'ok' && text === serializeOrder(before)) {
        return { ok: true, file: after, written: false };
    }
    if (read.state === 'none' && Object.keys(after.folders).length === 0) {
        return { ok: true, file: after, written: false };
    }
    try {
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, text, 'utf8');
    } catch (error) {
        return { ok: false, why: error instanceof Error ? error.message : String(error) };
    }
    return { ok: true, file: after, written: true };
}
