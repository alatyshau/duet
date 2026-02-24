// src/test/unit/businessTree.test.ts
import { describe, it, expect } from 'vitest';
import { BusinessTree } from '../../core/tree/businessTree';
import { StreamEntity } from '../../core/api-client';

function makeStream(overrides: Partial<StreamEntity> & { id: string; name: string; type: StreamEntity['type'] }): StreamEntity {
    return {
        icon: null,
        path: '',
        absolute_path: null,
        parent_id: null,
        git_url: null,
        status: null,
        ...overrides,
    };
}

describe('BusinessTree', () => {
    it('should return top-level businesses as roots', () => {
        const streams = [
            makeStream({ id: '1', type: 'business', name: 'Biz1', icon: 'B', absolute_path: '/b1' }),
            makeStream({ id: '2', type: 'business', name: 'Biz2', icon: 'B', absolute_path: '/b2' }),
        ];
        const tree = new BusinessTree(streams);

        const roots = tree.getRoots();

        expect(roots).toHaveLength(2);
        expect(roots.find(n => n.label === 'Biz1')).toBeDefined();
        expect(roots.find(n => n.label === 'Biz2')).toBeDefined();
        expect(roots[0].type).toBe('business');
    });

    it('should return children properly', () => {
        const streams = [
            makeStream({ id: '1', type: 'business', name: 'Biz1', icon: 'B', absolute_path: '/b1' }),
            makeStream({ id: '2', type: 'stream', name: 'Stream1', icon: 'S', absolute_path: '/b1/s1', parent_id: '1' }),
            makeStream({ id: '3', type: 'product', name: 'Prod1', icon: 'P', absolute_path: '/b1/s1/p1', parent_id: '2' }),
        ];
        const tree = new BusinessTree(streams);

        const bizChildren = tree.getChildren(1);
        expect(bizChildren).toHaveLength(1);
        expect(bizChildren[0].label).toBe('Stream1');
        expect(bizChildren[0].type).toBe('stream');
        expect(bizChildren[0].hasChildren).toBe(true); // has Prod1 as child

        const streamChildren = tree.getChildren(2);
        expect(streamChildren).toHaveLength(1);
        expect(streamChildren[0].label).toBe('Prod1');
        expect(streamChildren[0].hasChildren).toBe(false);
    });

    it('should map entities to tree nodes correctly', () => {
        const streams = [
            makeStream({ id: '1', type: 'business', name: 'BizMapped', icon: '🧪', absolute_path: '/path/to/biz' }),
            makeStream({ id: '2', type: 'stream', name: 'Child', icon: 'C', absolute_path: '/path/to/biz/child', parent_id: '1' }),
        ];
        const tree = new BusinessTree(streams);

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
        const streams = [
            makeStream({ id: '1', type: 'business', name: 'Biz1', icon: 'B', absolute_path: '/b1' }),
            makeStream({ id: '2', type: 'stream', name: 'Stream1', icon: 'S', absolute_path: '/b1/s1', parent_id: '1' }),
        ];
        const tree = new BusinessTree(streams);

        const parent = tree.getParent(2);
        expect(parent).toBeDefined();
        expect(parent?.label).toBe('Biz1');
        expect(parent?.entityId).toBe(1);

        const rootParent = tree.getParent(1);
        expect(rootParent).toBeNull();
    });

    it('should return all nodes flattened', () => {
        const streams = [
            makeStream({ id: '1', type: 'business', name: 'Biz1', icon: 'B', absolute_path: '/b1' }),
            makeStream({ id: '2', type: 'stream', name: 'Stream1', icon: 'S', absolute_path: '/b1/s1', parent_id: '1' }),
        ];
        const tree = new BusinessTree(streams);

        const all = tree.getAllNodes();
        expect(all).toHaveLength(2);
        expect(all.find(n => n.label === 'Biz1')).toBeDefined();
        expect(all.find(n => n.label === 'Stream1')).toBeDefined();
    });

    it('should cache nodes and return identical references', () => {
        const streams = [
            makeStream({ id: '1', type: 'business', name: 'Biz1', icon: 'B', absolute_path: '/b1' }),
        ];
        const tree = new BusinessTree(streams);

        const roots1 = tree.getRoots();
        const roots2 = tree.getRoots();

        expect(roots1[0]).toBe(roots2[0]); // Reference equality check

        const all = tree.getAllNodes();
        expect(all.find(n => n.entityId === 1)).toBe(roots1[0]);
    });

    it('should return all descendants in BFS order for accordion expand', () => {
        const streams = [
            makeStream({ id: '1', type: 'business', name: 'Biz1', icon: 'B', absolute_path: '/b1' }),
            makeStream({ id: '2', type: 'stream', name: 'Stream1', icon: 'S', absolute_path: '/b1/s1', parent_id: '1' }),
            makeStream({ id: '3', type: 'stream', name: 'Stream2', icon: 'S', absolute_path: '/b1/s2', parent_id: '1' }),
            makeStream({ id: '4', type: 'product', name: 'Product1', icon: 'P', absolute_path: '/b1/s1/p1', parent_id: '2' }),
        ];
        const tree = new BusinessTree(streams);

        const descendants = tree.getDescendants(1);

        expect(descendants).toHaveLength(3);

        const labels = descendants.map(d => d.label);
        expect(labels).toContain('Stream1');
        expect(labels).toContain('Stream2');
        expect(labels).toContain('Product1');

        expect(descendants.filter(d => d.type === 'stream')).toHaveLength(2);
        expect(descendants.filter(d => d.type === 'product')).toHaveLength(1);
    });

    it('should return empty array for leaf nodes in getDescendants', () => {
        const streams = [
            makeStream({ id: '1', type: 'business', name: 'Biz1', icon: 'B', absolute_path: '/b1' }),
            makeStream({ id: '2', type: 'stream', name: 'Stream1', icon: 'S', absolute_path: '/b1/s1', parent_id: '1' }),
        ];
        const tree = new BusinessTree(streams);

        // Stream1 is a leaf (no children)
        const descendants = tree.getDescendants(2);
        expect(descendants).toHaveLength(0);
    });
});
