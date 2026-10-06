import { EntryKind, ROOT, joinRel } from './names';
import { OrderFile, mergeOrder, pinsOf } from './order';
import { Snapshot, SnapshotEntry } from './snapshot';

/** A row of the tree. */
export type Row =
    | { kind: EntryKind; path: string; name: string; parent: string; link?: SnapshotEntry['link'] }
    /** The empty row of an expanded folder that shows nothing: a place to drop on. */
    | { kind: 'empty'; parent: string }
    /** A line that tells why a folder shows no content; it is not a file and takes no drop. */
    | { kind: 'note'; parent: string; text: string };

export type FileRow = Extract<Row, { kind: EntryKind }>;

export function isFileRow(row: Row | undefined | null): row is FileRow {
    return !!row && (row.kind === 'file' || row.kind === 'dir');
}

export interface RowContext {
    snapshot: Snapshot;
    /** Hidden paths, as `computeHidden` gives them. */
    hidden: ReadonlySet<string>;
    /** The pins to show; null — every folder has the pins it starts with. */
    order: OrderFile | null;
    pinned: readonly string[];
}

/**
 * The rows right inside a folder. A folder that could not be read gives one
 * note with the reason; a folder still being read gives nothing; a folder
 * with no shown rows gives the empty row — also when hidden files lie in it.
 * The root never gets an empty row.
 */
export function childRows(context: RowContext, folder: string): Row[] {
    const listing = context.snapshot.dirs.get(folder);
    if (!listing) {
        return [];
    }
    if (listing.state !== 'ok') {
        return [{ kind: 'note', parent: folder, text: listing.reason }];
    }
    const shown = listing.entries.filter(entry => !context.hidden.has(joinRel(folder, entry.name)));
    const rows: Row[] = mergeOrder(shown, pinsOf(context.order, folder, context.pinned)).map(entry => ({
        kind: entry.kind, path: joinRel(folder, entry.name), name: entry.name, parent: folder, link: entry.link
    }));
    return rows.length === 0 && folder !== ROOT ? [{ kind: 'empty', parent: folder }] : rows;
}

/** The rows on the screen, top to bottom: a folder's rows follow it while it is expanded. */
export function screenRows(context: RowContext, expanded: ReadonlySet<string>): Row[] {
    const result: Row[] = [];
    const walk = (folder: string) => {
        for (const row of childRows(context, folder)) {
            result.push(row);
            if (row.kind === 'dir' && expanded.has(row.path)) {
                walk(row.path);
            }
        }
    };
    walk(ROOT);
    return result;
}

/** Every folder a person could see, expanded or not, in screen order. */
export function admittedFolders(context: RowContext): string[] {
    const result: string[] = [];
    const walk = (folder: string) => {
        for (const row of childRows(context, folder)) {
            if (row.kind === 'dir') {
                result.push(row.path);
                walk(row.path);
            }
        }
    };
    walk(ROOT);
    return result;
}

/** What identifies a row for the tree: one string per row, the same on every call. */
export function rowKey(row: Row): string {
    if (row.kind === 'empty') {
        return `e|${row.parent}`;
    }
    if (row.kind === 'note') {
        return `n|${row.parent}`;
    }
    return `${row.kind === 'dir' ? 'd' : 'f'}|${row.path}`;
}
