import { DatabaseManager, Entity } from '../db';
import * as path from 'path';

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

        // 1. Find the closest entity for context
        // 2. If it's a Product, list its children of type 'project'
        // 3. If it's a Project, allow navigating back to sibling projects (parent product -> children)
        // Spec says: "Список проектов выбранного продукта".
        // Let's deduce Product from context.

        const entity = this.db.findClosestEntity(contextPath);
        if (!entity) { return []; }

        let product: Entity | null = null;
        if (entity.type === 'product') {
            product = entity;
        } else if (entity.type === 'project' && entity.parentId) {
            product = this.db.getEntity(entity.parentId);
        } else {
            // Business or Stream -> No projects list?
            // Spec implies "Секция ПРОЕКТЫ — только проекты текущего продукта".
            // If I click Business -> empty.
            return [];
        }

        if (!product || !product.id) { return []; }

        const children = this.db.getEntities(product.id);
        const projects = children.filter(c => c.type === 'project');

        return projects.map(p => ({
            id: p.drivePath,
            label: p.name,
            icon: 'clipboard', // Default, but we might use p.icon
            path: p.drivePath
        }));
    }
}
