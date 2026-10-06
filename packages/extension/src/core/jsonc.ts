/**
 * Parse JSON with comments and trailing commas — the dialect VS Code accepts in
 * `.code-workspace` files. Throws like `JSON.parse` when the text is not valid.
 */
export function parseJsonc(text: string): unknown {
    return JSON.parse(stripJsonc(text));
}

function stripJsonc(text: string): string {
    const out: string[] = [];
    // Index in `out` of a comma that is dropped if only whitespace and comments
    // separate it from a closing bracket.
    let pendingComma = -1;
    let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;

    while (i < text.length) {
        const ch = text[i];
        const next = text[i + 1];

        if (ch === '"') {
            const start = i;
            i++;
            while (i < text.length && text[i] !== '"') {
                i += text[i] === '\\' ? 2 : 1;
            }
            i++;
            out.push(text.slice(start, i));
            pendingComma = -1;
            continue;
        }
        if (ch === '/' && next === '/') {
            while (i < text.length && text[i] !== '\n') {
                i++;
            }
            continue;
        }
        if (ch === '/' && next === '*') {
            const end = text.indexOf('*/', i + 2);
            i = end === -1 ? text.length : end + 2;
            continue;
        }
        if (ch === ',') {
            pendingComma = out.length;
            out.push(ch);
            i++;
            continue;
        }
        if (ch === '}' || ch === ']') {
            if (pendingComma !== -1) {
                out[pendingComma] = '';
            }
            pendingComma = -1;
        } else if (!/\s/.test(ch)) {
            pendingComma = -1;
        }
        out.push(ch);
        i++;
    }
    return out.join('');
}
