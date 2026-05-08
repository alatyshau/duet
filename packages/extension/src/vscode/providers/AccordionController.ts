import * as vscode from 'vscode';
import { TreeNode } from '../../core/tree/contextTree';
import { ContextTreeProvider } from './ContextTreeProvider';

type TreeElement = TreeNode | { id: string };

/**
 * Manages accordion expand/collapse behavior for the context tree.
 *
 * Invariants:
 * - Only one root context can be expanded at a time
 * - Expanding a root expands all its descendants to leaves
 * - Collapsing a root resets the expanded state
 */
export class AccordionController {
    private isProcessing = false;

    constructor(
        private readonly contextProvider: ContextTreeProvider,
        private readonly treeView: vscode.TreeView<TreeElement>
    ) {}

    /**
     * Expand a root context and all its descendants.
     * Collapses other roots first (accordion behavior).
     */
    async expandRoot(entityId: number): Promise<void> {
        if (this.isProcessing) {
            return;
        }
        this.isProcessing = true;

        try {
            const root = this.contextProvider.getRoots()
                .find(r => r.entityId === entityId);
            if (!root) {
                return;
            }

            // Collapse all first (VS Code has no API to collapse a specific element)
            const currentExpanded = this.contextProvider.getExpandedRootId();
            if (currentExpanded !== null && currentExpanded !== entityId) {
                await vscode.commands.executeCommand(
                    'workbench.actions.treeView.duet.contexts.collapseAll'
                );
            }

            // Remember new expanded root (updates status icon)
            this.contextProvider.setExpandedRoot(entityId);

            // Expand the root and all its descendants
            await this.treeView.reveal(root, { expand: true, focus: false, select: false });

            const descendants = this.contextProvider.getDescendants(entityId);
            for (const descendant of descendants) {
                if (descendant.hasChildren) {
                    try {
                        await this.treeView.reveal(descendant, { expand: true, focus: false, select: false });
                    } catch {
                        // Ignore reveal errors (element may not be visible yet)
                    }
                }
            }
        } finally {
            this.isProcessing = false;
        }
    }

    /**
     * Register event listeners for accordion behavior.
     * Call this after creating the tree view.
     */
    registerListeners(): vscode.Disposable[] {
        const disposables: vscode.Disposable[] = [];

        // Expand handler: apply accordion behavior when a root is expanded
        disposables.push(
            this.treeView.onDidExpandElement(async (e) => {
                const element = e.element;
                // Skip non-TreeNode elements (VisualRoot, PlaceholderItem, SeparatorItem)
                if (!('entityId' in element)) {
                    return;
                }

                const node = element as TreeNode;
                if (node.isRoot) {
                    await this.expandRoot(node.entityId);
                }
            })
        );

        // Collapse handler: reset expandedRootId when a root is collapsed
        disposables.push(
            this.treeView.onDidCollapseElement((e) => {
                const element = e.element;
                if ('entityId' in element) {
                    const node = element as TreeNode;
                    if (node.isRoot &&
                        node.entityId === this.contextProvider.getExpandedRootId()) {
                        this.contextProvider.setExpandedRoot(null);
                    }
                }
            })
        );

        return disposables;
    }

    /**
     * Auto-expand the root containing an active node.
     * Call this after tree view is initialized.
     */
    autoExpandActive(): void {
        const activeRootId = this.contextProvider.getActiveRootId();
        if (activeRootId !== null) {
            // Delay to let tree view initialize
            setTimeout(() => this.expandRoot(activeRootId), 100);
        }
    }
}
