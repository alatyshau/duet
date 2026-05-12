/* eslint-disable @typescript-eslint/naming-convention */
// src/test/unit/contextTree.test.ts
import { describe, it, expect } from 'vitest';
import { ContextTree } from '../../core/tree/contextTree';
import { ContextEntity } from '../../core/api-client';

function makeContext(overrides: Partial<ContextEntity> & { id: string; name: string }): ContextEntity {
    return {
        type: 'context',
        icon: null,
        path: '',
        absolute_path: null,
        parent_id: null,
        meta: false,
        git_repos: null,
        ...overrides,
    };
}

describe('ContextTree', () => {
    it('should return top-level contexts as roots', () => {
        const contexts = [
            makeContext({ id: '1', name: 'Biz1', icon: 'B', absolute_path: '/b1' }),
            makeContext({ id: '2', name: 'Biz2', icon: 'B', absolute_path: '/b2' }),
        ];
        const tree = new ContextTree(contexts);

        const roots = tree.getRoots();

        expect(roots).toHaveLength(2);
        expect(roots.find(n => n.label === 'Biz1')).toBeDefined();
        expect(roots.find(n => n.label === 'Biz2')).toBeDefined();
        expect(roots[0].type).toBe('context');
        expect(roots[0].isRoot).toBe(true);
    });

    it('should mark git-backed contexts via hasGit', () => {
        const contexts = [
            makeContext({ id: '1', name: 'Biz', icon: 'B', absolute_path: '/b' }),
            makeContext({
                id: '2', name: 'Duet', icon: 'D', absolute_path: '/b/Duet',
                parent_id: '1', git_repos: { Duet: 'git@github.com:owner/duet.git' }
            }),
        ];
        const tree = new ContextTree(contexts);

        const child = tree.getChildren(1)[0];
        expect(child.hasGit).toBe(true);
        expect(child.gitRepos).toEqual({ Duet: 'git@github.com:owner/duet.git' });
        expect(child.isRoot).toBe(false);
    });

    it('should expose all git_repos entries for multi-repo terminal contexts', () => {
        const contexts = [
            makeContext({
                id: '1', name: 'DuetLab', icon: 'L', absolute_path: '/lab',
                git_repos: {
                    Duet: 'git@github.com:owner/duet.git',
                    'Duet-Instructions': 'git@github.com:owner/duet-instructions.git'
                }
            }),
        ];
        const tree = new ContextTree(contexts);

        const root = tree.getRoots()[0];
        expect(root.hasGit).toBe(true);
        expect(Object.keys(root.gitRepos)).toEqual(['Duet', 'Duet-Instructions']);
    });

    it('should treat empty git_repos map as non-terminal', () => {
        const contexts = [
            makeContext({ id: '1', name: 'Empty', icon: 'E', absolute_path: '/e', git_repos: {} }),
        ];
        const tree = new ContextTree(contexts);
        const root = tree.getRoots()[0];
        expect(root.hasGit).toBe(false);
        expect(root.gitRepos).toEqual({});
    });

    it('should propagate meta flag for meta-context', () => {
        const contexts = [
            makeContext({ id: '1', name: 'БАЗА', icon: '🔥', absolute_path: '/base', meta: true }),
        ];
        const tree = new ContextTree(contexts);

        const root = tree.getRoots()[0];
        expect(root.meta).toBe(true);
        expect(root.isRoot).toBe(true);
    });

    it('should return children properly', () => {
        const contexts = [
            makeContext({ id: '1', name: 'Biz1', icon: 'B', absolute_path: '/b1' }),
            makeContext({ id: '2', name: 'Stream1', icon: 'S', absolute_path: '/b1/s1', parent_id: '1' }),
            makeContext({ id: '3', name: 'Prod1', icon: 'P', absolute_path: '/b1/s1/p1', parent_id: '2', git_repos: { Prod1: 'git@x:y.git' } }),
        ];
        const tree = new ContextTree(contexts);

        const bizChildren = tree.getChildren(1);
        expect(bizChildren).toHaveLength(1);
        expect(bizChildren[0].label).toBe('Stream1');
        expect(bizChildren[0].hasChildren).toBe(true);

        const streamChildren = tree.getChildren(2);
        expect(streamChildren).toHaveLength(1);
        expect(streamChildren[0].label).toBe('Prod1');
        expect(streamChildren[0].hasGit).toBe(true);
        expect(streamChildren[0].hasChildren).toBe(false);
    });

    it('should map entities to tree nodes correctly', () => {
        const contexts = [
            makeContext({ id: '1', name: 'BizMapped', icon: '🧪', absolute_path: '/path/to/biz' }),
            makeContext({ id: '2', name: 'Child', icon: 'C', absolute_path: '/path/to/biz/child', parent_id: '1' }),
        ];
        const tree = new ContextTree(contexts);

        const roots = tree.getRoots();
        const node = roots.find(n => n.label === 'BizMapped');

        expect(node).toBeDefined();
        expect(node?.id).toBe('/path/to/biz');
        expect(node?.label).toBe('BizMapped');
        expect(node?.icon).toBe('🧪');
        expect(node?.type).toBe('context');
        expect(node?.hasChildren).toBe(true);
    });

    it('should return parent node correctly', () => {
        const contexts = [
            makeContext({ id: '1', name: 'Biz1', icon: 'B', absolute_path: '/b1' }),
            makeContext({ id: '2', name: 'Stream1', icon: 'S', absolute_path: '/b1/s1', parent_id: '1' }),
        ];
        const tree = new ContextTree(contexts);

        const parent = tree.getParent(2);
        expect(parent).toBeDefined();
        expect(parent?.label).toBe('Biz1');
        expect(parent?.entityId).toBe(1);

        const rootParent = tree.getParent(1);
        expect(rootParent).toBeNull();
    });

    it('should return all nodes flattened', () => {
        const contexts = [
            makeContext({ id: '1', name: 'Biz1', icon: 'B', absolute_path: '/b1' }),
            makeContext({ id: '2', name: 'Stream1', icon: 'S', absolute_path: '/b1/s1', parent_id: '1' }),
        ];
        const tree = new ContextTree(contexts);

        const all = tree.getAllNodes();
        expect(all).toHaveLength(2);
        expect(all.find(n => n.label === 'Biz1')).toBeDefined();
        expect(all.find(n => n.label === 'Stream1')).toBeDefined();
    });

    it('should cache nodes and return identical references', () => {
        const contexts = [
            makeContext({ id: '1', name: 'Biz1', icon: 'B', absolute_path: '/b1' }),
        ];
        const tree = new ContextTree(contexts);

        const roots1 = tree.getRoots();
        const roots2 = tree.getRoots();

        expect(roots1[0]).toBe(roots2[0]); // Reference equality check

        const all = tree.getAllNodes();
        expect(all.find(n => n.entityId === 1)).toBe(roots1[0]);
    });

    it('should return all descendants in BFS order for accordion expand', () => {
        const contexts = [
            makeContext({ id: '1', name: 'Biz1', icon: 'B', absolute_path: '/b1' }),
            makeContext({ id: '2', name: 'Stream1', icon: 'S', absolute_path: '/b1/s1', parent_id: '1' }),
            makeContext({ id: '3', name: 'Stream2', icon: 'S', absolute_path: '/b1/s2', parent_id: '1' }),
            makeContext({ id: '4', name: 'Product1', icon: 'P', absolute_path: '/b1/s1/p1', parent_id: '2' }),
        ];
        const tree = new ContextTree(contexts);

        const descendants = tree.getDescendants(1);

        expect(descendants).toHaveLength(3);

        const labels = descendants.map(d => d.label);
        expect(labels).toContain('Stream1');
        expect(labels).toContain('Stream2');
        expect(labels).toContain('Product1');
    });

    it('should return empty array for leaf nodes in getDescendants', () => {
        const contexts = [
            makeContext({ id: '1', name: 'Biz1', icon: 'B', absolute_path: '/b1' }),
            makeContext({ id: '2', name: 'Stream1', icon: 'S', absolute_path: '/b1/s1', parent_id: '1' }),
        ];
        const tree = new ContextTree(contexts);

        const descendants = tree.getDescendants(2);
        expect(descendants).toHaveLength(0);
    });

    // === Sorting: meta first, alphabetical otherwise ===

    it('places meta-context first among roots regardless of input order', () => {
        const contexts = [
            makeContext({ id: '1', name: 'Альфа', icon: 'A', absolute_path: '/a' }),
            makeContext({ id: '2', name: 'БАЗА', icon: '🔥', absolute_path: '/base', meta: true }),
            makeContext({ id: '3', name: 'Браво', icon: 'B', absolute_path: '/b' }),
        ];
        const tree = new ContextTree(contexts);

        const roots = tree.getRoots();
        expect(roots.map(r => r.label)).toEqual(['БАЗА', 'Альфа', 'Браво']);
    });

    it('sorts non-meta roots alphabetically; hasGit does not change position', () => {
        const contexts = [
            makeContext({ id: '1', name: 'Заря', icon: 'Z', absolute_path: '/z' }),
            makeContext({ id: '2', name: 'Альфа', icon: 'A', absolute_path: '/a', git_repos: { 'Альфа': 'git@x:a.git' } }),
            makeContext({ id: '3', name: 'Браво', icon: 'B', absolute_path: '/b' }),
        ];
        const tree = new ContextTree(contexts);

        const roots = tree.getRoots();
        // Альфа comes first alphabetically even though it has git_repos.
        expect(roots.map(r => r.label)).toEqual(['Альфа', 'Браво', 'Заря']);
    });

    it('sorts children alphabetically at each nesting level', () => {
        const contexts = [
            makeContext({ id: '1', name: 'Root', icon: 'R', absolute_path: '/r' }),
            makeContext({ id: '2', name: 'Янтарь', icon: 'Y', absolute_path: '/r/y', parent_id: '1' }),
            makeContext({ id: '3', name: 'Альбатрос', icon: 'A', absolute_path: '/r/a', parent_id: '1' }),
            makeContext({ id: '4', name: 'Гроза', icon: 'G', absolute_path: '/r/g', parent_id: '1' }),
        ];
        const tree = new ContextTree(contexts);

        const children = tree.getChildren(1);
        expect(children.map(c => c.label)).toEqual(['Альбатрос', 'Гроза', 'Янтарь']);
    });
});
