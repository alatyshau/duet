import type { Dirent } from 'fs';
import * as path from 'path';
import { FileSystem } from '../../../core/fs';

/**
 * In-memory FileSystem for unit tests: files and folders in maps, with counters
 * for the calls a test wants to assert on.
 */
export interface MemFs {
    fs: FileSystem;
    files: Map<string, string>;
    dirs: Set<string>;
    /** Bump the modification time of a file, as an edit would. */
    touch(filePath: string): void;
    calls: { readHead: number; stat: number; readdir: number; writeFile: number; atomicWriteFile: number };
}

export function createMemFs(initialFiles: Record<string, string> = {}, initialDirs: string[] = []): MemFs {
    const files = new Map<string, string>();
    const dirs = new Set<string>();
    const mtimes = new Map<string, number>();
    const calls = { readHead: 0, stat: 0, readdir: 0, writeFile: 0, atomicWriteFile: 0 };
    let clock = 1000;

    const addDir = (dir: string): void => {
        let current = dir;
        while (current && current !== path.dirname(current) && !dirs.has(current)) {
            dirs.add(current);
            current = path.dirname(current);
        }
    };
    const put = (filePath: string, data: string): void => {
        addDir(path.dirname(filePath));
        files.set(filePath, data);
        mtimes.set(filePath, ++clock);
    };
    const missing = (target: string): NodeJS.ErrnoException => {
        const error: NodeJS.ErrnoException = new Error(`ENOENT: ${target}`);
        error.code = 'ENOENT';
        return error;
    };

    for (const [filePath, data] of Object.entries(initialFiles)) {
        put(filePath, data);
    }
    initialDirs.forEach(addDir);

    const fs: FileSystem = {
        access: async (target) => {
            if (!files.has(target) && !dirs.has(target)) {
                throw missing(target);
            }
        },
        readFile: async (target) => {
            const data = files.get(target);
            if (data === undefined) {
                throw missing(target);
            }
            return data;
        },
        writeFile: async (target, data) => {
            calls.writeFile++;
            if (!dirs.has(path.dirname(target))) {
                throw missing(path.dirname(target));
            }
            put(target, data);
        },
        atomicWriteFile: async (target, data) => {
            calls.atomicWriteFile++;
            if (!dirs.has(path.dirname(target))) {
                throw missing(path.dirname(target));
            }
            put(target, data);
        },
        mkdir: async (target) => {
            addDir(target);
            return undefined;
        },
        readdir: async (target) => {
            calls.readdir++;
            if (!dirs.has(target)) {
                throw missing(target);
            }
            const entry = (name: string, isDir: boolean): Dirent => ({
                name,
                isDirectory: () => isDir,
                isFile: () => !isDir
            } as unknown as Dirent);
            return [
                ...[...dirs].filter(d => d !== target && path.dirname(d) === target)
                    .map(d => entry(path.basename(d), true)),
                ...[...files.keys()].filter(f => path.dirname(f) === target)
                    .map(f => entry(path.basename(f), false))
            ];
        },
        rename: async (from, to) => {
            if (files.has(to) || dirs.has(to)) {
                const error: NodeJS.ErrnoException = new Error(`EEXIST: ${to}`);
                error.code = 'EEXIST';
                throw error;
            }
            if (files.has(from)) {
                put(to, files.get(from)!);
                files.delete(from);
                return;
            }
            if (!dirs.has(from)) {
                throw missing(from);
            }
            if (!dirs.has(path.dirname(to))) {
                throw missing(path.dirname(to));
            }
            for (const dir of [...dirs]) {
                if (dir === from || dir.startsWith(from + path.sep)) {
                    dirs.delete(dir);
                    dirs.add(to + dir.slice(from.length));
                }
            }
            for (const [filePath, data] of [...files]) {
                if (filePath.startsWith(from + path.sep)) {
                    files.delete(filePath);
                    files.set(to + filePath.slice(from.length), data);
                    mtimes.set(to + filePath.slice(from.length), mtimes.get(filePath) ?? ++clock);
                }
            }
        },
        unlink: async (target) => {
            if (!files.delete(target)) {
                throw missing(target);
            }
        },
        stat: async (target) => {
            calls.stat++;
            if (files.has(target)) {
                return { mtimeMs: mtimes.get(target) ?? 0, size: files.get(target)!.length, isDirectory: false };
            }
            if (dirs.has(target)) {
                return { mtimeMs: 0, size: 0, isDirectory: true };
            }
            throw missing(target);
        },
        readHead: async (target, bytes) => {
            calls.readHead++;
            const data = files.get(target);
            if (data === undefined) {
                throw missing(target);
            }
            return data.slice(0, bytes);
        }
    };

    return {
        fs,
        files,
        dirs,
        calls,
        touch: (filePath) => { mtimes.set(filePath, ++clock); }
    };
}
