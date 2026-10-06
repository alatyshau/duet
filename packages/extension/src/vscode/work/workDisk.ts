import * as fs from 'fs/promises';
import * as vscode from 'vscode';
import { DiskEntry, SnapshotFs } from '../../core/folderView/snapshot';
import { WorkDisk } from '../../core/work/disk';

/**
 * The file operations of the view, through `workspace.fs` — the file service
 * Explorer itself uses. A rename made this way moves the open tab along and
 * a delete closes it, as after the same act in Explorer; and since
 * `workspace.fs` sends no rename events to extensions, links in other files
 * are never rewritten and nothing lands in the editor's undo stack.
 */
export const vscodeDisk: WorkDisk = {
    // `workspace.fs.writeFile` writes over a file that is there; the exclusive flag of the disk itself does not
    createFile: filePath => fs.writeFile(filePath, '', { flag: 'wx' }),
    createDir: folderPath => Promise.resolve(vscode.workspace.fs.createDirectory(vscode.Uri.file(folderPath))),
    rename: (from, to) => Promise.resolve(
        vscode.workspace.fs.rename(vscode.Uri.file(from), vscode.Uri.file(to), { overwrite: false })),
    copy: (from, to) => Promise.resolve(
        vscode.workspace.fs.copy(vscode.Uri.file(from), vscode.Uri.file(to), { overwrite: false })),
    trash: target => Promise.resolve(
        vscode.workspace.fs.delete(vscode.Uri.file(target), { recursive: true, useTrash: true }))
};

/** Folder listings for the snapshot, straight from the disk. */
export const nodeSnapshotFs: SnapshotFs = {
    readdir: async (folderPath): Promise<DiskEntry[]> =>
        (await fs.readdir(folderPath, { withFileTypes: true })).map(entry => ({
            name: entry.name, isDirectory: entry.isDirectory(), isSymbolicLink: entry.isSymbolicLink()
        })),
    resolveLink: async linkPath => {
        const realPath = await fs.realpath(linkPath);
        return { realPath, isDirectory: (await fs.stat(realPath)).isDirectory() };
    },
    realpath: target => fs.realpath(target)
};
