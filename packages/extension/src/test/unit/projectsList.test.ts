import { describe, it, expect, vi } from 'vitest';
import { ProjectsList } from '../../core/tree/projectsList';
import { DuetApiClient, ProjectEntity } from '../../core/api-client';

function makeApiClient(projects: ProjectEntity[] = []): DuetApiClient {
    return {
        projects: vi.fn().mockResolvedValue({ projects })
    } as any;
}

function makeProject(overrides: Partial<ProjectEntity> & { name: string }): ProjectEntity {
    return {
        id: '10',
        type: 'project',
        icon: '📋',
        path: 'default/path',
        absolute_path: null,
        parent_id: '5',
        git_url: null,
        status: null,
        ...overrides,
    };
}

describe('ProjectsList', () => {
    it('should return empty array for null entityId', async () => {
        const api = makeApiClient();
        const list = new ProjectsList(api);

        const projects = await list.getProjects(null);

        expect(projects).toEqual([]);
        expect(api.projects).not.toHaveBeenCalled();
    });

    it('should return projects from API', async () => {
        const api = makeApiClient([
            makeProject({
                id: '10',
                name: 'Project Alpha',
                path: 'biz/product/projects/alpha',
                absolute_path: '/drive/biz/product/projects/alpha',
                parent_id: '5'
            }),
            makeProject({
                id: '11',
                name: 'Project Beta',
                path: 'biz/product/projects/beta',
                absolute_path: '/drive/biz/product/projects/beta',
                parent_id: '5'
            })
        ]);
        const list = new ProjectsList(api);

        const projects = await list.getProjects(5);

        expect(projects).toHaveLength(2);
        expect(projects[0].label).toBe('Project Alpha');
        expect(projects[0].path).toBe('/drive/biz/product/projects/alpha');
        expect(projects[0].icon).toBe('clipboard');
        expect(projects[1].label).toBe('Project Beta');
        expect(api.projects).toHaveBeenCalledWith(5);
    });

    it('should return empty array on API error', async () => {
        const api = {
            projects: vi.fn().mockRejectedValue(new Error('Network error'))
        } as any;
        const list = new ProjectsList(api);

        const projects = await list.getProjects(5);

        expect(projects).toEqual([]);
    });

    it('should use path as fallback when absolute_path is null', async () => {
        const api = makeApiClient([
            makeProject({
                name: 'Test Project',
                path: 'relative/path',
                absolute_path: null
            })
        ]);
        const list = new ProjectsList(api);

        const projects = await list.getProjects(5);

        expect(projects[0].path).toBe('relative/path');
    });

    it('should use absolute_path when available', async () => {
        const api = makeApiClient([
            makeProject({
                name: 'Test Project',
                path: 'relative/path',
                absolute_path: '/absolute/path'
            })
        ]);
        const list = new ProjectsList(api);

        const projects = await list.getProjects(5);

        expect(projects[0].path).toBe('/absolute/path');
    });

    it('should set correct id from entity path', async () => {
        const api = makeApiClient([
            makeProject({
                name: 'Test Project',
                path: 'biz/product/projects/test',
                absolute_path: '/drive/biz/product/projects/test'
            })
        ]);
        const list = new ProjectsList(api);

        const projects = await list.getProjects(5);

        expect(projects[0].id).toBe('biz/product/projects/test');
    });
});
