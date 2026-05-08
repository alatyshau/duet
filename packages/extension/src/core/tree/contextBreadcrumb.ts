/**
 * Context Breadcrumb Builder
 *
 * Builds a tree representation of workspace folders in the context hierarchy.
 *
 * Algorithm:
 * 1. Folders from DuetData/repos/ with .git suffix -> lookup context by name
 * 2. Folders from DuetData/repos/ without .git suffix -> external folder
 * 3. Other folders -> lookup in contexts[] or mark as external
 *
 * Features:
 * - Merges common ancestors (two contexts under the same root -> single tree)
 * - Sort: meta-context always first; everything else alphabetically. `hasGit` does not
 *   affect ordering (it only drives icon/decoration). External/error nodes go last so
 *   the user's data tree comes before infra rows.
 * - Git folders are displayed as children of their git-backed context
 */

import * as path from 'path';
import { ContextEntity } from '../api-client';
import { isPathInside } from '../pathUtils';

// Node types for the context tree.
// `context` is the unified entity type from the backend; `git` / `external` /
// `error` are display-only categories used by the breadcrumb.
export type ContextNodeType = 'context' | 'git' | 'external' | 'error';

// Error codes for problematic folders
export type ContextErrorCode = 'orphan' | 'name_conflict' | 'outside_repos' | 'outside_hierarchy';

/**
 * A node in the context tree. Used by TreeDataProvider.
 *
 * Trees are merged by common ancestors, so children array may contain
 * nodes from different workspace folders.
 */
export interface ContextNode {
    /** Node type determines icon and behavior */
    type: ContextNodeType;
    /** Display name */
    name: string;
    /** Icon: emoji for entities, ThemeIcon id for special nodes */
    icon: string;
    /** Filesystem path (used as TreeItem.id for stability) */
    path: string;
    /** Child nodes in the hierarchy */
    children: ContextNode[];
    /** Error code for error nodes */
    errorCode?: ContextErrorCode;
    /** Original entity ID from database (for lookups) */
    entityId?: number;
    /** True for meta-context (one per workspace, e.g. !БАЗА) */
    meta?: boolean;
    /** True when context has an associated git repository */
    hasGit?: boolean;
    /** True when context is top-level (parent_id === null) */
    isRoot?: boolean;
}

/**
 * Dependencies for ContextBreadcrumb.
 * Injected for testability.
 */
export interface ContextBreadcrumbDeps {
    contexts: ContextEntity[];
    reposPath: string;
}

/**
 * Result of classifying a single folder.
 */
interface FolderClassification {
    /** The original folder path */
    folderPath: string;
    /** Entity chain from top-level root context to leaf */
    chain: ContextEntity[];
    /** Whether this is a git repo folder (has .git suffix in repos/) */
    isGitRepo: boolean;
    /** Error if folder couldn't be resolved */
    error?: { code: ContextErrorCode; message: string };
}

/**
 * Builds context tree from workspace folders.
 *
 * Usage:
 * ```typescript
 * const builder = new ContextBreadcrumb({ contexts, reposPath });
 * const roots = builder.build(workspaceFolderPaths);
 * ```
 */
export class ContextBreadcrumb {
    private contexts: ContextEntity[];
    private readonly reposPath: string;

    constructor(deps: ContextBreadcrumbDeps) {
        this.contexts = deps.contexts;
        this.reposPath = deps.reposPath;
    }

    /**
     * Update contexts array (after refresh/scan).
     */
    updateContexts(contexts: ContextEntity[]): void {
        this.contexts = contexts;
    }

    /**
     * Build context tree from an array of workspace folder paths.
     *
     * @param folderPaths - Paths from vscode.workspace.workspaceFolders
     * @returns Array of root ContextNodes (merged by common ancestors)
     */
    build(folderPaths: string[]): ContextNode[] {
        if (folderPaths.length === 0) {
            return [];
        }

        // Step 1: Classify each folder
        const classifications = folderPaths.map(p => this.classifyFolder(p));

        // Step 2: Build individual trees and merge common ancestors
        const mergedTree = this.mergeIntoTree(classifications);

        // Step 3: Sort roots
        return this.sortRoots(mergedTree);
    }

    /**
     * Classify a single folder according to the algorithm.
     */
    private classifyFolder(folderPath: string): FolderClassification {
        const normalizedPath = path.normalize(folderPath);
        const folderName = path.basename(normalizedPath);

        // Check if folder is inside DuetData/repos/
        const isInRepos = this.isInsideRepos(normalizedPath);

        if (isInRepos) {
            // Case 1: Folder in repos/ with .git suffix
            if (folderName.endsWith('.git')) {
                return this.classifyGitRepo(normalizedPath, folderName);
            }

            // Case 2: Folder in repos/ without .git suffix -> external (no error - migration possible)
            return {
                folderPath: normalizedPath,
                chain: [],
                isGitRepo: false
                // No error - this is informational, user may be migrating
            };
        }

        // Case 3: Folder outside repos/ - check if it's a git repo
        if (this.isGitRepository(normalizedPath)) {
            return {
                folderPath: normalizedPath,
                chain: [],
                isGitRepo: true,
                error: { code: 'outside_repos', message: 'Репозиторий вне DuetData' }
            };
        }

        // Case 4: Regular folder - look up in contexts
        return this.classifyByPath(normalizedPath);
    }

    /**
     * Classify a .git repo folder from DuetData/repos/.
     */
    private classifyGitRepo(folderPath: string, folderName: string): FolderClassification {
        // Strip .git suffix to get context name
        const contextName = folderName.slice(0, -4);

        // Look up by name in contexts
        const entity = this.contexts.find(c => c.name === contextName);

        if (!entity) {
            // Orphan: repo exists but no matching context
            return {
                folderPath,
                chain: [],
                isGitRepo: true,
                error: { code: 'orphan', message: 'Репозиторий не связан' }
            };
        }

        if (!entity.git_url) {
            // Name conflict: name exists but the matching context has no git_url
            return {
                folderPath,
                chain: [],
                isGitRepo: true,
                error: { code: 'name_conflict', message: 'Имя занято' }
            };
        }

        // Build chain from this context up to the top-level root
        const chain = this.buildChainToRoot(entity);

        return {
            folderPath,
            chain,
            isGitRepo: true
        };
    }

    /**
     * Classify a folder by looking it up in the contexts array.
     */
    private classifyByPath(folderPath: string): FolderClassification {
        // Find closest entity matching this path (by absolute_path prefix)
        const entity = this.findClosestEntity(folderPath);

        if (!entity) {
            // External folder - not in hierarchy
            return {
                folderPath,
                chain: [],
                isGitRepo: false,
                error: { code: 'outside_hierarchy', message: 'Папка вне иерархии' }
            };
        }

        const chain = this.buildChainToRoot(entity);

        return {
            folderPath,
            chain,
            isGitRepo: false
        };
    }

    /**
     * Find closest entity whose absolute_path is a prefix of the given path.
     * Returns the deepest match (longest path).
     */
    private findClosestEntity(folderPath: string): ContextEntity | null {
        const matches = this.contexts
            .filter(c => c.absolute_path && (
                folderPath === c.absolute_path || isPathInside(folderPath, c.absolute_path)
            ))
            .sort((a, b) => (b.absolute_path?.length ?? 0) - (a.absolute_path?.length ?? 0));

        return matches[0] ?? null;
    }

    /**
     * Build entity chain from given entity up to the top-level root context.
     */
    private buildChainToRoot(entity: ContextEntity): ContextEntity[] {
        const chain: ContextEntity[] = [];
        let current: ContextEntity | undefined = entity;

        while (current) {
            chain.unshift(current);
            if (current.parent_id) {
                current = this.contexts.find(c => c.id === current!.parent_id);
            } else {
                current = undefined;
            }
        }

        return chain;
    }

    /**
     * Merge classified folders into a tree with common ancestors.
     */
    private mergeIntoTree(classifications: FolderClassification[]): ContextNode[] {
        // Map from entity path to ContextNode (for merging)
        const nodeMap = new Map<string, ContextNode>();
        // Root nodes (no parent in our tree)
        const roots: ContextNode[] = [];

        for (const classification of classifications) {
            // External/error folders with empty chain - create standalone root
            if (classification.chain.length === 0) {
                const externalNode = this.createErrorNode(classification);
                roots.push(externalNode);
                continue;
            }

            // Build or merge the chain into tree
            let parentNode: ContextNode | null = null;

            for (let i = 0; i < classification.chain.length; i++) {
                const entity = classification.chain[i];
                const isLast = i === classification.chain.length - 1;
                const entityPath = entity.absolute_path ?? entity.path;

                // Check if node already exists (for merging)
                let node = nodeMap.get(entityPath);

                if (!node) {
                    // Create new node
                    node = this.entityToNode(entity);
                    nodeMap.set(entityPath, node);

                    if (parentNode) {
                        // Add as child if we have a parent
                        if (!parentNode.children.find(c => c.path === node!.path)) {
                            parentNode.children.push(node);
                        }
                    } else {
                        // No parent means this is a root
                        if (!roots.find(r => r.path === node!.path)) {
                            roots.push(node);
                        }
                    }
                }

                // If this is a git-backed context and we opened its git repo,
                // attach the git folder as a child of the context node.
                if (isLast && classification.isGitRepo && entity.git_url) {
                    const gitNode = this.createGitNode(classification.folderPath);
                    if (!node.children.find(c => c.path === gitNode.path)) {
                        node.children.push(gitNode);
                    }
                }

                parentNode = node;
            }
        }

        return roots;
    }

    /**
     * Create a ContextNode for an error/external folder.
     *
     * Error nodes are children of the problematic folder, not replacements.
     * Example: `Duet.git` -> `Репозиторий не связан` (child)
     */
    private createErrorNode(classification: FolderClassification): ContextNode {
        const folderName = path.basename(classification.folderPath);
        const error = classification.error;

        // For git repos with errors, show folder with error as child
        if (classification.isGitRepo && error) {
            const errorChild: ContextNode = {
                type: 'error',
                name: error.message,
                icon: 'warning',
                path: `${classification.folderPath}#error`,
                children: [],
                errorCode: error.code
            };

            return {
                type: 'git',
                name: folderName,
                icon: 'git-branch',
                path: classification.folderPath,
                children: [errorChild],
                errorCode: error.code
            };
        }

        // External folder - always show with info child
        // Both repos/ without .git suffix and folders outside hierarchy
        const infoChild: ContextNode = {
            type: 'error',  // Use 'error' type for clickable behavior
            name: 'Папка вне иерархии',
            icon: 'info',
            path: `${classification.folderPath}#info`,
            children: [],
            errorCode: 'outside_hierarchy'
        };

        return {
            type: 'external',
            name: folderName,
            icon: '📁',
            path: classification.folderPath,
            children: [infoChild]
            // No errorCode on parent - only child is clickable
        };
    }

    /**
     * Create a git folder node (child of a git-backed context).
     */
    private createGitNode(gitFolderPath: string): ContextNode {
        const folderName = path.basename(gitFolderPath);
        return {
            type: 'git',
            name: folderName,
            icon: 'git-branch', // ThemeIcon
            path: gitFolderPath,
            children: []
        };
    }

    /**
     * Convert a context entity to a ContextNode.
     */
    private entityToNode(entity: ContextEntity): ContextNode {
        return {
            type: 'context',
            name: entity.name,
            icon: entity.icon ?? '',
            path: entity.absolute_path ?? entity.path,
            children: [],
            entityId: parseInt(entity.id, 10),
            meta: entity.meta,
            hasGit: entity.git_url !== null,
            isRoot: entity.parent_id === null
        };
    }

    /**
     * Sort root nodes: meta-context always first, then everything else alphabetically.
     * `hasGit` does not affect ordering (only icon/decoration). External/error/git nodes
     * sort after real contexts so user data leads infra rows.
     *
     * Children at deeper levels are sorted via `sortChildrenAlphabetically` after the
     * tree is built — so every nesting level uses the same alpha rule.
     */
    private sortRoots(roots: ContextNode[]): ContextNode[] {
        const sorted = roots.sort((a, b) => {
            const aOrder = this.bucketOrder(a);
            const bOrder = this.bucketOrder(b);
            if (aOrder !== bOrder) {
                return aOrder - bOrder;
            }
            return a.name.localeCompare(b.name);
        });
        for (const root of sorted) {
            this.sortChildrenAlphabetically(root);
        }
        return sorted;
    }

    /**
     * Bucket key: meta first, regular contexts next, infra last.
     * `hasGit` is intentionally NOT a bucket — terminal contexts mix with intermediates
     * alphabetically (decision: stabilize-taxonomy-migration).
     */
    private bucketOrder(node: ContextNode): number {
        const leaf = this.getLeafNode(node);
        if (leaf.type === 'context') {
            if (leaf.meta) {
                return 0;
            }
            return 1;
        }
        if (leaf.type === 'git') {
            return 2;
        }
        if (leaf.type === 'external') {
            return 3;
        }
        return 99; // error / unknown
    }

    /** Recursively sort node.children alphabetically by name (meta first only at root level). */
    private sortChildrenAlphabetically(node: ContextNode): void {
        node.children.sort((a, b) => {
            const aOrder = this.bucketOrder(a);
            const bOrder = this.bucketOrder(b);
            if (aOrder !== bOrder) {
                return aOrder - bOrder;
            }
            return a.name.localeCompare(b.name);
        });
        for (const child of node.children) {
            this.sortChildrenAlphabetically(child);
        }
    }

    /**
     * Walk to the deepest "real" descendant of a node, ignoring git children.
     * Git folders are always children of a context, so we report the context
     * as the leaf in that case.
     */
    private getLeafNode(node: ContextNode): ContextNode {
        if (node.children.length === 0) {
            return node;
        }
        const nonGitChildren = node.children.filter(c => c.type !== 'git');
        if (nonGitChildren.length > 0) {
            return this.getLeafNode(nonGitChildren[0]);
        }
        return node;
    }

    /**
     * Check if a path is inside the DuetData/repos/ folder.
     * Uses isPathInside for robust cross-platform comparison.
     */
    private isInsideRepos(folderPath: string): boolean {
        // isPathInside returns false for equal paths, but we want true for repos/ itself
        const normalized = path.normalize(folderPath);
        const normalizedRepos = path.normalize(this.reposPath);

        // Check if equal (considering Windows case-insensitivity)
        const isEqual = process.platform === 'win32'
            ? normalized.toLowerCase() === normalizedRepos.toLowerCase()
            : normalized === normalizedRepos;

        return isEqual || isPathInside(folderPath, this.reposPath);
    }

    /**
     * Check if a folder is a git repository (contains .git folder).
     */
    private isGitRepository(folderPath: string): boolean {
        return path.basename(folderPath).endsWith('.git');
    }
}
