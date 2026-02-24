/* eslint-disable @typescript-eslint/naming-convention */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as path from 'path';
import { StreamEntity } from '../../core/api-client';

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

/**
 * Helper to set mock workspace folders for testing.
 */
function setWorkspaceFolders(paths: string[]) {
    (vscode.workspace as unknown as { workspaceFolders: { uri: { fsPath: string } }[] }).workspaceFolders =
        paths.map(p => ({ uri: { fsPath: p } }));
}

describe('BusinessTreeProvider', () => {
    let provider: BusinessTreeProvider;
    const TEMP_DIR = '/tmp/duet-test';

    beforeEach(() => {
        setWorkspaceFolders([]);
    });

    afterEach(() => {
        provider?.dispose();
    });

    describe('getActiveBusinessId', () => {
        it('should return null when no folders are open', () => {
            const bizPath = path.join(TEMP_DIR, 'biz1');
            const streams = [
                makeStream({ id: '1', type: 'business', name: 'Biz1', icon: 'B', absolute_path: bizPath }),
            ];
            provider = new BusinessTreeProvider(streams);

            expect(provider.getActiveBusinessId()).toBeNull();
        });

        it('should return business entityId when its folder is open', () => {
            const bizPath = path.join(TEMP_DIR, 'biz1');
            const otherBizPath = path.join(TEMP_DIR, 'biz2');
            const streams = [
                makeStream({ id: '1', type: 'business', name: 'Biz1', icon: 'B', absolute_path: bizPath }),
                makeStream({ id: '2', type: 'business', name: 'Biz2', icon: 'B', absolute_path: otherBizPath }),
            ];

            setWorkspaceFolders([bizPath]);
            provider = new BusinessTreeProvider(streams);

            expect(provider.getActiveBusinessId()).toBe(1);
        });

        it('should return business entityId when nested folder is open', () => {
            const bizPath = path.join(TEMP_DIR, 'biz1');
            const streamPath = path.join(TEMP_DIR, 'biz1', 'stream1');
            const otherBizPath = path.join(TEMP_DIR, 'biz2');

            const streams = [
                makeStream({ id: '1', type: 'business', name: 'Biz1', icon: 'B', absolute_path: bizPath }),
                makeStream({ id: '2', type: 'business', name: 'Biz2', icon: 'B', absolute_path: otherBizPath }),
                makeStream({ id: '3', type: 'stream', name: 'Stream1', icon: 'S', absolute_path: streamPath, parent_id: '1' }),
            ];

            setWorkspaceFolders([streamPath]);
            provider = new BusinessTreeProvider(streams);

            expect(provider.getActiveBusinessId()).toBe(1);
        });

        it('should return first active business when one business folder is open among many', () => {
            const biz1Path = path.join(TEMP_DIR, 'biz1');
            const biz2Path = path.join(TEMP_DIR, 'biz2');
            const biz3Path = path.join(TEMP_DIR, 'biz3');
            const streams = [
                makeStream({ id: '1', type: 'business', name: 'Biz1', icon: 'B', absolute_path: biz1Path }),
                makeStream({ id: '2', type: 'business', name: 'Biz2', icon: 'B', absolute_path: biz2Path }),
                makeStream({ id: '3', type: 'business', name: 'Biz3', icon: 'B', absolute_path: biz3Path }),
            ];

            setWorkspaceFolders([biz1Path]);
            provider = new BusinessTreeProvider(streams);

            expect(provider.getActiveBusinessId()).toBe(1);
        });

        it('should return null when all businesses are open (multi-root workspace)', () => {
            const biz1Path = path.join(TEMP_DIR, 'biz1');
            const biz2Path = path.join(TEMP_DIR, 'biz2');
            const streams = [
                makeStream({ id: '1', type: 'business', name: 'Biz1', icon: 'B', absolute_path: biz1Path }),
                makeStream({ id: '2', type: 'business', name: 'Biz2', icon: 'B', absolute_path: biz2Path }),
            ];

            setWorkspaceFolders([biz1Path, biz2Path]);
            provider = new BusinessTreeProvider(streams);

            expect(provider.getActiveBusinessId()).toBeNull();
        });

        it('should find business by git product name', () => {
            const reposPath = path.join(TEMP_DIR, 'repos');
            const streams = [
                makeStream({ id: '1', type: 'business', name: 'Biz1', icon: 'B', absolute_path: '/drive/biz1' }),
                makeStream({ id: '2', type: 'product', name: 'MyProduct', icon: 'P', absolute_path: '/drive/biz1/product', parent_id: '1', git_url: 'git@github.com:user/MyProduct.git' }),
            ];

            setWorkspaceFolders([path.join(reposPath, 'MyProduct.git')]);
            provider = new BusinessTreeProvider(streams, reposPath);

            expect(provider.getActiveBusinessId()).toBe(1);
        });
    });

    describe('getTreeItem label generation', () => {
        it('should show orange marker for current product', () => {
            const reposPath = path.join(TEMP_DIR, 'repos');
            const streams = [
                makeStream({ id: '1', type: 'business', name: 'Biz1', icon: 'B', absolute_path: '/drive/biz1' }),
                makeStream({ id: '2', type: 'product', name: 'MyProduct', icon: 'P', absolute_path: '/drive/biz1/product', parent_id: '1', git_url: 'git@github.com:user/MyProduct.git' }),
            ];

            setWorkspaceFolders([path.join(reposPath, 'MyProduct.git')]);
            provider = new BusinessTreeProvider(streams, reposPath);

            const bizNode = provider.getRoots()[0];
            const children = (provider.getChildren(bizNode) as unknown[])
                .filter((c: unknown) => 'entityId' in (c as object)) as { entityId: number }[];
            const product = children.find(c => c.entityId === 2);

            if (product) {
                const item = provider.getTreeItem(product as never);
                expect(item.label).toContain('🟠'); // Orange = active
            }
        });

        it('should show white marker for inactive product', () => {
            const streams = [
                makeStream({ id: '1', type: 'business', name: 'Biz1', icon: 'B', absolute_path: '/drive/biz1' }),
                makeStream({ id: '2', type: 'product', name: 'InactiveProduct', icon: 'P', absolute_path: '/drive/biz1/product', parent_id: '1' }),
            ];

            setWorkspaceFolders([]);
            provider = new BusinessTreeProvider(streams);

            const bizNode = provider.getRoots()[0];
            const children = (provider.getChildren(bizNode) as unknown[])
                .filter((c: unknown) => 'entityId' in (c as object));

            if (children.length > 0) {
                const item = provider.getTreeItem(children[0] as never);
                expect(item.label).toContain('◻️'); // White = inactive
            }
        });

        it('should show orange marker for ancestor of active node (chain highlighting)', () => {
            const reposPath = path.join(TEMP_DIR, 'repos');
            const streams = [
                makeStream({ id: '1', type: 'business', name: 'Biz1', icon: 'B', absolute_path: '/drive/biz1' }),
                makeStream({ id: '2', type: 'stream', name: 'ParentStream', icon: 'S', absolute_path: '/drive/biz1/stream', parent_id: '1' }),
                makeStream({ id: '3', type: 'product', name: 'ChildProduct', icon: 'P', absolute_path: '/drive/biz1/stream/product', parent_id: '2', git_url: 'git@github.com:user/ChildProduct.git' }),
            ];

            setWorkspaceFolders([path.join(reposPath, 'ChildProduct.git')]);
            provider = new BusinessTreeProvider(streams, reposPath);

            const bizNode = provider.getRoots()[0];
            const children = (provider.getChildren(bizNode) as unknown[])
                .filter((c: unknown) => 'entityId' in (c as object)) as { entityId: number }[];
            const stream = children.find(c => c.entityId === 2);

            if (stream) {
                const item = provider.getTreeItem(stream as never);
                expect(item.label).toContain('🟠');
            }
        });

        it('should show business brackets in label', () => {
            const streams = [
                makeStream({ id: '1', type: 'business', name: 'MyBusiness', icon: '🏢', absolute_path: '/drive/biz' }),
            ];
            provider = new BusinessTreeProvider(streams);

            const bizNode = provider.getRoots()[0];
            const item = provider.getTreeItem(bizNode);

            expect(item.label).toContain('[MyBusiness]');
        });

        it('should show correct status circles for business states', () => {
            const streams = [
                makeStream({ id: '1', type: 'business', name: 'Biz1', icon: 'B', absolute_path: '/drive/biz1' }),
            ];
            provider = new BusinessTreeProvider(streams);

            const bizNode = provider.getRoots()[0];

            let item = provider.getTreeItem(bizNode);
            expect(item.label).toContain('🔹'); // Collapsed + inactive

            provider.setExpandedBusiness(bizNode.entityId);
            item = provider.getTreeItem(bizNode);
            expect(item.label).toContain('🟦'); // Expanded + inactive
        });
    });

    describe('separators', () => {
        it('should have separator contextValue to exclude from inline buttons', () => {
            const streams = [
                makeStream({ id: '1', type: 'business', name: 'Biz1', icon: 'B', absolute_path: '/drive/biz1' }),
            ];
            provider = new BusinessTreeProvider(streams);

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
            const streams = [
                makeStream({ id: '1', type: 'business', name: 'Biz1', icon: 'B', absolute_path: '/drive/biz1' }),
            ];
            provider = new BusinessTreeProvider(streams);

            expect(provider.getExpandedBusinessId()).toBeNull();

            provider.setExpandedBusiness(1);
            expect(provider.getExpandedBusinessId()).toBe(1);

            provider.setExpandedBusiness(null);
            expect(provider.getExpandedBusinessId()).toBeNull();
        });
    });

    describe('updateStreams', () => {
        it('should refresh tree with new data', () => {
            const streams1 = [
                makeStream({ id: '1', type: 'business', name: 'OldBiz', icon: 'B', absolute_path: '/drive/old' }),
            ];
            provider = new BusinessTreeProvider(streams1);
            expect(provider.getRoots()[0].label).toBe('OldBiz');

            const streams2 = [
                makeStream({ id: '1', type: 'business', name: 'NewBiz', icon: 'B', absolute_path: '/drive/new' }),
                makeStream({ id: '2', type: 'stream', name: 'NewStream', icon: 'S', absolute_path: '/drive/new/s', parent_id: '1' }),
            ];
            provider.updateStreams(streams2);
            expect(provider.getRoots()[0].label).toBe('NewBiz');
            expect(provider.getRoots()[0].hasChildren).toBe(true);
        });
    });
});
