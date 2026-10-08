import * as path from 'path';
import { FileSystem } from '../fs';
import { parseTicketFolderName } from '../pathUtils';

/**
 * Which ticket the «Рабочая папка» view shows: the ticket of the window, another
 * ticket of any business picked in the bin, or none.
 */
export interface ShownTicket {
    number: string;
    /** Folder of the ticket. Two folders may carry one number; the view shows this one. */
    path: string;
    /** True for the ticket the window is opened on. */
    own: boolean;
}

/** Why a ticket has a title and no rows. */
export interface Trouble {
    number: string;
    own: boolean;
    why: 'missing' | 'ambiguous' | 'unknown';
}

export interface ShownState {
    ticket: ShownTicket | null;
    trouble: Trouble | null;
}

export const NOTHING_SHOWN: ShownState = { ticket: null, trouble: null };

/** Where the ticket of the window lies, as far as the disk told. */
export type OwnPlace =
    /** The window is not opened on a ticket. */
    | { state: 'none' }
    | { state: 'found'; number: string; path: string }
    | { state: 'missing'; number: string }
    | { state: 'ambiguous'; number: string }
    /** The folders did not answer. */
    | { state: 'unknown'; number: string };

export type ShownEvent =
    /** The window started, or «обновить» was pressed. */
    | { kind: 'home'; own: OwnPlace }
    /** A business was selected: wait for an explicit choice of a ticket. */
    | { kind: 'business' }
    /** A ticket row of the bin was clicked or reached by a key. */
    | { kind: 'select'; number: string; path: string; sameBusiness: boolean; ownNumber: string | null }
    /** The shown folder is gone; `places` are the folders that carry its number now. */
    | { kind: 'gone'; places: string[]; own: OwnPlace };

export interface ShownStep {
    state: ShownState;
    /** A line to tell the user. */
    say?: string;
    /** True when another folder must be read. */
    changed: boolean;
}

function home(own: OwnPlace, before: ShownState): ShownState {
    switch (own.state) {
        case 'none': return NOTHING_SHOWN;
        case 'found': return { ticket: { number: own.number, path: own.path, own: true }, trouble: null };
        // The folders did not answer: what is shown stays, the title says why nothing new came
        case 'unknown': return { ticket: before.ticket, trouble: { number: own.number, own: true, why: 'unknown' } };
        default: return { ticket: null, trouble: { number: own.number, own: true, why: own.state } };
    }
}

const sameTicket = (a: ShownTicket | null, b: ShownTicket | null) =>
    a === b || (!!a && !!b && a.number === b.number && a.path === b.path);

export function nextShown(before: ShownState, event: ShownEvent): ShownStep {
    if (event.kind === 'home') {
        const state = home(event.own, before);
        return { state, changed: !sameTicket(before.ticket, state.ticket) || event.own.state === 'found' };
    }
    if (event.kind === 'business') {
        return { state: NOTHING_SHOWN, changed: before.ticket !== null || before.trouble !== null };
    }
    if (event.kind === 'select') {
        const ticket = { number: event.number, path: event.path, own: event.sameBusiness && event.number === event.ownNumber };
        // A click on the ticket already shown does not start its view again
        if (sameTicket(before.ticket, ticket)) {
            return { state: before, changed: false };
        }
        return { state: { ticket, trouble: null }, changed: true };
    }
    const gone = before.ticket;
    if (!gone) {
        return { state: before, changed: false };
    }
    if (event.places.length === 1) {
        // The folder moved between the shelves and the archive: the view follows it
        return { state: { ticket: { ...gone, path: event.places[0] }, trouble: null }, changed: true };
    }
    if (event.places.length > 1) {
        return { state: { ticket: null, trouble: { number: gone.number, own: gone.own, why: 'ambiguous' } }, changed: true };
    }
    if (gone.own) {
        return { state: { ticket: null, trouble: { number: gone.number, own: true, why: 'missing' } }, changed: true };
    }
    // Another ticket vanished: one return to the ticket of the window
    return {
        state: home(event.own, NOTHING_SHOWN),
        changed: true,
        say: `Папка тикета ${gone.number} не найдена — рабочая папка вернулась к тикету окна.`
    };
}

export const WORK_TITLE = 'Рабочая папка';

export type LoadState =
    | { state: 'none' }
    | { state: 'loading' }
    | { state: 'ready' }
    /** The last reading failed; the rows are the ones read before. */
    | { state: 'stale'; reason: string }
    | { state: 'error'; reason: string };

const TROUBLE_SHORT: Record<Trouble['why'], string> = {
    missing: 'папка не найдена', ambiguous: 'найдено несколько папок', unknown: 'папка не отвечает'
};

/**
 * The header of the view: the title names the shown ticket, the description
 * tells another ticket from the window's own, the message line carries what a
 * person must know when rows are missing or old.
 */
export function viewTitle(shown: ShownState, load: LoadState): { title: string; description: string; message: string | undefined } {
    const number = shown.ticket?.number ?? shown.trouble?.number;
    const other = shown.ticket ? !shown.ticket.own : shown.trouble ? !shown.trouble.own : false;
    const marks = [other ? 'другой тикет' : '', shown.trouble ? TROUBLE_SHORT[shown.trouble.why] : ''].filter(Boolean);
    let message: string | undefined;
    if (shown.trouble) {
        const n = shown.trouble.number;
        message = shown.trouble.why === 'missing' ? `Папка тикета ${n} не найдена.`
            : shown.trouble.why === 'ambiguous' ? `У тикета ${n} найдено несколько папок — выберите строку в «Корзине».`
                : `Папка тикета ${n} не отвечает.`;
    } else if (load.state === 'loading') {
        message = 'Загрузка…';
    } else if (load.state === 'stale') {
        message = `Данные не обновлены: ${load.reason}`;
    } else if (load.state === 'error') {
        message = `Папка не прочитана: ${load.reason}`;
    }
    return { title: number ? `${WORK_TITLE} ${number}` : WORK_TITLE, description: marks.join(' · '), message };
}

/** `<business>/.vscode/duet-work-order/<number>.json` — the order of a ticket's rows, next to the order of the bin. */
export function workOrderPath(businessPath: string, ticketNumber: string): string {
    return path.join(businessPath, '.vscode', 'duet-work-order', `${ticketNumber}.json`);
}

/** How deep under `archive/` a ticket is looked for — the depth the bin's reader uses. */
const ARCHIVE_DEPTH = 3;

export type TicketPlaces =
    | { state: 'found'; paths: string[] }
    /** A folder that is there could not be read: nothing can be said about the ticket. */
    | { state: 'unknown'; reason: string };

/**
 * Every folder of a business that carries the ticket number: in `work/`,
 * `backlog/` and the archive. Unlike the bin's reader it tells «no such
 * ticket» from «the folder did not answer»: the view shows these differently.
 */
export async function locateTicket(fs: FileSystem, businessPath: string, ticketNumber: string): Promise<TicketPlaces> {
    const paths: string[] = [];
    const scan = async (dir: string, depth: number): Promise<void> => {
        let names: string[];
        try {
            names = (await fs.readdir(dir, { withFileTypes: true })).filter(e => e.isDirectory()).map(e => e.name);
        } catch (error) {
            const code = (error as NodeJS.ErrnoException).code;
            if (code === 'ENOENT' || code === 'ENOTDIR') {
                return;
            }
            throw error;
        }
        for (const name of names.sort()) {
            const parsed = parseTicketFolderName(name);
            if (parsed) {
                if (parsed.number === ticketNumber) {
                    paths.push(path.join(dir, name));
                }
            } else if (depth > 1) {
                await scan(path.join(dir, name), depth - 1);
            }
        }
    };
    try {
        await scan(path.join(businessPath, 'work'), 1);
        await scan(path.join(businessPath, 'backlog'), 1);
        await scan(path.join(businessPath, 'archive'), ARCHIVE_DEPTH);
    } catch (error) {
        return { state: 'unknown', reason: error instanceof Error ? error.message : String(error) };
    }
    return { state: 'found', paths };
}

/** The folder of the window's ticket among those that carry its number: the one named as the window knows it, or the only one. */
export function chooseOwnPlace(ticketNumber: string, ticketFolder: string, places: TicketPlaces): OwnPlace {
    if (places.state === 'unknown') {
        return { state: 'unknown', number: ticketNumber };
    }
    const named = places.paths.find(p => path.basename(p) === ticketFolder);
    if (named || places.paths.length === 1) {
        return { state: 'found', number: ticketNumber, path: named ?? places.paths[0] };
    }
    return { state: places.paths.length === 0 ? 'missing' : 'ambiguous', number: ticketNumber };
}
