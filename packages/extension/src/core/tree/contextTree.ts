import { ContextEntity, PrimaryFolder } from '../api-client';

/**
 * Sort order: meta-context first, everything else alphabetically. `hasGit` doesn't
 * change position — terminal contexts mix with intermediates by name. Decision:
 * `stabilize-taxonomy-migration` (rename-taxonomy saga).
 */
function compareTreeNodes(a: TreeNode, b: TreeNode): number {
    if (a.meta !== b.meta) {
        return a.meta ? -1 : 1;
    }
    return a.label.localeCompare(b.label);
}

export interface TreeNode {
    id: string; // absolute_path (for path comparison with workspace folders)
    label: string;
    icon: string;
    type: 'context';
    /** True when this node has no parent in the tree (top-level context). */
    isRoot: boolean;
    /** True for meta-context (e.g. !БАЗА). One per workspace. */
    meta: boolean;
    /** True when context has one or more `git_repos` aliases (terminal). */
    hasGit: boolean;
    hasChildren: boolean;
    entityId: number;
    /** Map alias → git URL from `git_repos`. Empty when context is not terminal. */
    gitRepos: Record<string, string>;
    referenceRepos?: Record<string, string>;
    /**
     * Optional UX hints from `workspace_config` in `context.json`. Currently only
     * `primaryFolder` — which folder appears first in the generated multi-root
     * workspace. Absent → `"git"` (cloned repos first, Drive folder last).
     */
    workspaceConfig?: { primaryFolder: PrimaryFolder };
}

export class ContextTree {
    private nodeCache = new Map<number, TreeNode>();
    private contexts: ContextEntity[];

    constructor(contexts: ContextEntity[]) {
        this.contexts = contexts;
    }

    updateContexts(contexts: ContextEntity[]): void {
        this.contexts = contexts;
        this.nodeCache.clear();
    }

    clearCache(): void {
        this.nodeCache.clear();
    }

    getRoots(): TreeNode[] {
        return this.contexts
            .filter(c => c.parent_id === null)
            .map(c => this.mapEntity(c))
            .sort(compareTreeNodes);
    }

    getChildren(parentId: number): TreeNode[] {
        const parentIdStr = String(parentId);
        return this.contexts
            .filter(c => c.parent_id === parentIdStr)
            .map(c => this.mapEntity(c))
            .sort(compareTreeNodes);
    }

    getAllNodes(): TreeNode[] {
        return this.contexts.map(c => this.mapEntity(c));
    }

    getParent(entityId: number): TreeNode | null {
        const entityIdStr = String(entityId);
        const entity = this.contexts.find(c => c.id === entityIdStr);
        if (!entity || !entity.parent_id) {
            return null;
        }
        const parent = this.contexts.find(c => c.id === entity.parent_id);
        return parent ? this.mapEntity(parent) : null;
    }

    /**
     * Get all descendants of a node (for expanding to leaves).
     * Returns nodes in BFS order (parent before children).
     */
    getDescendants(entityId: number): TreeNode[] {
        const result: TreeNode[] = [];
        const queue = [entityId];

        while (queue.length > 0) {
            const currentId = queue.shift()!;
            const children = this.getChildren(currentId);
            for (const child of children) {
                result.push(child);
                if (child.hasChildren) {
                    queue.push(child.entityId);
                }
            }
        }

        return result;
    }

    private mapEntity(context: ContextEntity): TreeNode {
        const numId = parseInt(context.id, 10);
        if (this.nodeCache.has(numId)) {
            return this.nodeCache.get(numId)!;
        }

        const gitRepos = context.git_repos ?? {};
        const node: TreeNode = {
            id: context.absolute_path ?? context.path,
            label: context.name,
            icon: context.icon ?? '',
            type: 'context',
            isRoot: context.parent_id === null,
            meta: context.meta,
            hasGit: Object.keys(gitRepos).length > 0,
            hasChildren: this.contexts.some(c => c.parent_id === context.id),
            entityId: numId,
            gitRepos,
            referenceRepos: context.reference_repos ?? undefined,
            workspaceConfig: context.workspace_config
                ? { primaryFolder: context.workspace_config.primary_folder }
                : undefined,
        };

        this.nodeCache.set(numId, node);
        return node;
    }
}
