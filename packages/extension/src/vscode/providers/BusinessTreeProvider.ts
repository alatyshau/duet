import * as vscode from 'vscode';
import { BusinessTree, TreeNode } from '../../core/tree/businessTree';
import { DatabaseManager } from '../../core/db';

class VisualRoot {
    readonly id = 'visual-root';
    readonly label = '[МОИ ДЕЛА]';
}

class PlaceholderItem {
    readonly id = 'placeholder';
    readonly label = 'Нажмите ➕ чтобы добавить бизнес';
}

type TreeElement = TreeNode | VisualRoot | PlaceholderItem;

export class BusinessTreeProvider implements vscode.TreeDataProvider<TreeElement> {
    private _onDidChangeTreeData: vscode.EventEmitter<TreeElement | undefined | null | void> = new vscode.EventEmitter<TreeElement | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<TreeElement | undefined | null | void> = this._onDidChangeTreeData.event;

    private tree: BusinessTree;

    constructor(private readonly db: DatabaseManager, private readonly wasmPath: string) {
        this.tree = new BusinessTree(db);
    }

    async refresh(): Promise<void> {
        await this.db.reload({ wasmPath: this.wasmPath });
        this.tree.clearCache();
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: TreeElement): vscode.TreeItem {
        if (element instanceof VisualRoot) {
            const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
            item.contextValue = 'header';
            return item;
        }

        if (element instanceof PlaceholderItem) {
            const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
            item.contextValue = 'placeholder';
            return item;
        }

        const node = element as TreeNode;
        const collapsibleState = node.hasChildren
            ? vscode.TreeItemCollapsibleState.Collapsed
            : vscode.TreeItemCollapsibleState.None;

        // Use emoji in label
        const item = new vscode.TreeItem(`${node.icon} ${node.label}`, collapsibleState);
        item.id = node.id;
        item.contextValue = node.gitUrl ? `${node.type}-git` : node.type;

        return item;
    }

    getChildren(element?: TreeElement): vscode.ProviderResult<TreeElement[]> {
        if (!element) {
            // Root level: VisualRoot + Businesses (or placeholder if empty)
            const businesses = this.tree.getRoots();
            const root = new VisualRoot();
            if (businesses.length === 0) {
                return [root, new PlaceholderItem()];
            }
            return [root, ...businesses];
        }

        if (element instanceof VisualRoot || element instanceof PlaceholderItem) {
            return [];
        }

        const node = element as TreeNode;
        return this.tree.getChildren(node.entityId);
    }

    getParent(element: TreeElement): vscode.ProviderResult<TreeElement> {
        if (element instanceof VisualRoot || element instanceof PlaceholderItem) {
            return null;
        }
        const node = element as TreeNode;
        const parent = this.tree.getParent(node.entityId);
        return parent ?? null;
    }

    getAllNodes(): TreeNode[] {
        return this.tree.getAllNodes();
    }
}
