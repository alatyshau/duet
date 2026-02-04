/**
 * ContextProvider - TreeDataProvider for the КОНТЕКСТ section
 *
 * Shows the current VS Code window's position in the business hierarchy.
 * Source: vscode.workspace.workspaceFolders (NOT active editor).
 *
 * Features:
 * - Displays hierarchy as expandable tree (collapsibleState.Expanded)
 * - Merges common ancestors when multiple folders from same business
 * - Shows errors/warnings for orphan repos, external folders
 * - Listens to workspace folder changes for live updates
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { ContextBreadcrumb, ContextNode } from '../../core/tree/contextBreadcrumb';
import { DatabaseManager } from '../../core/db';
import { Paths } from '../../core/paths';

/**
 * TreeDataProvider for the КОНТЕКСТ section in sidebar.
 *
 * Transforms ContextNode tree into VS Code TreeItems.
 */
export class ContextProvider implements vscode.TreeDataProvider<ContextNode> {
    private _onDidChangeTreeData = new vscode.EventEmitter<ContextNode | undefined | null | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private readonly logic: ContextBreadcrumb;
    private roots: ContextNode[] = [];
    private disposables: vscode.Disposable[] = [];

    constructor(db: DatabaseManager, paths: Paths) {
        this.logic = new ContextBreadcrumb({
            db,
            reposPath: paths.reposPath
        });

        // Listen to workspace folder changes
        this.disposables.push(
            vscode.workspace.onDidChangeWorkspaceFolders(() => this.refresh())
        );

        // Initial build
        this.rebuildTree();
    }

    dispose(): void {
        this.disposables.forEach(d => d.dispose());
        this._onDidChangeTreeData.dispose();
    }

    /**
     * Refresh the tree. Called after scan or workspace changes.
     */
    refresh(): void {
        this.rebuildTree();
        this._onDidChangeTreeData.fire();
    }

    /**
     * Rebuild internal tree structure from current workspace folders.
     */
    private rebuildTree(): void {
        const folders = vscode.workspace.workspaceFolders;
        if (!folders || folders.length === 0) {
            this.roots = [];
            return;
        }

        const paths = folders.map(f => f.uri.fsPath);
        this.roots = this.logic.build(paths);
    }

    getTreeItem(element: ContextNode): vscode.TreeItem {
        const hasChildren = element.children.length > 0;

        // Always expanded for hierarchy visibility
        const collapsibleState = hasChildren
            ? vscode.TreeItemCollapsibleState.Expanded
            : vscode.TreeItemCollapsibleState.None;

        const item = new vscode.TreeItem(this.formatLabel(element), collapsibleState);

        // Use path as id for tree state stability
        item.id = element.path;
        item.tooltip = this.formatTooltip(element);

        // Set icon based on type (currently unused, returns undefined)
        item.iconPath = this.getIcon(element);

        // Set description (type label on the right)
        item.description = this.getTypeLabel(element);

        // Context value for menu filtering
        item.contextValue = element.type;

        // For error nodes, make them clickable to show help
        // Only child error nodes are clickable, not parent folders with errorCode
        if (element.type === 'error') {
            item.command = {
                command: 'duet.showContextHelp',
                title: 'Show Help',
                arguments: [element]
            };
        }

        return item;
    }

    getChildren(element?: ContextNode): vscode.ProviderResult<ContextNode[]> {
        if (!element) {
            return this.roots;
        }
        return element.children;
    }

    getParent(element: ContextNode): vscode.ProviderResult<ContextNode> {
        // Find parent by traversing the tree
        return this.findParent(this.roots, element);
    }

    /**
     * Find parent node in tree.
     */
    private findParent(nodes: ContextNode[], target: ContextNode): ContextNode | null {
        for (const node of nodes) {
            if (node.children.find(c => c.path === target.path)) {
                return node;
            }
            const found = this.findParent(node.children, target);
            if (found) {
                return found;
            }
        }
        return null;
    }

    /**
     * Format display label for a node.
     */
    private formatLabel(node: ContextNode): string {
        if (node.type === 'error') {
            // Error nodes: emoji prefix + message
            const prefix = node.icon === 'info' ? 'ℹ️' : '⚠️';
            return `${prefix} ${node.name}`;
        }
        // Git nodes: folder emoji + name
        if (node.type === 'git') {
            return `📁 ${node.name}`;
        }
        // Entity types with icon from DB: emoji + name
        if (node.icon) {
            return `${node.icon} ${node.name}`;
        }
        // Others: just name
        return node.name;
    }

    /**
     * Get human-readable error message.
     */
    private getErrorMessage(code?: string): string {
        switch (code) {
            case 'orphan':
                return 'Репозиторий не связан';
            case 'name_conflict':
                return 'Имя занято';
            case 'outside_repos':
                return 'Репозиторий вне DuetData';
            case 'outside_hierarchy':
                return 'Папка вне иерархии';
            default:
                return 'Ошибка';
        }
    }

    /**
     * Format tooltip for a node.
     */
    private formatTooltip(node: ContextNode): string {
        if (node.errorCode) {
            return `${this.getErrorMessage(node.errorCode)}\n${node.path}`;
        }
        return node.path;
    }

    /**
     * Get icon for a node.
     */
    private getIcon(_node: ContextNode): vscode.ThemeIcon | undefined {
        // No ThemeIcon - all nodes use emoji in label text
        return undefined;
    }

    /**
     * Get type label for description (shown on the right).
     */
    private getTypeLabel(node: ContextNode): string | undefined {
        const labels: Record<string, string> = {
            'business': 'бизнес',
            'stream': 'дело',
            'product': 'продукт',
            'git': 'git-repo',
            'external': 'внешняя'
        };

        return labels[node.type];
    }
}

/**
 * Command handler for opening DuetData folder in system file manager.
 */
export async function openDataFolderCommand(paths: Paths): Promise<void> {
    const dataFolder = path.dirname(paths.reposPath);
    await vscode.env.openExternal(vscode.Uri.file(dataFolder));
}

/**
 * Command handler for context help (clicking on error nodes).
 */
export async function showContextHelpCommand(node: ContextNode): Promise<void> {
    // For now, show a simple message. In future, this could open an Editor Tab (WebView).
    let message: string;
    let actions: string[] = [];

    switch (node.errorCode) {
        case 'orphan':
            message = `Репозиторий "${node.name}" не связан ни с одним продуктом в иерархии.\n\nЧтобы связать, добавьте product.json на Google Drive с таким же именем.`;
            break;
        case 'name_conflict':
            message = `Имя "${node.name}" уже занято другой сущностью (не продуктом).\n\nПереименуйте папку репозитория или измените имя в манифесте на Drive.`;
            break;
        case 'outside_repos':
            message = `Репозиторий находится вне папки DuetData/repos/.\n\nПереместите его в ~/DuetData/repos/ для корректной работы.`;
            break;
        case 'outside_hierarchy':
            message = `Папка не входит в бизнес-иерархию.\n\nДобавьте бизнес-папку через кнопку ➕ в секции ДЕЛА.`;
            break;
        default:
            message = `Неизвестная ошибка для "${node.name}"`;
    }

    await vscode.window.showInformationMessage(message, ...actions);
}
