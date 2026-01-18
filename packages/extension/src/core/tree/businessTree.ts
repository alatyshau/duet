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
        const children = this.db.getEntities(parentId);
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

    private mapEntity(entity: Entity): TreeNode {
        if (this.nodeCache.has(entity.id!)) {
            return this.nodeCache.get(entity.id!)!;
        }

        const node: TreeNode = {
            id: entity.drivePath,
            label: entity.name,
            icon: entity.icon,
            type: entity.type,
            hasChildren: this.db.hasChildren(entity.id!),
            entityId: entity.id!,
            gitUrl: entity.gitUrl
        };

        this.nodeCache.set(entity.id!, node);
        return node;
    }
}
