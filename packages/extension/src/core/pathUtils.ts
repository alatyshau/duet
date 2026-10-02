/**
 * Path utilities for cross-platform path comparison.
 *
 * Handles:
 * - Windows case-insensitivity
 * - Trailing separators
 * - Path normalization
 */

import * as path from 'path';

/**
 * Normalize path for cross-platform comparison.
 * Converts to lowercase on Windows, normalizes separators.
 */
export function normalizePath(p: string): string {
    const normalized = path.normalize(p);
    // On Windows, paths are case-insensitive
    return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

/**
 * Check if childPath is inside parentPath.
 * Works correctly on all platforms (Windows case-insensitivity, trailing separators, etc.)
 *
 * @param childPath - Path to check
 * @param parentPath - Potential parent directory
 * @returns true if childPath is strictly inside parentPath (not equal)
 */
export function isPathInside(childPath: string, parentPath: string): boolean {
    // Normalize both paths
    let normalizedChild = path.normalize(childPath);
    let normalizedParent = path.normalize(parentPath);

    // On Windows, paths are case-insensitive
    if (process.platform === 'win32') {
        normalizedChild = normalizedChild.toLowerCase();
        normalizedParent = normalizedParent.toLowerCase();
    }

    // Get relative path from parent to child
    const relative = path.relative(normalizedParent, normalizedChild);

    // If relative path:
    // - starts with '..' → child is outside parent
    // - is absolute → different drives on Windows
    // - is empty string → paths are equal
    // - otherwise → child is inside parent
    return relative !== '' &&
           !relative.startsWith('..') &&
           !path.isAbsolute(relative);
}

/**
 * Format a Duet @-reference: `` `@<rootName>/<relativePath>` ``.
 *
 * Backslashes from Windows `path.relative` are normalized to forward slashes
 * so the reference reads the same on every platform. If `relativePath` is
 * empty (the resource IS the workspace root) the trailing slash is dropped:
 * `` `@<rootName>` ``.
 *
 * Precondition: `relativePath` MUST come from `path.relative(root, target)`
 * where `target` lies inside `root` — i.e. no leading `..` and not absolute.
 * The function does no validation: garbage in, garbage out.
 */
export function formatAtReference(rootName: string, relativePath: string): string {
    const normalized = relativePath.split(/[\\/]/).filter(Boolean).join('/');
    const body = normalized ? `${rootName}/${normalized}` : rootName;
    return `\`@${body}\``;
}

/** A ticket folder: `DUE009`, `DUEX01_Name` — business code + three-character number. */
const TICKET_FOLDER_RE = /^([A-Z]{3}(?:\d{3}|[A-Z]\d{2}))(?:_|$)/;

/** Folders that hold a business's tickets; a ticket is recognised only below one. */
const TICKET_STATUS_DIRS = new Set(['work', 'backlog', 'archive']);

/**
 * Format the short ticket @-reference for a path inside a ticket folder:
 * `` `@DUE009/<rest>` `` (or `` `@DUE009` `` for the folder itself).
 *
 * The short form stays valid when the ticket moves between `work/`,
 * `backlog/` and `archive/`, so it beats `@<business>/work/DUE009_Name/...`.
 * The ticket is the outermost folder matching the ticket pattern that lies
 * below a `work` / `backlog` / `archive` folder (at any grouping depth, e.g.
 * `archive/2026/09/`). Returns null when the path is not inside a ticket.
 */
export function formatTicketReference(absolutePath: string): string | null {
    const segments = absolutePath.split(/[\\/]/).filter(Boolean);
    let belowStatusDir = false;
    for (let i = 0; i < segments.length; i++) {
        const match = belowStatusDir ? TICKET_FOLDER_RE.exec(segments[i]) : null;
        if (match) {
            const rest = segments.slice(i + 1).join('/');
            return rest ? `\`@${match[1]}/${rest}\`` : `\`@${match[1]}\``;
        }
        if (TICKET_STATUS_DIRS.has(segments[i])) {
            belowStatusDir = true;
        }
    }
    return null;
}

/** Reads a file as UTF-8 text; rejects when the file is missing or unreadable. */
export type ReadText = (filePath: string) => Promise<string>;

/**
 * Format the @-reference through the nearest business:
 * `` `@<business name>/<relative>` ``.
 *
 * Walks up from `absolutePath` (the path itself first, so a business folder
 * gives `` `@<name>` ``) to the nearest folder whose `context.json` declares a
 * non-empty `name`, and uses that canonical name — the one Duet registers —
 * not the folder name: `!СЕМЬЯ/…` copies as `` `@СЕМЬЯ/…` ``. Returns null
 * when no ancestor is a business (e.g. files in a repo under DuetData).
 */
export async function formatBusinessReference(
    absolutePath: string,
    readText: ReadText
): Promise<string | null> {
    let dir = absolutePath;
    for (;;) {
        const name = await readBusinessName(dir, readText);
        if (name) {
            return formatAtReference(name, path.relative(dir, absolutePath));
        }
        const parent = path.dirname(dir);
        if (parent === dir) {
            return null;
        }
        dir = parent;
    }
}

async function readBusinessName(dir: string, readText: ReadText): Promise<string | null> {
    let text: string;
    try {
        text = await readText(path.join(dir, 'context.json'));
    } catch {
        return null;
    }
    try {
        const data: unknown = JSON.parse(text);
        if (data && typeof data === 'object' && !Array.isArray(data)) {
            const name = (data as Record<string, unknown>).name;
            if (typeof name === 'string' && name.trim()) {
                return name;
            }
        }
    } catch {
        // malformed manifest: not a business Duet registers
    }
    return null;
}

/**
 * Resolve a Duet @-reference to an absolute path.
 *
 * Naming convention from the design-doc:
 *  - Git products use `@<alias>.git` (the `.git` echoes the on-disk folder
 *    name `<reposDir>/<alias>.git`). The alias key in `gitFolders` is the
 *    bare alias — so we strip a trailing `.git` from the head before lookup.
 *  - Drive products use `@<context_name>` (or `@<context_name>/<sub>`),
 *    resolved against `contextFolder`.
 *
 * Returns null when the head matches neither a known git alias nor the
 * context name, or when the reference has a `.` / `..` segment — caller
 * decides how to surface that to the user.
 *
 * This is the extension's copy of the alpha-path grammar, which the Backend
 * owns in `services/at_paths.py`; it resolves the product refs of one
 * `orientation()` answer without a round trip, so keep the two in step.
 */
export function resolveAtRef(
    atRef: string,
    gitFolders: Record<string, string>,
    contextName?: string,
    contextFolder?: string
): string | null {
    if (!atRef.startsWith('@')) {
        return null;
    }
    // Same grammar as the Backend's `services/at_paths.py`: `/` and `\` both
    // separate segments, empty ones are dropped, `.` and `..` are refused.
    const segments = atRef.slice(1).split(/[\\/]/).filter(Boolean);
    if (segments.length === 0 || segments.some(s => s === '.' || s === '..')) {
        return null;
    }
    const [head, ...tail] = segments;

    const aliasKey = head.endsWith('.git') ? head.slice(0, -4) : head;
    const gitRoot = gitFolders[aliasKey];
    if (gitRoot) {
        return tail.length > 0 ? path.join(gitRoot, ...tail) : gitRoot;
    }

    if (contextName && contextFolder && head === contextName) {
        return tail.length > 0 ? path.join(contextFolder, ...tail) : contextFolder;
    }

    return null;
}
