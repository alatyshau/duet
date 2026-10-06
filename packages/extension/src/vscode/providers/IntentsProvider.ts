import * as vscode from 'vscode';
import { ActiveIntent, activeRowText, rowNumber, reorderActive } from '../../core/intents/active';
import { draggedIdentity, placeNextTo } from '../../core/intents/order';
import { IntentsRuntime } from '../intents/IntentsRuntime';
import { rowColorResource, rowIcon, rowLabel } from './rowLook';

/** Mime type of the view's own rows; accepting only it keeps rows of other views out. */
const INTENTS_MIME = 'application/vnd.code.tree.duet.intents';

/**
 * «Активная Работа» view — the windows Duet opened in this program: business windows
 * first, then the active intents of every business. A flat list read from the
 * window markers. One click switches to the window of the row; the order of
 * intents is set by dragging and is the same in every window. The first nine
 * rows carry a number, their place in the list — the one Cmd+1 … Cmd+9 switch by.
 */
export class IntentsProvider
implements vscode.TreeDataProvider<ActiveIntent>, vscode.TreeDragAndDropController<ActiveIntent> {
    readonly dropMimeTypes = [INTENTS_MIME];
    readonly dragMimeTypes = [INTENTS_MIME];

    private readonly emitter = new vscode.EventEmitter<ActiveIntent | undefined | void>();
    readonly onDidChangeTreeData = this.emitter.event;
    private readonly subscription: vscode.Disposable;

    constructor(private readonly runtime: IntentsRuntime) {
        this.subscription = runtime.onDidChange(() => this.emitter.fire());
    }

    dispose(): void {
        this.subscription.dispose();
        this.emitter.dispose();
    }

    getTreeItem(row: ActiveIntent): vscode.TreeItem {
        const text = activeRowText(row, rowNumber(this.runtime.getActive(), row.ticket));
        const item = new vscode.TreeItem(rowLabel(text, row.own), vscode.TreeItemCollapsibleState.None);
        item.id = `intent:${row.ticket}`;
        item.description = text.description;
        item.iconPath = rowIcon(row.icon);
        // The text takes the colour that is in force in the row's window now
        item.resourceUri = rowColorResource(row.color, row.ticket);
        item.contextValue = row.subject;
        item.tooltip = row.subject === 'business' ? row.workspaceFile : `${row.business}\n${row.workspaceFile}`;
        item.command = { command: 'duet.intents.switch', title: 'Переключиться', arguments: [row] };
        return item;
    }

    getChildren(row?: ActiveIntent): ActiveIntent[] {
        return row ? [] : this.runtime.getActive();
    }

    getParent(): undefined {
        return undefined;
    }

    /** The row of this window, when Duet opened it. */
    ownRow(): ActiveIntent | undefined {
        return this.runtime.getActive().find(row => row.own);
    }

    handleDrag(source: readonly ActiveIntent[], dataTransfer: vscode.DataTransfer): void {
        // Every row is dragged, a business window like an intent
        if (source.length > 0) {
            dataTransfer.set(INTENTS_MIME, new vscode.DataTransferItem(source[0].ticket));
        }
    }

    async handleDrop(target: ActiveIntent | undefined, dataTransfer: vscode.DataTransfer): Promise<void> {
        const source = draggedIdentity(dataTransfer.get(INTENTS_MIME)?.value, row => row.ticket);
        if (source === null) {
            return;
        }
        // A drop past the rows has no target: the row goes to the end
        const next = reorderActive(this.runtime.getActive(), source, target?.ticket ?? null, placeNextTo);
        if (next) {
            await this.runtime.saveActiveOrder(next);
        }
    }
}
