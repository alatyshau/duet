import * as vscode from 'vscode';
import { TreeNode } from '../../core/tree/businessTree';
import { BusinessTreeProvider } from './BusinessTreeProvider';

type TreeElement = TreeNode | { id: string };

/**
 * Manages accordion expand/collapse behavior for business tree.
 *
 * Invariants:
 * - Only one business can be expanded at a time
 * - Expanding a business expands all its descendants to leaves
 * - Collapsing a business resets the expanded state
 */
export class AccordionController {
    private isProcessing = false;

    constructor(
        private readonly businessProvider: BusinessTreeProvider,
        private readonly treeView: vscode.TreeView<TreeElement>
    ) {}

    /**
     * Expand a business and all its descendants.
     * Collapses other businesses first (accordion behavior).
     */
    async expandBusiness(entityId: number): Promise<void> {
        if (this.isProcessing) {
            return;
        }
        this.isProcessing = true;

        try {
            const business = this.businessProvider.getRoots()
                .find(b => b.entityId === entityId);
            if (!business) {
                return;
            }

            // Collapse all first (VS Code has no API to collapse specific element)
            const currentExpanded = this.businessProvider.getExpandedBusinessId();
            if (currentExpanded !== null && currentExpanded !== entityId) {
                await vscode.commands.executeCommand(
                    'workbench.actions.treeView.duet.businesses.collapseAll'
                );
            }

            // Remember new expanded business (updates status icon)
            this.businessProvider.setExpandedBusiness(entityId);

            // Expand the business and all its descendants
            await this.treeView.reveal(business, { expand: true, focus: false, select: false });

            const descendants = this.businessProvider.getDescendants(entityId);
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

        // Expand handler: apply accordion behavior when business is expanded
        disposables.push(
            this.treeView.onDidExpandElement(async (e) => {
                const element = e.element;
                // Skip non-TreeNode elements (VisualRoot, PlaceholderItem, SeparatorItem)
                if (!('entityId' in element)) {
                    return;
                }

                const node = element as TreeNode;
                if (node.type === 'business') {
                    await this.expandBusiness(node.entityId);
                }
            })
        );

        // Collapse handler: reset expandedBusinessId when business is collapsed
        disposables.push(
            this.treeView.onDidCollapseElement((e) => {
                const element = e.element;
                if ('entityId' in element) {
                    const node = element as TreeNode;
                    if (node.type === 'business' &&
                        node.entityId === this.businessProvider.getExpandedBusinessId()) {
                        this.businessProvider.setExpandedBusiness(null);
                    }
                }
            })
        );

        return disposables;
    }

    /**
     * Auto-expand business containing active node.
     * Call this after tree view is initialized.
     */
    autoExpandActive(): void {
        const activeBusinessId = this.businessProvider.getActiveBusinessId();
        if (activeBusinessId !== null) {
            // Delay to let tree view initialize
            setTimeout(() => this.expandBusiness(activeBusinessId), 100);
        }
    }
}
