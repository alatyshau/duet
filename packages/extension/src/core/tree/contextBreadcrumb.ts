/**
 * Context Breadcrumb Builder
 *
 * Builds a tree representation of workspace folders in the business hierarchy.
 *
 * Algorithm:
 * 1. Folders from DuetData/repos/ with .git suffix → lookup product by name
 * 2. Folders from DuetData/repos/ without .git suffix → external folder
 * 3. Other folders → lookup in DB or mark as external
 *
 * Features:
 * - Merges common ancestors (two products from same business → single tree)
 * - Sorts roots by leaf type: businesses > streams > products > external
 * - Git folders displayed as children of products
 */

import * as path from 'path';
import { DatabaseManager, Entity } from '../db';
import { isPathInside } from '../pathUtils';

// Node types for the context tree
export type ContextNodeType = 'business' | 'stream' | 'product' | 'git' | 'external' | 'error';

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
}

/**
 * Dependencies for ContextBreadcrumb.
 * Injected for testability.
 */
export interface ContextBreadcrumbDeps {
    db: DatabaseManager;
    reposPath: string;
}

/**
 * Result of classifying a single folder.
 */
interface FolderClassification {
    /** The original folder path */
    folderPath: string;
    /** Entity chain from root to leaf (business → stream* → product) */
    chain: Entity[];
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
 * const builder = new ContextBreadcrumb({ db, reposPath });
 * const roots = builder.build(workspaceFolderPaths);
 * ```
 */
export class ContextBreadcrumb {
    private readonly db: DatabaseManager;
    private readonly reposPath: string;

    constructor(deps: ContextBreadcrumbDeps) {
        this.db = deps.db;
        this.reposPath = deps.reposPath;
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

            // Case 2: Folder in repos/ without .git suffix → external (no error - migration possible)
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

        // Case 4: Regular folder - look up in database
        return this.classifyByPath(normalizedPath);
    }

    /**
     * Classify a .git repo folder from DuetData/repos/.
     */
    private classifyGitRepo(folderPath: string, folderName: string): FolderClassification {
        // Strip .git suffix to get product name
        const productName = folderName.slice(0, -4);

        // Look up by name in database
        const entity = this.db.findByName(productName);

        if (!entity) {
            // Orphan: repo exists but no matching entity
            return {
                folderPath,
                chain: [],
                isGitRepo: true,
                error: { code: 'orphan', message: 'Репозиторий не связан' }
            };
        }

        if (entity.type !== 'product') {
            // Name conflict: name exists but is not a product
            return {
                folderPath,
                chain: [],
                isGitRepo: true,
                error: { code: 'name_conflict', message: `Имя занято (${entity.type})` }
            };
        }

        // Build chain from product to root
        const chain = this.buildChainToRoot(entity);

        return {
            folderPath,
            chain,
            isGitRepo: true
        };
    }

    /**
     * Classify a folder by looking it up in the database.
     */
    private classifyByPath(folderPath: string): FolderClassification {
        // Find closest entity matching this path
        const entity = this.db.findClosestEntity(folderPath);

        if (!entity) {
            // External folder - not in hierarchy
            return {
                folderPath,
                chain: [],
                isGitRepo: false,
                error: { code: 'outside_hierarchy', message: 'Папка вне иерархии' }
            };
        }

        // Build chain from entity to root
        const chain = this.buildChainToRoot(entity);

        return {
            folderPath,
            chain,
            isGitRepo: false
        };
    }

    /**
     * Build entity chain from given entity up to root business.
     */
    private buildChainToRoot(entity: Entity): Entity[] {
        const chain: Entity[] = [];
        let current: Entity | null = entity;

        while (current) {
            chain.unshift(current);
            if (current.parentId) {
                current = this.db.getEntity(current.parentId);
            } else {
                current = null;
            }
        }

        return chain;
    }

    /**
     * Merge classified folders into a tree with common ancestors.
     */
    private mergeIntoTree(classifications: FolderClassification[]): ContextNode[] {
        // Map from entity drive_path to ContextNode (for merging)
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

                // Check if node already exists (for merging)
                let node = nodeMap.get(entity.drivePath);

                if (!node) {
                    // Create new node
                    node = this.entityToNode(entity);
                    nodeMap.set(entity.drivePath, node);

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

                // If this is a product and we have a git repo, add git folder as child
                if (isLast && classification.isGitRepo && entity.type === 'product') {
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
     * Example: `📁 Duet.git` → `⚠️ Репозиторий не связан` (child)
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
     * Create a git folder node (child of product).
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
     * Convert a database entity to a ContextNode.
     */
    private entityToNode(entity: Entity): ContextNode {
        return {
            type: entity.type as ContextNodeType,
            name: entity.name,
            icon: entity.icon,
            path: entity.drivePath,
            children: [],
            entityId: entity.id
        };
    }

    /**
     * Sort root nodes by leaf type, then alphabetically.
     * Order: businesses > streams > products > external/error
     */
    private sortRoots(roots: ContextNode[]): ContextNode[] {
        const typeOrder: Record<ContextNodeType, number> = {
            'business': 1,
            'stream': 2,
            'product': 3,
            'git': 4,
            'external': 5,
            'error': 6
        };

        return roots.sort((a, b) => {
            // Get leaf type for sorting
            const aLeafType = this.getLeafType(a);
            const bLeafType = this.getLeafType(b);

            const aOrder = typeOrder[aLeafType] ?? 99;
            const bOrder = typeOrder[bLeafType] ?? 99;

            if (aOrder !== bOrder) {
                return aOrder - bOrder;
            }

            // Same type - sort alphabetically
            return a.name.localeCompare(b.name);
        });
    }

    /**
     * Get the leaf node type for a tree (for sorting).
     * Traverses to deepest child.
     */
    private getLeafType(node: ContextNode): ContextNodeType {
        if (node.children.length === 0) {
            return node.type;
        }
        // For sorting purposes, we care about the deepest "real" node type
        // Git folders are children of products, so product is the leaf type
        const nonGitChildren = node.children.filter(c => c.type !== 'git');
        if (nonGitChildren.length > 0) {
            return this.getLeafType(nonGitChildren[0]);
        }
        // Only git children - this is a product
        return node.type;
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
        // Simple heuristic: if folder name ends with .git or contains .git subfolder
        // For now, we just check the name pattern since we can't do async fs checks here
        // In practice, git repos cloned outside repos/ would be detected by other means
        return path.basename(folderPath).endsWith('.git');
    }
}
