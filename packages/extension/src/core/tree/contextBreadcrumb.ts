import { DatabaseManager, Entity } from '../db';

export interface BreadcrumbItem {
    label: string;
    icon: string;
    emoji: string;
    path: string;
    type: 'business' | 'stream' | 'product' | 'project' | 'orphan' | 'unknown';
    isWarning: boolean;
}

export class ContextBreadcrumb {
    constructor(private readonly db: DatabaseManager) {}

    getContext(currentPath: string): BreadcrumbItem[] {
        const entity = this.db.findClosestEntity(currentPath);

        if (!entity) {
            // Check if it's a git repo in repos/ but not indexed (Orphan) -> Needs Paths context, but db logic is enough for now
            // Spec says: "Папка вне иерархии"
            return [{
                label: 'Вне иерархии',
                icon: 'question',
                emoji: 'ℹ️',
                path: currentPath,
                type: 'unknown',
                isWarning: false
            }];
        }

        // Build chain upwards
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

        return chain.map(e => ({
            label: e.name,
            icon: 'folder', // We use custom rendered items anyway
            emoji: e.icon,
            path: e.drivePath,
            type: e.type,
            isWarning: false
        }));
    }
}
