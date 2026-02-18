import { StreamEntity } from '../api-client';

export interface TreeNode {
    id: string; // absolute_path (for path comparison with workspace folders)
    label: string;
    icon: string;
    type: 'business' | 'stream' | 'product' | 'project';
    hasChildren: boolean;
    entityId: number;
    gitUrl?: string;
}

export class BusinessTree {
    private nodeCache = new Map<number, TreeNode>();
    private streams: StreamEntity[];

    constructor(streams: StreamEntity[]) {
        this.streams = streams;
    }

    updateStreams(streams: StreamEntity[]): void {
        this.streams = streams;
        this.nodeCache.clear();
    }

    clearCache(): void {
        this.nodeCache.clear();
    }

    getRoots(): TreeNode[] {
        return this.streams
            .filter(s => s.parent_id === null)
            .map(s => this.mapEntity(s));
    }

    getChildren(parentId: number): TreeNode[] {
        const parentIdStr = String(parentId);
        // /streams already excludes projects (R4), no filter needed
        return this.streams
            .filter(s => s.parent_id === parentIdStr)
            .map(s => this.mapEntity(s));
    }

    getAllNodes(): TreeNode[] {
        return this.streams.map(s => this.mapEntity(s));
    }

    getParent(entityId: number): TreeNode | null {
        const entityIdStr = String(entityId);
        const entity = this.streams.find(s => s.id === entityIdStr);
        if (!entity || !entity.parent_id) {
            return null;
        }
        const parent = this.streams.find(s => s.id === entity.parent_id);
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

    private mapEntity(stream: StreamEntity): TreeNode {
        const numId = parseInt(stream.id, 10);
        if (this.nodeCache.has(numId)) {
            return this.nodeCache.get(numId)!;
        }

        const node: TreeNode = {
            id: stream.absolute_path ?? stream.path,
            label: stream.name,
            icon: stream.icon ?? '',
            type: stream.type,
            hasChildren: this.streams.some(s => s.parent_id === stream.id),
            entityId: numId,
            gitUrl: stream.git_url ?? undefined
        };

        this.nodeCache.set(numId, node);
        return node;
    }
}
