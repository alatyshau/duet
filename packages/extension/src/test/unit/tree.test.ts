import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BusinessTree } from '../../core/tree/businessTree';
import { DatabaseManager } from '../../core/db';

describe('BusinessTree', () => {
    let db: DatabaseManager;
    let tree: BusinessTree;

    beforeEach(() => {
        db = {
            getEntities: vi.fn(),
            hasChildren: vi.fn()
        } as any;
        tree = new BusinessTree(db);
    });

    it('should return roots', () => {
        const businesses = [
            { id: 1, type: 'business', name: 'Biz1', icon: 'B', drivePath: '/b1', parentId: null }
        ];
        (db.getEntities as any).mockReturnValue(businesses);
        (db.hasChildren as any).mockReturnValue(true);

        const roots = tree.getRoots();
        expect(roots).toHaveLength(1);
        expect(roots[0].label).toBe('Biz1');
        expect(roots[0].hasChildren).toBe(true);
        expect(db.getEntities).toHaveBeenCalledWith(null);
    });

    it('should return children', () => {
        const streams = [
            { id: 2, type: 'stream', name: 'Stream1', icon: 'S', drivePath: '/b1/s1', parentId: 1 }
        ];
        (db.getEntities as any).mockReturnValue(streams);
        (db.hasChildren as any).mockReturnValue(false);

        const children = tree.getChildren(1);
        expect(children).toHaveLength(1);
        expect(children[0].label).toBe('Stream1');
        expect(db.getEntities).toHaveBeenCalledWith(1);
    });
});
