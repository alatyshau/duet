/**
 * The file operations of the «Рабочая папка» view. They are the ordinary ones —
 * the file service Explorer itself uses — and nothing stricter: a name found
 * taken by the check before an operation is a refusal in one line, and that
 * check is all the protection there is.
 */
export interface WorkDisk {
    /** Create an empty file; rejects when the name is taken — a file that is there is never written over. */
    createFile(filePath: string): Promise<void>;
    createDir(folderPath: string): Promise<void>;
    /** Rename or move; rejects when the target exists. */
    rename(from: string, to: string): Promise<void>;
    /** Copy a file or a whole folder; rejects when the target exists. */
    copy(from: string, to: string): Promise<void>;
    /** Move to the system trash; rejects when the trash refuses — nothing is ever deleted for good. */
    trash(target: string): Promise<void>;
}

/** True for the error an operation gives when its target is already there. */
export function isTakenError(error: unknown): boolean {
    const code = (error as { code?: unknown } | null)?.code;
    return code === 'FileExists' || code === 'EEXIST' || code === 'EntryExists';
}

export function reasonOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
