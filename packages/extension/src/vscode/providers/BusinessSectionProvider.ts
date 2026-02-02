/**
 * BusinessSectionProvider - TreeDataProvider for a single business section
 *
 * Each business gets its own VS Code section (duet.business0...duet.business9).
 * The provider shows children of a specific business by index.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { BusinessTree, TreeNode } from '../../core/tree/businessTree';
import { DatabaseManager } from '../../core/db';
import { normalizePath, isPathInside } from '../../core/pathUtils';

class PlaceholderItem {
    readonly id = 'placeholder';
    readonly label = 'Нажмите ➕ чтобы добавить бизнес';
}

type TreeElement = TreeNode | PlaceholderItem;

const TYPE_LABELS: Record<string, string> = {
    'business': 'бизнес',
    'stream': 'дело',
    'product': 'продукт',
    'project': 'проект'
};

export class BusinessSectionProvider implements vscode.TreeDataProvider<TreeElement> {
    private _onDidChangeTreeData = new vscode.EventEmitter<TreeElement | undefined | null | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private tree: BusinessTree;
    private currentProductNames: Set<string> = new Set();
    private currentOpenPaths: Set<string> = new Set();
    private disposables: vscode.Disposable[] = [];

    constructor(
        private readonly db: DatabaseManager,
        private readonly reposPath: string | undefined,
        private readonly index: number
    ) {
        this.tree = new BusinessTree(db);
        this.updateCurrentContext();
        // Note: workspace folder change listener is centralized in extension.ts
    }

    dispose(): void {
        this.disposables.forEach(d => d.dispose());
        this._onDidChangeTreeData.dispose();
    }

    private updateCurrentContext(): void {
        this.currentProductNames.clear();
        this.currentOpenPaths.clear();

        const folders = vscode.workspace.workspaceFolders;
        if (!folders) {
            return;
        }

        for (const folder of folders) {
            const fsPath = folder.uri.fsPath;
            this.currentOpenPaths.add(normalizePath(fsPath));

            if (this.reposPath && isPathInside(fsPath, this.reposPath)) {
                const folderName = path.basename(fsPath);
                const productName = folderName.endsWith('.git')
                    ? folderName.slice(0, -4)
                    : folderName.replace(/\.wt-\d+$/, '');
                this.currentProductNames.add(productName);
            }
        }
    }

    /**
     * Get the business for this section, or null if index is out of range.
     */
    getBusiness(): TreeNode | null {
        const businesses = this.tree.getRoots();
        return businesses[this.index] ?? null;
    }

    /**
     * Notify that data changed (after external DB reload).
     * Does NOT reload DB - use when DB was already reloaded elsewhere.
     */
    notifyRefresh(): void {
        this.tree.clearCache();
        this.updateCurrentContext();
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: TreeElement): vscode.TreeItem {
        if (element instanceof PlaceholderItem) {
            const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
            item.contextValue = 'placeholder';
            return item;
        }

        const node = element as TreeNode;
        const collapsibleState = node.hasChildren
            ? vscode.TreeItemCollapsibleState.Expanded
            : vscode.TreeItemCollapsibleState.None;

        const isCurrent =
            (node.type === 'product' && this.currentProductNames.has(node.label)) ||
            this.currentOpenPaths.has(normalizePath(node.id));

        const label = isCurrent ? `${node.icon} ${node.label} ●` : `${node.icon} ${node.label}`;
        const item = new vscode.TreeItem(label, collapsibleState);
        item.id = node.id;
        item.resourceUri = vscode.Uri.parse(`duet-tree:/${node.type}/${node.entityId}${isCurrent ? '?active' : ''}`);
        item.iconPath = new vscode.ThemeIcon('blank');
        item.contextValue = node.gitUrl ? `${node.type}-git` : node.type;

        const typeLabel = TYPE_LABELS[node.type];
        item.description = node.gitUrl ? `${typeLabel} [git]` : typeLabel;
        item.tooltip = node.id;

        item.command = {
            command: 'duet.selectNode',
            title: 'Select'
        };

        return item;
    }

    getChildren(element?: TreeElement): vscode.ProviderResult<TreeElement[]> {
        if (!element) {
            const business = this.getBusiness();
            if (!business) {
                return [new PlaceholderItem()];
            }
            return this.tree.getChildren(business.entityId);
        }

        if (element instanceof PlaceholderItem) {
            return [];
        }

        const node = element as TreeNode;
        return this.tree.getChildren(node.entityId);
    }

    getParent(element: TreeElement): vscode.ProviderResult<TreeElement> {
        if (element instanceof PlaceholderItem) {
            return null;
        }
        const node = element as TreeNode;
        const parent = this.tree.getParent(node.entityId);

        // Don't return the business itself as parent (it's not in this tree)
        const business = this.getBusiness();
        if (parent && business && parent.entityId === business.entityId) {
            return null;
        }

        return parent ?? null;
    }

    /**
     * Get all nodes for expand/collapse functionality.
     */
    getAllNodes(): TreeNode[] {
        const business = this.getBusiness();
        if (!business) {
            return [];
        }

        const result: TreeNode[] = [];
        const collectChildren = (parentId: number) => {
            const children = this.tree.getChildren(parentId);
            for (const child of children) {
                result.push(child);
                if (child.hasChildren) {
                    collectChildren(child.entityId);
                }
            }
        };
        collectChildren(business.entityId);
        return result;
    }
}
