import { ExcludeMatcher } from './glob';
import { IgnoreRules, parseIgnore } from './ignore';
import { ROOT, isUnder, joinRel } from './names';
import { Snapshot } from './snapshot';

/**
 * Which rows of a folder view are hidden — the rule of Explorer's own filter
 * (`FilesFilter.isVisible`, VS Code 1.104): a name is hidden when a
 * `files.exclude` pattern or a `.gitignore` matches it or a folder above it,
 * unless a visible editor shows it or something below it.
 */
export interface FilterInput {
    /** The eye: true shows everything. */
    showHidden: boolean;
    /** Path of the view's root from the workspace folder it lies in, `/`-separated; empty when they are the same. */
    prefix: string;
    exclude: ExcludeMatcher;
    /** `.gitignore` rules over paths `/a/b` from the workspace folder; null while `explorer.excludeGitIgnore` is off. */
    ignored: IgnoreRules | null;
    /** Files shown in visible editors, as paths inside the view's root. */
    visibleEditors: readonly string[];
}

/** The paths hidden now, each hidden folder with everything below it. */
export function computeHidden(snapshot: Snapshot, input: FilterInput): Set<string> {
    const hidden = new Set<string>();
    if (input.showHidden) {
        return hidden;
    }
    const fromRoot = (rel: string) => (input.prefix ? `${input.prefix}/${rel}` : rel);
    const matched = (pathFromRoot: string, name: string, isDir: boolean, hasSibling: (n: string) => boolean) =>
        input.exclude(pathFromRoot, name, hasSibling) || (input.ignored?.('/' + pathFromRoot, isDir) ?? false);

    // A hidden folder hides what is below it, and the folders above the root count too
    let aboveExcluded = false;
    const segments = input.prefix ? input.prefix.split('/') : [];
    for (let i = 0; i < segments.length && !aboveExcluded; i++) {
        aboveExcluded = matched(segments.slice(0, i + 1).join('/'), segments[i], true, () => false);
    }

    const hideBelow = (folder: string) => {
        const listing = snapshot.dirs.get(folder);
        if (listing?.state !== 'ok') {
            return;
        }
        for (const entry of listing.entries) {
            const rel = joinRel(folder, entry.name);
            hidden.add(rel);
            if (entry.kind === 'dir') {
                hideBelow(rel);
            }
        }
    };

    const walk = (folder: string, parentExcluded: boolean) => {
        const listing = snapshot.dirs.get(folder);
        if (listing?.state !== 'ok') {
            return;
        }
        const names = new Set(listing.entries.map(entry => entry.name));
        for (const entry of listing.entries) {
            const rel = joinRel(folder, entry.name);
            const isDir = entry.kind === 'dir';
            // Explorer shows the ignore file itself whenever it reads ignore files
            if (input.ignored && entry.name === '.gitignore') {
                continue;
            }
            const excluded = parentExcluded
                || matched(fromRoot(rel), entry.name, isDir, name => names.has(name));
            if (excluded && !input.visibleEditors.some(shown => shown === rel || isUnder(shown, rel))) {
                hidden.add(rel);
                if (isDir) {
                    hideBelow(rel);
                }
                continue;
            }
            if (isDir) {
                walk(rel, excluded);
            }
        }
    };
    walk(ROOT, aboveExcluded);
    return hidden;
}

/**
 * Join the `.gitignore` files of a workspace folder into one set of rules.
 * For a path the nearest file at or above it speaks first, the files above it after.
 *
 * @param files - `dir` is the folder of the file from the workspace folder, `` for the folder itself
 */
export function composeIgnore(files: ReadonlyArray<{ dir: string; text: string }>): IgnoreRules {
    const byDir = new Map<string, IgnoreRules>();
    const sorted = [...files].sort((a, b) => a.dir.length - b.dir.length);
    const nearest = (path: string): IgnoreRules | undefined => {
        let best: string | null = null;
        for (const dir of byDir.keys()) {
            if ((path === dir || path.startsWith(dir + '/')) && (best === null || dir.length > best.length)) {
                best = dir;
            }
        }
        return best === null ? undefined : byDir.get(best);
    };
    for (const file of sorted) {
        const dirPath = file.dir ? '/' + file.dir : '';
        byDir.set(dirPath, parseIgnore(file.text, dirPath, nearest(dirPath)));
    }
    return (path, isDir) => nearest(path)?.(path, isDir) ?? false;
}
