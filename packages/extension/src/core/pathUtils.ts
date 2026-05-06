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
