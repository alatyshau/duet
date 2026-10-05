/* eslint-disable @typescript-eslint/naming-convention */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ContextEntity } from '../../core/api-client';

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

import * as vscode from 'vscode';
import { ContextProvider } from '../../vscode/providers/ContextProvider';
import { buildContextPanel, findCurrentBusiness } from '../../core/tree/contextPanel';

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

function setWorkspaceFolders(paths: string[]) {
    (vscode.workspace as unknown as { workspaceFolders: { uri: { fsPath: string } }[] }).workspaceFolders =
        paths.map(p => ({ uri: { fsPath: p } }));
}

/** МетаЛаб → ТехноЛаб → DuetLab → {Research, Shell}; a sibling venture !БАЗА (meta). */
function metaLab(): ContextEntity[] {
    return [
        makeContext({ id: '1', name: 'МетаЛаб', icon: '🔬', absolute_path: '/drive/!МетаЛаб', description: 'Кузница языка' }),
        makeContext({ id: '2', name: 'ТехноЛаб', icon: '📁', absolute_path: '/drive/!МетаЛаб/ТехноЛаб', parent_id: '1' }),
        makeContext({
            id: '3', name: 'DuetLab', icon: '🎭', absolute_path: '/drive/!МетаЛаб/ТехноЛаб/DuetLab', parent_id: '2',
            git_repos: { Duet: 'git@x:Duet.git' }
        }),
        makeContext({ id: '4', name: 'Research', icon: '📁', absolute_path: '/drive/!МетаЛаб/ТехноЛаб/DuetLab/Research', parent_id: '3' }),
        makeContext({ id: '5', name: 'Shell', icon: '📁', absolute_path: '/drive/!МетаЛаб/ТехноЛаб/DuetLab/Shell', parent_id: '3' }),
        makeContext({ id: '6', name: 'Deep', icon: '📁', absolute_path: '/drive/!МетаЛаб/ТехноЛаб/DuetLab/Shell/Deep', parent_id: '5' }),
        makeContext({ id: '7', name: 'БАЗА', icon: '📚', absolute_path: '/drive/!БАЗА', meta: true }),
    ];
}

const DUETLAB = '/drive/!МетаЛаб/ТехноЛаб/DuetLab';

describe('findCurrentBusiness', () => {
    it('is the business whose folder is among the window folders', () => {
        expect(findCurrentBusiness(metaLab(), [DUETLAB])?.name).toBe('DuetLab');
    });

    it('is nobody when only a repo folder is open', () => {
        expect(findCurrentBusiness(metaLab(), ['/DuetData/repos/Duet.git'])).toBeNull();
    });

    it('is nobody for a folder inside a business that is not a business folder', () => {
        expect(findCurrentBusiness(metaLab(), [`${DUETLAB}/work/DUE013_X`])).toBeNull();
    });

    it('prefers the meta-context, otherwise the first window folder', () => {
        expect(findCurrentBusiness(metaLab(), [DUETLAB, '/drive/!БАЗА'])?.name).toBe('БАЗА');
        expect(findCurrentBusiness(metaLab(), [`${DUETLAB}/Shell`, DUETLAB])?.name).toBe('Shell');
    });
});

describe('buildContextPanel', () => {
    it('shows the venture, the current business and the businesses under it', () => {
        const root = buildContextPanel(metaLab(), [DUETLAB, '/DuetData/repos/Duet.git'])!;

        expect(root.name).toBe('МетаЛаб');
        expect(root.role).toBe('venture');
        // Intermediate parent ТехноЛаб is not shown.
        expect(root.children.map(c => [c.name, c.role])).toEqual([['DuetLab', 'current']]);
        // Direct children only: Deep is under Shell.
        expect(root.children[0].children.map(c => [c.name, c.role])).toEqual([
            ['Research', 'child'],
            ['Shell', 'child'],
        ]);
        expect(root.children[0].children.every(c => c.children.length === 0)).toBe(true);
    });

    it('shows a venture as its own root with its businesses', () => {
        const root = buildContextPanel(metaLab(), ['/drive/!МетаЛаб'])!;

        expect([root.name, root.role]).toEqual(['МетаЛаб', 'venture']);
        expect(root.children.map(c => [c.name, c.role])).toEqual([['ТехноЛаб', 'child']]);
    });

    it('is null when the window has no business folder', () => {
        expect(buildContextPanel(metaLab(), [])).toBeNull();
        expect(buildContextPanel(metaLab(), ['/random'])).toBeNull();
    });
});

describe('ContextProvider', () => {
    let provider: ContextProvider;

    beforeEach(() => {
        setWorkspaceFolders([]);
    });

    afterEach(() => {
        provider?.dispose();
    });

    it('renders the panel as nested business nodes with icon labels', () => {
        setWorkspaceFolders([DUETLAB]);
        provider = new ContextProvider(metaLab());

        const roots = provider.getChildren() as Array<{ kind: string; name?: string }>;
        expect(roots).toHaveLength(1);
        expect(provider.getTreeItem(roots[0] as never).label).toBe('🔬 МетаЛаб');

        const current = provider.getChildren(roots[0] as never) as Array<{ name?: string }>;
        expect(current.map(c => c.name)).toEqual(['DuetLab']);
        expect(provider.getTreeItem(current[0] as never).label).toBe('🎭 DuetLab');

        const children = provider.getChildren(current[0] as never) as Array<{ name?: string }>;
        expect(children.map(c => c.name)).toEqual(['Research', 'Shell']);
        expect(provider.getParent(children[0] as never)).toBe(current[0]);
    });

    it('puts the description and the folder into the tooltip', () => {
        setWorkspaceFolders(['/drive/!МетаЛаб']);
        provider = new ContextProvider(metaLab());

        const root = (provider.getChildren() as unknown[])[0];
        expect(provider.getTreeItem(root as never).tooltip).toBe('Кузница языка\n/drive/!МетаЛаб');
    });

    it('shows an info node when no business folder is open', () => {
        setWorkspaceFolders(['/DuetData/repos/Duet.git']);
        provider = new ContextProvider(metaLab());

        const roots = provider.getChildren() as Array<{ kind: string; message?: string }>;
        expect(roots).toHaveLength(1);
        expect(roots[0].kind).toBe('info');
        expect(roots[0].message).toContain('папка бизнеса');
    });

    it('rebuilds from a fresh list of businesses', () => {
        setWorkspaceFolders([DUETLAB]);
        provider = new ContextProvider([]);
        expect((provider.getChildren() as Array<{ kind: string }>)[0].kind).toBe('info');

        provider.updateContexts(metaLab());
        const roots = provider.getChildren() as Array<{ kind: string; name?: string }>;
        expect(roots[0].kind).toBe('business');
        expect(roots[0].name).toBe('МетаЛаб');
    });
});
