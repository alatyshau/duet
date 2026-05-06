import * as vscode from 'vscode';
import * as path from 'path';
import { BusinessTree, TreeNode } from '../../core/tree/businessTree';
import { StreamEntity } from '../../core/api-client';
import { normalizePath, isPathInside } from '../../core/pathUtils';

class VisualRoot {
    readonly id = 'visual-root';
    readonly label = '[МОИ ДЕЛА]';
}

class PlaceholderItem {
    readonly id = 'placeholder';
    readonly label = 'Нажмите ➕ чтобы добавить бизнес';
}

type SeparatorType = 'line' | 'dots';

class SeparatorItem {
    constructor(readonly index: number, readonly separatorType: SeparatorType = 'line') {}
    get id() { return `separator-${this.separatorType}-${this.index}`; }
    get label() {
        // Experiment 1: solid line + dots
        // return this.separatorType === 'line'
        //     ? '────────────────────────'
        //     : '· · · · · · · · · · · · · · · · · · · · · · · · · · · · · ·';

        // Experiment 2: dots + space
        return this.separatorType === 'line'
            ? '────────────────────────' // '· · · · · · · · · · · · · · · · · · · · · · · · · · · · · ·'
            : ' ';
    }
}

type TreeElement = TreeNode | VisualRoot | PlaceholderItem | SeparatorItem;

// Type labels for description
const TYPE_LABELS: Record<string, string> = {
    'business': 'бизнес',
    'stream': 'дело',
    'product': 'продукт'
};

export class BusinessTreeProvider implements vscode.TreeDataProvider<TreeElement> {
    private _onDidChangeTreeData: vscode.EventEmitter<TreeElement | undefined | null | void> = new vscode.EventEmitter<TreeElement | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<TreeElement | undefined | null | void> = this._onDidChangeTreeData.event;

    private tree: BusinessTree;
    /** Product names extracted from git repos in repos/ folder */
    private currentProductNames: Set<string> = new Set();
    /** Normalized paths of all open workspace folders (for Drive folders) */
    private currentOpenPaths: Set<string> = new Set();
    /** True if all businesses are open (all-businesses workspace) */
    private allBusinessesOpen: boolean = false;
    /** Currently expanded business entityId (for status icon) */
    private expandedBusinessId: number | null = null;
    private disposables: vscode.Disposable[] = [];

    constructor(streams: StreamEntity[], private readonly reposPath?: string) {
        this.tree = new BusinessTree(streams);
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
     * Check if given path is ancestor of any currently open path.
     * Used to highlight businesses that contain open folders.
     */
    private isPathAncestorOfAnyOpen(ancestorPath: string): boolean {
        const normalizedAncestor = normalizePath(ancestorPath);
        for (const openPath of this.currentOpenPaths) {
            if (openPath.startsWith(normalizedAncestor + '/') || openPath === normalizedAncestor) {
                return true;
            }
        }
        // Also check git products (they're in repos/ folder, not under business path)
        // A business is active if any of its products is open
        if (this.currentProductNames.size > 0) {
            // Check if any product under this business is open
            const children = this.tree.getChildren(
                this.tree.getRoots().find(r => normalizePath(r.id) === normalizedAncestor)?.entityId ?? -1
            );
            return this.hasActiveDescendant(children);
        }
        return false;
    }

    /**
     * Recursively check if any descendant is currently active (open).
     */
    private hasActiveDescendant(nodes: TreeNode[]): boolean {
        for (const node of nodes) {
            if (node.type === 'product' && this.currentProductNames.has(node.label)) {
                return true;
            }
            if (this.currentOpenPaths.has(normalizePath(node.id))) {
                return true;
            }
            if (node.hasChildren) {
                const children = this.tree.getChildren(node.entityId);
                if (this.hasActiveDescendant(children)) {
                    return true;
                }
            }
        }
        return false;
    }

    /**
     * Update sets of currently open folders for highlighting.
     * Tracks both:
     * - Product names from git repos (repos/*.git)
     * - Direct Drive folder paths (for business/stream/product on Drive)
     * Also detects if all businesses are open (all-businesses workspace).
     */
    private updateCurrentContext(): void {
        this.currentProductNames.clear();
        this.currentOpenPaths.clear();
        this.allBusinessesOpen = false;

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

        // Check if all businesses are open (marker goes to [МОИ ДЕЛА] instead)
        const businesses = this.tree.getRoots();
        if (businesses.length > 0) {
            const allOpen = businesses.every(b => this.currentOpenPaths.has(normalizePath(b.id)));
            this.allBusinessesOpen = allOpen && businesses.length === this.currentOpenPaths.size;
        }
    }

    /**
     * Update streams data (after scan/refresh).
     * Replaces entire dataset and rebuilds tree.
     */
    updateStreams(streams: StreamEntity[]): void {
        this.tree.updateStreams(streams);
        this.updateCurrentContext();
        this._onDidChangeTreeData.fire();
    }

    /**
     * Refresh tree display (without data reload).
     * Used when only visual state changed.
     */
    refresh(): void {
        this.tree.clearCache();
        this.updateCurrentContext();
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: TreeElement): vscode.TreeItem {
        if (element instanceof VisualRoot) {
            // Add marker if all businesses are open
            const label = this.allBusinessesOpen ? `${element.label} ●` : element.label;
            const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
            item.contextValue = 'header';
            item.tooltip = 'Открыть все бизнесы в multi-root workspace';
            return item;
        }

        if (element instanceof PlaceholderItem) {
            const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
            item.contextValue = 'placeholder';
            return item;
        }

        if (element instanceof SeparatorItem) {
            const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
            item.id = element.id;
            // resourceUri for gray color via TreeDecorationProvider
            item.resourceUri = vscode.Uri.parse(`duet-tree:/separator/${element.index}`);
            item.iconPath = new vscode.ThemeIcon('blank');
            item.contextValue = 'separator'; // Exclude from inline buttons
            return item;
        }

        const node = element as TreeNode;
        // Start collapsed - accordion logic in extension.ts handles expand
        const collapsibleState = node.hasChildren
            ? vscode.TreeItemCollapsibleState.Collapsed
            : vscode.TreeItemCollapsibleState.None;

        // Check if this node is currently open (git product by name, or Drive folder by path)
        // Skip marker for businesses if all businesses are open (marker is on [МОИ ДЕЛА])
        const isCurrent =
            !this.allBusinessesOpen &&
            ((node.type === 'product' && this.currentProductNames.has(node.label)) ||
            this.currentOpenPaths.has(normalizePath(node.id)));

        // For businesses, check if any open path is inside this business
        const isBusinessActive = node.type === 'business' && this.isPathAncestorOfAnyOpen(node.id);

        // Build label: businesses get status circle + brackets
        // 🔷 closed + inactive, 🔵 open + inactive, 🔶 closed + active, 🟠 open + active
        let label: string;
        if (node.type === 'business') {
            const isExpanded = this.expandedBusinessId === node.entityId;
            let statusCircle: string;
            if (isExpanded && isBusinessActive) {
                statusCircle = '🟧'; // 🟠🟧🔶
            } else if (isExpanded && !isBusinessActive) {
                statusCircle = '🟦'; // 🔵🟦🔷
            } else if (!isExpanded && isBusinessActive) {
                statusCircle = '🔸'; // 🔶🔸
            } else {
                statusCircle = '🔹'; // 🔷🔹
            }
            label = `${statusCircle} ${node.icon} [${node.label}]`;
        } else {
            // Non-business nodes inside business get ▫️ prefix
            // Highlight entire ancestor chain: current OR has active descendant
            const hasActiveChild = node.hasChildren && this.hasActiveDescendant(this.tree.getChildren(node.entityId));
            const isInActiveChain = isCurrent || hasActiveChild;
            label = isInActiveChain ? `🟠 ${node.icon} ${node.label}` : `◻️ ${node.icon} ${node.label}`;
            // ⚪️ ⬜️ ◻️ ◽️ ▫️
        }
        const item = new vscode.TreeItem(label, collapsibleState);
        item.id = node.id;
        item.contextValue = node.gitUrl ? `${node.type}-git` : node.type;

        // Add type description (with git marker for products with git_url)
        const typeLabel = TYPE_LABELS[node.type];
        item.description = node.gitUrl ? `${typeLabel} [git]` : typeLabel;

        // Tooltip with path
        item.tooltip = node.id;

        // Noop command to prevent toggle on label click (toggle only via arrow)
        item.command = {
            command: 'duet.selectNode',
            title: 'Select'
        };

        return item;
    }

    getChildren(element?: TreeElement): vscode.ProviderResult<TreeElement[]> {
        if (!element) {
            // Root level: VisualRoot + Businesses with separators between them
            const businesses = this.tree.getRoots();
            const root = new VisualRoot();
            if (businesses.length === 0) {
                return [root, new PlaceholderItem()];
            }
            // Wrap businesses with line separators (before first, between, after last)
            const result: TreeElement[] = [root];
            result.push(new SeparatorItem(0, 'line')); // Before first
            businesses.forEach((biz, idx) => {
                result.push(biz);
                result.push(new SeparatorItem(idx + 1, 'line')); // After each
            });
            return result;
        }

        if (element instanceof VisualRoot || element instanceof PlaceholderItem || element instanceof SeparatorItem) {
            return [];
        }

        const node = element as TreeNode;
        const children = this.tree.getChildren(node.entityId);

        // For businesses, add dots separators between first-level children
        if (node.type === 'business' && children.length > 0) {
            const result: TreeElement[] = [];
            result.push(new SeparatorItem(1000 + node.entityId * 100, 'dots')); // Before first child
            children.forEach((child, idx) => {
                result.push(child);
                result.push(new SeparatorItem(1000 + node.entityId * 100 + idx + 1, 'dots')); // After each child
            });
            return result;
        }

        return children;
    }

    getParent(element: TreeElement): vscode.ProviderResult<TreeElement> {
        if (element instanceof VisualRoot || element instanceof PlaceholderItem || element instanceof SeparatorItem) {
            return null;
        }
        const node = element as TreeNode;
        const parent = this.tree.getParent(node.entityId);
        return parent ?? null;
    }

    getAllNodes(): TreeNode[] {
        return this.tree.getAllNodes();
    }

    /**
     * Get root businesses (for accordion logic).
     */
    getRoots(): TreeNode[] {
        return this.tree.getRoots();
    }

    /**
     * Get all descendants of a node (for expanding to leaves).
     */
    getDescendants(entityId: number): TreeNode[] {
        return this.tree.getDescendants(entityId);
    }

    /**
     * Get currently expanded business entityId.
     */
    getExpandedBusinessId(): number | null {
        return this.expandedBusinessId;
    }

    /**
     * Find business that contains an active (open) node.
     * Returns the first active business entityId, or null if none.
     */
    getActiveBusinessId(): number | null {
        if (this.allBusinessesOpen) {
            return null; // All businesses open - no single active
        }
        const businesses = this.tree.getRoots();
        for (const biz of businesses) {
            if (this.isPathAncestorOfAnyOpen(biz.id)) {
                return biz.entityId;
            }
        }
        return null;
    }

    /**
     * Set currently expanded business (for status icon).
     * Pass null when collapsed.
     */
    setExpandedBusiness(entityId: number | null): void {
        const prevId = this.expandedBusinessId;
        this.expandedBusinessId = entityId;

        // Refresh affected businesses to update their icons
        const roots = this.tree.getRoots();
        if (prevId !== null) {
            const prev = roots.find(r => r.entityId === prevId);
            if (prev) {
                this._onDidChangeTreeData.fire(prev);
            }
        }
        if (entityId !== null) {
            const current = roots.find(r => r.entityId === entityId);
            if (current) {
                this._onDidChangeTreeData.fire(current);
            }
        }
    }
}
