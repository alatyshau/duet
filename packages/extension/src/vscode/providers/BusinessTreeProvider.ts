import * as vscode from 'vscode';
import * as path from 'path';
import { BusinessTree, TreeNode } from '../../core/tree/businessTree';
import { DatabaseManager } from '../../core/db';
import { normalizePath, isPathInside } from '../../core/pathUtils';

class VisualRoot {
    readonly id = 'visual-root';
    readonly label = '[МОИ ДЕЛА]';
}

class PlaceholderItem {
    readonly id = 'placeholder';
    readonly label = 'Нажмите ➕ чтобы добавить бизнес';
}

type TreeElement = TreeNode | VisualRoot | PlaceholderItem;

// Type labels for description
const TYPE_LABELS: Record<string, string> = {
    'business': 'бизнес',
    'stream': 'дело',
    'product': 'продукт',
    'project': 'проект'
};

export class BusinessTreeProvider implements vscode.TreeDataProvider<TreeElement> {
    private _onDidChangeTreeData: vscode.EventEmitter<TreeElement | undefined | null | void> = new vscode.EventEmitter<TreeElement | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<TreeElement | undefined | null | void> = this._onDidChangeTreeData.event;

    private tree: BusinessTree;
    /** Product names extracted from git repos in repos/ folder */
    private currentProductNames: Set<string> = new Set();
    /** Normalized paths of all open workspace folders (for Drive folders) */
    private currentOpenPaths: Set<string> = new Set();
    private disposables: vscode.Disposable[] = [];

    constructor(private readonly db: DatabaseManager, private readonly wasmPath: string, private readonly reposPath?: string) {
        this.tree = new BusinessTree(db);
        this.updateCurrentContext();

        // Listen to workspace folder changes
        this.disposables.push(
            vscode.workspace.onDidChangeWorkspaceFolders(() => {
                this.updateCurrentContext();
                this._onDidChangeTreeData.fire();
            })
        );
    }

    dispose(): void {
        this.disposables.forEach(d => d.dispose());
    }

    /**
     * Update sets of currently open folders for highlighting.
     * Tracks both:
     * - Product names from git repos (repos/*.git)
     * - Direct Drive folder paths (for business/stream/product on Drive)
     */
    private updateCurrentContext(): void {
        this.currentProductNames.clear();
        this.currentOpenPaths.clear();
        const folders = vscode.workspace.workspaceFolders;
        if (!folders) {
            return;
        }

        for (const folder of folders) {
            const fsPath = folder.uri.fsPath;

            // Always add to open paths (for Drive folders)
            this.currentOpenPaths.add(normalizePath(fsPath));

            // Check if folder is in repos/ directory (for git products)
            if (this.reposPath && isPathInside(fsPath, this.reposPath)) {
                // Extract product name from folder name (remove .git suffix)
                const folderName = path.basename(fsPath);
                const productName = folderName.endsWith('.git')
                    ? folderName.slice(0, -4)
                    : folderName.replace(/\.wt-\d+$/, ''); // Handle worktrees
                this.currentProductNames.add(productName);
            }
        }
    }

    async refresh(): Promise<void> {
        await this.db.reload({ wasmPath: this.wasmPath });
        this.tree.clearCache();
        this.updateCurrentContext();
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: TreeElement): vscode.TreeItem {
        if (element instanceof VisualRoot) {
            const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
            item.contextValue = 'header';
            item.tooltip = 'Открыть все бизнесы в multi-root workspace';
            return item;
        }

        if (element instanceof PlaceholderItem) {
            const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
            item.contextValue = 'placeholder';
            return item;
        }

        const node = element as TreeNode;
        const collapsibleState = node.hasChildren
            ? vscode.TreeItemCollapsibleState.Expanded
            : vscode.TreeItemCollapsibleState.None;

        // Check if this node is currently open (git product by name, or Drive folder by path)
        const isCurrent =
            (node.type === 'product' && this.currentProductNames.has(node.label)) ||
            this.currentOpenPaths.has(normalizePath(node.id));

        // Use emoji in label, add marker for current
        const label = isCurrent ? `${node.icon} ${node.label} ●` : `${node.icon} ${node.label}`;
        const item = new vscode.TreeItem(label, collapsibleState);
        item.id = node.id;
        item.contextValue = node.gitUrl ? `${node.type}-git` : node.type;

        // Add type description (with git marker for products with git_url)
        const typeLabel = TYPE_LABELS[node.type];
        item.description = node.gitUrl ? `${typeLabel} [git]` : typeLabel;

        // Tooltip with path
        item.tooltip = node.id;

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
