/* eslint-disable @typescript-eslint/naming-convention */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as path from 'path';
import { ContextEntity } from '../../core/api-client';

// Mock vscode before importing ContextTreeProvider
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
import { ContextTreeProvider } from '../../vscode/providers/ContextTreeProvider';

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

/**
 * Helper to set mock workspace folders for testing.
 */
function setWorkspaceFolders(paths: string[]) {
    (vscode.workspace as unknown as { workspaceFolders: { uri: { fsPath: string } }[] }).workspaceFolders =
        paths.map(p => ({ uri: { fsPath: p } }));
}

describe('ContextTreeProvider', () => {
    let provider: ContextTreeProvider;
    const TEMP_DIR = '/tmp/duet-test';

    beforeEach(() => {
        setWorkspaceFolders([]);
    });

    afterEach(() => {
        provider?.dispose();
    });

    describe('getActiveRootId', () => {
        it('should return null when no folders are open', () => {
            const bizPath = path.join(TEMP_DIR, 'biz1');
            const contexts = [
                makeContext({ id: '1', name: 'Biz1', icon: 'B', absolute_path: bizPath }),
            ];
            provider = new ContextTreeProvider(contexts);

            expect(provider.getActiveRootId()).toBeNull();
        });

        it('should return root entityId when its folder is open', () => {
            const bizPath = path.join(TEMP_DIR, 'biz1');
            const otherBizPath = path.join(TEMP_DIR, 'biz2');
            const contexts = [
                makeContext({ id: '1', name: 'Biz1', icon: 'B', absolute_path: bizPath }),
                makeContext({ id: '2', name: 'Biz2', icon: 'B', absolute_path: otherBizPath }),
            ];

            setWorkspaceFolders([bizPath]);
            provider = new ContextTreeProvider(contexts);

            expect(provider.getActiveRootId()).toBe(1);
        });

        it('should return root entityId when nested folder is open', () => {
            const bizPath = path.join(TEMP_DIR, 'biz1');
            const streamPath = path.join(TEMP_DIR, 'biz1', 'stream1');
            const otherBizPath = path.join(TEMP_DIR, 'biz2');

            const contexts = [
                makeContext({ id: '1', name: 'Biz1', icon: 'B', absolute_path: bizPath }),
                makeContext({ id: '2', name: 'Biz2', icon: 'B', absolute_path: otherBizPath }),
                makeContext({ id: '3', name: 'Stream1', icon: 'S', absolute_path: streamPath, parent_id: '1' }),
            ];

            setWorkspaceFolders([streamPath]);
            provider = new ContextTreeProvider(contexts);

            expect(provider.getActiveRootId()).toBe(1);
        });

        it('should return first active root when one root folder is open among many', () => {
            const biz1Path = path.join(TEMP_DIR, 'biz1');
            const biz2Path = path.join(TEMP_DIR, 'biz2');
            const biz3Path = path.join(TEMP_DIR, 'biz3');
            const contexts = [
                makeContext({ id: '1', name: 'Biz1', icon: 'B', absolute_path: biz1Path }),
                makeContext({ id: '2', name: 'Biz2', icon: 'B', absolute_path: biz2Path }),
                makeContext({ id: '3', name: 'Biz3', icon: 'B', absolute_path: biz3Path }),
            ];

            setWorkspaceFolders([biz1Path]);
            provider = new ContextTreeProvider(contexts);

            expect(provider.getActiveRootId()).toBe(1);
        });

        it('should return null when all roots are open (multi-root workspace)', () => {
            const biz1Path = path.join(TEMP_DIR, 'biz1');
            const biz2Path = path.join(TEMP_DIR, 'biz2');
            const contexts = [
                makeContext({ id: '1', name: 'Biz1', icon: 'B', absolute_path: biz1Path }),
                makeContext({ id: '2', name: 'Biz2', icon: 'B', absolute_path: biz2Path }),
            ];

            setWorkspaceFolders([biz1Path, biz2Path]);
            provider = new ContextTreeProvider(contexts);

            expect(provider.getActiveRootId()).toBeNull();
        });

        it('should find root by git context name', () => {
            const reposPath = path.join(TEMP_DIR, 'repos');
            const contexts = [
                makeContext({ id: '1', name: 'Biz1', icon: 'B', absolute_path: '/drive/biz1' }),
                makeContext({ id: '2', name: 'MyProduct', icon: 'P', absolute_path: '/drive/biz1/product', parent_id: '1', git_repos: { MyProduct: 'git@github.com:user/MyProduct.git' } }),
            ];

            setWorkspaceFolders([path.join(reposPath, 'MyProduct.git')]);
            provider = new ContextTreeProvider(contexts, reposPath);

            expect(provider.getActiveRootId()).toBe(1);
        });
    });

    describe('getTreeItem label generation', () => {
        it('should show orange marker for current git-backed context', () => {
            const reposPath = path.join(TEMP_DIR, 'repos');
            const contexts = [
                makeContext({ id: '1', name: 'Biz1', icon: 'B', absolute_path: '/drive/biz1' }),
                makeContext({ id: '2', name: 'MyProduct', icon: 'P', absolute_path: '/drive/biz1/product', parent_id: '1', git_repos: { MyProduct: 'git@github.com:user/MyProduct.git' } }),
            ];

            setWorkspaceFolders([path.join(reposPath, 'MyProduct.git')]);
            provider = new ContextTreeProvider(contexts, reposPath);

            const bizNode = provider.getRoots()[0];
            const children = (provider.getChildren(bizNode) as unknown[])
                .filter((c: unknown) => 'entityId' in (c as object)) as { entityId: number }[];
            const product = children.find(c => c.entityId === 2);

            if (product) {
                const item = provider.getTreeItem(product as never);
                expect(item.label).toContain('🟠'); // Orange = active
            }
        });

        it('should highlight git-backed context when any of its aliases is open (multi-repo)', () => {
            const reposPath = path.join(TEMP_DIR, 'repos');
            const contexts = [
                makeContext({ id: '1', name: 'МетаЛаб', icon: 'M', absolute_path: '/drive/metalab' }),
                makeContext({
                    id: '2', name: 'DuetLab', icon: 'L', absolute_path: '/drive/metalab/duetlab',
                    parent_id: '1',
                    git_repos: {
                        Duet: 'git@x:Duet.git',
                        'Duet-Instructions': 'git@x:Duet-Instructions.git'
                    }
                }),
            ];

            // Open only ONE of the two aliases — the context label "DuetLab" does
            // not match any opened folder basename. Pre-multi-repo highlight broke
            // here because the matcher compared `node.label` instead of aliases.
            setWorkspaceFolders([path.join(reposPath, 'Duet.git')]);
            provider = new ContextTreeProvider(contexts, reposPath);

            const root = provider.getRoots()[0];
            const children = (provider.getChildren(root) as unknown[])
                .filter((c: unknown) => 'entityId' in (c as object)) as { entityId: number }[];
            const duetLab = children.find(c => c.entityId === 2);

            expect(duetLab).toBeDefined();
            const item = provider.getTreeItem(duetLab as never);
            expect(item.label).toContain('🟠');
        });

        it('should treat root as active when one descendant git alias is open', () => {
            const reposPath = path.join(TEMP_DIR, 'repos');
            const contexts = [
                makeContext({ id: '1', name: 'МетаЛаб', icon: 'M', absolute_path: '/drive/metalab' }),
                makeContext({
                    id: '2', name: 'DuetLab', icon: 'L', absolute_path: '/drive/metalab/duetlab',
                    parent_id: '1',
                    git_repos: {
                        Duet: 'git@x:Duet.git',
                        'Duet-Instructions': 'git@x:Duet-Instructions.git'
                    }
                }),
            ];

            setWorkspaceFolders([path.join(reposPath, 'Duet-Instructions.git')]);
            provider = new ContextTreeProvider(contexts, reposPath);

            expect(provider.getActiveRootId()).toBe(1);
        });

        it('should show white marker for inactive nested context', () => {
            const contexts = [
                makeContext({ id: '1', name: 'Biz1', icon: 'B', absolute_path: '/drive/biz1' }),
                makeContext({ id: '2', name: 'InactiveProduct', icon: 'P', absolute_path: '/drive/biz1/product', parent_id: '1' }),
            ];

            setWorkspaceFolders([]);
            provider = new ContextTreeProvider(contexts);

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
            const contexts = [
                makeContext({ id: '1', name: 'Biz1', icon: 'B', absolute_path: '/drive/biz1' }),
                makeContext({ id: '2', name: 'ParentStream', icon: 'S', absolute_path: '/drive/biz1/stream', parent_id: '1' }),
                makeContext({ id: '3', name: 'ChildProduct', icon: 'P', absolute_path: '/drive/biz1/stream/product', parent_id: '2', git_repos: { ChildProduct: 'git@github.com:user/ChildProduct.git' } }),
            ];

            setWorkspaceFolders([path.join(reposPath, 'ChildProduct.git')]);
            provider = new ContextTreeProvider(contexts, reposPath);

            const bizNode = provider.getRoots()[0];
            const children = (provider.getChildren(bizNode) as unknown[])
                .filter((c: unknown) => 'entityId' in (c as object)) as { entityId: number }[];
            const stream = children.find(c => c.entityId === 2);

            if (stream) {
                const item = provider.getTreeItem(stream as never);
                expect(item.label).toContain('🟠');
            }
        });

        it('should show brackets in root label', () => {
            const contexts = [
                makeContext({ id: '1', name: 'MyBusiness', icon: '🏢', absolute_path: '/drive/biz' }),
            ];
            provider = new ContextTreeProvider(contexts);

            const bizNode = provider.getRoots()[0];
            const item = provider.getTreeItem(bizNode);

            expect(item.label).toContain('[MyBusiness]');
        });

        it('should show correct status circles for root states', () => {
            const contexts = [
                makeContext({ id: '1', name: 'Biz1', icon: 'B', absolute_path: '/drive/biz1' }),
            ];
            provider = new ContextTreeProvider(contexts);

            const bizNode = provider.getRoots()[0];

            let item = provider.getTreeItem(bizNode);
            expect(item.label).toContain('🔹'); // Collapsed + inactive

            provider.setExpandedRoot(bizNode.entityId);
            item = provider.getTreeItem(bizNode);
            expect(item.label).toContain('🟦'); // Expanded + inactive
        });
    });

    describe('separators', () => {
        it('should have separator contextValue to exclude from inline buttons', () => {
            const contexts = [
                makeContext({ id: '1', name: 'Biz1', icon: 'B', absolute_path: '/drive/biz1' }),
            ];
            provider = new ContextTreeProvider(contexts);

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

    describe('expandedRootId tracking', () => {
        it('should track expanded root state', () => {
            const contexts = [
                makeContext({ id: '1', name: 'Biz1', icon: 'B', absolute_path: '/drive/biz1' }),
            ];
            provider = new ContextTreeProvider(contexts);

            expect(provider.getExpandedRootId()).toBeNull();

            provider.setExpandedRoot(1);
            expect(provider.getExpandedRootId()).toBe(1);

            provider.setExpandedRoot(null);
            expect(provider.getExpandedRootId()).toBeNull();
        });
    });

    describe('updateContexts', () => {
        it('should refresh tree with new data', () => {
            const contexts1 = [
                makeContext({ id: '1', name: 'OldBiz', icon: 'B', absolute_path: '/drive/old' }),
            ];
            provider = new ContextTreeProvider(contexts1);
            expect(provider.getRoots()[0].label).toBe('OldBiz');

            const contexts2 = [
                makeContext({ id: '1', name: 'NewBiz', icon: 'B', absolute_path: '/drive/new' }),
                makeContext({ id: '2', name: 'NewStream', icon: 'S', absolute_path: '/drive/new/s', parent_id: '1' }),
            ];
            provider.updateContexts(contexts2);
            expect(provider.getRoots()[0].label).toBe('NewBiz');
            expect(provider.getRoots()[0].hasChildren).toBe(true);
        });
    });
});
