import { intentIcon, intentIdentity, rowText, RowText, BUSINESS_TAG } from './naming';
import { WindowMarker } from './markers';

/**
 * Active windows as the «Активная Работа» view shows them: the business windows of this
 * program and its intents — the tickets that have a window open — in one list. One row per
 * key, whatever the number of windows.
 */
export interface ActiveIntent {
    subject: 'intent' | 'business';
    /** Key of the row: the ticket number `DUE017`, or `@DuetLab` for a business window. */
    ticket: string;
    /** Ticket folder name the window was opened for; empty for a business window. */
    folder: string;
    /** Readable name: `Intent Switcher`; for a business window, the business name. */
    name: string;
    /**
     * Emoji shown in the row, by three steps: the ticket's own; else the one of its parent ticket (the
     * nearest up the `parent` chain that has one); else the one of its business. Empty when none has one.
     */
    icon: string;
    business: string;
    workspaceFile: string;
    /** Colour in force in the window now; null when it has none. */
    color: string | null;
    /** True for the row of the window that asks. */
    own: boolean;
    /** True while the window is still being opened (a reservation, no window marker yet). */
    pending: boolean;
}

/** How long a row stays after its marker is gone, so a window reload does not blink. */
export const LINGER_MS = 1500;

/**
 * One row per key from the live markers. Among several markers of a key the
 * window that asks wins, then a real window over a reservation, then the
 * newest.
 */
export function activeFromMarkers(live: WindowMarker[], ownPid: number): ActiveIntent[] {
    const best = new Map<string, WindowMarker>();
    for (const marker of live) {
        const current = best.get(marker.ticket);
        if (!current || rank(marker, ownPid) > rank(current, ownPid)) {
            best.set(marker.ticket, marker);
        }
    }
    return [...best.values()].map(marker => {
        const business = marker.subject === 'business';
        return {
            subject: marker.subject,
            ticket: marker.ticket,
            folder: marker.ticketFolder,
            name: business ? marker.business : (intentIdentity(marker.ticketFolder)?.name ?? ''),
            icon: business ? marker.icon : intentIcon(marker.ticketIcon, marker.icon),
            business: marker.business,
            workspaceFile: marker.workspaceFile,
            color: marker.color,
            own: marker.kind === 'window' && marker.pid === ownPid,
            pending: marker.kind === 'reservation'
        };
    });
}

function rank(marker: WindowMarker, ownPid: number): number {
    const own = marker.kind === 'window' && marker.pid === ownPid ? 2e15 : 0;
    const real = marker.kind === 'window' ? 1e15 : 0;
    return own + real + marker.writtenAt;
}

/** Stands at the end of the row of the window that asks: "this window is here". */
export const OWN_MARK = '🔴';

/** How many rows carry a number, and with it a shortcut: Cmd+1 … Cmd+9. */
export const NUMBERED_ROWS = 9;

/**
 * The rows that carry a number, in the order of their numbers: the first nine
 * rows as the view shows them — windows of businesses and of intents alike.
 * A number is the place of a row, not a property of its window: it is kept
 * nowhere and counted anew from the shown rows each time, so after a drag, or
 * when a window opens or closes, the rows below take new numbers. The text of
 * a row and the shortcut both read this one list, so the number a row shows is
 * always the number that switches to it.
 */
export function numberedRows(shown: ActiveIntent[]): ActiveIntent[] {
    return shown.slice(0, NUMBERED_ROWS);
}

/** Number of a row, from 1; null for a row past the ninth. */
export function rowNumber(shown: ActiveIntent[], ticket: string): number | null {
    const at = numberedRows(shown).findIndex(row => row.ticket === ticket);
    return at === -1 ? null : at + 1;
}

/** The row under a number; null when no row carries it. */
export function rowByNumber(shown: ActiveIntent[], number: unknown): ActiveIntent | null {
    return typeof number === 'number' && Number.isInteger(number)
        ? numberedRows(shown)[number - 1] ?? null
        : null;
}

/**
 * Text of a row: the name in the label, with the row's number in front the way
 * the editor numbers its tabs — `2: Intent Switcher`; after it the ticket
 * number, or `biz` for a business window; and the red dot at the very end of
 * this window's own row. The number is part of the name, so the backdrop of
 * the own row lies under it too.
 *
 * @param number - from `rowNumber`; null for a row without one
 */
export function activeRowText(row: ActiveIntent, number: number | null = null): RowText {
    const plain = rowText('', row.name, row.subject === 'business' ? BUSINESS_TAG : row.ticket);
    const label = number === null ? plain.label : `${number}: ${plain.label}`;
    const text: RowText = { ...plain, label, name: [0, label.length] };
    if (!row.own) {
        return text;
    }
    return { ...text, description: text.description ? `${text.description} ${OWN_MARK}` : OWN_MARK };
}

/**
 * Rows in the order the view shows them: one list of open windows, business
 * windows and intents alike, in the remembered order. A row the order does not
 * hold yet stands at the end, in the sequence it came in — `listNewRows` gives
 * that sequence and the caller writes it down, so the place is kept from then on.
 */
export function orderActive(rows: ActiveIntent[], order: string[]): ActiveIntent[] {
    const position = new Map(order.map((key, at) => [key, at]));
    const place = (row: ActiveIntent) => position.get(row.ticket) ?? Number.MAX_SAFE_INTEGER;
    // The sort is stable: rows without a place keep the sequence they came in
    return [...rows].sort((a, b) => place(a) - place(b));
}

/**
 * The remembered order with the windows it does not hold yet put at its end,
 * the one opened earlier first — a new tab always goes to the end, as in a
 * browser. Null when the order already holds every shown row. When the list
 * would pass `limit`, keys of windows that are not open leave it, oldest first.
 *
 * @param rows - rows shown now
 * @param live - their markers; the earliest write of a key is when its window came
 */
export function listNewRows(
    order: string[],
    rows: ActiveIntent[],
    live: Pick<WindowMarker, 'ticket' | 'writtenAt'>[],
    limit: number
): string[] | null {
    const listed = new Set(order);
    const cameAt = new Map<string, number>();
    for (const marker of live) {
        cameAt.set(marker.ticket, Math.min(cameAt.get(marker.ticket) ?? Infinity, marker.writtenAt));
    }
    const fresh = rows
        .map(row => row.ticket)
        .filter(key => !listed.has(key))
        .sort((a, b) => (cameAt.get(a) ?? Infinity) - (cameAt.get(b) ?? Infinity) || (a < b ? -1 : a > b ? 1 : 0));
    if (fresh.length === 0) {
        return null;
    }
    const shown = new Set(rows.map(row => row.ticket));
    const next = [...order, ...fresh];
    let over = next.length - limit;
    return over <= 0 ? next : next.filter(key => shown.has(key) || over-- <= 0);
}

/**
 * Where a dragged row lands among the shown rows. Every row is dragged the
 * same way, a business window or an intent.
 *
 * @param shown - rows as the view shows them
 * @param target - key of the row the drop landed on, null for a drop past the rows
 * @returns the new sequence of keys, or null when nothing changes or the row is not shown
 */
export function reorderActive(
    shown: ActiveIntent[],
    source: string,
    target: string | null,
    placeNextTo: (sequence: string[], source: string, target: string | null) => string[]
): string[] | null {
    const sequence = shown.map(row => row.ticket);
    if (!sequence.includes(source)) {
        return null;
    }
    const next = placeNextTo(sequence, source, target);
    return next.join('\n') === sequence.join('\n') ? null : next;
}

export interface LingerState {
    /** Rows shown now, in no particular order. */
    rows: ActiveIntent[];
    /** Key → epoch milliseconds when its marker was first found gone. */
    goneAt: Map<string, number>;
}

/**
 * Keep a row for `LINGER_MS` after its marker disappears. A window reload
 * removes the marker and writes a new one a moment later; without the delay the
 * row would blink out and back.
 *
 * @returns the rows to show and, when some row is only lingering, how many
 *          milliseconds later the caller should ask again.
 */
export function applyLinger(
    previous: LingerState,
    current: ActiveIntent[],
    now: number
): { state: LingerState; recheckIn: number | null } {
    const present = new Set(current.map(r => r.ticket));
    const rows = [...current];
    const goneAt = new Map<string, number>();
    let recheckIn: number | null = null;

    for (const row of previous.rows) {
        if (present.has(row.ticket)) {
            continue;
        }
        const since = previous.goneAt.get(row.ticket) ?? now;
        const left = since + LINGER_MS - now;
        if (left > 0) {
            rows.push(row);
            goneAt.set(row.ticket, since);
            recheckIn = recheckIn === null ? left : Math.min(recheckIn, left);
        }
    }
    return { state: { rows, goneAt }, recheckIn };
}
