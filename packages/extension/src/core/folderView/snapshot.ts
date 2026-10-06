import { Entry, ROOT, System, isUnder, joinRel, parentOf } from './names';

/** One name of a folder as the disk reports it. */
export interface DiskEntry {
    name: string;
    isDirectory: boolean;
    isSymbolicLink: boolean;
}

/** What a snapshot needs of the disk; the real one is Node `fs`, tests pass their own. */
export interface SnapshotFs {
    readdir(folderPath: string): Promise<DiskEntry[]>;
    /** Where a link leads and whether that is a folder; rejects for a broken link. */
    resolveLink(linkPath: string): Promise<{ realPath: string; isDirectory: boolean }>;
    realpath(target: string): Promise<string>;
}

export interface SnapshotEntry extends Entry {
    /** Set for a symbolic link: it leads to a file, to a folder inside the root, out of the root, or back onto its own path. */
    link?: 'file' | 'dir' | 'outside' | 'cycle';
}

export type Listing =
    | { state: 'ok'; entries: SnapshotEntry[] }
    /** The folder could not be read. */
    | { state: 'error'; reason: string }
    /** A link whose content is not shown; `reason` says why. */
    | { state: 'limit'; reason: string };

/** A folder read into memory: a listing per folder, keyed by its path inside the root. */
export interface Snapshot {
    dirs: Map<string, Listing>;
}

export interface SnapshotOptions {
    system: System;
    /** Joins the root path and a relative one into a disk path. */
    join: (rootPath: string, rel: string) => string;
    /** How long one folder may take to answer, in milliseconds. */
    timeoutMs: number;
}

export const LINK_OUTSIDE = 'Ссылка ведёт за пределы тикета';
export const LINK_CYCLE = 'Ссылка замыкается на себя';

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('папка не отвечает')), ms);
        promise.then(
            value => { clearTimeout(timer); resolve(value); },
            error => { clearTimeout(timer); reject(error); }
        );
    });
}

function reasonOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

interface ReadContext {
    fs: SnapshotFs;
    rootPath: string;
    rootReal: string;
    options: SnapshotOptions;
}

/** True when `inner` is `outer` or lies below it, as disk paths. */
function within(inner: string, outer: string): boolean {
    return inner === outer || inner.startsWith(outer.endsWith('/') || outer.endsWith('\\') ? outer : outer + '/')
        || inner.startsWith(outer + '\\');
}

async function readListing(context: ReadContext, rel: string): Promise<Listing> {
    const { fs, rootPath, options } = context;
    const folderPath = rel === ROOT ? rootPath : options.join(rootPath, rel);
    let raw: DiskEntry[];
    try {
        raw = await withTimeout(fs.readdir(folderPath), options.timeoutMs);
    } catch (error) {
        return { state: 'error', reason: reasonOf(error) };
    }
    let ownReal: Promise<string> | undefined;
    // The links of a folder are resolved together: one after another, a folder of many links would take a timeout each
    const entries = await Promise.all(raw.map(async (item): Promise<SnapshotEntry> => {
        // Events of the watcher come in NFC on macOS, and the disk finds a file by either form
        const name = options.system === 'darwin' ? item.name.normalize('NFC') : item.name;
        if (!item.isSymbolicLink) {
            return { name, kind: item.isDirectory ? 'dir' : 'file' };
        }
        const linkPath = options.join(rootPath, joinRel(rel, name));
        try {
            const target = await withTimeout(fs.resolveLink(linkPath), options.timeoutMs);
            if (!target.isDirectory) {
                return { name, kind: 'file', link: 'file' };
            }
            if (!within(target.realPath, context.rootReal)) {
                return { name, kind: 'dir', link: 'outside' };
            }
            // A link to a folder above itself would show the tree inside itself without end
            ownReal ??= fs.realpath(folderPath);
            return { name, kind: 'dir', link: within(await ownReal, target.realPath) ? 'cycle' : 'dir' };
        } catch {
            // A broken link is a file that cannot be opened — the same row Explorer gives it
            return { name, kind: 'file', link: 'file' };
        }
    }));
    return { state: 'ok', entries };
}

async function readTree(context: ReadContext, rel: string, dirs: Map<string, Listing>): Promise<void> {
    const listing = await readListing(context, rel);
    dirs.set(rel, listing);
    if (listing.state !== 'ok') {
        return;
    }
    await Promise.all(listing.entries.filter(entry => entry.kind === 'dir').map(entry => {
        const child = joinRel(rel, entry.name);
        if (entry.link === 'outside' || entry.link === 'cycle') {
            dirs.set(child, { state: 'limit', reason: entry.link === 'outside' ? LINK_OUTSIDE : LINK_CYCLE });
            return Promise.resolve();
        }
        return readTree(context, child, dirs);
    }));
}

async function contextOf(fs: SnapshotFs, rootPath: string, options: SnapshotOptions): Promise<ReadContext> {
    let rootReal = rootPath;
    try {
        rootReal = await fs.realpath(rootPath);
    } catch {
        // The root read below reports the failure
    }
    return { fs, rootPath, rootReal, options };
}

/**
 * Read a folder with everything below it. The whole tree is held in memory so
 * that the tree view answers at once and «expand all» has something to expand.
 * Rejects when the root itself cannot be read; a folder below that fails
 * carries its error in its listing.
 */
export async function readSnapshot(fs: SnapshotFs, rootPath: string, options: SnapshotOptions): Promise<Snapshot> {
    const context = await contextOf(fs, rootPath, options);
    const dirs = new Map<string, Listing>();
    await readTree(context, ROOT, dirs);
    const root = dirs.get(ROOT) as Listing;
    if (root.state === 'error') {
        throw new Error(root.reason);
    }
    return { dirs };
}

function sameListing(a: Listing | undefined, b: Listing): boolean {
    if (!a || a.state !== b.state) {
        return false;
    }
    if (a.state !== 'ok' || b.state !== 'ok') {
        return (a as { reason: string }).reason === (b as { reason: string }).reason;
    }
    return a.entries.length === b.entries.length
        && a.entries.every((entry, i) => entry.name === b.entries[i].name
            && entry.kind === b.entries[i].kind && entry.link === b.entries[i].link);
}

/**
 * Read the named folders again and return a new snapshot with the folders
 * whose listing changed. A folder that appeared is read with all below it; a
 * folder that went takes its listings along. The root failing rejects.
 */
export async function rereadFolders(
    fs: SnapshotFs, rootPath: string, snapshot: Snapshot, folders: readonly string[], options: SnapshotOptions
): Promise<{ snapshot: Snapshot; changed: string[] }> {
    const context = await contextOf(fs, rootPath, options);
    const dirs = new Map(snapshot.dirs);
    const changed: string[] = [];
    // A parent first: when it lost a folder, that folder is not read at all
    for (const rel of [...new Set(folders)].sort((a, b) => a.length - b.length)) {
        if (rel !== ROOT && !dirs.has(rel)) {
            continue;
        }
        const before = dirs.get(rel);
        if (before?.state === 'limit') {
            continue;
        }
        const fresh = await readListing(context, rel);
        if (rel === ROOT && fresh.state === 'error') {
            throw new Error(fresh.reason);
        }
        if (sameListing(before, fresh)) {
            continue;
        }
        dirs.set(rel, fresh);
        changed.push(rel);
        const keep = new Set(fresh.state === 'ok'
            ? fresh.entries.filter(entry => entry.kind === 'dir').map(entry => joinRel(rel, entry.name))
            : []);
        for (const known of [...dirs.keys()]) {
            if (isUnder(known, rel) && ![...keep].some(folder => known === folder || isUnder(known, folder))) {
                dirs.delete(known);
            }
        }
        if (fresh.state === 'ok') {
            for (const entry of fresh.entries) {
                const child = joinRel(rel, entry.name);
                if (entry.kind === 'dir' && !dirs.has(child)) {
                    if (entry.link === 'outside' || entry.link === 'cycle') {
                        dirs.set(child, { state: 'limit', reason: entry.link === 'outside' ? LINK_OUTSIDE : LINK_CYCLE });
                    } else {
                        await readTree(context, child, dirs);
                    }
                }
            }
        }
    }
    return { snapshot: { dirs }, changed };
}

/**
 * Which folders to read again for a batch of file events: the parent of each
 * changed path, or the nearest folder above it that the snapshot knows.
 * An event only says where to look; what changed is seen by reading.
 *
 * @param changedPaths - paths inside the root, relative, with `/`
 */
export function foldersToReread(changedPaths: readonly string[], snapshot: Snapshot): string[] {
    const result = new Set<string>();
    for (const rel of changedPaths) {
        let folder = rel === ROOT ? ROOT : parentOf(rel);
        while (folder !== ROOT && !snapshot.dirs.has(folder)) {
            folder = parentOf(folder);
        }
        result.add(folder);
    }
    return [...result];
}

/** The entries of a folder, or an empty list when it is not read. */
export function entriesOf(snapshot: Snapshot, folder: string): SnapshotEntry[] {
    const listing = snapshot.dirs.get(folder);
    return listing?.state === 'ok' ? listing.entries : [];
}

/** The entry at a path, or undefined. */
export function entryAt(snapshot: Snapshot, rel: string): SnapshotEntry | undefined {
    const name = rel.slice(rel.lastIndexOf('/') + 1);
    return entriesOf(snapshot, parentOf(rel)).find(entry => entry.name === name);
}
