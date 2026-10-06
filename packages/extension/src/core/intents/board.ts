import * as path from 'path';
import { FileSystem, nodeFs } from '../fs';
import { normalizePath } from '../pathUtils';
import { BinNode, buildBinTree } from './binTree';
import { binOrderPath, readBinOrder } from './binOrder';
import { coalesce } from './coalesce';
import { SHELVES, TicketInfo, TicketReader } from './tickets';

/** What changed in the business folder, as far as the path of the event tells. */
export type DiskChange =
    /** A folder right inside `work/` or `backlog/`, or the order file: the three stamps tell whether to read. */
    | 'shelves'
    /** An `INDEX.md` of a ticket: the stamps do not see it, the folders are read. */
    | 'ticket';

/** Events of the business folder that come within this time lead to one reading. */
export const DISK_DEBOUNCE_MS = 300;

/**
 * The tickets of one business as a window knows them: what lies in `work/` and
 * `backlog/`, the remembered order, the rows built from both. The board owns
 * this state and is the only one to decide when the disk is read; the bin view
 * shows it and the commands act through it.
 *
 * The business folder is the source every window shares — agents and people
 * change it past the extension — so the signal that it changed is the file
 * events of the folder itself, told to the board by `diskChanged`. Every window
 * holds a board of its own and they agree because they read the same folder.
 *
 * The folder is on a cloud drive, so the board reads no more than it must:
 * nothing while its rows are not shown; three `stat` calls for an event about
 * the shelves, and the folders only when those differ from the last reading,
 * which is how a move made by this window is not read twice. Listeners are
 * told only when what was read differs from what they have.
 */
export class TicketBoard {
    private readonly fs: FileSystem;
    private businessPath: string | null = null;
    /** Null until the business folders have been read. */
    private tickets: TicketInfo[] | null = null;
    private order: string[] = [];
    private orderKnown = false;
    private tree: BinNode[] = [];
    /** The shelves and the order file as they were at the last reading. */
    private stamp: string | null = null;
    private face = '';
    private shown = false;
    private pending: DiskChange | null = null;
    private timer: ReturnType<typeof setTimeout> | undefined;
    private readonly listeners = new Set<() => void>();
    private readonly read = coalesce(() => this.readOnce());

    constructor(private readonly reader: TicketReader, fileSystem?: FileSystem) {
        this.fs = fileSystem ?? nodeFs;
    }

    /** Called when the tickets, the order or the business changed. */
    onDidChange(listener: () => void): { dispose: () => void } {
        this.listeners.add(listener);
        return { dispose: () => { this.listeners.delete(listener); } };
    }

    dispose(): void {
        clearTimeout(this.timer);
        this.listeners.clear();
    }

    getBusinessPath(): string | null {
        return this.businessPath;
    }

    /** Null until the business folders have been read. */
    getTickets(): TicketInfo[] | null {
        return this.tickets;
    }

    getTree(): BinNode[] {
        return this.tree;
    }

    getOrder(): string[] {
        return this.order;
    }

    /**
     * False when the order file was there at the last reading but could not be
     * read: the order in memory is then an older one and must not be written
     * over the file.
     */
    isOrderKnown(): boolean {
        return this.orderKnown;
    }

    /** Whose tickets the board holds. Another business drops everything that was read. */
    setBusiness(businessPath: string | null): void {
        if (key(businessPath) === key(this.businessPath)) {
            return;
        }
        this.businessPath = businessPath;
        this.forget();
        this.tell();
        if (this.shown) {
            void this.read();
        }
    }

    /**
     * The rows are shown or hidden. Showing them reads the folders; while they
     * are hidden the events of the business folder cost nothing.
     */
    setShown(shown: boolean): Promise<void> {
        this.shown = shown;
        if (!shown) {
            clearTimeout(this.timer);
            this.pending = null;
            return Promise.resolve();
        }
        return this.read();
    }

    /** Read the business folders and the order now. */
    reload(): Promise<void> {
        return this.read();
    }

    /**
     * Something changed in the business folder. Events are gathered into one
     * answer; the kind of a file event is not looked at — a file written again
     * may come as a rename — only where it happened.
     */
    diskChanged(change: DiskChange): void {
        if (!this.shown || !this.businessPath) {
            return;
        }
        if (this.pending !== 'ticket') {
            this.pending = change;
        }
        clearTimeout(this.timer);
        this.timer = setTimeout(() => {
            const pending = this.pending;
            this.pending = null;
            void (pending === 'ticket' ? this.read() : this.check());
        }, DISK_DEBOUNCE_MS);
    }

    /**
     * Read the folders when the shelves or the order file are not what they
     * were at the last reading: three `stat` calls when nothing changed.
     */
    async check(): Promise<void> {
        const businessPath = this.businessPath;
        if (!this.shown || !businessPath) {
            return;
        }
        if (await this.readStamp(businessPath) !== this.stamp) {
            await this.read();
        }
    }

    private async readOnce(): Promise<void> {
        const businessPath = this.businessPath;
        if (!businessPath) {
            return;
        }
        // Taken before the reading: a change that comes while it runs leaves the stamp behind, never ahead
        const stamp = await this.readStamp(businessPath);
        const [tickets, order] = await Promise.all([
            this.reader.readShelves(businessPath),
            readBinOrder(businessPath, this.fs)
        ]);
        // The business changed while the folders were being read
        if (key(this.businessPath) !== key(businessPath)) {
            return;
        }
        this.stamp = stamp;
        this.orderKnown = order !== null;
        // An unreadable order file leaves the last order that was read well
        const nextOrder = order ?? this.order;
        const face = JSON.stringify([tickets, nextOrder]);
        if (this.tickets !== null && face === this.face) {
            return;
        }
        this.tickets = tickets;
        this.order = nextOrder;
        this.tree = buildBinTree(tickets, nextOrder);
        this.face = face;
        this.tell();
    }

    /** Modification times of `work/`, `backlog/` and the order file: they change when a ticket comes, goes or the order is written. */
    private async readStamp(businessPath: string): Promise<string> {
        const targets = [...SHELVES.map(shelf => path.join(businessPath, shelf)), binOrderPath(businessPath)];
        const parts = await Promise.all(targets.map(async target => {
            try {
                const stat = await this.fs.stat(target);
                return `${stat.mtimeMs}:${stat.size}`;
            } catch {
                return '-';
            }
        }));
        return parts.join('|');
    }

    private forget(): void {
        clearTimeout(this.timer);
        this.pending = null;
        this.tickets = null;
        this.order = [];
        this.orderKnown = false;
        this.tree = [];
        this.stamp = null;
        this.face = '';
    }

    private tell(): void {
        for (const listener of [...this.listeners]) {
            listener();
        }
    }
}

function key(businessPath: string | null): string | null {
    return businessPath ? normalizePath(businessPath) : null;
}
