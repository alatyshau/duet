import { DiskEntry, SnapshotFs } from '../../../core/folderView/snapshot';
import { WorkDisk } from '../../../core/work/disk';

/**
 * In-memory disk for the tests of the «Рабочая папка» view: files, folders and
 * symbolic links by path, with the operations the view performs. A folder
 * exists while it is listed in `dirs` or anything lies below it.
 */
export interface MemDisk {
    fs: SnapshotFs;
    ops: WorkDisk;
    files: Map<string, string>;
    dirs: Set<string>;
    /** Link path → the path it leads to. */
    links: Map<string, string>;
    /** Folders whose reading fails. */
    failing: Set<string>;
    /** Operations whose next call fails with this reason. */
    refuse: Map<keyof WorkDisk, string>;
    trashed: string[];
    /** The operations carried out, in order: `rename a -> b`. */
    log: string[];
    /** Runs right before an operation touches the disk — another writer getting in first. */
    before: ((op: keyof WorkDisk, target: string) => void) | null;
    isDir(target: string): boolean;
    exists(target: string): boolean;
}

const dirname = (p: string) => p.slice(0, p.lastIndexOf('/')) || '/';
const basename = (p: string) => p.slice(p.lastIndexOf('/') + 1);

export function createMemDisk(initialFiles: Record<string, string> = {}, initialDirs: string[] = []): MemDisk {
    const files = new Map(Object.entries(initialFiles));
    const dirs = new Set(initialDirs);
    const links = new Map<string, string>();
    const failing = new Set<string>();
    const refuse = new Map<keyof WorkDisk, string>();
    const trashed: string[] = [];
    const log: string[] = [];

    const below = (paths: Iterable<string>, folder: string) => [...paths].some(p => p.startsWith(folder + '/'));
    const isDir = (target: string) => dirs.has(target) || below(files.keys(), target) || below(dirs, target) || below(links.keys(), target);
    const exists = (target: string) => files.has(target) || links.has(target) || isDir(target);

    const realpath = (target: string): string => {
        let current = target;
        for (let hops = 0; hops < 20; hops++) {
            const link = [...links.keys()].filter(l => current === l || current.startsWith(l + '/'))
                .sort((a, b) => b.length - a.length)[0];
            if (!link) {
                return current;
            }
            current = links.get(link)! + current.slice(link.length);
        }
        throw new Error('ELOOP');
    };
    const taken = (target: string): Error => Object.assign(new Error(`уже существует: ${target}`), { code: 'FileExists' });
    const missing = (target: string): Error => Object.assign(new Error(`ENOENT: ${target}`), { code: 'ENOENT' });

    const disk: MemDisk = {
        files, dirs, links, failing, refuse, trashed, log, before: null, isDir, exists,
        fs: {
            readdir: async (folderPath) => {
                if (failing.has(folderPath)) {
                    throw new Error('папка не читается');
                }
                const real = realpath(folderPath);
                if (!isDir(real)) {
                    throw missing(folderPath);
                }
                const direct = (paths: Iterable<string>) => [...paths].filter(p => dirname(p) === real).map(basename);
                const subdirs = new Set<string>();
                for (const p of [...files.keys(), ...dirs, ...links.keys()]) {
                    if (p.startsWith(real + '/')) {
                        const name = p.slice(real.length + 1).split('/')[0];
                        if (!files.has(`${real}/${name}`) && !links.has(`${real}/${name}`)) {
                            subdirs.add(name);
                        }
                    }
                }
                const entry = (name: string, isDirectory: boolean, isSymbolicLink: boolean): DiskEntry => ({ name, isDirectory, isSymbolicLink });
                return [
                    ...[...subdirs].sort().map(name => entry(name, true, false)),
                    ...direct(files.keys()).sort().map(name => entry(name, false, false)),
                    ...direct(links.keys()).sort().map(name => entry(name, false, true))
                ];
            },
            resolveLink: async (linkPath) => {
                const realPath = realpath(linkPath);
                if (!exists(realPath)) {
                    throw missing(linkPath);
                }
                return { realPath, isDirectory: isDir(realPath) };
            },
            realpath: async (target) => realpath(target)
        },
        ops: {
            createFile: async (filePath) => {
                run('createFile', filePath);
                // A new file is never written over one that is there
                if (exists(filePath)) {
                    throw taken(filePath);
                }
                files.set(filePath, '');
            },
            createDir: async (folderPath) => { run('createDir', folderPath); dirs.add(folderPath); },
            rename: async (from, to) => {
                run('rename', to, `${from} -> ${to}`);
                if (!exists(from)) {
                    throw missing(from);
                }
                // The same object under a name that differs in case alone may be renamed
                if (exists(to) && from.toLowerCase() !== to.toLowerCase()) {
                    throw taken(to);
                }
                move(from, to, true);
            },
            copy: async (from, to) => {
                run('copy', to, `${from} -> ${to}`);
                if (exists(to)) {
                    throw taken(to);
                }
                move(from, to, false);
            },
            trash: async (target) => {
                run('trash', target);
                trashed.push(target);
                move(target, null, true);
            }
        }
    };

    function run(op: keyof WorkDisk, target: string, line = target): void {
        disk.before?.(op, target);
        const reason = refuse.get(op);
        if (reason !== undefined) {
            refuse.delete(op);
            throw new Error(reason);
        }
        log.push(`${op} ${line}`);
    }

    /** Move or copy a path with everything below it; `to` null removes it. */
    function move(from: string, to: string | null, remove: boolean): void {
        for (const map of [files, links]) {
            for (const [p, value] of [...map]) {
                if (p === from || p.startsWith(from + '/')) {
                    if (remove) {
                        map.delete(p);
                    }
                    if (to !== null) {
                        map.set(to + p.slice(from.length), value);
                    }
                }
            }
        }
        for (const p of [...dirs]) {
            if (p === from || p.startsWith(from + '/')) {
                if (remove) {
                    dirs.delete(p);
                }
                if (to !== null) {
                    dirs.add(to + p.slice(from.length));
                }
            }
        }
    }

    return disk;
}

/**
 * The same disk as the `FileSystem` the view keeps its own files through —
 * the order, what is expanded, the settings of the window — so that one test
 * disk holds the ticket and everything written about it.
 */
export function asFileSystem(disk: MemDisk): import('../../../core/fs').FileSystem & { writes: string[] } {
    const missing = (target: string) => Object.assign(new Error(`ENOENT: ${target}`), { code: 'ENOENT' });
    const writes: string[] = [];
    const write = async (target: string, data: string) => { writes.push(target); disk.files.set(target, data); };
    return {
        writes,
        access: async target => { if (!disk.exists(target)) { throw missing(target); } },
        readFile: async target => {
            const data = disk.files.get(target);
            if (data === undefined) {
                throw missing(target);
            }
            return data;
        },
        writeFile: write,
        atomicWriteFile: write,
        mkdir: async target => { disk.dirs.add(target); return undefined; },
        readdir: async target => (await disk.fs.readdir(target)).map(entry => ({
            name: entry.name, isDirectory: () => entry.isDirectory, isFile: () => !entry.isDirectory
        })) as unknown as import('fs').Dirent[],
        rename: (from, to) => disk.ops.rename(from, to),
        unlink: async target => { disk.files.delete(target); },
        stat: async target => {
            if (!disk.exists(target)) {
                throw missing(target);
            }
            return { mtimeMs: 0, size: disk.files.get(target)?.length ?? 0, isDirectory: disk.isDir(target) };
        },
        readHead: async (target, bytes) => (disk.files.get(target) ?? '').slice(0, bytes)
    };
}
