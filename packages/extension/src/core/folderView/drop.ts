import { ROOT, System, isUnder, joinRel, nameKey } from './names';
import { FileRow, Row, isFileRow } from './rows';

/**
 * What a drop means. The tree reports only the row a drop landed on, never a
 * place between rows, so a row always means «next to it, in its folder»:
 * dragged up — before the row, dragged down — after it. Whether «next to it»
 * gives a place at all is decided by the caller: only pinned rows have one,
 * and a row that comes from another folder stands by the alphabet. A file, a collapsed
 * folder and an expanded folder mean the same. Inside a folder one gets by
 * dropping on a row inside it, or on the empty row of an empty folder.
 */
export interface DropInput {
    /** The rows on the screen, top to bottom. */
    rows: readonly Row[];
    /** Paths of the dragged rows. */
    dragged: readonly string[];
    /** The row under the pointer; undefined — below all rows. */
    target: Row | undefined;
    /** True when the folder holds a name that matches, hidden names included. */
    isTaken: (folder: string, name: string) => boolean;
    /** True while the path is on the disk. */
    exists: (path: string) => boolean;
    system: System;
}

export type DropPlan =
    | { kind: 'none' }
    | { kind: 'refuse'; say: string }
    | {
        kind: 'apply';
        /** The folder the block ends in. */
        folder: string;
        /** The dragged rows as they will stand, top to bottom. */
        block: FileRow[];
        /** Rows that change their folder: where from and where to. */
        moves: Array<{ from: string; to: string; isDir: boolean }>;
        /** The name the block lands next to; null — the end of the folder. */
        anchor: string | null;
        after: boolean;
        /** How the place was named: a row, the empty row of a folder, the space below the rows. */
        via: 'row' | 'empty' | 'end';
    };

export function folderLabel(folder: string): string {
    return folder === ROOT ? 'корень тикета' : `${folder}/`;
}

export function resolveDrop(input: DropInput): DropPlan {
    const { rows, target } = input;
    if (target?.kind === 'note' || (target && isFileRow(target) && input.dragged.includes(target.path))) {
        return { kind: 'none' };
    }
    // Rows in screen order; a row whose folder is dragged too rides inside that folder
    const picked = rows.filter((row): row is FileRow => isFileRow(row) && input.dragged.includes(row.path));
    const block = picked.filter(row => !picked.some(other => other.kind === 'dir' && isUnder(row.path, other.path)));
    if (block.length === 0) {
        return { kind: 'none' };
    }

    const folder = !target ? ROOT : target.parent;
    const via = !target ? 'end' : target.kind === 'empty' ? 'empty' : 'row';
    for (const row of block) {
        if (row.kind === 'dir' && (folder === row.path || isUnder(folder, row.path))) {
            return { kind: 'refuse', say: 'Папка не переносится внутрь самой себя.' };
        }
    }
    const gone = block.find(row => !input.exists(row.path));
    if (gone) {
        return { kind: 'refuse', say: `Дерево изменилось: ${gone.name} больше нет.` };
    }
    if (target && isFileRow(target) && !input.exists(target.path)) {
        return { kind: 'refuse', say: `Дерево изменилось: ${target.name} больше нет.` };
    }

    const moving = block.filter(row => row.parent !== folder);
    const seen = new Set<string>();
    for (const row of block) {
        const key = nameKey(row.name, input.system);
        const clash = seen.has(key) || (row.parent !== folder && input.isTaken(folder, row.name));
        if (clash && moving.length > 0) {
            return { kind: 'refuse', say: `В ${folderLabel(folder)} уже есть ${row.name} — ничего не перенесено.` };
        }
        seen.add(key);
    }

    let anchor: string | null = null;
    let after = true;
    if (target && isFileRow(target)) {
        anchor = target.name;
        // By path: the target comes from the tree, the rows are built anew — they are never the same objects
        const place = (row: FileRow) => rows.findIndex(other => isFileRow(other) && other.path === row.path);
        after = place(block[0]) < place(target);
    }
    return {
        kind: 'apply',
        folder,
        block,
        moves: moving.map(row => ({ from: row.path, to: joinRel(folder, row.name), isDir: row.kind === 'dir' })),
        anchor,
        after,
        via
    };
}

export interface ImportInput {
    target: Row | undefined;
    /** Names of the files and folders brought from the system. */
    names: readonly string[];
    isTaken: (folder: string, name: string) => boolean;
    system: System;
}

export type ImportPlan =
    | { kind: 'none' }
    | { kind: 'refuse'; say: string }
    | { kind: 'apply'; folder: string; anchor: string | null; via: 'row' | 'empty' | 'end' };

/** Where files dropped from the system land: by the same rule of the target, always after the target row. */
export function resolveImport(input: ImportInput): ImportPlan {
    if (input.target?.kind === 'note' || input.names.length === 0) {
        return { kind: 'none' };
    }
    const folder = input.target ? input.target.parent : ROOT;
    const seen = new Set<string>();
    for (const name of input.names) {
        const key = nameKey(name, input.system);
        if (seen.has(key) || input.isTaken(folder, name)) {
            return { kind: 'refuse', say: `В ${folderLabel(folder)} уже есть ${name} — ничего не скопировано.` };
        }
        seen.add(key);
    }
    return {
        kind: 'apply',
        folder,
        anchor: input.target && isFileRow(input.target) ? input.target.name : null,
        via: !input.target ? 'end' : input.target.kind === 'empty' ? 'empty' : 'row'
    };
}

/** One line for a move that was carried out: what went where. */
export function moveLine(folder: string, names: readonly string[]): string {
    const head = names.length > 1 ? `${names[0]} и ещё ${names.length - 1}` : names[0];
    return `Перенесено в ${folderLabel(folder)}: ${head}.`;
}

/**
 * Rows a command acts on. A click inside the selection means the whole
 * selection, outside it — the clicked row alone; a key means the focused row
 * by the same rule. Empty rows and notes are dropped; rows inside a chosen
 * folder are dropped when `withoutNested` — the folder carries them.
 */
export function commandTargets(
    clicked: Row | undefined, many: readonly Row[] | undefined, selection: readonly Row[], withoutNested = false
): FileRow[] {
    const same = (a: Row, b: Row) => isFileRow(a) && isFileRow(b) && a.path === b.path;
    let rows: readonly Row[];
    if (clicked) {
        const pool = many && many.length > 0 ? many : selection;
        rows = pool.some(row => same(row, clicked)) ? pool : [clicked];
    } else {
        rows = selection;
    }
    const files = rows.filter(isFileRow);
    return withoutNested
        ? files.filter(row => !files.some(other => other.kind === 'dir' && isUnder(row.path, other.path)))
        : files;
}

/**
 * The row that takes the focus after a deletion: the next one left in the
 * folder, else the one before, else the folder itself; nothing in an empty root.
 *
 * @param rows - the rows on the screen before the deletion
 */
export function afterDeleteFocus(rows: readonly Row[], deleted: readonly string[]): FileRow | null {
    const isGone = (row: FileRow) => deleted.some(path => row.path === path || isUnder(row.path, path));
    const last = [...rows].reverse().find((row): row is FileRow => isFileRow(row) && deleted.includes(row.path));
    if (!last) {
        return null;
    }
    const siblings = rows.filter((row): row is FileRow => isFileRow(row) && row.parent === last.parent);
    const at = siblings.indexOf(last);
    const next = siblings.slice(at + 1).find(row => !isGone(row));
    const previous = [...siblings.slice(0, at)].reverse().find(row => !isGone(row));
    if (next || previous) {
        return next ?? previous ?? null;
    }
    const folder = rows.find((row): row is FileRow => isFileRow(row) && row.path === last.parent);
    return folder && !isGone(folder) ? folder : null;
}
