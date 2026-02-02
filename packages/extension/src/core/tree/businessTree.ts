import { DatabaseManager, Entity } from '../db';

export interface TreeNode {
    id: string; // drivePath
    label: string;
    icon: string;
    type: 'business' | 'stream' | 'product' | 'project';
    hasChildren: boolean;
    entityId: number;
    gitUrl?: string;
}

export class BusinessTree {
    private nodeCache = new Map<number, TreeNode>();

    constructor(private readonly db: DatabaseManager) {}

    clearCache() {
        this.nodeCache.clear();
    }

    getRoots(): TreeNode[] {
        const businesses = this.db.getEntities(null);
        return businesses.map(b => this.mapEntity(b));
    }

    getChildren(parentId: number): TreeNode[] {
        const children = this.db.getEntities(parentId)
            .filter(c => c.type !== 'project'); // Projects only in ПРОЕКТЫ section
        return children.map(c => this.mapEntity(c));
    }

    getAllNodes(): TreeNode[] {
        const entities = this.db.getAllEntities();
        return entities.map(e => this.mapEntity(e));
    }

    getParent(entityId: number): TreeNode | null {
        const entity = this.db.getEntity(entityId);
        if (!entity || !entity.parentId) {
            return null;
        }
        const parent = this.db.getEntity(entity.parentId);
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

    private mapEntity(entity: Entity): TreeNode {
        if (this.nodeCache.has(entity.id!)) {
            return this.nodeCache.get(entity.id!)!;
        }

        const node: TreeNode = {
            id: entity.drivePath,
            label: entity.name,
            icon: entity.icon,
            type: entity.type,
            hasChildren: this.db.hasChildren(entity.id!, ['project']),
            entityId: entity.id!,
            gitUrl: entity.gitUrl
        };

        this.nodeCache.set(entity.id!, node);
        return node;
    }
}
