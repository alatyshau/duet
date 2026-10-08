import * as fsSync from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { FileSystem, nodeFs } from '../../core/fs';
import { ContextKeys, PlusDepth, availability } from '../../core/folderView/availability';
import { folderLabel } from '../../core/folderView/drop';
import { FilterInput, composeIgnore } from '../../core/folderView/filter';
import { compileExclude } from '../../core/folderView/glob';
import { NameVerdict, ROOT, System, compareDefault, joinRel, nameKey, parentOf } from '../../core/folderView/names';
import { OrderOp, OrderRead, changeOrder, orderLock, readOrder } from '../../core/folderView/order';
import { FileRow, Row, isFileRow, rowKey } from '../../core/folderView/rows';
import {
    Snapshot, SnapshotFs, SnapshotOptions, entriesOf, entryAt, foldersToReread, readSnapshot, rereadFolders
} from '../../core/folderView/snapshot';
import { coalesce } from '../../core/intents/coalesce';
import { BinNode } from '../../core/intents/binTree';
import { programFolderName } from '../../core/intents/window';
import { Paths } from '../../core/paths';
import { normalizePath } from '../../core/pathUtils';
import { WorkDisk } from '../../core/work/disk';
import {
    LoadState, NOTHING_SHOWN, OwnPlace, ShownState, ShownTicket, chooseOwnPlace, locateTicket, nextShown, viewTitle,
    workOrderPath
} from '../../core/work/shown';
import { PINNED_FILES, TreeAction, WorkTree } from '../../core/work/tree';
import {
    WindowView, parseTicketView, parseWindowView, serializeTicketView, serializeWindowView
} from '../../core/work/viewFiles';
import { IntentsRuntime } from '../intents/IntentsRuntime';
import { inform, messageOf, say } from '../notify';
import { nodeSnapshotFs, vscodeDisk } from './workDisk';

export const WORK_VIEW_ID = 'duet.work';
const WORK_MIME = 'application/vnd.code.tree.duet.work';
/** Accepted only so that a row of the bin dropped here gets its line of refusal. */
const BIN_MIME = 'application/vnd.code.tree.duet.bin';

/** Tree refreshes that come within this time are sent as one — the rule of the bin. */
const REDRAW_DEBOUNCE_MS = 25;
/** File events are answered this long after the first one; the count is not restarted, or an agent that keeps writing would hold the tree back for good. */
const DISK_EVENTS_MS = 250;
/** What is expanded is written this long after the last change. */
const VIEW_WRITE_MS = 500;
/** Events of one recursive gesture of the platform come within this time. */
const GESTURE_MS = 50;
/** How long one folder may take to answer. */
const READ_TIMEOUT_MS = 1000;
const WINDOW_STATE_KEY = 'duet.work.window';
const FOREIGN_DROP = 'Рабочая папка принимает только свои строки и файлы из системы.';
const TWO_FOLDERS = 'у номера тикета две папки';

/** The files a tab shows: one for an editor, both sides for a comparison. */
function tabFiles(input: unknown): vscode.Uri[] {
    if (input instanceof vscode.TabInputText || input instanceof vscode.TabInputCustom || input instanceof vscode.TabInputNotebook) {
        return [input.uri];
    }
    if (input instanceof vscode.TabInputTextDiff || input instanceof vscode.TabInputNotebookDiff) {
        return [input.original, input.modified];
    }
    return [];
}

const SEVERITY: Record<NameVerdict['severity'], vscode.InputBoxValidationSeverity> = {
    error: vscode.InputBoxValidationSeverity?.Error,
    warning: vscode.InputBoxValidationSeverity?.Warning,
    info: vscode.InputBoxValidationSeverity?.Info
};

export interface WorkDeps {
    disk: WorkDisk;
    snapshotFs: SnapshotFs;
    fs: FileSystem;
}

/** What a file operation works through: the ticket it began in, whatever is shown by the time it ends. */
export interface Operation {
    /** Disk path of a row of the ticket the operation began in. */
    abs(rel: string): string;
    /** False once another ticket was shown: the operation finishes what it holds and leaves the tree alone. */
    alive(): boolean;
    /**
     * Write a change of the order of the ticket the operation began in — into
     * that ticket's file, whatever ticket is shown by then. False when it was
     * refused; the reason is said through `fail`.
     */
    writeOrder(ops: readonly OrderOp[], fail: (why: string) => string): Promise<boolean>;
    say(line: string): void;
    inform(line: string): void;
}

/** What the view asks of the code that carries out a drop. */
export interface DropHandler {
    /** A drop of the view's own rows; resolves to the folder the rows ended in, or null when nothing was done. */
    drop(paths: string[], target: Row | undefined): Promise<string | null>;
    /** Files dropped from the system. */
    importFiles(sources: vscode.Uri[], target: Row | undefined): Promise<void>;
}

/**
 * «Рабочая папка» view — the files of one ticket, as Explorer shows the folder
 * of a project: the ticket of the window by default, or another ticket of
 * any business picked in the bin. The rows stand in the order a person gave
 * them, what is expanded is remembered per ticket, files are hidden as
 * Explorer hides them.
 *
 * This class is the wiring: it reads the disk, listens to the editor and the
 * tree, and keeps the files of the view. What follows from what is decided in
 * `core/folderView/` and `core/work/`.
 */
export class WorkView implements vscode.TreeDataProvider<string>, vscode.TreeDragAndDropController<string>, vscode.Disposable {
    readonly dropMimeTypes = [WORK_MIME, BIN_MIME, 'text/uri-list', 'files'];
    readonly dragMimeTypes = ['text/uri-list'];

    readonly tree = new WorkTree();
    readonly system: System = process.platform === 'darwin' ? 'darwin' : process.platform === 'win32' ? 'win32' : 'linux';
    readonly disk: WorkDisk;
    readonly fs: FileSystem;
    shown: ShownState = NOTHING_SHOWN;
    load: LoadState = { state: 'none' };
    window: WindowView = parseWindowView(null);
    /** Business of the shown ticket. */
    businessPath: string | null = null;
    /** Both refresh buttons use the same linked return once the bin is registered. */
    refreshHome: (() => Promise<void>) | null = null;

    /** Set by the commands that carry out drops. */
    dropHandler: DropHandler | null = null;

    private readonly snapshotFs: SnapshotFs;
    private readonly emitter = new vscode.EventEmitter<string | undefined | void>();
    readonly onDidChangeTreeData = this.emitter.event;
    private view!: vscode.TreeView<string>;
    private readonly disposables: vscode.Disposable[] = [this.emitter];
    private watchers: vscode.Disposable[] = [];

    /** Part of every row id: no other window of the program has the same, so a drop from one is never taken for the view's own. */
    private readonly windowId = Date.now();
    /** Goes up with every choice of a ticket; a reading that ends under an older number is dropped. */
    private request = 0;
    private orderRead: OrderRead = { state: 'none' };
    private hasViewState = false;
    private viewWritable = true;
    /** Two folders carry the number of the shown ticket: the files kept by number belong to both and are not written. */
    private twoFolders = false;
    private busy: string | null = null;
    private readonly keys: Record<string, unknown> = {};

    private redrawTimer: ReturnType<typeof setTimeout> | undefined;
    private redrawAll = false;
    private readonly redrawFolders = new Set<string>();
    private diskTimer: ReturnType<typeof setTimeout> | undefined;
    private readonly diskPending: string[] = [];
    /** A `.gitignore` was written or deleted: the rules of hiding are read anew with the next reading of the disk. */
    private ignoreTouched = false;
    private viewTimer: ReturnType<typeof setTimeout> | undefined;
    private gestureTimer: ReturnType<typeof setTimeout> | undefined;

    private readonly selections = new Map<string, string[]>();
    private dragData: { paths: string[] } | null = null;
    private dragSourceFolder = ROOT;
    private nameBox: { revalidate: () => void; close: () => void } | null = null;
    /** The file chosen for comparison through this view; the editor keeps the choice itself and does not tell it. */
    compareSample: string | null = null;

    private readonly reread = coalesce(() => this.rereadOnce());

    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly runtime: IntentsRuntime,
        private readonly paths: Paths,
        deps: Partial<WorkDeps> = {}
    ) {
        this.disk = deps.disk ?? vscodeDisk;
        this.snapshotFs = deps.snapshotFs ?? nodeSnapshotFs;
        this.fs = deps.fs ?? nodeFs;
    }

    /** Create the tree view and show the ticket of the window. */
    async start(): Promise<void> {
        this.create();
        await this.begin();
    }

    /**
     * Create the tree view. Done at once, before anything is read: a view that
     * becomes visible with no provider behind it shows the platform's «no data
     * provider» text.
     */
    create(): void {
        this.view = vscode.window.createTreeView(WORK_VIEW_ID, {
            treeDataProvider: this,
            dragAndDropController: this,
            canSelectMany: true,
            // The minus-plus button of the title does this; the stock one would be a fifth button
            showCollapseAll: false
        });
        this.disposables.push(
            this.view,
            this.view.onDidExpandElement(event => this.onExpanded(event.element)),
            this.view.onDidCollapseElement(event => this.onCollapsed(event.element)),
            this.view.onDidChangeSelection(event => this.onSelection(event.selection)),
            this.view.onDidChangeVisibility(event => { if (event.visible) { void this.follow(); } }),
            vscode.window.onDidChangeActiveTextEditor(() => this.onEditorsChanged()),
            vscode.window.tabGroups.onDidChangeTabs(() => this.onEditorsChanged()),
            vscode.window.tabGroups.onDidChangeTabGroups(() => this.onEditorsChanged()),
            vscode.workspace.onDidChangeConfiguration(event => {
                if (event.affectsConfiguration('files.exclude') || event.affectsConfiguration('explorer.excludeGitIgnore')) {
                    void this.refilter().then(() => this.afterFilter());
                }
            })
        );
        this.refreshChrome();
    }

    /** Read the settings of the window and show its ticket. */
    async begin(): Promise<void> {
        const request = this.request;
        const window = parseWindowView(await this.readWindowText());
        if (request !== this.request) { return; }
        this.window = window;
        this.refreshChrome();
        await this.goHome();
    }

    dispose(): void {
        clearTimeout(this.redrawTimer);
        clearTimeout(this.diskTimer);
        clearTimeout(this.viewTimer);
        clearTimeout(this.gestureTimer);
        this.nameBox?.close();
        this.watchers.forEach(d => d.dispose());
        this.disposables.forEach(d => d.dispose());
    }

    // ----- which ticket is shown -----

    get ticket(): ShownTicket | null {
        return this.shown.ticket;
    }

    get isReady(): boolean {
        return this.shown.ticket !== null && this.load.state === 'ready';
    }

    /** The «обновить» button and the start of the window: back to the ticket of the window, read anew. */
    async goHome(): Promise<void> {
        this.dragEnded();
        const request = ++this.request;
        const own = await this.ownPlace();
        if (request !== this.request) { return; }
        const step = nextShown(this.shown, { kind: 'home', own });
        // When the folders did not answer, what is shown stays — and it may be a ticket of the bin
        const stays = step.state.ticket && !step.state.ticket.own;
        await this.enter(step.state, stays ? this.businessPath : this.runtime.own?.businessPath ?? null, request);
    }

    /** Selection of a business is not goHome: even a ticket window becomes empty. */
    async clearForBusiness(): Promise<void> {
        this.dragEnded();
        const request = ++this.request;
        await this.enter(nextShown(this.shown, { kind: 'business' }).state, null, request);
    }

    /** A ticket row of the bin was clicked or reached by a key. Rows of groups come here too and change nothing. */
    async selectFromBin(node: unknown): Promise<void> {
        const row = node as Partial<BinNode> | undefined;
        if (!row || row.kind !== 'ticket' || !row.ticket) {
            return;
        }
        this.dragEnded();
        const business = path.dirname(path.dirname(row.ticket.path));
        const own = this.runtime.own;
        const step = nextShown(this.shown, {
            kind: 'select',
            number: row.ticket.number,
            path: row.ticket.path,
            sameBusiness: !own || normalizePath(own.businessPath) === normalizePath(business),
            ownNumber: own?.subject === 'intent' ? own.key : null
        });
        if (step.say) {
            say(step.say);
        }
        if (step.changed) {
            await this.enter(step.state, business);
        }
    }

    private async ownPlace(): Promise<OwnPlace> {
        const own = this.runtime.own;
        if (!own || own.subject !== 'intent') {
            return { state: 'none' };
        }
        return chooseOwnPlace(own.key, own.ticketFolder, await locateTicket(this.fs, own.businessPath, own.key));
    }

    /** Leave the ticket shown and show another state: the title at once, the rows when they are read. */
    private async enter(state: ShownState, businessPath: string | null, request = ++this.request): Promise<void> {
        await this.flushView();
        if (request !== this.request) { return; }
        this.nameBox?.close();
        const remembered = state.ticket ? this.selections.get(state.ticket.number) ?? [] : [];
        const before = this.shown.ticket;
        // The same ticket read anew keeps its rows on the screen while the disk answers
        const same = !!before && !!state.ticket && this.tree.snapshot !== null
            && before.number === state.ticket.number && before.path === state.ticket.path;
        this.shown = state;
        this.businessPath = state.ticket ? businessPath : null;
        if (!same) {
            this.tree.reset();
            this.load = state.ticket ? { state: 'loading' } : { state: 'none' };
            this.orderRead = { state: 'none' };
            this.hasViewState = false;
            this.viewWritable = true;
            this.twoFolders = false;
        }
        this.diskPending.length = 0;
        this.ignoreTouched = false;
        this.watch(state.ticket);
        this.refreshChrome();
        if (!same) {
            this.redrawNow();
        }
        const ticket = state.ticket;
        if (!ticket) {
            return;
        }
        await vscode.window.withProgress({ location: { viewId: WORK_VIEW_ID } }, () => this.loadTicket(request, ticket, remembered, same));
    }

    private async loadTicket(request: number, ticket: ShownTicket, remembered: string[], same: boolean): Promise<void> {
        let snapshot: Snapshot;
        try {
            snapshot = await readSnapshot(this.snapshotFs, ticket.path, this.snapshotOptions());
        } catch (error) {
            if (request === this.request) {
                this.load = { state: same ? 'stale' : 'error', reason: messageOf(error) };
                this.refreshChrome();
            }
            return;
        }
        if (request !== this.request) { return; }
        const business = this.businessPath;
        const [orderRead, viewText, places] = await Promise.all([
            business ? readOrder(this.fs, workOrderPath(business, ticket.number)) : Promise.resolve<OrderRead>({ state: 'none' }),
            this.readText(business ? this.paths.workTicketViewPath(business, ticket.number) : null),
            business ? locateTicket(this.fs, business, ticket.number) : Promise.resolve(null)
        ]);
        if (request !== this.request) {
            // Another ticket was chosen meanwhile: this reading is not shown
            return;
        }
        const view = parseTicketView(viewText.text);
        if (same) {
            // Rows whose state did not change keep their ids, and with them the selection and the scroll
            this.tree.enforce(new Set(view.view.expanded));
        } else {
            this.tree.expanded = new Set(view.view.expanded);
        }
        this.tree.oneFolder = view.view.oneFolder;
        this.tree.oneFolderLevel = view.view.oneFolderFromLevel;
        this.hasViewState = !viewText.failed;
        this.viewWritable = view.writable && !viewText.failed;
        this.twoFolders = places?.state === 'found' && places.paths.length > 1;
        this.applyOrderRead(orderRead, true);
        this.tree.setSnapshot(snapshot);
        // Bringing the saved view back is not a change of this window
        this.tree.dirty = false;
        const filter = await this.readFilter(ticket);
        if (request !== this.request) { return; }
        this.tree.setFilter(filter);
        this.load = { state: 'ready' };
        this.refreshChrome();
        this.redrawNow();
        // The same ticket read anew kept its rows, and the tree kept their selection itself
        if (!(await this.follow()) && !same) {
            // The tree lets an extension select one row only: the top one of those remembered, as they stand on the screen
            const row = this.tree.rows().find((candidate): candidate is FileRow => isFileRow(candidate) && remembered.includes(candidate.path));
            if (row) {
                await this.select(row.path, false);
            }
        }
    }

    private applyOrderRead(read: OrderRead, warn: boolean): void {
        this.orderRead = read;
        if (read.state === 'ok' || (read.state === 'newer' && read.file)) {
            this.tree.order = read.file;
        } else if (read.state === 'none') {
            this.tree.order = null;
        } else if (warn && !this.tree.order) {
            // No order read well so far: the default one, and a word about why
            say(`Закрепления не прочитаны: ${orderLock(read)}. Показан порядок по умолчанию.`);
        }
    }

    // ----- the disk -----

    private snapshotOptions(): SnapshotOptions {
        return { system: this.system, join: (root, rel) => path.join(root, ...rel.split('/')), timeoutMs: READ_TIMEOUT_MS };
    }

    /** Disk path of a row. */
    abs(rel: string): string {
        const root = (this.shown.ticket as ShownTicket).path;
        return rel === ROOT ? root : path.join(root, ...rel.split('/'));
    }

    /** Path inside the shown ticket, or null for a path outside it. */
    toRel(fsPath: string): string | null {
        const root = this.shown.ticket?.path;
        if (!root) {
            return null;
        }
        if (fsPath === root) {
            return ROOT;
        }
        if (!fsPath.startsWith(root + path.sep)) {
            return null;
        }
        const rel = fsPath.slice(root.length + 1).split(path.sep).join('/');
        return this.system === 'darwin' ? rel.normalize('NFC') : rel;
    }

    private watch(ticket: ShownTicket | null): void {
        this.watchers.forEach(d => d.dispose());
        this.watchers = [];
        clearTimeout(this.diskTimer);
        this.diskTimer = undefined;
        if (!ticket) {
            return;
        }
        // RelativePattern also watches a previewed ticket outside this workspace.
        const files = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(ticket.path), '**/*'));
        const changed = (uri: vscode.Uri) => this.diskChanged(uri.fsPath);
        this.watchers.push(files, files.onDidCreate(changed), files.onDidChange(changed), files.onDidDelete(changed));
        if (this.businessPath) {
            const orderFile = workOrderPath(this.businessPath, ticket.number);
            const order = vscode.workspace.createFileSystemWatcher(
                new vscode.RelativePattern(vscode.Uri.file(path.dirname(orderFile)), path.basename(orderFile)));
            const reload = () => void this.reloadOrder();
            this.watchers.push(order, order.onDidCreate(reload), order.onDidChange(reload), order.onDidDelete(reload));
        }
        // The ignore files above the ticket hide its rows too, and no event of the ticket's own folder tells of them
        const top = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(ticket.path))?.uri.fsPath ?? this.businessPath;
        if (top && top !== ticket.path) {
            const ignore = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(top), '**/.gitignore'));
            const above = (uri: vscode.Uri) => {
                if (ticket.path.startsWith(path.dirname(uri.fsPath) + path.sep)) {
                    this.ignoreTouched = true;
                    this.scheduleReread();
                }
            };
            this.watchers.push(ignore, ignore.onDidCreate(above), ignore.onDidChange(above), ignore.onDidDelete(above));
        }
    }

    /** A file event: it only says where to look. */
    private diskChanged(fsPath: string): void {
        const rel = this.toRel(fsPath);
        if (rel === null) {
            return;
        }
        this.diskPending.push(rel);
        // A change of its text changes no listing, and after a deletion no listing holds it: the name of the event is all there is
        this.ignoreTouched = this.ignoreTouched || path.basename(fsPath) === '.gitignore';
        this.scheduleReread();
    }

    private scheduleReread(): void {
        if (this.diskTimer === undefined) {
            this.diskTimer = setTimeout(() => {
                this.diskTimer = undefined;
                void this.reread();
            }, DISK_EVENTS_MS);
        }
    }

    private async rereadOnce(): Promise<void> {
        const ticket = this.shown.ticket;
        const snapshot = this.tree.snapshot;
        if (!ticket || !snapshot) {
            return;
        }
        const folders = foldersToReread(this.diskPending.splice(0), snapshot);
        const ignoreTouched = this.ignoreTouched;
        this.ignoreTouched = false;
        const request = this.request;
        if (folders.length > 0) {
            await this.readFolders(folders);
        }
        if (ignoreTouched && request === this.request && this.tree.getFilter().ignored) {
            await this.refilter();
            if (request === this.request) {
                this.afterFilter();
            }
        }
    }

    /** Read folders again now and show what changed. Commands call it before they decide and after they act. */
    async readFolders(folders: readonly string[]): Promise<void> {
        const ticket = this.shown.ticket;
        const snapshot = this.tree.snapshot;
        const request = this.request;
        if (!ticket || !snapshot) {
            return;
        }
        try {
            const result = await rereadFolders(this.snapshotFs, ticket.path, snapshot, folders, this.snapshotOptions());
            if (request !== this.request) {
                return;
            }
            const recovered = this.load.state !== 'ready';
            this.tree.setSnapshot(result.snapshot);
            this.load = { state: 'ready' };
            if (result.changed.length > 0 || recovered) {
                result.changed.forEach(folder => this.redraw(folder));
                this.nameBox?.revalidate();
                this.refreshChrome();
                this.scheduleViewWrite();
            }
        } catch (error) {
            if (request !== this.request) {
                return;
            }
            let rootThere = true;
            try {
                await this.fs.access(ticket.path);
            } catch {
                rootThere = false;
            }
            if (!rootThere) {
                await this.folderGone();
                return;
            }
            // What was read before stays on the screen, marked as not confirmed
            this.load = { state: 'stale', reason: messageOf(error) };
            this.refreshChrome();
        }
    }

    /** The shown folder is gone: follow it by the ticket number, or say what happened. */
    private async folderGone(): Promise<void> {
        const gone = this.shown.ticket;
        const business = this.businessPath;
        if (!gone || !business) {
            return;
        }
        const places = await locateTicket(this.fs, business, gone.number);
        if (places.state === 'unknown') {
            this.load = { state: 'stale', reason: places.reason };
            this.refreshChrome();
            return;
        }
        const step = nextShown(this.shown, { kind: 'gone', places: places.paths, own: gone.own ? { state: 'none' } : await this.ownPlace() });
        if (step.say) {
            say(step.say);
        }
        await this.enter(step.state, step.state.ticket?.own ? this.runtime.own?.businessPath ?? business : business);
    }

    private async readText(file: string | null): Promise<{ text: string | null; failed: boolean }> {
        if (!file) {
            return { text: null, failed: false };
        }
        try {
            return { text: await this.fs.readFile(file, 'utf8'), failed: false };
        } catch (error) {
            return { text: null, failed: (error as NodeJS.ErrnoException).code !== 'ENOENT' };
        }
    }

    // ----- the order -----

    /** Why the order may not be written now; null when it may. */
    orderLockReason(): string | null {
        return this.twoFolders ? TWO_FOLDERS : orderLock(this.orderRead);
    }

    /**
     * Why an operation may not write into these folders; null when it may.
     * They are read anew first, each with the folder above it, and each must
     * be there and read: a folder that did not answer is not an empty folder,
     * and one that is gone is not made again. An empty line — another ticket
     * is shown by now, and there is nothing to say.
     */
    async unconfirmed(folders: readonly string[], op: Operation): Promise<string | null> {
        await this.readFolders([...new Set(folders.flatMap(folder => (folder === ROOT ? [ROOT] : [parentOf(folder), folder])))]);
        if (!op.alive()) {
            return '';
        }
        if (!this.isReady) {
            return 'Данные рабочей папки не обновлены — действие не выполнено.';
        }
        for (const folder of folders) {
            const trouble = this.folderTrouble(folder);
            if (trouble) {
                return trouble;
            }
        }
        return null;
    }

    /** Why nothing may be written into a folder as it is known now; null when its content is known. */
    folderTrouble(folder: string): string | null {
        const snapshot = this.tree.snapshot;
        const listing = snapshot?.dirs.get(folder);
        if (!snapshot || !listing || (folder !== ROOT && entryAt(snapshot, folder)?.kind !== 'dir')) {
            return `Дерево изменилось: папки ${folderLabel(folder)} больше нет.`;
        }
        if (listing.state === 'limit') {
            return `${listing.reason}: в ${folderLabel(folder)} ничего не меняется.`;
        }
        return listing.state === 'error' ? `Папка ${folderLabel(folder)} не прочитана: ${listing.reason} — действие не выполнено.` : null;
    }

    /**
     * True when the folder holds a name that matches by the rule of this
     * system, hidden names included. The entry named exactly `except` does not
     * count — the object being renamed.
     */
    isTaken(folder: string, name: string, except?: string): boolean {
        const key = nameKey(name, this.system);
        return !!this.tree.snapshot
            && entriesOf(this.tree.snapshot, folder).some(e => e.name !== except && nameKey(e.name, this.system) === key);
    }

    /** The folders whose pins a person changed, as the order shown now has them. */
    arrangedFolders(): Set<string> {
        return new Set(Object.keys(this.tree.order?.folders ?? {}));
    }

    /** Write a change of the order of the shown ticket. False when it was refused; the reason is said by the caller's `fail`. */
    async writeOrder(ops: readonly OrderOp[], fail: (why: string) => string): Promise<boolean> {
        const request = this.request;
        return this.writeOrderOf(this.orderFile(), this.twoFolders, () => request === this.request, say, ops, fail);
    }

    private orderFile(): string | null {
        const ticket = this.shown.ticket;
        return ticket && this.businessPath ? workOrderPath(this.businessPath, ticket.number) : null;
    }

    /**
     * Write a change into one ticket's order file. The file is named by the
     * caller and not taken from what is shown: an operation that began in one
     * ticket must never write its order into another. The tree is touched only
     * while that ticket is still the one shown.
     */
    private async writeOrderOf(
        file: string | null, twoFolders: boolean, shown: () => boolean, tell: (line: string) => void,
        ops: readonly OrderOp[], fail: (why: string) => string
    ): Promise<boolean> {
        if (ops.length === 0 || !file) {
            return true;
        }
        // The file is read anew by the write itself, which refuses what it cannot read: the lock known here only says so sooner
        const lock = twoFolders ? TWO_FOLDERS : shown() ? orderLock(this.orderRead) : null;
        if (lock) {
            tell(fail(lock));
            return false;
        }
        const result = await changeOrder(this.fs, file, ops, PINNED_FILES);
        if (!result.ok) {
            tell(fail(result.why));
            if (shown()) {
                await this.reloadOrder();
            }
            return false;
        }
        if (shown()) {
            this.orderRead = { state: 'ok', file: result.file };
            this.tree.order = result.file;
            this.refreshChrome();
            this.redraw();
        }
        return true;
    }

    /** The order file changed — in another window, on another machine. The rows move; what is expanded does not. */
    private async reloadOrder(): Promise<void> {
        const ticket = this.shown.ticket;
        const request = this.request;
        if (!ticket || !this.businessPath) {
            return;
        }
        const read = await readOrder(this.fs, workOrderPath(this.businessPath, ticket.number));
        if (request !== this.request) {
            return;
        }
        const before = JSON.stringify(this.tree.order?.folders ?? {});
        this.applyOrderRead(read, false);
        this.refreshChrome();
        if (JSON.stringify(this.tree.order?.folders ?? {}) !== before) {
            this.redraw();
        }
    }

    // ----- hidden files -----

    private visibleEditors(): string[] {
        const result: string[] = [];
        for (const group of vscode.window.tabGroups.all) {
            // A comparison shows two files, and either of them may be a hidden one
            for (const uri of tabFiles(group.activeTab?.input)) {
                const rel = uri.scheme === 'file' ? this.toRel(uri.fsPath) : null;
                if (rel && rel !== ROOT && !result.includes(rel)) {
                    result.push(rel);
                }
            }
        }
        return result;
    }

    private async readFilter(ticket: ShownTicket): Promise<FilterInput> {
        const uri = vscode.Uri.file(ticket.path);
        // Explorer judges a path from the workspace folder it lies in, not from the shown folder
        const root = vscode.workspace.getWorkspaceFolder(uri)?.uri.fsPath ?? this.businessPath ?? ticket.path;
        const prefix = path.relative(root, ticket.path).split(path.sep).join('/');
        const exclude = compileExclude(vscode.workspace.getConfiguration('files', uri).get('exclude'));
        let ignored: FilterInput['ignored'] = null;
        if (vscode.workspace.getConfiguration('explorer', uri).get('excludeGitIgnore') === true) {
            ignored = composeIgnore(await this.readIgnoreFiles(root, prefix));
        }
        return { showHidden: this.window.showHidden, prefix, exclude, ignored, visibleEditors: this.visibleEditors() };
    }

    /** Every `.gitignore` from the workspace folder down to the ticket and inside it. */
    private async readIgnoreFiles(root: string, prefix: string): Promise<Array<{ dir: string; text: string }>> {
        const dirs = [''];
        const segments = prefix ? prefix.split('/') : [];
        segments.forEach((_, i) => dirs.push(segments.slice(0, i + 1).join('/')));
        const snapshot = this.tree.snapshot;
        if (snapshot) {
            for (const [rel, listing] of snapshot.dirs) {
                if (rel !== ROOT && listing.state === 'ok' && listing.entries.some(e => e.name === '.gitignore')) {
                    dirs.push(prefix ? `${prefix}/${rel}` : rel);
                }
            }
        }
        const files: Array<{ dir: string; text: string }> = [];
        for (const dir of dirs) {
            try {
                files.push({ dir, text: await this.fs.readFile(path.join(root, ...dir.split('/'), '.gitignore'), 'utf8') });
            } catch {
                // No ignore file in this folder
            }
        }
        return files;
    }

    private async refilter(): Promise<void> {
        const ticket = this.shown.ticket;
        const request = this.request;
        if (!ticket || !this.tree.snapshot) {
            return;
        }
        const filter = await this.readFilter(ticket);
        if (request === this.request) {
            this.tree.setFilter(filter);
        }
    }

    /** The set of shown rows may have changed: draw, and show the open file again when that is on. */
    private afterFilter(): void {
        this.nameBox?.revalidate();
        this.refreshChrome();
        this.redrawNow();
        void this.follow();
    }

    /** The eye button. Works without a ticket too: it changes the state the button keeps. */
    async setShowHidden(show: boolean): Promise<void> {
        this.dragEnded();
        this.window = { ...this.window, showHidden: show };
        await this.saveWindow();
        this.tree.setFilter({ ...this.tree.getFilter(), showHidden: show });
        this.afterFilter();
    }

    private onEditorsChanged(): void {
        this.dragEnded();
        if (this.shown.ticket && this.tree.snapshot) {
            const before = this.tree.getFilter();
            const visibleEditors = this.visibleEditors();
            if (visibleEditors.join('\n') !== before.visibleEditors.join('\n')) {
                // A hidden file shown in an editor is let through with the folders above it — and goes when the tab does
                this.tree.setFilter({ ...before, visibleEditors });
                this.refreshChrome();
                this.redrawNow();
            }
        }
        void this.follow();
    }

    // ----- showing the open file -----

    private activeFile(): string | null {
        const editor = vscode.window.activeTextEditor;
        if (editor) {
            return editor.document.uri.scheme === 'file' ? editor.document.uri.fsPath : null;
        }
        // No text editor has the focus: of a comparison the changed side, the right one, is taken
        const files = tabFiles(vscode.window.tabGroups.activeTabGroup?.activeTab?.input);
        const uri = files[files.length - 1];
        return uri?.scheme === 'file' ? uri.fsPath : null;
    }

    /** Path of the active file when it is a row of the shown ticket. */
    activeRow(): string | null {
        const active = this.activeFile();
        const rel = active ? this.toRel(active) : null;
        const snapshot = this.tree.snapshot;
        if (!rel || rel === ROOT || !snapshot || entryAt(snapshot, rel)?.kind !== 'file' || this.tree.isHidden(rel)) {
            return null;
        }
        return rel;
    }

    /**
     * Show the file of the active editor: expand the way to it, select its row.
     * Only while that is switched on and the view is visible — a hidden view is
     * never raised; it shows the file once when the person opens it. True when
     * a row was shown.
     */
    async follow(): Promise<boolean> {
        if (!this.window.followEditor || !this.isReady || !this.view.visible) {
            return false;
        }
        const rel = this.activeRow();
        if (!rel) {
            return false;
        }
        if (this.tree.reveal(rel)) {
            this.viewChanged();
            this.redrawNow();
        }
        await this.select(rel, false);
        return true;
    }

    /**
     * Select a row. The folders above it are expanded by the view's own set
     * first: left to `reveal`, they would come back as expansions by hand. A
     * hidden view is not touched — `reveal` would raise it.
     */
    async select(rel: string, focus: boolean): Promise<void> {
        const ticket = this.shown.ticket;
        const snapshot = this.tree.snapshot;
        const entry = snapshot ? entryAt(snapshot, rel) : undefined;
        if (!ticket || !entry || !this.view.visible) {
            return;
        }
        try {
            await this.view.reveal(`${ticket.number}|${entry.kind === 'dir' ? 'd' : 'f'}|${rel}`, { select: true, focus, expand: false });
        } catch {
            // The row went while the tree was being drawn: nothing to select
        }
    }

    async setFollow(on: boolean): Promise<void> {
        this.window = { ...this.window, followEditor: on };
        await this.saveWindow();
        this.refreshChrome();
        // Switching it off leaves what it expanded
        if (on) {
            await this.follow();
        }
    }

    // ----- what is expanded -----

    private onExpanded(element: string): void {
        const row = this.rowOf(element);
        if (row?.kind !== 'dir') {
            return;
        }
        const outcome = this.tree.didExpand(row.path);
        clearTimeout(this.gestureTimer);
        this.gestureTimer = setTimeout(() => this.tree.endGesture(), GESTURE_MS);
        if (outcome === 'echo' || outcome === 'deferred') {
            if (outcome === 'deferred') {
                this.scheduleViewWrite();
            }
            return;
        }
        this.viewChanged();
        this.redraw(outcome === 'enforced' ? undefined : row.path);
    }

    private onCollapsed(element: string): void {
        const row = this.rowOf(element);
        if (row?.kind === 'dir' && this.tree.didCollapse(row.path)) {
            this.viewChanged();
            this.redraw(row.path);
        }
    }

    private viewChanged(): void {
        this.refreshChrome();
        this.scheduleViewWrite();
    }

    /** One of the actions under «…»; unavailable ones are greyed by the menu and refused here all the same. */
    runAction(action: TreeAction): void {
        this.dragEnded();
        const keys = this.contextKeys();
        const blocked = action === 'expandAll' ? keys.blockAll
            : action === 'expandLevel1' ? keys.block1
                : action === 'expandLevel2' ? keys.block2 : false;
        const expands = action.startsWith('expand');
        if (!this.shown.ticket || blocked || (expands && !this.isReady)) {
            return;
        }
        if (this.tree.run(action)) {
            this.viewChanged();
            this.redraw();
        }
    }

    /** The minus-plus button. */
    smartToggle(): void {
        this.dragEnded();
        const keys = this.contextKeys();
        if (!this.shown.ticket || (!keys.hasExpanded && (keys.blockDepth || !this.isReady))) {
            return;
        }
        if (this.tree.toggle(this.window.plusDepth)) {
            this.viewChanged();
            this.redraw();
        }
    }

    async setDepth(depth: PlusDepth): Promise<void> {
        // The tree is not touched: the depth is for the next press of the plus button
        this.window = { ...this.window, plusDepth: depth };
        await this.saveWindow();
        this.refreshChrome();
    }

    /**
     * Switch «одна папка за раз» or change its level. `focused` is the row the
     * focus is on — title commands get it from the platform.
     */
    async setRule(on: boolean | null, level: number | null, focused: unknown): Promise<void> {
        this.dragEnded();
        if (!this.shown.ticket || !this.hasViewState) {
            return;
        }
        const row = this.rowOf(focused);
        const focusFolder = !row ? null : row.kind === 'dir' ? row.path : row.parent;
        const revealFile = this.window.followEditor && this.view.visible ? this.activeRow() : null;
        const nextOn = on ?? this.tree.oneFolder;
        const changed = this.tree.setRule(nextOn, level ?? this.tree.oneFolderLevel, focusFolder, nextOn ? revealFile : null);
        this.viewChanged();
        if (changed) {
            this.redrawNow();
        }
        if (nextOn && revealFile) {
            await this.select(revealFile, false);
        }
    }

    private scheduleViewWrite(): void {
        clearTimeout(this.viewTimer);
        this.viewTimer = setTimeout(() => void this.flushView(), VIEW_WRITE_MS);
    }

    private viewFile(): { file: string; text: string } | null {
        const ticket = this.shown.ticket;
        if (!ticket || !this.businessPath || !this.tree.dirty || !this.hasViewState || !this.viewWritable || this.twoFolders) {
            return null;
        }
        return {
            file: this.paths.workTicketViewPath(this.businessPath, ticket.number),
            text: serializeTicketView({
                expanded: [...this.tree.expanded], oneFolder: this.tree.oneFolder, oneFolderFromLevel: this.tree.oneFolderLevel
            })
        };
    }

    /** Write what is expanded, when this window changed it. The view of the window that changed it last is what the next entry reads. */
    async flushView(): Promise<void> {
        clearTimeout(this.viewTimer);
        const pending = this.viewFile();
        if (!pending) {
            return;
        }
        this.tree.dirty = false;
        try {
            await this.fs.mkdir(path.dirname(pending.file), { recursive: true });
            await this.fs.atomicWriteFile(pending.file, pending.text, 'utf8');
        } catch (error) {
            say(`Раскрытие не сохранено: ${messageOf(error)}`);
        }
    }

    /** The same write for `deactivate`: the extension host is shut down right after, an async write may not finish. */
    flushViewSync(): void {
        clearTimeout(this.viewTimer);
        const pending = this.viewFile();
        if (!pending) {
            return;
        }
        try {
            fsSync.mkdirSync(path.dirname(pending.file), { recursive: true });
            fsSync.writeFileSync(pending.file, pending.text, 'utf8');
        } catch {
            // Nothing can be told to the user at this point
        }
    }

    // ----- the settings of the window -----

    private windowFile(): string | null {
        const own = this.runtime.own;
        return own ? this.paths.workWindowViewPath(programFolderName(vscode.env.uriScheme), own.key) : null;
    }

    private async readWindowText(): Promise<string | null> {
        const file = this.windowFile();
        if (!file) {
            // A window Duet did not open has no key of its own
            return this.context.workspaceState.get<string>(WINDOW_STATE_KEY) ?? null;
        }
        return (await this.readText(file)).text;
    }

    private async saveWindow(): Promise<void> {
        const text = serializeWindowView(this.window);
        const file = this.windowFile();
        try {
            if (!file) {
                await this.context.workspaceState.update(WINDOW_STATE_KEY, text);
                return;
            }
            await this.fs.mkdir(path.dirname(file), { recursive: true });
            await this.fs.atomicWriteFile(file, text, 'utf8');
        } catch (error) {
            say(`Настройка вью не сохранена: ${messageOf(error)}`);
        }
    }

    // ----- the header and the context keys -----

    contextKeys(): ContextKeys {
        return availability({
            hasTicket: this.shown.ticket !== null,
            ready: this.load.state === 'ready',
            busy: this.busy !== null,
            hasViewState: this.hasViewState,
            showHidden: this.window.showHidden,
            followEditor: this.window.followEditor,
            plusDepth: this.window.plusDepth,
            orderLocked: this.orderLockReason() !== null,
            ...this.tree.facts()
        });
    }

    refreshChrome(): void {
        if (this.view) {
            const header = viewTitle(this.shown, this.load);
            this.view.title = header.title;
            this.view.description = header.description;
            this.view.message = header.message;
        }
        for (const [name, raw] of Object.entries(this.contextKeys())) {
            // Numbers go as text: a `when` clause compares with what is written in it
            const value = typeof raw === 'number' ? String(raw) : raw;
            if (this.keys[name] !== value) {
                this.keys[name] = value;
                void vscode.commands.executeCommand('setContext', `duet.work.${name}`, value);
            }
        }
    }

    // ----- one operation at a time -----

    /**
     * Run a file operation alone: while one is under way another is refused,
     * not queued. The operation gets the paths of the ticket it began in, so
     * showing another ticket meanwhile neither redirects it nor lets it touch
     * the new tree; what it says then starts with the number of its ticket.
     */
    async exclusive(label: string, task: (op: Operation) => Promise<void>): Promise<void> {
        if (this.busy) {
            say(`Рабочая папка занята: идёт ${this.busy}.`);
            return;
        }
        const request = this.request;
        const root = this.shown.ticket?.path ?? '';
        const number = this.shown.ticket?.number ?? '';
        const orderFile = this.orderFile();
        const twoFolders = this.twoFolders;
        const alive = () => request === this.request;
        const prefix = () => (alive() ? '' : `${number}: `);
        this.busy = label;
        this.refreshChrome();
        try {
            await task({
                abs: rel => (rel === ROOT ? root : path.join(root, ...rel.split('/'))),
                alive,
                say: line => say(prefix() + line),
                inform: line => inform(prefix() + line),
                writeOrder: (ops, fail) => this.writeOrderOf(orderFile, twoFolders, alive, line => say(prefix() + line), ops, fail)
            });
        } finally {
            this.busy = null;
            this.refreshChrome();
        }
    }

    /** The number of the choice of a ticket: an operation compares it to learn that the ticket was changed under it. */
    get requestNumber(): number {
        return this.request;
    }

    // ----- the tree -----

    private element(row: Row): string {
        return `${(this.shown.ticket as ShownTicket).number}|${rowKey(row)}`;
    }

    /** The row behind what the tree or a command handed over; undefined for anything that is not a row of the shown ticket. */
    rowOf(element: unknown): Row | undefined {
        const ticket = this.shown.ticket;
        const snapshot = this.tree.snapshot;
        if (typeof element !== 'string' || !ticket || !snapshot) {
            return undefined;
        }
        const [number, kind, ...rest] = element.split('|');
        const rel = rest.join('|');
        if (number !== ticket.number || !rel) {
            return undefined;
        }
        if (kind === 'e') {
            return { kind: 'empty', parent: rel };
        }
        if (kind === 'n') {
            const listing = snapshot.dirs.get(rel);
            return listing && listing.state !== 'ok' ? { kind: 'note', parent: rel, text: listing.reason } : undefined;
        }
        const entry = entryAt(snapshot, rel);
        if (!entry || (kind === 'd') !== (entry.kind === 'dir')) {
            return undefined;
        }
        return { kind: entry.kind, path: rel, name: entry.name, parent: parentOf(rel), link: entry.link };
    }

    /** The selected rows, top to bottom as on the screen. */
    selectionRows(): Row[] {
        const chosen = new Set((this.view?.selection ?? []).map(element => this.rowOf(element)).filter(isFileRow).map(row => row.path));
        return this.tree.rows().filter(row => isFileRow(row) && chosen.has(row.path));
    }

    getChildren(element?: string): string[] {
        if (!this.shown.ticket || !this.tree.snapshot) {
            return [];
        }
        if (element === undefined) {
            return this.tree.children(ROOT).map(row => this.element(row));
        }
        const row = this.rowOf(element);
        return row?.kind === 'dir' ? this.tree.children(row.path).map(child => this.element(child)) : [];
    }

    getParent(element: string): string | undefined {
        const row = this.rowOf(element);
        if (!row || row.parent === ROOT) {
            return undefined;
        }
        return `${(this.shown.ticket as ShownTicket).number}|d|${row.parent}`;
    }

    getTreeItem(element: string): vscode.TreeItem {
        const row = this.rowOf(element);
        const number = this.shown.ticket?.number ?? '';
        const id = `${this.windowId}|${number}|`;
        if (!row) {
            return new vscode.TreeItem('', vscode.TreeItemCollapsibleState.None);
        }
        if (row.kind === 'empty' || row.kind === 'note') {
            // No address, no icon, no command, and a context value no menu item answers to
            const item = new vscode.TreeItem(row.kind === 'note' ? row.text : '', vscode.TreeItemCollapsibleState.None);
            item.id = `${id}${row.kind === 'note' ? 'n' : 'e'}|${row.parent}`;
            item.contextValue = row.kind;
            return item;
        }
        const uri = vscode.Uri.file(this.abs(row.path));
        const pin = this.tree.isPinned(row.parent, row.name, row.kind === 'dir') ? '.pin' : '';
        if (row.kind === 'dir') {
            const open = this.tree.expanded.has(row.path);
            const item = new vscode.TreeItem(uri, open ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed);
            item.id = `${id}d|${this.tree.epochOf(row.path)}|${row.path}`;
            // Menu when-clauses stand on these words: creating inside needs an open folder, unpinning — a pin, a reset — pins changed by hand
            item.contextValue = `folder.${open ? 'open' : 'closed'}${pin}${this.tree.isManual(row.path) ? '.manual' : ''}`;
            return item;
        }
        const item = new vscode.TreeItem(uri, vscode.TreeItemCollapsibleState.None);
        item.id = `${id}f|${row.path}`;
        item.contextValue = `${this.compareSample === this.abs(row.path) ? 'file.cmp' : 'file'}${pin}`;
        // Exactly one argument: only then does the tree add its opening event — one click a preview tab, two a kept one
        item.command = { command: 'vscode.open', title: 'Open', arguments: [uri] };
        return item;
    }

    /**
     * Ask the tree to draw again: one folder, or everything. Requests that come
     * together are sent as one; while a drag is under way nothing is drawn, so
     * the row under the pointer does not move away.
     */
    redraw(folder?: string): void {
        if (folder === undefined || folder === ROOT) {
            this.redrawAll = true;
        } else {
            this.redrawFolders.add(folder);
        }
        if (this.tree.isDragging()) {
            return;
        }
        clearTimeout(this.redrawTimer);
        this.redrawTimer = setTimeout(() => this.redrawNow(), REDRAW_DEBOUNCE_MS);
    }

    redrawNow(): void {
        clearTimeout(this.redrawTimer);
        const ticket = this.shown.ticket;
        const folders = [...this.redrawFolders].filter(folder => this.rowOf(`${ticket?.number}|d|${folder}`));
        const all = this.redrawAll || !ticket || folders.length !== this.redrawFolders.size || this.redrawFolders.size === 0;
        this.redrawAll = false;
        this.redrawFolders.clear();
        if (all) {
            this.emitter.fire();
        } else {
            folders.forEach(folder => this.emitter.fire(`${ticket.number}|d|${folder}`));
        }
    }

    private onSelection(selection: readonly string[]): void {
        this.dragEnded();
        const ticket = this.shown.ticket;
        if (ticket && this.load.state !== 'loading') {
            this.selections.set(ticket.number, selection.map(element => this.rowOf(element)).filter(isFileRow).map(row => row.path));
        }
    }

    // ----- drag and drop -----

    handleDrag(source: readonly string[], dataTransfer: vscode.DataTransfer, token: vscode.CancellationToken): void {
        this.dragEnded();
        const rows = source.map(element => this.rowOf(element)).filter(isFileRow);
        this.dragData = { paths: rows.map(row => row.path) };
        dataTransfer.set(WORK_MIME, new vscode.DataTransferItem(this.dragData));
        // The editor takes addresses only from what the extension put here; folders and empty rows are left out
        const files = rows.filter(row => row.kind === 'file').map(row => vscode.Uri.file(this.abs(row.path)).toString());
        if (files.length > 0) {
            dataTransfer.set('text/uri-list', new vscode.DataTransferItem(files.join('\r\n')));
        }
        const top = this.tree.rows().find((row): row is FileRow => isFileRow(row) && this.dragData!.paths.includes(row.path));
        this.dragSourceFolder = top?.parent ?? ROOT;
        this.tree.beginDrag();
        // The platform cancels the token when the drag ended with no drop taken anywhere
        token.onCancellationRequested(() => this.dragEnded());
    }

    async handleDrop(target: string | undefined, dataTransfer: vscode.DataTransfer): Promise<void> {
        const own = this.dragData;
        const targetRow = this.rowOf(target);
        if (!this.shown.ticket || !this.dropHandler) {
            this.dragEnded();
            return;
        }
        if (target !== undefined && !targetRow) {
            // The row under the pointer is gone; the nearest row does not stand in for it
            this.dragEnded();
            say('Дерево изменилось: строки, на которую бросили, больше нет.');
            return;
        }
        // The view's own rows come as the very object handed out in `handleDrag`; a row of another window comes as text
        if (own && dataTransfer.get(WORK_MIME)?.value === own) {
            const folder = await this.dropHandler.drop(own.paths, target === undefined ? undefined : targetRow);
            this.dragEnded(folder ?? (targetRow ? targetRow.parent : ROOT));
            return;
        }
        this.dragEnded();
        let fromSystem = false;
        dataTransfer.forEach(item => { fromSystem = fromSystem || item.asFile() !== undefined; });
        const list = fromSystem ? await dataTransfer.get('text/uri-list')?.asString() : undefined;
        const sources = (list ?? '').split(/\r?\n/).filter(line => line && !line.startsWith('#')).map(line => vscode.Uri.parse(line));
        if (sources.length === 0) {
            say(FOREIGN_DROP);
            return;
        }
        await this.dropHandler.importFiles(sources, target === undefined ? undefined : targetRow);
    }

    /**
     * The drag is over. Folders that opened under the pointer stay expanded;
     * with the rule on, the folder the rows were dropped into stays as the one
     * branch — or, when nothing was dropped here, the folder they were taken from.
     */
    private dragEnded(dropFolder?: string): void {
        if (!this.tree.isDragging()) {
            return;
        }
        this.dragData = null;
        if (this.tree.endDrag(dropFolder ?? this.dragSourceFolder)) {
            this.viewChanged();
            this.redrawAll = true;
        }
        if (this.redrawAll || this.redrawFolders.size > 0) {
            this.redrawNow();
        }
    }

    /** Every command of the view begins here: a drag whose end the platform did not report is over by now. */
    beforeCommand(): void {
        this.dragEnded();
    }

    // ----- the name box -----

    /**
     * Ask for a name in the box at the top of the window. The name is judged
     * while it is typed and again whenever the folder or the filter changes;
     * the box stays open until the name passes, Escape, or another ticket is shown.
     */
    askName(options: { title: string; value: string; selection?: [number, number]; validate: (name: string) => NameVerdict | null }): Promise<string | undefined> {
        this.nameBox?.close();
        const box = vscode.window.createInputBox();
        box.title = options.title;
        box.value = options.value;
        box.valueSelection = options.selection;
        box.ignoreFocusOut = true;
        const judge = (): NameVerdict | null => {
            const verdict = options.validate(box.value);
            box.validationMessage = verdict ? { message: verdict.message, severity: SEVERITY[verdict.severity] } : undefined;
            return verdict;
        };
        return new Promise(resolve => {
            let done = false;
            const finish = (name: string | undefined) => {
                if (done) {
                    return;
                }
                done = true;
                this.nameBox = null;
                box.dispose();
                resolve(name);
            };
            box.onDidChangeValue(() => judge());
            box.onDidAccept(() => {
                // Enter on the name as it was simply closes the box
                if (options.value && box.value === options.value) {
                    finish(undefined);
                    return;
                }
                const verdict = judge();
                if (!verdict || verdict.severity === 'warning') {
                    finish(box.value);
                }
            });
            box.onDidHide(() => finish(undefined));
            this.nameBox = { revalidate: () => { if (box.value) { judge(); } }, close: () => finish(undefined) };
            box.show();
        });
    }

    /** Disk paths of the files with unsaved changes in an editor. */
    private unsavedFiles(): string[] {
        const uris = [
            ...vscode.workspace.textDocuments.filter(document => document.isDirty).map(document => document.uri),
            ...vscode.window.tabGroups.all.flatMap(group => group.tabs.filter(tab => tab.isDirty).flatMap(tab => tabFiles(tab.input)))
        ];
        return [...new Set(uris.filter(uri => uri.scheme === 'file').map(uri => uri.fsPath))];
    }

    /** True when the path or anything below it has unsaved changes in an editor. */
    hasUnsaved(fsPath: string): boolean {
        return this.unsavedFiles().some(file => file === fsPath || file.startsWith(fsPath + path.sep));
    }

    /**
     * The same question for the moment right before a change, asked of the
     * disk as well: a file open under one path is the same file when the row
     * reaches it through a link to its folder. Only the way to the row is
     * resolved — a row that is a link itself is renamed or deleted as the
     * link, and what it leads to stays untouched.
     */
    async unsaved(fsPath: string): Promise<boolean> {
        if (this.hasUnsaved(fsPath)) {
            return true;
        }
        const files = this.unsavedFiles();
        if (files.length === 0) {
            return false;
        }
        const real = (target: string) => this.snapshotFs.realpath(target).catch(() => target);
        const place = path.join(await real(path.dirname(fsPath)), path.basename(fsPath));
        const places = await Promise.all(files.map(real));
        return places.some(file => file === place || file.startsWith(place + path.sep));
    }

    /** Join a folder of the ticket and a name into a path of the view. */
    rel(folder: string, name: string): string {
        return joinRel(folder, name);
    }
}
