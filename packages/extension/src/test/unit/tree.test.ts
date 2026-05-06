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
        ...overrides,
    };
}

describe('BusinessTree', () => {
    it('should return roots', () => {
        const streams: StreamEntity[] = [
            makeStream({ id: '1', type: 'business', name: 'Biz1', icon: 'B', absolute_path: '/b1' }),
            makeStream({ id: '2', type: 'stream', name: 'Stream1', icon: 'S', absolute_path: '/b1/s1', parent_id: '1' }),
        ];
        const tree = new BusinessTree(streams);

        const roots = tree.getRoots();
        expect(roots).toHaveLength(1);
        expect(roots[0].label).toBe('Biz1');
        expect(roots[0].hasChildren).toBe(true);
    });

    it('should return children', () => {
        const streams: StreamEntity[] = [
            makeStream({ id: '1', type: 'business', name: 'Biz1', icon: 'B', absolute_path: '/b1' }),
            makeStream({ id: '2', type: 'stream', name: 'Stream1', icon: 'S', absolute_path: '/b1/s1', parent_id: '1' }),
        ];
        const tree = new BusinessTree(streams);

        const children = tree.getChildren(1);
        expect(children).toHaveLength(1);
        expect(children[0].label).toBe('Stream1');
        expect(children[0].hasChildren).toBe(false);
    });

    it('should use absolute_path as node id', () => {
        const streams: StreamEntity[] = [
            makeStream({ id: '1', type: 'business', name: 'Biz1', icon: 'B', path: 'relative', absolute_path: '/absolute/path' }),
        ];
        const tree = new BusinessTree(streams);

        const roots = tree.getRoots();
        expect(roots[0].id).toBe('/absolute/path');
    });

    it('should fall back to path when absolute_path is null', () => {
        const streams: StreamEntity[] = [
            makeStream({ id: '1', type: 'business', name: 'Biz1', icon: 'B', path: 'relative/path', absolute_path: null }),
        ];
        const tree = new BusinessTree(streams);

        const roots = tree.getRoots();
        expect(roots[0].id).toBe('relative/path');
    });

    it('should return parent', () => {
        const streams: StreamEntity[] = [
            makeStream({ id: '1', type: 'business', name: 'Biz1', icon: 'B', absolute_path: '/b1' }),
            makeStream({ id: '2', type: 'stream', name: 'Stream1', icon: 'S', absolute_path: '/b1/s1', parent_id: '1' }),
        ];
        const tree = new BusinessTree(streams);

        const parent = tree.getParent(2);
        expect(parent).not.toBeNull();
        expect(parent!.label).toBe('Biz1');
    });

    it('should return null for root parent', () => {
        const streams: StreamEntity[] = [
            makeStream({ id: '1', type: 'business', name: 'Biz1', icon: 'B', absolute_path: '/b1' }),
        ];
        const tree = new BusinessTree(streams);

        expect(tree.getParent(1)).toBeNull();
    });

    it('should return all nodes', () => {
        const streams: StreamEntity[] = [
            makeStream({ id: '1', type: 'business', name: 'Biz1', icon: 'B', absolute_path: '/b1' }),
            makeStream({ id: '2', type: 'stream', name: 'Stream1', icon: 'S', absolute_path: '/b1/s1', parent_id: '1' }),
            makeStream({ id: '3', type: 'product', name: 'Prod1', icon: 'P', absolute_path: '/b1/s1/p1', parent_id: '2' }),
        ];
        const tree = new BusinessTree(streams);

        const allNodes = tree.getAllNodes();
        expect(allNodes).toHaveLength(3);
    });

    it('should return descendants in BFS order', () => {
        const streams: StreamEntity[] = [
            makeStream({ id: '1', type: 'business', name: 'Biz1', icon: 'B', absolute_path: '/b1' }),
            makeStream({ id: '2', type: 'stream', name: 'Stream1', icon: 'S', absolute_path: '/b1/s1', parent_id: '1' }),
            makeStream({ id: '3', type: 'product', name: 'Prod1', icon: 'P', absolute_path: '/b1/s1/p1', parent_id: '2' }),
        ];
        const tree = new BusinessTree(streams);

        const desc = tree.getDescendants(1);
        expect(desc).toHaveLength(2);
        expect(desc[0].label).toBe('Stream1');
        expect(desc[1].label).toBe('Prod1');
    });

    it('should update streams and clear cache', () => {
        const streams1: StreamEntity[] = [
            makeStream({ id: '1', type: 'business', name: 'Old', icon: 'O', absolute_path: '/old' }),
        ];
        const tree = new BusinessTree(streams1);
        expect(tree.getRoots()[0].label).toBe('Old');

        const streams2: StreamEntity[] = [
            makeStream({ id: '1', type: 'business', name: 'New', icon: 'N', absolute_path: '/new' }),
        ];
        tree.updateStreams(streams2);
        expect(tree.getRoots()[0].label).toBe('New');
    });

    it('should parse entityId from string id', () => {
        const streams: StreamEntity[] = [
            makeStream({ id: '42', type: 'business', name: 'Biz', icon: 'B', absolute_path: '/b' }),
        ];
        const tree = new BusinessTree(streams);

        expect(tree.getRoots()[0].entityId).toBe(42);
    });

    it('should expose gitUrl from stream', () => {
        const streams: StreamEntity[] = [
            makeStream({ id: '1', type: 'product', name: 'Prod', icon: 'P', absolute_path: '/p', git_url: 'https://github.com/test' }),
        ];
        const tree = new BusinessTree(streams);

        expect(tree.getRoots()[0].gitUrl).toBe('https://github.com/test');
    });

    it('should expose referenceRepos from stream', () => {
        const streams: StreamEntity[] = [
            makeStream({
                id: '1', type: 'business', name: 'Biz', icon: 'B', absolute_path: '/b',
                reference_repos: { cookbook: 'https://github.com/anthropics/cookbook.git' }
            }),
        ];
        const tree = new BusinessTree(streams);

        expect(tree.getRoots()[0].referenceRepos).toEqual({
            cookbook: 'https://github.com/anthropics/cookbook.git'
        });
    });

    it('should leave referenceRepos undefined when absent', () => {
        const streams: StreamEntity[] = [
            makeStream({ id: '1', type: 'business', name: 'Biz', icon: 'B', absolute_path: '/b' }),
        ];
        const tree = new BusinessTree(streams);

        expect(tree.getRoots()[0].referenceRepos).toBeUndefined();
    });
});
