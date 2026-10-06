import * as vscode from 'vscode';
import { ContextEntity } from '../../core/api-client';
import { normalizePath } from '../../core/pathUtils';
import { findCurrentBusiness } from '../../core/tree/contextPanel';
import { BinNode, buildBinTree, parentOfBinNode } from '../../core/intents/binTree';
import { readBinOrder } from '../../core/intents/binOrder';
import { rowText } from '../../core/intents/naming';
import { draggedIdentity } from '../../core/intents/order';
import { TicketInfo } from '../../core/intents/tickets';
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
 * The view serves rows from a snapshot in memory. The disk is read when the
 * view is opened, after a finished move and by the refresh button — never on a
 * plain tree refresh, or every window opening would re-read folders on a cloud
 * drive. A change of the window's business drops the snapshot.
 */
export class BinProvider implements vscode.TreeDataProvider<BinNode>, vscode.TreeDragAndDropController<BinNode> {
    readonly dropMimeTypes = [BIN_MIME];
    readonly dragMimeTypes = [BIN_MIME];
    /** Carries out a drop; set by the commands that own the disk operations. */
    onDrop: BinDropHandler | null = null;

    private business: ContextEntity | null;
    /** Null until the business folders have been read. */
    private tickets: TicketInfo[] | null = null;
    private order: string[] = [];
    private tree: BinNode[] = [];
    private visible = false;
    private requested = false;
    private reloading: Promise<void> | null = null;
    private reloadAgain = false;
    private redrawTimer: ReturnType<typeof setTimeout> | undefined;
    private unseenTimer: ReturnType<typeof setTimeout> | undefined;
    /**
     * Part of every row id. VS Code remembers what is expanded by row id and
     * has no command to collapse one node, so a new number is how the view
     * returns to "containers open, every Backlog closed". It starts from the
     * clock, so a window that starts again never repeats the ids of its last run.
     */
    private generation = Date.now();

    private readonly emitter = new vscode.EventEmitter<BinNode | undefined | void>();
    readonly onDidChangeTreeData = this.emitter.event;
    private readonly disposables: vscode.Disposable[] = [this.emitter];

    constructor(private contexts: ContextEntity[], private readonly runtime: IntentsRuntime) {
        this.business = findCurrentBusiness(contexts, openPaths());
        this.disposables.push(
            // A window opened or closed: the colours and the buttons change, the disk is not read
            runtime.onDidChange(() => this.redraw()),
            vscode.workspace.onDidChangeWorkspaceFolders(() => this.updateBusiness())
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
     * their starting shape and the folders are read. The extension only learns
     * that the view became visible: it cannot tell opening the view from coming
     * back to the Duet side bar.
     */
    setVisible(visible: boolean): void {
        this.visible = visible;
        if (visible) {
            this.generation++;
            void this.reload();
        }
    }

    /**
     * Read the business folders and the remembered order from disk, rebuild the
     * rows. A call that comes while a reading is under way leads to one more
     * reading after it, so whoever awaits sees the disk as it was after their call.
     */
    reload(): Promise<void> {
        if (this.reloading) {
            this.reloadAgain = true;
            return this.reloading;
        }
        this.reloading = (async () => {
            try {
                do {
                    this.reloadAgain = false;
                    await this.readOnce();
                } while (this.reloadAgain);
            } finally {
                this.reloading = null;
                this.redraw();
            }
        })();
        return this.reloading;
    }

    private async readOnce(): Promise<void> {
        const business = this.business;
        const businessPath = business?.absolute_path;
        if (!businessPath) {
            this.tickets = null;
            this.tree = [];
            return;
        }
        this.requested = true;
        const [tickets, order] = await Promise.all([
            this.runtime.tickets.readShelves(businessPath),
            readBinOrder(businessPath)
        ]);
        // The window's business changed while the folders were being read
        if (pathKey(this.business) !== pathKey(business)) {
            return;
        }
        this.tickets = tickets;
        // An unreadable order file leaves the last order that was read well
        if (order !== null) {
            this.order = order;
        }
        this.tree = buildBinTree(tickets, this.order);
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

    /** The business of the window — the same rule as the КОНТЕКСТ view. */
    currentBusiness(): ContextEntity | null {
        return this.business;
    }

    getTree(): BinNode[] {
        return this.tree;
    }

    getOrder(): string[] {
        return this.order;
    }

    getTickets(): TicketInfo[] {
        return this.tickets ?? [];
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
        // A click only selects the row and does not toggle the node — that is the arrow's job, as in «Все Бизнесы»
        item.command = { command: 'duet.selectNode', title: 'Select' };
        return item;
    }

    getChildren(node?: BinNode): BinNode[] {
        if (node) {
            return node.children;
        }
        // The view asks for rows only while it is shown, and is told it became visible right
        // after — that is what reads the folders. Should that word never come, read anyway.
        if (this.tickets === null && this.business && !this.requested) {
            this.requested = true;
            this.unseenTimer = setTimeout(() => {
                if (this.tickets === null && !this.reloading) {
                    void this.reload();
                }
            }, UNSEEN_READ_MS);
        }
        return this.tree;
    }

    getParent(node: BinNode): BinNode | undefined {
        return parentOfBinNode(this.tree, node.key) ?? undefined;
    }

    handleDrag(source: readonly BinNode[], dataTransfer: vscode.DataTransfer): void {
        if (source.length > 0) {
            dataTransfer.set(BIN_MIME, new vscode.DataTransferItem(source[0].key));
        }
    }

    async handleDrop(target: BinNode | undefined, dataTransfer: vscode.DataTransfer): Promise<void> {
        const source = draggedIdentity(dataTransfer.get(BIN_MIME)?.value, row => row.key);
        if (source !== null && this.onDrop) {
            await this.onDrop(source, target?.key ?? null);
        }
    }

    private rowId(node: BinNode): string {
        return `${this.generation}|${node.key}`;
    }

    private updateBusiness(): void {
        const next = findCurrentBusiness(this.contexts, openPaths());
        const samePlace = pathKey(next) === pathKey(this.business);
        this.business = next;
        if (samePlace) {
            return;
        }
        this.tickets = null;
        this.order = [];
        this.tree = [];
        this.requested = false;
        if (this.visible) {
            void this.reload();
        } else {
            this.redraw();
        }
    }
}

function openPaths(): string[] {
    return (vscode.workspace.workspaceFolders ?? []).map(folder => folder.uri.fsPath);
}

function pathKey(business: ContextEntity | null): string | null {
    return business?.absolute_path ? normalizePath(business.absolute_path) : null;
}
