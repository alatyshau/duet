import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { Paths } from '../../core/paths';
import { normalizePath } from '../../core/pathUtils';
import { MarkerStore, RESERVATION_MS, TicketLocation, WindowMarker, occupiedColors } from '../../core/intents/markers';
import { ActiveIntent, LingerState, activeFromMarkers, applyLinger, orderActive } from '../../core/intents/active';
import { businessKey, businessWindowOf, intentWindowOf, programFolderName } from '../../core/intents/window';
import { TicketPlace, TicketReader, readBusinessManifest, withTimeout } from '../../core/intents/tickets';
import { mergeOrderBlock } from '../../core/intents/order';

/** What this window is opened on, when Duet opened it. */
export interface OwnWindow {
    subject: 'intent' | 'business';
    /** Key among the markers: the ticket number, or `@name` for a business window. */
    key: string;
    /** Ticket folder name; empty for a business window. */
    ticketFolder: string;
    /** Business name as the path spells it — used until the manifest is read. */
    businessDir: string;
    /** Business folder — the first folder of the window. */
    businessPath: string;
    /** What opening again brings this window forward: its workspace file, or the folder of a business opened as a folder. */
    workspaceFile: string;
}

type MarkerFields = Omit<WindowMarker, 'pid' | 'writtenAt' | 'expiresAt'>;

/** Events of the markers folder are gathered into one re-read. */
const REFRESH_DEBOUNCE_MS = 100;
/** Longest wait for the business folder before the marker is written without what it would tell. */
const ANNOUNCE_READ_MS = 1000;

/**
 * What a window knows about the windows Duet opened in its program: its own
 * marker, the markers of the others, the remembered order of active intents.
 *
 * Needs only the DuetData path — no backend — so the «Активная Работа» view works while
 * the backend is down.
 */
export class IntentsRuntime implements vscode.Disposable {
    readonly store: MarkerStore;
    readonly tickets = new TicketReader();

    private ownWindow: OwnWindow | null;
    /** The only folder of a window that has no workspace file: it may turn out to be a business folder. */
    private readonly plainFolder: string | null;
    private ownMarker: WindowMarker | null = null;
    private live: WindowMarker[] = [];
    private active: ActiveIntent[] = [];
    private linger: LingerState = { rows: [], goneAt: new Map() };

    private refreshTimer: ReturnType<typeof setTimeout> | undefined;
    private recheckTimer: ReturnType<typeof setTimeout> | undefined;
    private refreshing: Promise<void> | null = null;
    private refreshAgain = false;

    private readonly emitter = new vscode.EventEmitter<void>();
    /** Fires when the list of active windows may have changed. */
    readonly onDidChange = this.emitter.event;
    private readonly disposables: vscode.Disposable[] = [this.emitter];

    constructor(paths: Paths) {
        this.store = new MarkerStore(paths.intentsProgramPath(programFolderName(vscode.env.uriScheme)));

        const file = vscode.workspace.workspaceFile;
        const filePath = file?.scheme === 'file' ? file.fsPath : undefined;
        const first = vscode.workspace.workspaceFolders?.[0]?.uri;
        const firstPath = first?.scheme === 'file' ? first.fsPath : undefined;

        const intent = intentWindowOf(filePath, paths.workspacesPath);
        const business = intent ? null : businessWindowOf(filePath, paths.workspacesPath);
        if (intent && filePath && firstPath) {
            this.ownWindow = {
                subject: 'intent', key: intent.ticket, ticketFolder: intent.ticketFolder,
                businessDir: intent.businessDir, businessPath: firstPath, workspaceFile: filePath
            };
        } else if (business && filePath && firstPath) {
            this.ownWindow = {
                subject: 'business', key: businessKey(business), ticketFolder: '',
                businessDir: business, businessPath: firstPath, workspaceFile: filePath
            };
        } else {
            this.ownWindow = null;
        }
        this.plainFolder = !file && firstPath ? firstPath : null;
    }

    /** Null when Duet did not open this window: it is neither an intent window nor a business window. */
    get own(): OwnWindow | null {
        return this.ownWindow;
    }

    /**
     * Write this window's marker. The first thing activation does: a window
     * that started while the backend was down must not look closed, or its
     * workspace file would be rewritten under it.
     */
    async announce(): Promise<void> {
        try {
            if (!this.ownWindow && this.plainFolder) {
                // A business without repos is opened as a plain folder; its manifest tells it is one
                const manifest = await withTimeout(readBusinessManifest(this.plainFolder), ANNOUNCE_READ_MS);
                if (manifest.name) {
                    this.ownWindow = {
                        subject: 'business', key: businessKey(manifest.name), ticketFolder: '',
                        businessDir: manifest.name, businessPath: this.plainFolder, workspaceFile: this.plainFolder
                    };
                }
            }
            if (this.ownWindow) {
                this.ownMarker = await this.store.write(await this.ownFields());
            }
        } catch (error) {
            console.error('[Duet] window marker not written:', error);
        }
    }

    /** Start watching the markers of the program and read them once. */
    async watch(): Promise<void> {
        try {
            // The folder must exist before the watcher is put on it
            await this.store.ensureDirs();
            // Markers lie in the `windows/` subfolder; a plain `*.json` would not see them
            const watcher = vscode.workspace.createFileSystemWatcher(
                new vscode.RelativePattern(vscode.Uri.file(this.store.programDir), '**/*.json')
            );
            const changed = () => this.scheduleRefresh();
            this.disposables.push(
                watcher,
                watcher.onDidCreate(changed),
                watcher.onDidChange(changed),
                watcher.onDidDelete(changed)
            );
        } catch (error) {
            console.error('[Duet] intents folder not watched:', error);
        }

        this.disposables.push(
            // A marker removed from outside is put back when the window is next used
            vscode.window.onDidChangeWindowState(state => {
                if (state.focused) {
                    void this.reannounce();
                }
            }),
            // The colour in the marker is the colour in force, not the one once chosen
            vscode.workspace.onDidChangeConfiguration(event => {
                if (event.affectsConfiguration('workbench.colorCustomizations')) {
                    void this.reannounce();
                }
            })
        );
        await this.refresh();
    }

    /** Active windows of the program: businesses first, then intents in the remembered order. */
    getActive(): ActiveIntent[] {
        return this.active;
    }

    isOpen(key: string): boolean {
        return this.active.some(row => row.ticket === key);
    }

    /** True when the window that asks is the one opened on the key — the row the red dot stands at. */
    isOwn(key: string): boolean {
        return this.active.some(row => row.own && row.ticket === key);
    }

    /**
     * True when a window of this program was opened by this workspace file. Asked
     * before the file is written: a business may also be open as a plain folder,
     * under the same key, and that window does not hold the file.
     */
    hasFileOpen(workspaceFile: string): boolean {
        const wanted = normalizePath(workspaceFile);
        return this.live.some(marker => marker.kind === 'window' && normalizePath(marker.workspaceFile) === wanted);
    }

    /** Colour in force in the window of a key; null when no window holds the key or it has no colour. */
    colorOf(key: string): string | null {
        return this.active.find(row => row.ticket === key)?.color ?? null;
    }

    /** Colours held by the open windows of the program, except those of `exceptKey`. */
    occupiedColors(exceptKey: string): string[] {
        return occupiedColors(this.live, exceptKey);
    }

    /** Re-read the markers and the order from disk. Calls that overlap are joined into one more read. */
    refresh(): Promise<void> {
        if (this.refreshing) {
            this.refreshAgain = true;
            return this.refreshing;
        }
        this.refreshing = (async () => {
            try {
                do {
                    this.refreshAgain = false;
                    await this.readOnce();
                } while (this.refreshAgain);
            } finally {
                this.refreshing = null;
            }
        })();
        return this.refreshing;
    }

    /**
     * Hold a key and its colour while its window is being opened. Without it
     * the window looks closed, and its colour free, between the click and the
     * start of the new window.
     */
    async reserve(fields: Omit<MarkerFields, 'kind'>): Promise<void> {
        try {
            const reservation = await this.store.write({ ...fields, kind: 'reservation' });
            const timer = setTimeout(() => void this.store.remove(reservation), RESERVATION_MS + 500);
            this.disposables.push({ dispose: () => clearTimeout(timer) });
            await this.refresh();
        } catch (error) {
            console.error('[Duet] reservation not written:', error);
        }
    }

    /** Remember the shown order of active intents after a drag. The same for every window of the program. */
    async saveActiveOrder(shown: string[]): Promise<void> {
        await this.store.writeOrder(mergeOrderBlock(await this.store.readOrder(), shown));
        await this.refresh();
    }

    /** Folder of this window's ticket wherever it lies now; null when the ticket is gone or the window is not an intent window. */
    async ownTicketPlace(): Promise<{ path: string; folder: string } | null> {
        const own = this.ownWindow;
        if (!own || own.subject !== 'intent') {
            return null;
        }
        const places = await this.tickets.locate(own.businessPath, own.key);
        const place = pickOwnPlace(places, own.ticketFolder);
        if (place) {
            return place;
        }
        const archived = await this.tickets.findInArchive(own.businessPath, own.key);
        return archived ? { path: archived, folder: path.basename(archived) } : null;
    }

    /**
     * Remove this window's marker. Synchronous on purpose: the extension host
     * is shut down right after `deactivate`, and an async unlink may not finish.
     */
    removeOwnMarkerSync(): void {
        if (!this.ownMarker) {
            return;
        }
        try {
            fs.unlinkSync(this.store.pathOf(this.ownMarker));
        } catch {
            // already gone
        }
        this.ownMarker = null;
    }

    dispose(): void {
        clearTimeout(this.refreshTimer);
        clearTimeout(this.recheckTimer);
        this.disposables.forEach(d => d.dispose());
    }

    private scheduleRefresh(): void {
        clearTimeout(this.refreshTimer);
        this.refreshTimer = setTimeout(() => void this.refresh(), REFRESH_DEBOUNCE_MS);
    }

    private async readOnce(): Promise<void> {
        const live = await this.store.read();
        const order = await this.store.readOrder();
        const now = Date.now();
        const { state, recheckIn } = applyLinger(this.linger, activeFromMarkers(live, this.store.pid), now);

        this.live = live;
        this.linger = state;
        this.active = orderActive(state.rows, order);

        // Ask again when a lingering row is due to go or a reservation is due to end
        const ends = live
            .filter(m => m.kind === 'reservation' && m.expiresAt !== undefined)
            .map(m => (m.expiresAt as number) - now + 50);
        const next = Math.min(...(recheckIn === null ? [] : [recheckIn]), ...ends);
        clearTimeout(this.recheckTimer);
        if (Number.isFinite(next)) {
            this.recheckTimer = setTimeout(() => void this.refresh(), Math.max(next, 50));
        }
        this.emitter.fire();
    }

    /** Check this window's marker and write it again when it is gone or no longer true. */
    private async reannounce(): Promise<void> {
        if (!this.ownWindow) {
            return;
        }
        try {
            const fields = await this.ownFields();
            const current = this.ownMarker;
            const same = current !== null
                && current.location === fields.location
                && current.color === fields.color
                && current.icon === fields.icon
                && current.ticketIcon === fields.ticketIcon
                && current.business === fields.business
                && await this.store.exists(current);
            if (!same) {
                this.ownMarker = await this.store.write(fields);
            }
        } catch (error) {
            console.error('[Duet] window marker not restored:', error);
        }
    }

    private async ownFields(): Promise<MarkerFields> {
        const own = this.ownWindow as OwnWindow;
        let business = own.businessDir;
        let icon = '';
        let ticketIcon = '';
        let location: TicketLocation = 'missing';
        try {
            // The business folder is on a cloud drive and may hang; the marker does not wait for it
            await withTimeout((async () => {
                const manifest = await readBusinessManifest(own.businessPath);
                business = manifest.name ?? business;
                icon = manifest.icon;
                if (own.subject !== 'intent') {
                    return;
                }
                const place = pickOwnPlace(await this.tickets.locate(own.businessPath, own.key), own.ticketFolder);
                if (place) {
                    location = place.shelf;
                    ticketIcon = await this.tickets.inheritedIcon(own.businessPath, place.path);
                    return;
                }
                const archived = await this.tickets.findInArchive(own.businessPath, own.key);
                if (archived) {
                    location = 'archive';
                    ticketIcon = await this.tickets.inheritedIcon(own.businessPath, archived);
                }
            })(), ANNOUNCE_READ_MS);
        } catch {
            // written with what is known; the next focus fills in the rest
        }
        return {
            kind: 'window',
            subject: own.subject,
            ticket: own.key,
            ticketFolder: own.ticketFolder,
            business,
            businessPath: own.businessPath,
            icon,
            ticketIcon,
            workspaceFile: own.workspaceFile,
            location,
            color: currentWindowColor()
        };
    }
}

/** The folder the window was opened for when it is still there, else the one in work, else any. */
function pickOwnPlace(places: TicketPlace[], ticketFolder: string): TicketPlace | null {
    return places.find(p => p.folder === ticketFolder)
        ?? places.find(p => p.shelf === 'work')
        ?? places[0]
        ?? null;
}

/** Colour of the window's title bar in force now; null when the window has none. */
function currentWindowColor(): string | null {
    const colors = vscode.workspace.getConfiguration('workbench').get<Record<string, unknown>>('colorCustomizations');
    const color = colors?.['titleBar.activeBackground'];
    return typeof color === 'string' ? color : null;
}
