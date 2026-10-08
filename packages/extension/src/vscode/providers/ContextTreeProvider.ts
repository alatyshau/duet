import * as vscode from 'vscode';
import { ContextTree, TreeNode } from '../../core/tree/contextTree';
import { ContextEntity } from '../../core/api-client';
import { normalizePath } from '../../core/pathUtils';

class PlaceholderItem {
    readonly id = 'placeholder';
    readonly label = 'Добавьте root-контекст в Duet Host';
}

// 'line' = solid horizontal rule between root contexts.
// 'spacer' = blank row between first-level children of a root (empty label
// renders as transparent gap; previously misnamed 'dots' before the dotted
// variant was dropped in favour of cleaner whitespace).
type SeparatorType = 'line' | 'spacer';

class SeparatorItem {
    constructor(readonly index: number, readonly separatorType: SeparatorType = 'line') {}
    get id() { return `separator-${this.separatorType}-${this.index}`; }
    get label() {
        return this.separatorType === 'line'
            ? '────────────────────────'
            : ' ';
    }
}

type TreeElement = TreeNode | PlaceholderItem | SeparatorItem;

function describeContext(node: TreeNode): string | undefined {
    return node.hasGit ? '[git]' : undefined;
}

export class ContextTreeProvider implements vscode.TreeDataProvider<TreeElement> {
    private _onDidChangeTreeData: vscode.EventEmitter<TreeElement | undefined | null | void> = new vscode.EventEmitter<TreeElement | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<TreeElement | undefined | null | void> = this._onDidChangeTreeData.event;

    private tree: ContextTree;
    /** Normalized paths of the open workspace folders that mark businesses (see `updateCurrentContext`) */
    private currentOpenPaths: Set<string> = new Set();
    /** Currently expanded root entityId (for status icon) */
    private expandedRootId: number | null = null;
    private disposables: vscode.Disposable[] = [];

    constructor(contexts: ContextEntity[]) {
        this.tree = new ContextTree(contexts);
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
     * Used to highlight roots that contain open folders.
     */
    private isPathAncestorOfAnyOpen(ancestorPath: string): boolean {
        const normalizedAncestor = normalizePath(ancestorPath);
        for (const openPath of this.currentOpenPaths) {
            if (openPath.startsWith(normalizedAncestor + '/') || openPath === normalizedAncestor) {
                return true;
            }
        }
        return false;
    }

    /**
     * Recursively check if any descendant is currently active: its business
     * folder is among the window's folders.
     */
    private hasActiveDescendant(nodes: TreeNode[]): boolean {
        for (const node of nodes) {
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
     * Update the set of currently open folders for highlighting.
     * A business is current only when its own folder is among them: a repo
     * folder marks nobody, because one repo may be declared by several
     * businesses. The window of a meta business also holds the folders of the
     * other ventures: there the meta business alone is current — the rule of
     * `core/tree/contextPanel.ts:findCurrentBusiness`, the meta business wins.
     */
    private updateCurrentContext(): void {
        this.currentOpenPaths.clear();

        const folders = vscode.workspace.workspaceFolders;
        if (!folders) {
            return;
        }

        for (const folder of folders) {
            this.currentOpenPaths.add(normalizePath(folder.uri.fsPath));
        }

        const openMeta = this.tree.getAllNodes()
            .find(node => node.meta && this.currentOpenPaths.has(normalizePath(node.id)));
        if (openMeta) {
            this.currentOpenPaths = new Set([normalizePath(openMeta.id)]);
        }
    }

    /**
     * Update contexts data (after scan/refresh).
     * Replaces entire dataset and rebuilds tree.
     */
    updateContexts(contexts: ContextEntity[]): void {
        this.tree.updateContexts(contexts);
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

        // Check if this node is currently open: its business folder is among the
        // window's folders.
        const isCurrent = this.currentOpenPaths.has(normalizePath(node.id));

        // For roots, check if any open path is inside this root.
        const isRootActive = node.isRoot && this.isPathAncestorOfAnyOpen(node.id);

        // Build label: roots get status circle + brackets.
        // 🔷 closed + inactive, 🔵 open + inactive, 🔶 closed + active, 🟠 open + active
        let label: string;
        if (node.isRoot) {
            const isExpanded = this.expandedRootId === node.entityId;
            let statusCircle: string;
            if (isExpanded && isRootActive) {
                statusCircle = '🟧';
            } else if (isExpanded && !isRootActive) {
                statusCircle = '🟦';
            } else if (!isExpanded && isRootActive) {
                statusCircle = '🔸';
            } else {
                statusCircle = '🔹';
            }
            label = `${statusCircle} ${node.icon} [${node.label}]`;
        } else {
            // Non-root nodes get ◻️ prefix.
            // Highlight entire ancestor chain: current OR has active descendant.
            const hasActiveChild = node.hasChildren && this.hasActiveDescendant(this.tree.getChildren(node.entityId));
            const isInActiveChain = isCurrent || hasActiveChild;
            label = isInActiveChain ? `🟠 ${node.icon} ${node.label}` : `◻️ ${node.icon} ${node.label}`;
        }
        const item = new vscode.TreeItem(label, collapsibleState);
        item.id = node.id;
        // contextValue is used by package.json menu when-clauses; keep `context-git`/`context` shape.
        item.contextValue = node.hasGit ? 'context-git' : 'context';

        item.description = describeContext(node);

        // Tooltip with path
        item.tooltip = node.id;

        // Noop command to prevent toggle on label click (toggle only via arrow)
        item.command = {
            command: 'duet.contexts.select',
            title: 'Select',
            arguments: [node]
        };

        return item;
    }

    getChildren(element?: TreeElement): vscode.ProviderResult<TreeElement[]> {
        if (!element) {
            // Root level: roots with separators between them
            const roots = this.tree.getRoots();
            if (roots.length === 0) {
                return [new PlaceholderItem()];
            }
            const result: TreeElement[] = [];
            result.push(new SeparatorItem(0, 'line')); // Before first
            roots.forEach((root, idx) => {
                result.push(root);
                result.push(new SeparatorItem(idx + 1, 'line')); // After each
            });
            return result;
        }

        if (element instanceof PlaceholderItem || element instanceof SeparatorItem) {
            return [];
        }

        const node = element as TreeNode;
        const children = this.tree.getChildren(node.entityId);

        // For roots, add dots separators between first-level children.
        if (node.isRoot && children.length > 0) {
            const result: TreeElement[] = [];
            result.push(new SeparatorItem(1000 + node.entityId * 100, 'spacer')); // Before first child
            children.forEach((child, idx) => {
                result.push(child);
                result.push(new SeparatorItem(1000 + node.entityId * 100 + idx + 1, 'spacer')); // After each child
            });
            return result;
        }

        return children;
    }

    getParent(element: TreeElement): vscode.ProviderResult<TreeElement> {
        if (element instanceof PlaceholderItem || element instanceof SeparatorItem) {
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
     * Get root contexts (for accordion logic).
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
     * Get currently expanded root entityId.
     */
    getExpandedRootId(): number | null {
        return this.expandedRootId;
    }

    /**
     * Find root that contains an active (open) node.
     * Returns the first active root entityId, or null if none.
     */
    getActiveRootId(): number | null {
        const roots = this.tree.getRoots();
        for (const root of roots) {
            if (this.isPathAncestorOfAnyOpen(root.id)) {
                return root.entityId;
            }
        }
        return null;
    }

    /**
     * Set currently expanded root (for status icon).
     * Pass null when collapsed.
     */
    setExpandedRoot(entityId: number | null): void {
        const prevId = this.expandedRootId;
        this.expandedRootId = entityId;

        // Refresh affected roots to update their icons
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
