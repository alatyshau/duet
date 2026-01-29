// src/test/unit/projectsList.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DatabaseManager, Entity } from '../../core/db';
import { ProjectsList } from '../../core/tree/projectsList';
import { Paths } from '../../core/paths';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';

describe('ProjectsList', () => {
    let tempDir: string;
    let db: DatabaseManager;
    let projectsList: ProjectsList;

    beforeEach(async () => {
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'duet-projects-test-'));
        const paths = new Paths(path.join(tempDir, 'DuetData'));
        db = new DatabaseManager(paths);
        await db.init();
        projectsList = new ProjectsList(db);
    });

    afterEach(async () => {
        await fs.rm(tempDir, { recursive: true, force: true });
    });

    it('should return empty array for null context', () => {
        const projects = projectsList.getProjects(null);
        expect(projects).toEqual([]);
    });

    it('should return empty array for entity without projects', () => {
        db.insertEntity({
            type: 'business',
            name: 'Biz1',
            icon: 'B',
            drivePath: '/biz1'
        });

        const projects = projectsList.getProjects('/biz1');
        expect(projects).toEqual([]);
    });

    it('should return projects for business context', () => {
        const bizId = db.insertEntity({
            type: 'business',
            name: 'Biz1',
            icon: 'B',
            drivePath: '/biz1'
        });
        db.insertEntity({
            type: 'project',
            name: 'Biz Project',
            icon: '📋',
            drivePath: '/biz1/projects/proj1',
            parentId: bizId
        });

        const projects = projectsList.getProjects('/biz1');
        expect(projects).toHaveLength(1);
        expect(projects[0].label).toBe('Biz Project');
    });

    it('should return projects for stream context', () => {
        const bizId = db.insertEntity({
            type: 'business',
            name: 'Biz1',
            icon: 'B',
            drivePath: '/biz1'
        });
        const streamId = db.insertEntity({
            type: 'stream',
            name: 'Stream1',
            icon: 'S',
            drivePath: '/biz1/stream1',
            parentId: bizId
        });
        db.insertEntity({
            type: 'project',
            name: 'Stream Project',
            icon: '📋',
            drivePath: '/biz1/stream1/projects/proj1',
            parentId: streamId
        });

        const projects = projectsList.getProjects('/biz1/stream1');
        expect(projects).toHaveLength(1);
        expect(projects[0].label).toBe('Stream Project');
    });

    it('should return projects for product context', () => {
        const bizId = db.insertEntity({
            type: 'business',
            name: 'Biz1',
            icon: 'B',
            drivePath: '/biz1'
        });
        const productId = db.insertEntity({
            type: 'product',
            name: 'Product1',
            icon: 'P',
            drivePath: '/biz1/product1',
            parentId: bizId
        });
        db.insertEntity({
            type: 'project',
            name: 'Project Alpha',
            icon: '📋',
            drivePath: '/biz1/product1/projects/alpha',
            parentId: productId
        });
        db.insertEntity({
            type: 'project',
            name: 'Project Beta',
            icon: '📋',
            drivePath: '/biz1/product1/projects/beta',
            parentId: productId
        });

        const projects = projectsList.getProjects('/biz1/product1');

        expect(projects).toHaveLength(2);
        expect(projects.find(p => p.label === 'Project Alpha')).toBeDefined();
        expect(projects.find(p => p.label === 'Project Beta')).toBeDefined();
    });

    it('should return sibling projects for project context', () => {
        const bizId = db.insertEntity({
            type: 'business',
            name: 'Biz1',
            icon: 'B',
            drivePath: '/biz1'
        });
        const productId = db.insertEntity({
            type: 'product',
            name: 'Product1',
            icon: 'P',
            drivePath: '/biz1/product1',
            parentId: bizId
        });
        db.insertEntity({
            type: 'project',
            name: 'Project Alpha',
            icon: '📋',
            drivePath: '/biz1/product1/projects/alpha',
            parentId: productId
        });
        db.insertEntity({
            type: 'project',
            name: 'Project Beta',
            icon: '📋',
            drivePath: '/biz1/product1/projects/beta',
            parentId: productId
        });

        // Context is a project path, should still return all projects of parent product
        const projects = projectsList.getProjects('/biz1/product1/projects/alpha');

        expect(projects).toHaveLength(2);
        expect(projects.find(p => p.label === 'Project Alpha')).toBeDefined();
        expect(projects.find(p => p.label === 'Project Beta')).toBeDefined();
    });

    it('should return correct ProjectItem structure', () => {
        const bizId = db.insertEntity({
            type: 'business',
            name: 'Biz1',
            icon: 'B',
            drivePath: '/biz1'
        });
        const productId = db.insertEntity({
            type: 'product',
            name: 'Product1',
            icon: 'P',
            drivePath: '/biz1/product1',
            parentId: bizId
        });
        db.insertEntity({
            type: 'project',
            name: 'Test Project',
            icon: '📋',
            drivePath: '/biz1/product1/projects/test',
            parentId: productId
        });

        const projects = projectsList.getProjects('/biz1/product1');

        expect(projects).toHaveLength(1);
        const project = projects[0];
        expect(project.id).toBe('/biz1/product1/projects/test');
        expect(project.label).toBe('Test Project');
        expect(project.path).toBe('/biz1/product1/projects/test');
        expect(project.icon).toBe('clipboard');
    });

    it('should return empty array for unknown path', () => {
        const projects = projectsList.getProjects('/unknown/path');
        expect(projects).toEqual([]);
    });
});
