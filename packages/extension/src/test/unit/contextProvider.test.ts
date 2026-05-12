/* eslint-disable @typescript-eslint/naming-convention */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OrientationResponse } from '../../core/api-client';

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
    Uri: {
        parse: vi.fn((s: string) => ({ scheme: 'duet-tree', path: s })),
        file: vi.fn((p: string) => ({ fsPath: p, scheme: 'file' })),
    },
    EventEmitter: class {
        event = vi.fn();
        fire = vi.fn();
        dispose = vi.fn();
    },
    env: { openExternal: vi.fn() },
}));

import { ContextProvider } from '../../vscode/providers/ContextProvider';

function duetLabOrientation(): OrientationResponse {
    return {
        duet_paths: {
            duetDataPath: '/abs/DuetData',
            machineConfig: '/abs/DuetConfig/mac.json',
            instructionsPath: '/abs/DuetData/repos/Duet-Instructions.git'
        },
        context: {
            chain: [
                { name: 'МетаЛаб', icon: '🔬', description: 'Кузница языка' },
                { name: 'ТехноЛаб', icon: '📁' },
                { name: 'DuetLab', icon: '🎭', description: 'Платформа Human ⇄ AI' }
            ]
        },
        workspace: {
            kind: 'context',
            context_name: 'DuetLab',
            context_folder: '/abs/Drive/!МетаЛаб/ТехноЛаб/DuetLab',
            git_folders: {
                Duet: '/abs/DuetData/repos/Duet.git',
                'Duet-Instructions': '/abs/DuetData/repos/Duet-Instructions.git'
            }
        },
        products: [
            {
                name: 'Duet',
                path: '@Duet.git',
                spec: 'spec/PRODUCT.md',
                description: 'Платформа Human ⇄ AI.',
                components: [
                    { name: 'backend', path: 'packages/backend', spec: 'spec/COMPONENT.md', description: 'Python HTTP API.' },
                    { name: 'extension', path: 'packages/extension', spec: 'spec/COMPONENT.md' },
                    { name: 'host', path: 'packages/host', spec: 'spec/COMPONENT.md' }
                ]
            },
            {
                name: 'Duet-Instructions',
                path: '@Duet-Instructions.git',
                description: 'Инструкции для AI.',
                components: []
            }
        ]
    };
}

describe('ContextProvider', () => {
    let provider: ContextProvider;
    const refreshFn = vi.fn();

    beforeEach(() => {
        refreshFn.mockReset();
    });

    afterEach(() => {
        provider?.dispose();
    });

    describe('chain rendering', () => {
        it('renders the full chain as nested context nodes', () => {
            const orientation = duetLabOrientation();
            provider = new ContextProvider(orientation, refreshFn);

            const roots = provider.getChildren() as Array<{ kind: string; name?: string }>;
            expect(roots).toHaveLength(1);
            expect(roots[0].kind).toBe('chain');
            expect(roots[0].name).toBe('МетаЛаб');

            const tehno = provider.getChildren(roots[0] as never) as Array<{ kind: string; name?: string }>;
            expect(tehno).toHaveLength(1);
            expect(tehno[0].name).toBe('ТехноЛаб');

            const duetlab = provider.getChildren(tehno[0] as never) as Array<{ kind: string; name?: string }>;
            expect(duetlab).toHaveLength(1);
            expect(duetlab[0].name).toBe('DuetLab');
        });

        it('places products as children of the last chain item', () => {
            provider = new ContextProvider(duetLabOrientation(), refreshFn);

            const chain1 = (provider.getChildren() as Array<unknown>)[0];
            const chain2 = (provider.getChildren(chain1 as never) as Array<unknown>)[0];
            const last = (provider.getChildren(chain2 as never) as Array<unknown>)[0];
            const products = provider.getChildren(last as never) as Array<{ kind: string; name?: string; atRef?: string }>;

            expect(products.map(p => p.name)).toEqual(['Duet', 'Duet-Instructions']);
            expect(products.every(p => p.kind === 'product')).toBe(true);
        });

        it('places components under each product', () => {
            provider = new ContextProvider(duetLabOrientation(), refreshFn);

            const chain1 = (provider.getChildren() as Array<unknown>)[0];
            const chain2 = (provider.getChildren(chain1 as never) as Array<unknown>)[0];
            const last = (provider.getChildren(chain2 as never) as Array<unknown>)[0];
            const products = provider.getChildren(last as never) as Array<{ kind: string; name?: string }>;

            const duet = products.find(p => p.name === 'Duet')!;
            const components = provider.getChildren(duet as never) as Array<{ kind: string; name?: string; relativePath?: string }>;
            expect(components.map(c => c.name)).toEqual(['backend', 'extension', 'host']);
            expect(components.every(c => c.kind === 'component')).toBe(true);

            const instr = products.find(p => p.name === 'Duet-Instructions')!;
            expect(provider.getChildren(instr as never)).toEqual([]);
        });
    });

    describe('@-ref resolution', () => {
        it('resolves product.path against workspace.git_folders for git-products', () => {
            provider = new ContextProvider(duetLabOrientation(), refreshFn);

            const chain1 = (provider.getChildren() as Array<unknown>)[0];
            const chain2 = (provider.getChildren(chain1 as never) as Array<unknown>)[0];
            const last = (provider.getChildren(chain2 as never) as Array<unknown>)[0];
            const products = provider.getChildren(last as never) as Array<{ name?: string; absolutePath?: string | null }>;

            const duet = products.find(p => p.name === 'Duet')!;
            expect(duet.absolutePath).toBe('/abs/DuetData/repos/Duet.git');
        });

        it('resolves drive-product paths against workspace.context_folder', () => {
            const r: OrientationResponse = {
                duet_paths: { duetDataPath: '/dd', machineConfig: '/mc', instructionsPath: '/inst' },
                context: { chain: [{ name: 'OntoCore', icon: '📁' }] },
                workspace: {
                    kind: 'context',
                    context_name: 'OntoCore',
                    context_folder: '/drive/OntoCore',
                    git_folders: {}
                },
                products: [
                    { name: 'OntoCore', path: '@OntoCore', components: [
                        { name: 'LangLab', path: 'LangLab' }
                    ] }
                ]
            };
            provider = new ContextProvider(r, refreshFn);

            const chain = (provider.getChildren() as Array<unknown>)[0];
            const products = provider.getChildren(chain as never) as Array<{ name?: string; absolutePath?: string | null }>;
            expect(products[0].absolutePath).toBe('/drive/OntoCore');

            const components = provider.getChildren(products[0] as never) as Array<{ name?: string; absolutePath?: string | null }>;
            expect(components[0].absolutePath).toBe('/drive/OntoCore/LangLab');
        });
    });

    describe('unknown workspace fallback', () => {
        it('shows an info node when workspace.kind is "unknown"', () => {
            const r: OrientationResponse = {
                duet_paths: { duetDataPath: '/dd', machineConfig: '/mc', instructionsPath: '/inst' },
                workspace: { kind: 'unknown', git_folders: {}, context_folder: '/random' },
                products: []
            };
            provider = new ContextProvider(r, refreshFn);

            const roots = provider.getChildren() as Array<{ kind: string; message?: string }>;
            expect(roots).toHaveLength(1);
            expect(roots[0].kind).toBe('info');
            expect(roots[0].message).toContain('вне иерархии');
        });

        it('shows an info node when chain is empty even with kind=context', () => {
            const r: OrientationResponse = {
                duet_paths: { duetDataPath: '/dd', machineConfig: '/mc', instructionsPath: '/inst' },
                workspace: { kind: 'context', context_name: 'X', context_folder: '/x', git_folders: {} },
                context: { chain: [] },
                products: []
            };
            provider = new ContextProvider(r, refreshFn);

            const roots = provider.getChildren() as Array<{ kind: string }>;
            expect(roots[0].kind).toBe('info');
        });

        it('shows an info node when orientation is null', () => {
            provider = new ContextProvider(null, refreshFn);
            const roots = provider.getChildren() as Array<{ kind: string; message?: string }>;
            expect(roots[0].kind).toBe('info');
            expect(roots[0].message).toContain('Контекст');
        });
    });

    describe('updateOrientation', () => {
        it('rebuilds the tree from a fresh response', () => {
            provider = new ContextProvider(null, refreshFn);
            expect((provider.getChildren() as Array<{ kind: string }>)[0].kind).toBe('info');

            provider.updateOrientation(duetLabOrientation());
            const roots = provider.getChildren() as Array<{ kind: string; name?: string }>;
            expect(roots[0].kind).toBe('chain');
            expect(roots[0].name).toBe('МетаЛаб');
        });
    });

    describe('TreeItem labels', () => {
        it('prepends manifest icon to chain labels and uses "comp" for components, no description for products', () => {
            provider = new ContextProvider(duetLabOrientation(), refreshFn);

            const chain1 = (provider.getChildren() as Array<unknown>)[0];
            const chainItem1 = provider.getTreeItem(chain1 as never);
            expect(chainItem1.label).toBe('🔬 МетаЛаб');

            const chain2 = (provider.getChildren(chain1 as never) as Array<unknown>)[0];
            const chainItem2 = provider.getTreeItem(chain2 as never);
            expect(chainItem2.label).toBe('📁 ТехноЛаб');

            const last = (provider.getChildren(chain2 as never) as Array<unknown>)[0];
            const chainItem3 = provider.getTreeItem(last as never);
            expect(chainItem3.label).toBe('🎭 DuetLab');

            const products = provider.getChildren(last as never) as Array<unknown>;
            const duet = (products as Array<{ name: string }>).find(p => p.name === 'Duet')!;

            const productItem = provider.getTreeItem(duet as never);
            // Product label is the bare name; suffix `.git` in the name itself
            // distinguishes git-products visually — no separate marker needed.
            expect(productItem.description).toBeUndefined();

            const components = provider.getChildren(duet as never) as Array<unknown>;
            const backend = (components as Array<{ name: string }>).find(c => c.name === 'backend')!;
            const componentItem = provider.getTreeItem(backend as never);
            expect(componentItem.description).toBe('comp');
        });
    });
});
