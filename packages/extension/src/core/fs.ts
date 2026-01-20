import * as fs from 'fs/promises';
import type { Dirent } from 'fs';

/**
 * FileSystem interface for dependency injection.
 *
 * Used by ConfigManager, Scanner, and other core modules.
 * Enables easy mocking in tests without vi.mock() hacks.
 */
export interface FileSystem {
    /** Check if path exists and is accessible */
    access(path: string): Promise<void>;

    /** Read file contents as UTF-8 string */
    readFile(path: string, encoding: 'utf8'): Promise<string>;

    /** Write UTF-8 string to file */
    writeFile(path: string, data: string, encoding: 'utf8'): Promise<void>;

    /** Create directory (with optional recursive flag) */
    mkdir(path: string, options?: { recursive?: boolean }): Promise<string | undefined>;

    /** Read directory entries with file type information */
    readdir(path: string, options: { withFileTypes: true }): Promise<Dirent[]>;

    /** Rename/move file or directory */
    rename(oldPath: string, newPath: string): Promise<void>;
}

/**
 * Default implementation using Node.js fs/promises.
 * Use this in production code.
 */
export const nodeFs: FileSystem = {
    access: fs.access,
    readFile: (path, encoding) => fs.readFile(path, encoding),
    writeFile: (path, data, encoding) => fs.writeFile(path, data, encoding),
    mkdir: fs.mkdir,
    readdir: (path, options) => fs.readdir(path, options),
    rename: fs.rename,
};

/**
 * Create a mock FileSystem for testing.
 * All methods throw by default - override only what your test needs.
 */
export function createMockFs(overrides: Partial<FileSystem> = {}): FileSystem {
    const notImplemented = (method: string) => () => {
        throw new Error(`MockFs: ${method} not implemented`);
    };

    return {
        access: overrides.access ?? notImplemented('access'),
        readFile: overrides.readFile ?? notImplemented('readFile'),
        writeFile: overrides.writeFile ?? notImplemented('writeFile'),
        mkdir: overrides.mkdir ?? notImplemented('mkdir'),
        readdir: overrides.readdir ?? notImplemented('readdir'),
        rename: overrides.rename ?? notImplemented('rename'),
    };
}
