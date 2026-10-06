/**
 * Remembered order, kept as one flat list of ticket numbers.
 *
 * Two files use it: the order of active intents of a program
 * (`DuetData/intents/<program>/active.json`) and the order of a business's
 * tickets in the bin (`<business>/.vscode/duet-intents.json`). The order inside
 * any group of rows is the relative order of its numbers in the list; a number
 * the list does not hold stands after the listed ones, by number.
 */

/** Read a list written by `serializeOrder`; a bare array is accepted too. Returns null when the text is neither. */
export function parseOrder(text: string): string[] | null {
    let data: unknown;
    try {
        data = JSON.parse(text);
    } catch {
        return null;
    }
    const list = Array.isArray(data)
        ? data
        : (typeof data === 'object' && data !== null ? (data as Record<string, unknown>).order : null);
    if (!Array.isArray(list)) {
        return null;
    }
    const result: string[] = [];
    for (const item of list) {
        if (typeof item === 'string' && item && !result.includes(item)) {
            result.push(item);
        }
    }
    return result;
}

export function serializeOrder(order: string[]): string {
    return JSON.stringify({ order }, null, 2) + '\n';
}

/**
 * Sort rows by the remembered order. Rows whose number the order holds come
 * first, in its sequence; the rest follow by number, then by `tieBreak`.
 */
export function sortByOrder<T>(
    rows: T[],
    order: string[],
    numberOf: (row: T) => string,
    tieBreak: (row: T) => string = numberOf
): T[] {
    const position = new Map(order.map((n, i) => [n, i]));
    return [...rows].sort((a, b) => {
        const pa = position.get(numberOf(a));
        const pb = position.get(numberOf(b));
        if (pa !== undefined && pb !== undefined && pa !== pb) {
            return pa - pb;
        }
        if (pa !== undefined && pb === undefined) {
            return -1;
        }
        if (pa === undefined && pb !== undefined) {
            return 1;
        }
        return compareText(numberOf(a), numberOf(b)) || compareText(tieBreak(a), tieBreak(b));
    });
}

function compareText(a: string, b: string): number {
    return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Put `source` right before or right after `target` in a sequence; a source the
 * sequence already holds leaves its old place. A target the sequence does not
 * hold sends the source to the end.
 */
export function insertNextTo(sequence: string[], source: string, target: string, after: boolean): string[] {
    if (source === target) {
        return [...sequence];
    }
    const rest = sequence.filter(n => n !== source);
    const to = rest.indexOf(target);
    if (to === -1) {
        return [...rest, source];
    }
    const at = to + (after ? 1 : 0);
    return [...rest.slice(0, at), source, ...rest.slice(at)];
}

/**
 * Move `source` next to `target` inside one shown sequence: a row dragged up
 * lands before the target, a row dragged down lands after it. A null target is
 * a drop past the rows — the row goes to the end.
 */
export function placeNextTo(sequence: string[], source: string, target: string | null): string[] {
    if (target === null) {
        return [...sequence.filter(n => n !== source), source];
    }
    const draggedDown = sequence.indexOf(source) < sequence.indexOf(target);
    return insertNextTo(sequence, source, target, draggedDown);
}

/**
 * Write a shown sequence into the remembered order as one block: its numbers
 * leave their old places and go, in the shown sequence, where the first of them
 * stood (to the end when none was listed). Numbers outside the block keep their
 * relative order, so the first drag in a group lists all its visible rows
 * without disturbing other groups.
 */
export function mergeOrderBlock(order: string[], block: string[]): string[] {
    const inBlock = new Set(block);
    const firstAt = order.findIndex(n => inBlock.has(n));
    const rest = order.filter(n => !inBlock.has(n));
    if (firstAt === -1) {
        return [...rest, ...block];
    }
    const before = order.slice(0, firstAt).filter(n => !inBlock.has(n)).length;
    return [...rest.slice(0, before), ...block, ...rest.slice(before)];
}

/**
 * Read what a drag carried. A tree view hands a drop the value its own drag
 * put into the transfer, but the shape is not ours to rely on: it may come back
 * as the string that was set, as the dragged row, or as a list of rows. Returns
 * the identity of the first dragged row, or null when the value is none of these.
 *
 * @param identityOf - the field of a row object that identifies it
 */
export function draggedIdentity(value: unknown, identityOf: (row: Record<string, unknown>) => unknown): string | null {
    if (typeof value === 'string') {
        return value || null;
    }
    if (Array.isArray(value)) {
        return value.length > 0 ? draggedIdentity(value[0], identityOf) : null;
    }
    if (typeof value === 'object' && value !== null) {
        const identity = identityOf(value as Record<string, unknown>);
        return typeof identity === 'string' && identity ? identity : null;
    }
    return null;
}
