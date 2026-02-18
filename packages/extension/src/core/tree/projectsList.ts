import { DuetApiClient } from '../api-client';

export interface ProjectItem {
    id: string; // drive path (relative)
    label: string;
    icon: string;
    path: string; // absolute path (for navigation)
}

export class ProjectsList {
    constructor(private readonly api: DuetApiClient) {}

    async getProjects(entityId: number | null): Promise<ProjectItem[]> {
        if (entityId === null) {
            return [];
        }

        try {
            const { projects } = await this.api.projects(entityId);
            return projects.map(p => ({
                id: p.path,
                label: p.name,
                icon: 'clipboard',
                path: p.absolute_path ?? p.path
            }));
        } catch (error) {
            console.error(`[Duet] Failed to load projects for entity ${entityId}:`, error);
            return [];
        }
    }
}
