/**
 * The glob dialect of the `files.exclude` setting, as Explorer of VS Code
 * 1.104 reads it (`vs/base/common/glob.ts`). An extension cannot call
 * Explorer's matcher, and other glob libraries differ in dialect, so the rules
 * are written out here:
 *
 * - `*` — any characters but the separator, a leading dot included; `?` — one;
 * - `**` — any number of path segments, none included: `a/**` matches `a` too;
 * - `{a,b}` — alternatives, not nested; `[…]` — one character, `[!…]` negates;
 * - the pattern is trimmed, a trailing `/` is dropped; case matters on every system;
 * - a pattern without `/` meets only names right in the root it is matched from.
 */

/** Turn `{a,b}` groups into separate patterns. */
function expandBraces(pattern: string): string[] {
    const open = pattern.indexOf('{');
    const close = open < 0 ? -1 : pattern.indexOf('}', open);
    if (close < 0) {
        return [pattern];
    }
    const head = pattern.slice(0, open);
    const tail = pattern.slice(close + 1);
    return pattern.slice(open + 1, close).split(',')
        .flatMap(choice => expandBraces(head + choice + tail));
}

function segmentToRegExp(segment: string): string {
    let out = '';
    for (let i = 0; i < segment.length; i++) {
        const char = segment[i];
        if (char === '*') {
            out += '[^/]*';
        } else if (char === '?') {
            out += '[^/]';
        } else if (char === '[') {
            const close = segment.indexOf(']', i + 2);
            if (close < 0) {
                out += '\\[';
                continue;
            }
            let body = segment.slice(i + 1, close);
            const negated = body[0] === '!' || body[0] === '^';
            if (negated) {
                body = body.slice(1);
            }
            out += `(?!/)[${negated ? '^' : ''}${body.replace(/[\\\]]/g, '\\$&')}]`;
            i = close;
        } else {
            out += char.replace(/[.+^${}()|\\\]]/g, '\\$&');
        }
    }
    return out;
}

/** One pattern without braces as a regular expression over a `/`-separated path. */
function patternToRegExp(pattern: string): RegExp {
    const segments = pattern.split('/').filter((segment, i, all) => !(segment === '**' && all[i - 1] === '**'));
    let out = '';
    segments.forEach((segment, i) => {
        const last = i === segments.length - 1;
        if (segment === '**') {
            if (i === 0) {
                out += last ? '.*' : '(?:.*/)?';
            } else {
                out += last ? '(?:/.*)?' : '/(?:.*/)?';
            }
            return;
        }
        if (i > 0 && segments[i - 1] !== '**') {
            out += '/';
        }
        out += segmentToRegExp(segment);
    });
    return new RegExp(`^${out}$`);
}

/** Compile one glob; a pattern that is empty after trimming matches nothing. */
export function compileGlob(pattern: string): (path: string) => boolean {
    const trimmed = pattern.trim().replace(/\/+$/, '');
    if (!trimmed) {
        return () => false;
    }
    const expressions = expandBraces(trimmed).map(patternToRegExp);
    return path => expressions.some(expression => expression.test(path));
}

export type ExcludeMatcher = (pathFromRoot: string, basename: string, hasSibling: (name: string) => boolean) => boolean;

/**
 * Compile the value of `files.exclude`: an object of patterns. `true` switches
 * a pattern on, `false` off; `{ "when": "$(basename).ext" }` hides a name only
 * while the folder also holds the sibling the clause names.
 */
export function compileExclude(setting: unknown): ExcludeMatcher {
    const rules: Array<{ matches: (path: string) => boolean; when: string | null }> = [];
    if (setting && typeof setting === 'object') {
        for (const [pattern, value] of Object.entries(setting as Record<string, unknown>)) {
            if (value === true) {
                rules.push({ matches: compileGlob(pattern), when: null });
            } else if (value && typeof value === 'object' && typeof (value as { when?: unknown }).when === 'string') {
                rules.push({ matches: compileGlob(pattern), when: (value as { when: string }).when });
            }
        }
    }
    return (pathFromRoot, basename, hasSibling) => rules.some(rule => {
        if (!rule.matches(pathFromRoot)) {
            return false;
        }
        if (rule.when === null) {
            return true;
        }
        const dot = basename.lastIndexOf('.');
        const stem = dot > 0 ? basename.slice(0, dot) : basename;
        return hasSibling(rule.when.replace('$(basename)', stem));
    });
}
