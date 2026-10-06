import * as path from 'path';

/**
 * The venture folders this window knows — the root businesses of the loaded
 * tree — for commands that are registered apart from it: opening a meta
 * business adds them to its window. Empty until the tree is loaded, and then a
 * meta business opens with its own folder only.
 */
let source: (() => string[]) | null = null;

export function setVentureFoldersSource(next: (() => string[]) | null): void {
    source = next;
}

/** Absolute paths only: a venture the backend could not resolve is left out. */
export function getVentureFolders(): string[] {
    return source ? source().filter(folder => path.isAbsolute(folder)) : [];
}
