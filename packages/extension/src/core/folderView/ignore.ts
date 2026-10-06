import { compileGlob } from './glob';

/**
 * `.gitignore` as Explorer of VS Code 1.104 reads it when
 * `explorer.excludeGitIgnore` is on (`vs/workbench/services/search/common/ignoreFile.ts`).
 * It is that reading and not git's own: a line with `!` anywhere in it brings
 * back whatever it matches, and a line ending with `/` speaks of folders only.
 * Reading `!` as git does would be a bug here: the view must hide what
 * Explorer hides.
 *
 * Paths are absolute in the form `/a/b`, without a trailing slash; `dirPath`
 * is the folder the file lies in.
 */
export type IgnoreRules = (path: string, isDir: boolean) => boolean;

function lineToGlob(line: string, dirPath: string): string {
    const firstSep = line.indexOf('/');
    if (firstSep === -1 || firstSep === line.length - 1) {
        return '**/' + line;
    }
    if (firstSep === 0) {
        return dirPath + (dirPath.endsWith('/') ? line.slice(1) : line);
    }
    return dirPath + (dirPath.endsWith('/') ? '' : '/') + line;
}

function linesToMatcher(lines: string[], dirPath: string): (path: string) => boolean {
    const globs = lines.map(line => compileGlob(lineToGlob(line, dirPath)));
    return path => globs.some(matches => matches(path));
}

/**
 * Parse one `.gitignore`. `parent` holds the rules of the nearest file above:
 * they are asked when this file has nothing to say about a path.
 */
export function parseIgnore(text: string, dirPath: string, parent?: IgnoreRules): IgnoreRules {
    const lines = text.split('\n').map(line => line.trim()).filter(line => line && line[0] !== '#');
    const fileLines = lines.filter(line => !line.endsWith('/'));
    const strip = (line: string) => line.replace(/!/g, '');

    const fileIgnored = linesToMatcher(fileLines.filter(line => !line.includes('!')), dirPath);
    const fileIncluded = linesToMatcher(fileLines.filter(line => line.includes('!')).map(strip), dirPath);
    const dirIgnored = linesToMatcher(lines.filter(line => !line.includes('!')), dirPath);
    const dirIncluded = linesToMatcher(lines.filter(line => line.includes('!')).map(strip), dirPath);

    return (path, isDir) => {
        if (!path.startsWith(dirPath)) {
            return false;
        }
        if (isDir && dirIgnored(path) && !dirIncluded(path)) {
            return true;
        }
        if (fileIgnored(path) && !fileIncluded(path)) {
            return true;
        }
        return parent ? parent(path, isDir) : false;
    };
}
