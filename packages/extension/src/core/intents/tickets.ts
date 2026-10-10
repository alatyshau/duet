import * as path from 'path';
import { FileSystem, FileStat, nodeFs } from '../fs';
import { parseTicketFolderName } from '../pathUtils';
import { spaceIntentName } from './naming';

/**
 * Tickets of a business as they lie on disk: folders right inside `work/` and
 * `backlog/` whose name fits the ticket-number rule. Everything else in those
 * folders is not shown. The archive is read only to find one ticket by number.
 * This module only reads: tickets are created and moved by the Duet server,
 * see `ticketService.ts`.
 */

/** The two folders whose tickets the bin shows. */
export type Shelf = 'work' | 'backlog';
export const SHELVES: readonly Shelf[] = ['work', 'backlog'];

export interface TicketInfo {
    /** Ticket number: `DUE017`. */
    number: string;
    /** Folder name: `DUE017_IntentSwitcher`. */
    folder: string;
    /** Readable name: `Intent Switcher`. */
    name: string;
    /** Absolute path of the folder. */
    path: string;
    shelf: Shelf;
    /** `work-type` of the ticket's `INDEX.md`, lower case; null when absent or unreadable. */
    workType: string | null;
    /** `process-type` from INDEX.md; null when absent. */
    processType: string | null;
    /** Number of the parent ticket from `parent`; null when the ticket has none. */
    parent: string | null;
    /** Emoji of the ticket from `icon`; empty when it has none. */
    icon: string;
}

export interface TicketFrontmatter {
    parent: string | null;
    workType: string | null;
    /** `process-type` from INDEX.md; null when absent. */
    processType: string | null;
    icon: string;
}

export interface TicketPlace {
    shelf: Shelf;
    folder: string;
    path: string;
}

/** Only the start of `INDEX.md` is read: the frontmatter is there. */
export const INDEX_HEAD_BYTES = 2048;
/** Longest `parent` chain followed in search of an icon. */
const MAX_PARENT_CHAIN = 16;
/** How deep below `archive/` a ticket is looked for: `archive/2026/09/<ticket>`. */
const ARCHIVE_DEPTH = 3;

/**
 * Read `parent`, `work-type` and `icon` from the frontmatter at the start of a
 * ticket's `INDEX.md`. An empty value and `null` both mean "no parent" and "no
 * icon". A parent written as a folder name or an alpha path is reduced to its
 * ticket number.
 */
export function parseTicketFrontmatter(head: string): TicketFrontmatter {
    const result: TicketFrontmatter = { parent: null, workType: null, processType: null, icon: '' };
    const lines = head.replace(/^﻿/, '').split(/\r?\n/);
    if (lines[0] !== '---') {
        return result;
    }
    for (let i = 1; i < lines.length && lines[i] !== '---'; i++) {
        const match = /^(parent|work-type|process-type|icon)\s*:(.*)$/.exec(lines[i]);
        if (!match) {
            continue;
        }
        const value = cleanValue(match[2]);
        if (match[1] === 'work-type') {
            result.workType = value ? value.toLowerCase() : null;
        } else if (match[1] === 'process-type') {
            result.processType = value ? value.toLowerCase() : null;
        } else if (match[1] === 'icon') {
            result.icon = value ?? '';
        } else {
            result.parent = value ? (parseTicketFolderName(value.replace(/^@/, ''))?.number ?? value) : null;
        }
    }
    return result;
}

function cleanValue(raw: string): string | null {
    // Trimmed first, so that a value which itself starts with `#` (the emoji #️⃣) is not taken for a comment
    const value = raw.trim().replace(/\s+#.*$/, '').trim().replace(/^(["'`])(.*)\1$/, '$2').trim();
    return value === '' || value === 'null' || value === '~' ? null : value;
}

/**
 * Reads ticket folders of a business. The frontmatter of every `INDEX.md` is
 * remembered by the file's modification time and size, so a second reading of
 * unchanged tickets costs a `stat` each and no file content.
 */
export class TicketReader {
    private readonly fs: FileSystem;
    private readonly cache = new Map<string, { mtimeMs: number; size: number; front: TicketFrontmatter; complete: boolean }>();

    /** @param timeoutMs - longest wait for one `INDEX.md`; a file on a cloud drive may hang */
    constructor(fileSystem?: FileSystem, private readonly timeoutMs: number = 2000) {
        this.fs = fileSystem ?? nodeFs;
    }

    /** Emoji of one ticket, from the `icon` of its `INDEX.md`; empty when it has none or the file cannot be read. */
    async ticketIcon(ticketPath: string): Promise<string> {
        return (await this.frontmatterOf(path.join(ticketPath, 'INDEX.md'))).icon;
    }

    /**
     * Emoji a ticket shows in the «Активная Работа» view: its own `icon`, else the icon
     * of its parent ticket, and so on up the `parent` chain to the nearest
     * ticket that has one — the same chain the bin follows to find a ticket's
     * program. Icons are given to programs, and windows are opened on their
     * projects; without this every such row would carry the emoji of the
     * business. Empty when no ticket of the chain has an icon — the caller
     * then falls back on the business.
     */
    async inheritedIcon(businessPath: string, ticketPath: string): Promise<string> {
        const seen = new Set<string>();
        let current: string | null = ticketPath;
        while (current) {
            const front = await this.frontmatterOf(path.join(current, 'INDEX.md'));
            if (front.icon) {
                return front.icon;
            }
            // A loop in the chain, or a chain far longer than any real one, ends the search
            if (!front.parent || seen.has(front.parent) || seen.size >= MAX_PARENT_CHAIN) {
                return '';
            }
            seen.add(front.parent);
            const places = await this.locate(businessPath, front.parent);
            current = (places.find(place => place.shelf === 'work') ?? places[0])?.path
                ?? await this.findInArchive(businessPath, front.parent);
        }
        return '';
    }

    /** All tickets of `work/` and `backlog/`. A ticket with an unreadable `INDEX.md` has no parent, type or icon. */
    async readShelves(businessPath: string): Promise<TicketInfo[]> {
        const places = (await Promise.all(SHELVES.map(shelf => this.listShelf(businessPath, shelf)))).flat();
        return Promise.all(places.map(async (place): Promise<TicketInfo> => {
            const parsed = parseTicketFolderName(place.folder)!;
            const front = await this.frontmatterOf(path.join(place.path, 'INDEX.md'));
            return {
                number: parsed.number,
                folder: place.folder,
                name: spaceIntentName(parsed.rest),
                path: place.path,
                shelf: place.shelf,
                workType: front.workType,
                processType: front.processType,
                parent: front.parent,
                icon: front.icon
            };
        }));
    }

    /** Search cannot silently treat unreadable shelves or headers as "no curator". */
    async findCurator(businessPath: string): Promise<TicketInfo | null> {
        const places = (await Promise.all(SHELVES.map(async shelf =>
            (await withTimeout(this.subfoldersOrThrow(path.join(businessPath, shelf)), this.timeoutMs))
                .filter(folder => parseTicketFolderName(folder) !== null)
                .map(folder => ({ shelf, folder, path: path.join(businessPath, shelf, folder) }))
        ))).flat();
        const tickets = await Promise.all(places.map(async place => {
            const parsed = parseTicketFolderName(place.folder)!;
            const front = await this.checkedFrontmatter(path.join(place.path, 'INDEX.md'));
            return { ...place, number: parsed.number, name: spaceIntentName(parsed.rest), ...front };
        }));
        return pickCurator(tickets);
    }

    /** Revalidate the criterion on the resolved folder before opening it. */
    async isCuratorAt(ticketPath: string): Promise<boolean> {
        return isCurator(await this.checkedFrontmatter(path.join(ticketPath, 'INDEX.md')));
    }

    private async checkedFrontmatter(indexPath: string): Promise<TicketFrontmatter> {
        try {
            return await withTimeout(this.readFrontmatter(indexPath, true), this.timeoutMs);
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
                return { parent: null, workType: null, processType: null, icon: '' };
            }
            throw new Error(`Не удалось проверить Куратора: ${indexPath}: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /** Ticket folders of one shelf; an absent shelf folder is an empty shelf. */
    async listShelf(businessPath: string, shelf: Shelf): Promise<TicketPlace[]> {
        const dir = path.join(businessPath, shelf);
        return (await this.subfolders(dir))
            .filter(name => parseTicketFolderName(name) !== null)
            .sort()
            .map(folder => ({ shelf, folder, path: path.join(dir, folder) }));
    }

    /** Every folder of `work/` and `backlog/` that carries the number — normally one, two after a half-done move. */
    async locate(businessPath: string, number: string): Promise<TicketPlace[]> {
        const places = (await Promise.all(SHELVES.map(shelf => this.listShelf(businessPath, shelf)))).flat();
        return places.filter(place => parseTicketFolderName(place.folder)?.number === number);
    }

    /** Path of the ticket inside `archive/`, at any grouping depth down to `archive/a/b/<ticket>`; null when not there. */
    async findInArchive(businessPath: string, number: string): Promise<string | null> {
        const search = async (dir: string, depth: number): Promise<string | null> => {
            const names = await this.subfolders(dir);
            const hit = names.find(name => parseTicketFolderName(name)?.number === number);
            if (hit) {
                return path.join(dir, hit);
            }
            if (depth >= ARCHIVE_DEPTH) {
                return null;
            }
            for (const name of names) {
                // A ticket folder is a leaf of the grouping: tickets do not nest in the archive
                if (parseTicketFolderName(name) !== null) {
                    continue;
                }
                const found = await search(path.join(dir, name), depth + 1);
                if (found) {
                    return found;
                }
            }
            return null;
        };
        return search(path.join(businessPath, 'archive'), 1);
    }

    /** Subfolders of `dir`; an absent folder has none, any other failure to read it is thrown. */
    private async subfoldersOrThrow(dir: string): Promise<string[]> {
        try {
            const entries = await this.fs.readdir(dir, { withFileTypes: true });
            return entries.filter(e => e.isDirectory()).map(e => e.name);
        } catch (error) {
            const code = (error as NodeJS.ErrnoException).code;
            if (code === 'ENOENT' || code === 'ENOTDIR') {
                return [];
            }
            throw new Error(`папка ${dir} не читается: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    private async subfolders(dir: string): Promise<string[]> {
        try {
            const entries = await this.fs.readdir(dir, { withFileTypes: true });
            return entries.filter(e => e.isDirectory()).map(e => e.name);
        } catch {
            return [];
        }
    }

    private async frontmatterOf(indexPath: string): Promise<TicketFrontmatter> {
        try {
            return await withTimeout(this.readFrontmatter(indexPath), this.timeoutMs);
        } catch {
            return { parent: null, workType: null, processType: null, icon: '' };
        }
    }

    private async readFrontmatter(indexPath: string, strict = false): Promise<TicketFrontmatter> {
        const stat: FileStat = await this.fs.stat(indexPath);
        const cached = this.cache.get(indexPath);
        if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
            if (strict && !cached.complete) {
                throw new Error('шапка INDEX.md не завершена в прочитанном фрагменте');
            }
            return cached.front;
        }
        const head = await this.fs.readHead(indexPath, INDEX_HEAD_BYTES);
        const lines = head.replace(/^﻿/, '').split(/\r?\n/);
        const complete = lines[0] !== '---' || lines.slice(1).includes('---');
        const front = parseTicketFrontmatter(head);
        this.cache.set(indexPath, { mtimeMs: stat.mtimeMs, size: stat.size, front, complete });
        if (strict && !complete) {
            throw new Error('шапка INDEX.md не завершена в прочитанном фрагменте');
        }
        return front;
    }
}

export function isCurator(ticket: Pick<TicketFrontmatter, 'workType' | 'processType'>): boolean {
    return ticket.workType === 'process' && ticket.processType === 'curator';
}

/** Canonical ticket numbers have fixed-width suffixes; choose independently of display order. */
export function pickCurator(tickets: readonly TicketInfo[]): TicketInfo | null {
    return tickets.filter(isCurator).sort((a, b) => a.number < b.number ? -1 : a.number > b.number ? 1 : 0)[0] ?? null;
}

/** Reject with a timeout error when `promise` has not settled within `ms` milliseconds. */
export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('timeout')), ms);
        promise.then(
            value => { clearTimeout(timer); resolve(value); },
            error => { clearTimeout(timer); reject(error); }
        );
    });
}

/** Where a ticket shown in a view lies at this moment. */
export type TicketNow =
    /** The same folder on the same shelf. */
    | { state: 'here'; place: TicketPlace }
    /** The number is found in one other place: the ticket was moved or renamed. */
    | { state: 'moved'; place: TicketPlace }
    /** Several folders carry the number and none is the row's own. */
    | { state: 'ambiguous' }
    /** The number is neither in work nor in the backlog. */
    | { state: 'gone' };

/**
 * Find a ticket on disk by its number before acting on a row. A view is a
 * snapshot; the folder may have been moved since — by an agent, by another
 * window, by cloud sync — and no action may run on a stale path.
 */
export async function resolveTicketNow(
    reader: TicketReader,
    businessPath: string,
    row: Pick<TicketInfo, 'number' | 'folder' | 'shelf'>
): Promise<TicketNow> {
    const places = await reader.locate(businessPath, row.number);
    const own = places.find(p => p.shelf === row.shelf && p.folder === row.folder);
    if (own) {
        return { state: 'here', place: own };
    }
    if (places.length === 1) {
        return { state: 'moved', place: places[0] };
    }
    return places.length === 0 ? { state: 'gone' } : { state: 'ambiguous' };
}

/** What `context.json` of a business says about its name, emoji and ticket code. */
export interface BusinessManifest {
    /** `name` of the manifest; null when the folder has no manifest Duet would register. */
    name: string | null;
    /** Emoji from `icon`; empty when the manifest has none — the Backend's default icons are not used here. */
    icon: string;
    /** Three capital letters from `ticket_code`: `DUE`. Null when the manifest declares none. */
    ticketCode: string | null;
}

/**
 * Read the name, the emoji and the ticket code of a business straight from its `context.json`.
 * An intent window needs them before the Backend answers, and the Backend puts
 * a default icon where the manifest has none — the intent rule is "no icon, no emoji".
 */
export async function readBusinessManifest(businessPath: string, fileSystem?: FileSystem): Promise<BusinessManifest> {
    const fs = fileSystem ?? nodeFs;
    try {
        const data: unknown = JSON.parse(await fs.readFile(path.join(businessPath, 'context.json'), 'utf8'));
        if (typeof data === 'object' && data !== null && !Array.isArray(data)) {
            const manifest = data as Record<string, unknown>;
            return {
                // A manifest Duet registers carries a numeric `version`; another tool's `context.json` is not a business
                name: typeof manifest.version === 'number' && typeof manifest.name === 'string' && manifest.name.trim()
                    ? manifest.name
                    : null,
                icon: typeof manifest.icon === 'string' ? manifest.icon.trim() : '',
                ticketCode: typeof manifest.ticket_code === 'string' && /^[A-Z]{3}$/.test(manifest.ticket_code.trim())
                    ? manifest.ticket_code.trim()
                    : null
            };
        }
    } catch {
        // no manifest or not JSON
    }
    return { name: null, icon: '', ticketCode: null };
}
