// src/test/unit/businessTree.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DatabaseManager, Entity } from '../../core/db';
import { BusinessTree } from '../../core/tree/businessTree';
import { Paths } from '../../core/paths';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';

describe('BusinessTree', () => {
    let tempDir: string;
    let db: DatabaseManager;
    let tree: BusinessTree;

    beforeEach(async () => {
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'duet-tree-test-'));
        const paths = new Paths(path.join(tempDir, 'DuetData'));
        db = new DatabaseManager(paths);
        await db.init(); // Initialize in-memory DB
        tree = new BusinessTree(db);
    });

    afterEach(async () => {
        await fs.rm(tempDir, { recursive: true, force: true });
    });

    it('should return top-level businesses as roots', () => {
        const biz1: Entity = { type: 'business', name: 'Biz1', icon: 'B', drivePath: '/b1' };
        const biz2: Entity = { type: 'business', name: 'Biz2', icon: 'B', drivePath: '/b2' };
        
        db.insertEntity(biz1);
        db.insertEntity(biz2);

        const roots = tree.getRoots();
        
        expect(roots).toHaveLength(2);
        expect(roots.find(n => n.label === 'Biz1')).toBeDefined();
        expect(roots.find(n => n.label === 'Biz2')).toBeDefined();
        expect(roots[0].type).toBe('business');
    });

    it('should return children properly', () => {
        const bizId = db.insertEntity({ type: 'business', name: 'Biz1', icon: 'B', drivePath: '/b1' });
        
        const streamId = db.insertEntity({ 
            type: 'stream', 
            name: 'Stream1', 
            icon: 'S', 
            drivePath: '/b1/s1',
            parentId: bizId 
        });

        const children = tree.getChildren(bizId);
        expect(children).toHaveLength(1);
        expect(children[0].label).toBe('Stream1');
        expect(children[0].type).toBe('stream');
        expect(children[0].hasChildren).toBe(false);

        // Insert Product as child of Stream
        db.insertEntity({ 
            type: 'product', 
            name: 'Prod1', 
            icon: 'P', 
            drivePath: '/b1/s1/p1',
            parentId: streamId 
        });

        // Clear cache to pick up database changes
        tree.clearCache();

        // hasChildren should be true now
        // Wait, 'children' variable is just a snapshot. We need to fetch again to see update?
        // Actually mapEntity calls db.hasChildren() at moment of mapping.
        // So we need to call tree.getChildren again to get fresh nodes
        const streamChildren = tree.getChildren(streamId);
        expect(streamChildren).toHaveLength(1);
        expect(streamChildren[0].label).toBe('Prod1');
        
        // Verify parent's hasChildren updated
        const bizChildrenCompat = tree.getChildren(bizId);
        expect(bizChildrenCompat[0].hasChildren).toBe(true);
    });

    it('should map entities to tree nodes correctly', () => {
        const id = db.insertEntity({ 
            type: 'business', 
            name: 'BizMapped', 
            icon: '🧪', 
            drivePath: '/path/to/biz' 
        });

        db.insertEntity({ 
            type: 'stream', 
            name: 'Child', 
            icon: 'C', 
            drivePath: '/path/to/biz/child', 
            parentId: id 
        });

        const roots = tree.getRoots();
        const node = roots.find(n => n.label === 'BizMapped');

        expect(node).toBeDefined();
        expect(node?.id).toBe('/path/to/biz');
        expect(node?.label).toBe('BizMapped');
        expect(node?.icon).toBe('🧪');
        expect(node?.type).toBe('business');
        expect(node?.hasChildren).toBe(true);
    });

    it('should return parent node correctly', () => {
        const bizId = db.insertEntity({ type: 'business', name: 'Biz1', icon: 'B', drivePath: '/b1' });
        const streamId = db.insertEntity({ 
            type: 'stream', 
            name: 'Stream1', 
            icon: 'S', 
            drivePath: '/b1/s1',
            parentId: bizId 
        });

        const parent = tree.getParent(streamId);
        expect(parent).toBeDefined();
        expect(parent?.label).toBe('Biz1');
        expect(parent?.entityId).toBe(bizId);

        const rootParent = tree.getParent(bizId);
        expect(rootParent).toBeNull();
    });

    it('should return all nodes flattened', () => {
        const bizId = db.insertEntity({ type: 'business', name: 'Biz1', icon: 'B', drivePath: '/b1' });
        db.insertEntity({ 
            type: 'stream', 
            name: 'Stream1', 
            icon: 'S', 
            drivePath: '/b1/s1',
            parentId: bizId 
        });

        const all = tree.getAllNodes();
        expect(all).toHaveLength(2);
        expect(all.find(n => n.label === 'Biz1')).toBeDefined();
        expect(all.find(n => n.label === 'Stream1')).toBeDefined();
    });

    it('should cache nodes and return identical references', () => {
        const bizId = db.insertEntity({ type: 'business', name: 'Biz1', icon: 'B', drivePath: '/b1' });

        const roots1 = tree.getRoots();
        const roots2 = tree.getRoots();

        expect(roots1[0]).toBe(roots2[0]); // Reference equality check

        const all = tree.getAllNodes();
        expect(all.find(n => n.entityId === bizId)).toBe(roots1[0]);
    });

    it('should exclude projects from children (projects only in ПРОЕКТЫ section)', () => {
        const bizId = db.insertEntity({ type: 'business', name: 'Biz1', icon: 'B', drivePath: '/b1' });

        // Add a stream child
        db.insertEntity({
            type: 'stream',
            name: 'Stream1',
            icon: 'S',
            drivePath: '/b1/s1',
            parentId: bizId
        });

        // Add a project child (should be filtered out)
        db.insertEntity({
            type: 'project',
            name: 'Project1',
            icon: '📋',
            drivePath: '/b1/projects/p1',
            parentId: bizId
        });

        const children = tree.getChildren(bizId);

        expect(children).toHaveLength(1);
        expect(children[0].label).toBe('Stream1');
        expect(children.find(c => c.type === 'project')).toBeUndefined();
    });

    it('should report hasChildren=false when only projects exist', () => {
        const bizId = db.insertEntity({ type: 'business', name: 'Biz1', icon: 'B', drivePath: '/b1' });

        // Add only a project child
        db.insertEntity({
            type: 'project',
            name: 'Project1',
            icon: '📋',
            drivePath: '/b1/projects/p1',
            parentId: bizId
        });

        // hasChildren should be false (projects excluded)
        const roots = tree.getRoots();
        expect(roots[0].hasChildren).toBe(false);
    });
});
