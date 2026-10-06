import { ROOT, ancestorsOf, isUnder, levelOf, parentOf } from './names';

/**
 * What is expanded — pure functions over the set of expanded folder paths.
 * The set also holds folders expanded inside collapsed ones and folders the
 * filter hides now: collapsing a folder by hand keeps what is below it, and
 * hiding is not collapsing.
 */

/** Folders a person sees expanded: in the set, admitted by the filter, every folder above expanded too. */
export function visiblyExpanded(expanded: ReadonlySet<string>, admitted: readonly string[]): string[] {
    return admitted.filter(folder => expanded.has(folder) && ancestorsOf(folder).every(above => expanded.has(above)));
}

export function expandAll(expanded: ReadonlySet<string>, admitted: readonly string[]): Set<string> {
    return new Set([...expanded, ...admitted]);
}

/** Exactly `depth` levels of the admitted folders are expanded, whatever was open before. */
export function expandToLevel(expanded: ReadonlySet<string>, admitted: readonly string[], depth: number): Set<string> {
    const known = new Set(admitted);
    return new Set([
        ...[...expanded].filter(folder => !known.has(folder)),
        ...admitted.filter(folder => levelOf(folder) <= depth)
    ]);
}

/** Collapse the deepest level a person sees expanded — one scale from the root for the whole tree. */
export function collapseDeepestLevel(expanded: ReadonlySet<string>, admitted: readonly string[]): Set<string> {
    const seen = visiblyExpanded(expanded, admitted);
    const deepest = Math.max(0, ...seen.map(levelOf));
    const gone = new Set(seen.filter(folder => levelOf(folder) === deepest));
    return new Set([...expanded].filter(folder => !gone.has(folder)));
}

/**
 * «One folder at a time»: when `opened` is expanded, every other expanded
 * folder of level `fromLevel` and deeper is collapsed — all but `opened`
 * itself and the folders above it. The folders remembered below `opened` go too.
 */
export function oneAtATime(expanded: ReadonlySet<string>, opened: string, fromLevel: number): Set<string> {
    return new Set([...expanded].filter(folder =>
        levelOf(folder) < fromLevel || folder === opened || isUnder(opened, folder)));
}

/**
 * The branch that stays when the rule is switched on or its level changes:
 * the nearest folder at or above the focused row that is seen expanded at the
 * rule's level or deeper; else the folder expanded last; else the first such
 * folder on the screen. Null when there is nothing to cut.
 */
export function pickBranch(
    expanded: ReadonlySet<string>, admitted: readonly string[],
    focusFolder: string | null, lastExpanded: string | null, fromLevel: number
): string | null {
    const candidates = new Set(visiblyExpanded(expanded, admitted).filter(folder => levelOf(folder) >= fromLevel));
    for (let folder = focusFolder; folder && folder !== ROOT; folder = parentOf(folder)) {
        if (candidates.has(folder)) {
            return folder;
        }
    }
    if (lastExpanded && candidates.has(lastExpanded)) {
        return lastExpanded;
    }
    return admitted.find(folder => candidates.has(folder)) ?? null;
}

/** Expand the way to a file; with the rule on, `fromLevel` is its level, else null. */
export function revealPath(expanded: ReadonlySet<string>, file: string, fromLevel: number | null): Set<string> {
    const next = new Set([...expanded, ...ancestorsOf(file)]);
    return fromLevel === null ? next : oneAtATime(next, parentOf(file), fromLevel);
}

/** Folders whose state differs between two sets — the ones the tree must draw anew. */
export function changedFolders(before: ReadonlySet<string>, after: ReadonlySet<string>): string[] {
    return [...new Set([...before, ...after])].filter(folder => before.has(folder) !== after.has(folder));
}
