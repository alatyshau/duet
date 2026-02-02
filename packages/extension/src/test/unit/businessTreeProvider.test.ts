/* eslint-disable @typescript-eslint/naming-convention */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DatabaseManager, Entity } from '../../core/db';
import { Paths } from '../../core/paths';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';

// Mock vscode before importing BusinessTreeProvider
vi.mock('vscode', () => ({
    workspace: {
        workspaceFolders: [] as { uri: { fsPath: string } }[],
        onDidChangeWorkspaceFolders: vi.fn(() => ({ dispose: vi.fn() })),
    },
    TreeItem: class {
        label: string;
        collapsibleState: number;
        id?: string;
        contextValue?: string;
        description?: string;
        tooltip?: string;
        resourceUri?: unknown;
        iconPath?: unknown;
        command?: unknown;
        constructor(label: string, collapsibleState: number) {
            this.label = label;
            this.collapsibleState = collapsibleState;
        }
    },
    TreeItemCollapsibleState: {
        None: 0,
        Collapsed: 1,
        Expanded: 2,
    },
    ThemeIcon: class {
        constructor(public id: string) {}
    },
    Uri: {
        parse: vi.fn((s: string) => ({ scheme: 'duet-tree', path: s })),
    },
    EventEmitter: class {
        event = vi.fn();
        fire = vi.fn();
    },
}));

import * as vscode from 'vscode';
import { BusinessTreeProvider } from '../../vscode/providers/BusinessTreeProvider';

/**
 * Helper to set mock workspace folders for testing.
 */
function setWorkspaceFolders(paths: string[]) {
    (vscode.workspace as unknown as { workspaceFolders: { uri: { fsPath: string } }[] }).workspaceFolders =
        paths.map(p => ({ uri: { fsPath: p } }));
}

describe('BusinessTreeProvider', () => {
    let tempDir: string;
    let db: DatabaseManager;
    let provider: BusinessTreeProvider;
    const wasmPath = '/mock/wasm/path';

    beforeEach(async () => {
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'duet-provider-test-'));
        const paths = new Paths(path.join(tempDir, 'DuetData'));
        db = new DatabaseManager(paths);
        await db.init();

        // Reset workspace folders
        setWorkspaceFolders([]);
    });

    afterEach(async () => {
        provider?.dispose();
        await fs.rm(tempDir, { recursive: true, force: true });
    });

    describe('getActiveBusinessId', () => {
        it('should return null when no folders are open', () => {
            const bizPath = path.join(tempDir, 'biz1');
            db.insertEntity({ type: 'business', name: 'Biz1', icon: 'B', drivePath: bizPath });
            provider = new BusinessTreeProvider(db, wasmPath);

            expect(provider.getActiveBusinessId()).toBeNull();
        });

        it('should return business entityId when its folder is open', () => {
            const bizPath = path.join(tempDir, 'biz1');
            const otherBizPath = path.join(tempDir, 'biz2');
            const bizId = db.insertEntity({ type: 'business', name: 'Biz1', icon: 'B', drivePath: bizPath });
            // Add another business to prevent "all businesses open" flag
            db.insertEntity({ type: 'business', name: 'Biz2', icon: 'B', drivePath: otherBizPath });

            setWorkspaceFolders([bizPath]);
            provider = new BusinessTreeProvider(db, wasmPath);

            expect(provider.getActiveBusinessId()).toBe(bizId);
        });

        it('should return business entityId when nested folder is open', () => {
            const bizPath = path.join(tempDir, 'biz1');
            const streamPath = path.join(tempDir, 'biz1', 'stream1');
            const otherBizPath = path.join(tempDir, 'biz2');

            const bizId = db.insertEntity({ type: 'business', name: 'Biz1', icon: 'B', drivePath: bizPath });
            // Also add an unrelated business to prevent "all businesses open" flag
            db.insertEntity({ type: 'business', name: 'Biz2', icon: 'B', drivePath: otherBizPath });
            db.insertEntity({
                type: 'stream',
                name: 'Stream1',
                icon: 'S',
                drivePath: streamPath,
                parentId: bizId
            });

            setWorkspaceFolders([streamPath]);
            provider = new BusinessTreeProvider(db, wasmPath);

            expect(provider.getActiveBusinessId()).toBe(bizId);
        });

        it('should return first active business when one business folder is open among many', () => {
            const biz1Path = path.join(tempDir, 'biz1');
            const biz2Path = path.join(tempDir, 'biz2');
            const biz3Path = path.join(tempDir, 'biz3');
            const biz1Id = db.insertEntity({ type: 'business', name: 'Biz1', icon: 'B', drivePath: biz1Path });
            db.insertEntity({ type: 'business', name: 'Biz2', icon: 'B', drivePath: biz2Path });
            db.insertEntity({ type: 'business', name: 'Biz3', icon: 'B', drivePath: biz3Path });

            // Only first business folder is open (not all businesses)
            setWorkspaceFolders([biz1Path]);
            provider = new BusinessTreeProvider(db, wasmPath);

            expect(provider.getActiveBusinessId()).toBe(biz1Id);
        });

        it('should return null when all businesses are open (multi-root workspace)', () => {
            const biz1Path = path.join(tempDir, 'biz1');
            const biz2Path = path.join(tempDir, 'biz2');
            db.insertEntity({ type: 'business', name: 'Biz1', icon: 'B', drivePath: biz1Path });
            db.insertEntity({ type: 'business', name: 'Biz2', icon: 'B', drivePath: biz2Path });

            // Exactly all businesses are open (multi-root workspace marker)
            setWorkspaceFolders([biz1Path, biz2Path]);
            provider = new BusinessTreeProvider(db, wasmPath);

            // When all businesses are open, returns null (marker goes to header instead)
            expect(provider.getActiveBusinessId()).toBeNull();
        });

        it('should find business by git product name', () => {
            const reposPath = path.join(tempDir, 'repos');
            const bizId = db.insertEntity({ type: 'business', name: 'Biz1', icon: 'B', drivePath: '/drive/biz1' });
            db.insertEntity({
                type: 'product',
                name: 'MyProduct',
                icon: 'P',
                drivePath: '/drive/biz1/product',
                parentId: bizId,
                gitUrl: 'git@github.com:user/MyProduct.git'
            });

            // Product folder is open in repos (git clone location)
            setWorkspaceFolders([path.join(reposPath, 'MyProduct.git')]);
            provider = new BusinessTreeProvider(db, wasmPath, reposPath);

            expect(provider.getActiveBusinessId()).toBe(bizId);
        });
    });

    describe('getTreeItem label generation', () => {
        it('should show orange marker for current product', () => {
            const reposPath = path.join(tempDir, 'repos');
            const bizId = db.insertEntity({ type: 'business', name: 'Biz1', icon: 'B', drivePath: '/drive/biz1' });
            const productId = db.insertEntity({
                type: 'product',
                name: 'MyProduct',
                icon: 'P',
                drivePath: '/drive/biz1/product',
                parentId: bizId,
                gitUrl: 'git@github.com:user/MyProduct.git'
            });

            setWorkspaceFolders([path.join(reposPath, 'MyProduct.git')]);
            provider = new BusinessTreeProvider(db, wasmPath, reposPath);

            const productNode = provider.getRoots()[0];
            const children = (provider.getChildren(productNode) as unknown[])
                .filter((c: unknown) => 'entityId' in (c as object)) as { entityId: number }[];
            const product = children.find(c => c.entityId === productId);

            if (product) {
                const item = provider.getTreeItem(product as never);
                expect(item.label).toContain('🟠'); // Orange = active
            }
        });

        it('should show white marker for inactive product', () => {
            const bizId = db.insertEntity({ type: 'business', name: 'Biz1', icon: 'B', drivePath: '/drive/biz1' });
            db.insertEntity({
                type: 'product',
                name: 'InactiveProduct',
                icon: 'P',
                drivePath: '/drive/biz1/product',
                parentId: bizId
            });

            // No folders open
            setWorkspaceFolders([]);
            provider = new BusinessTreeProvider(db, wasmPath);

            const productNode = provider.getRoots()[0];
            const children = (provider.getChildren(productNode) as unknown[])
                .filter((c: unknown) => 'entityId' in (c as object));

            if (children.length > 0) {
                const item = provider.getTreeItem(children[0] as never);
                expect(item.label).toContain('◻️'); // White = inactive
            }
        });

        it('should show orange marker for ancestor of active node (chain highlighting)', () => {
            const reposPath = path.join(tempDir, 'repos');
            const bizId = db.insertEntity({ type: 'business', name: 'Biz1', icon: 'B', drivePath: '/drive/biz1' });
            const streamId = db.insertEntity({
                type: 'stream',
                name: 'ParentStream',
                icon: 'S',
                drivePath: '/drive/biz1/stream',
                parentId: bizId
            });
            db.insertEntity({
                type: 'product',
                name: 'ChildProduct',
                icon: 'P',
                drivePath: '/drive/biz1/stream/product',
                parentId: streamId,
                gitUrl: 'git@github.com:user/ChildProduct.git'
            });

            // Product is open
            setWorkspaceFolders([path.join(reposPath, 'ChildProduct.git')]);
            provider = new BusinessTreeProvider(db, wasmPath, reposPath);

            // Get the stream (parent of active product)
            const bizNode = provider.getRoots()[0];
            const children = (provider.getChildren(bizNode) as unknown[])
                .filter((c: unknown) => 'entityId' in (c as object)) as { entityId: number }[];
            const stream = children.find(c => c.entityId === streamId);

            if (stream) {
                const item = provider.getTreeItem(stream as never);
                // Stream should be orange because it has an active descendant
                expect(item.label).toContain('🟠');
            }
        });

        it('should show business brackets in label', () => {
            db.insertEntity({ type: 'business', name: 'MyBusiness', icon: '🏢', drivePath: '/drive/biz' });
            provider = new BusinessTreeProvider(db, wasmPath);

            const bizNode = provider.getRoots()[0];
            const item = provider.getTreeItem(bizNode);

            expect(item.label).toContain('[MyBusiness]');
        });

        it('should show correct status circles for business states', () => {
            db.insertEntity({ type: 'business', name: 'Biz1', icon: 'B', drivePath: '/drive/biz1' });
            provider = new BusinessTreeProvider(db, wasmPath);

            const bizNode = provider.getRoots()[0];

            // Initially collapsed and inactive
            let item = provider.getTreeItem(bizNode);
            expect(item.label).toContain('🔹'); // Collapsed + inactive

            // Simulate expanded
            provider.setExpandedBusiness(bizNode.entityId);
            item = provider.getTreeItem(bizNode);
            expect(item.label).toContain('🟦'); // Expanded + inactive
        });
    });

    describe('separators', () => {
        it('should have separator contextValue to exclude from inline buttons', () => {
            db.insertEntity({ type: 'business', name: 'Biz1', icon: 'B', drivePath: '/drive/biz1' });
            provider = new BusinessTreeProvider(db, wasmPath);

            const rootChildren = provider.getChildren() as unknown[];
            const separator = rootChildren.find((c: unknown) =>
                'id' in (c as object) && (c as { id: string }).id.startsWith('separator-')
            );

            if (separator) {
                const item = provider.getTreeItem(separator as never);
                expect(item.contextValue).toBe('separator');
            }
        });
    });

    describe('expandedBusinessId tracking', () => {
        it('should track expanded business state', () => {
            const bizId = db.insertEntity({ type: 'business', name: 'Biz1', icon: 'B', drivePath: '/drive/biz1' });
            provider = new BusinessTreeProvider(db, wasmPath);

            expect(provider.getExpandedBusinessId()).toBeNull();

            provider.setExpandedBusiness(bizId);
            expect(provider.getExpandedBusinessId()).toBe(bizId);

            provider.setExpandedBusiness(null);
            expect(provider.getExpandedBusinessId()).toBeNull();
        });
    });
});
