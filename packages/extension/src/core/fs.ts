import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import type { Dirent } from 'fs';

/**
 * FileSystem interface for dependency injection.
 *
 * Used by WorkspaceManager and other core modules.
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

    /** Write file atomically using tmp + rename. Prevents corruption on crash. */
    atomicWriteFile(filePath: string, data: string, encoding: 'utf8'): Promise<void>;

    /** Remove file (unlink) */
    unlink(path: string): Promise<void>;
}

/**
 * Default implementation using Node.js fs/promises.
 * Use this in production code.
 */
export const nodeFs: FileSystem = {
    access: fs.access,
    readFile: (filePath, encoding) => fs.readFile(filePath, encoding),
    writeFile: (filePath, data, encoding) => fs.writeFile(filePath, data, encoding),
    mkdir: fs.mkdir,
    readdir: (dirPath, options) => fs.readdir(dirPath, options),
    rename: fs.rename,
    unlink: fs.unlink,
    atomicWriteFile: async (filePath, data, encoding) => {
        // Write to temp file in same directory (ensures same filesystem for atomic rename)
        const dir = path.dirname(filePath);
        const basename = path.basename(filePath);
        const tmpPath = path.join(dir, `.${basename}.${process.pid}.tmp`);

        try {
            await fs.writeFile(tmpPath, data, encoding);
            await fs.rename(tmpPath, filePath);
        } catch (error) {
            // Cleanup temp file on error
            try {
                await fs.unlink(tmpPath);
            } catch {
                // Ignore cleanup errors
            }
            throw error;
        }
    },
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
        unlink: overrides.unlink ?? notImplemented('unlink'),
        atomicWriteFile: overrides.atomicWriteFile ?? notImplemented('atomicWriteFile'),
    };
}
