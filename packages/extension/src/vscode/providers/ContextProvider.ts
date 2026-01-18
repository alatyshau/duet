import * as vscode from 'vscode';
import { ContextBreadcrumb, BreadcrumbItem } from '../../core/tree/contextBreadcrumb';
import { DatabaseManager } from '../../core/db';

export class ContextProvider implements vscode.TreeDataProvider<BreadcrumbItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<BreadcrumbItem | undefined | null | void> = new vscode.EventEmitter<BreadcrumbItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<BreadcrumbItem | undefined | null | void> = this._onDidChangeTreeData.event;

    private logic: ContextBreadcrumb;

    private _disposable: vscode.Disposable;

    constructor(db: DatabaseManager) {
        this.logic = new ContextBreadcrumb(db);
        
        // Listen to active editor changes
        this._disposable = vscode.window.onDidChangeActiveTextEditor(() => this.refresh());
    }

    dispose() {
        this._disposable.dispose();
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: BreadcrumbItem): vscode.TreeItem {
        const item = new vscode.TreeItem(`${element.emoji} ${element.label}`, vscode.TreeItemCollapsibleState.None);
        item.description = element.type;
        item.tooltip = element.path;
        
        if (element.isWarning) {
            item.iconPath = new vscode.ThemeIcon('warning');
        }

        return item;
    }

    getChildren(element?: BreadcrumbItem): vscode.ProviderResult<BreadcrumbItem[]> {
        if (element) {
            return [];
        }

        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return []; // Empty context if no editor
        }

        const docPath = editor.document.uri.fsPath;
        return this.logic.getContext(docPath);
    }
}
