import * as vscode from 'vscode';
import { ContextEntity } from '../../core/api-client';
import { normalizePath } from '../../core/pathUtils';
import { findCurrentBusiness } from '../../core/tree/contextPanel';
import { BinNode, binTickets, parentOfBinNode } from '../../core/intents/binTree';
import { TicketBoard } from '../../core/intents/board';
import { rowText } from '../../core/intents/naming';
import { IntentsRuntime } from '../intents/IntentsRuntime';
import { rowColorResource, rowIcon, rowLabel } from './rowLook';

/** Mime type of the view's own rows; accepting only it keeps rows of other views out. */
const BIN_MIME = 'application/vnd.code.tree.duet.bin';

export type BinDropHandler = (sourceKey: string, targetKey: string | null) => Promise<void>;

/** Tree refreshes that come within this time are sent as one. */
const REDRAW_DEBOUNCE_MS = 25;
/** How long the view waits to be told it is visible before it reads the folders on its own. */
const UNSEEN_READ_MS = 300;

/**
 * «Корзина» view — all tickets of the current business from `work/` and
 * `backlog/`, laid out by `core/intents/binTree.ts`. The view is for managing
 * the backlog and the order: a click on a row only selects it, and switching
 * to a window is the job of the «Активная Работа» view alone.
 *
 * The view holds no tickets of its own: it shows the board of the business
 * (`core/intents/board.ts`), which alone decides when the disk is read, and
 * draws its rows again when the board says they changed. It tells the board
 * whose tickets to hold and whether its rows are shown.
 */
export class BinProvider implements vscode.TreeDataProvider<BinNode>, vscode.TreeDragAndDropController<BinNode> {
    readonly dropMimeTypes = [BIN_MIME];
    readonly dragMimeTypes = [BIN_MIME];
    /** Carries out a drop; set by the commands that own the disk operations. */
    onDrop: BinDropHandler | null = null;

    private ownBusiness: ContextEntity | null = null;
    private previewId: string | null = null;
    private business: ContextEntity | null;
    private requested = false;
    private visibilityKnown = false;
    private redrawTimer: ReturnType<typeof setTimeout> | undefined;
    private unseenTimer: ReturnType<typeof setTimeout> | undefined;
    /**
     * Part of every row id. VS Code remembers what is expanded by row id and
     * has no command to collapse one node, so a new number is how the view
     * returns to "containers open, every Backlog closed". It starts from the
     * clock, so a window that starts again never repeats the ids of its last run.
     */
    private generation = Date.now();
    private readonly dragId = `${Date.now()}:${Math.random()}`;

    private readonly emitter = new vscode.EventEmitter<BinNode | undefined | void>();
    readonly onDidChangeTreeData = this.emitter.event;
    private readonly disposables: vscode.Disposable[] = [this.emitter];

    constructor(
        private contexts: ContextEntity[],
        private readonly runtime: IntentsRuntime,
        private readonly board: TicketBoard
    ) {
        this.ownBusiness = this.business = findCurrentBusiness(contexts, openPaths());
        board.setBusiness(this.business?.absolute_path ?? null);
        this.disposables.push(
            board.onDidChange(() => this.redraw()),
            // A window opened or closed: the colours and the buttons change, the disk is not read
            runtime.onDidChange(() => this.redraw()),
            vscode.workspace.onDidChangeWorkspaceFolders(() => { this.previewId = null; this.updateBusiness(); })
        );
    }

    dispose(): void {
        clearTimeout(this.redrawTimer);
        clearTimeout(this.unseenTimer);
        this.disposables.forEach(d => d.dispose());
    }

    /** Replace the list of businesses (after `duet.refresh`). */
    updateContexts(contexts: ContextEntity[]): void {
        this.contexts = contexts;
        this.updateBusiness();
    }

    /**
     * The view was shown or hidden. Each time it is shown the rows return to
     * their starting shape and the board reads the folders. The extension only
     * learns that the view became visible: it cannot tell opening the view from
     * coming back to the Duet side bar.
     */
    setVisible(visible: boolean): void {
        this.visibilityKnown = true;
        clearTimeout(this.unseenTimer);
        if (!visible) {
            void this.board.setShown(false);
            return;
        }
        this.generation++;
        this.requested = true;
        // Drawn once the folders are read: the new row ids and the fresh rows go in one refresh
        void this.board.setShown(true).finally(() => this.redraw());
    }

    /**
     * Ask the tree to draw its rows again. Requests that come together are sent
     * as one: two refreshes a few milliseconds apart make VS Code ask for the
     * children of rows the second refresh has already replaced.
     */
    private redraw(): void {
        clearTimeout(this.redrawTimer);
        this.redrawTimer = setTimeout(() => this.emitter.fire(), REDRAW_DEBOUNCE_MS);
    }

    windowBusiness(): ContextEntity | null { return this.ownBusiness; }

    isForeignBusiness(): boolean { return this.business?.id !== this.ownBusiness?.id; }

    /** Preview a real business, without changing the workspace or reading a hidden board. */
    showBusiness(entityId: number): boolean {
        const next = this.contexts.find(b => b.id === String(entityId) && !!b.absolute_path);
        if (!next) { return false; }
        this.previewId = next.id;
        this.setBusiness(next);
        return true;
    }

    async goHome(): Promise<void> {
        this.previewId = null;
        this.setBusiness(this.ownBusiness);
        if (this.board.isShown()) { await this.board.reload(); }
    }

    hasNode(node: unknown): node is BinNode {
        const row = node as BinNode | undefined;
        return row?.kind === 'ticket' && binTickets(this.board.getTree()).includes(row);
    }

    /** The business shown — it may differ from the stable business of the window. */
    currentBusiness(): ContextEntity | null {
        return this.business;
    }

    getTreeItem(node: BinNode): vscode.TreeItem {
        if (node.kind !== 'ticket') {
            const item = new vscode.TreeItem(
                node.kind === 'backlog' ? 'Backlog' : 'Unsorted',
                node.kind === 'backlog'
                    ? vscode.TreeItemCollapsibleState.Collapsed
                    : vscode.TreeItemCollapsibleState.Expanded
            );
            item.id = this.rowId(node);
            item.iconPath = rowIcon('');
            item.contextValue = 'bin-group';
            // A click on the name does nothing; the node is toggled by its arrow, as in «Все Бизнесы»
            item.command = { command: 'duet.selectNode', title: 'Select' };
            return item;
        }

        const ticket = node.ticket;
        const open = this.runtime.isOpen(ticket.number);
        const text = rowText('', ticket.name, ticket.number);
        const item = new vscode.TreeItem(
            // The ticket of the window you are in: its name on the backdrop, as in «Активная Работа»
            rowLabel(text, this.runtime.isOwn(ticket.number)),
            node.children.length > 0
                ? vscode.TreeItemCollapsibleState.Expanded
                : vscode.TreeItemCollapsibleState.None
        );
        item.id = this.rowId(node);
        item.description = text.description;
        item.iconPath = rowIcon(ticket.icon);
        // A ticket with an open window is told by the colour of that window, in force now
        item.resourceUri = open ? rowColorResource(this.runtime.colorOf(ticket.number), ticket.number) : undefined;
        // Menu when-clauses stand on these: the buttons differ by shelf and vanish for an open ticket
        item.contextValue = open ? 'ticket-open' : `ticket-${ticket.shelf}`;
        item.tooltip = ticket.path;
        // A click selects the row and does not toggle the node — that is the arrow's job, as in «Все Бизнесы».
        // The command also shows the ticket in «Рабочая папка»; it never switches windows
        item.command = { command: 'duet.bin.select', title: 'Select', arguments: [node] };
        return item;
    }

    getChildren(node?: BinNode): BinNode[] {
        if (node) {
            return node.children;
        }
        // The view asks for rows only while it is shown, and is told it became visible right
        // after — that is what reads the folders. Should that word never come, read anyway.
        if (this.board.getTickets() === null && this.business && !this.requested && !this.visibilityKnown) {
            this.requested = true;
            this.unseenTimer = setTimeout(() => {
                if (this.board.getTickets() === null) {
                    void this.board.setShown(true);
                }
            }, UNSEEN_READ_MS);
        }
        return this.board.getTree();
    }

    getParent(node: BinNode): BinNode | undefined {
        return parentOfBinNode(this.board.getTree(), node.key) ?? undefined;
    }

    handleDrag(source: readonly BinNode[], dataTransfer: vscode.DataTransfer): void {
        if (source.length > 0 && this.hasNode(source[0])) {
            dataTransfer.set(BIN_MIME, new vscode.DataTransferItem({ key: source[0].key, owner: this.dragId, generation: this.board.getGeneration() }));
        }
    }

    async handleDrop(target: BinNode | undefined, dataTransfer: vscode.DataTransfer): Promise<void> {
        const data = dataTransfer.get(BIN_MIME)?.value as { key?: unknown; generation?: unknown; owner?: unknown } | undefined;
        if (typeof data?.key !== 'string' || data.owner !== this.dragId || data.generation !== this.board.getGeneration()) { return; }
        // Old rows cannot be dropped into a newly selected business (including A → B → A).
        if (target && !this.contains(target)) { return; }
        if (this.onDrop) { await this.onDrop(data.key, target?.key ?? null); }
    }

    private contains(node: BinNode): boolean {
        const find = (rows: BinNode[]): boolean => rows.some(row => row === node || find(row.children));
        return find(this.board.getTree());
    }

    private rowId(node: BinNode): string {
        return `${this.generation}|${node.key}`;
    }

    private updateBusiness(): void {
        this.ownBusiness = findCurrentBusiness(this.contexts, openPaths());
        const preview = this.contexts.find(b => b.id === this.previewId && !!b.absolute_path);
        if (!preview) { this.previewId = null; }
        this.setBusiness(preview ?? this.ownBusiness);
    }

    private setBusiness(next: ContextEntity | null): void {
        if (pathKey(next) !== pathKey(this.business)) {
            this.requested = false;
            clearTimeout(this.unseenTimer);
            this.generation++;
        }
        this.business = next;
        this.board.setBusiness(next?.absolute_path ?? null);
        this.redraw();
    }

}

function openPaths(): string[] {
    return (vscode.workspace.workspaceFolders ?? []).map(folder => folder.uri.fsPath);
}

function pathKey(business: ContextEntity | null): string | null {
    return business?.absolute_path ? normalizePath(business.absolute_path) : null;
}
