import { DatabaseManager, Entity } from '../db';

export interface ProjectItem {
    id: string; // drivePath
    label: string;
    icon: string;
    path: string; // drivePath
}

export class ProjectsList {
    constructor(private readonly db: DatabaseManager) {}

    getProjects(contextPath: string | null): ProjectItem[] {
        if (!contextPath) {
            return [];
        }

        // Any entity (business, stream, product) can have projects as children.
        // If context is a project, show sibling projects (parent's children).

        const entity = this.db.findClosestEntity(contextPath);
        if (!entity) { return []; }

        let parent: Entity | null = null;
        if (entity.type === 'project' && entity.parentId) {
            // For project context, get parent to show siblings
            parent = this.db.getEntity(entity.parentId);
        } else {
            // For business/stream/product, show their own projects
            parent = entity;
        }

        if (!parent || !parent.id) { return []; }

        const children = this.db.getEntities(parent.id);
        const projects = children.filter(c => c.type === 'project');

        return projects.map(p => ({
            id: p.drivePath,
            label: p.name,
            icon: 'clipboard', // Default, but we might use p.icon
            path: p.drivePath
        }));
    }
}
