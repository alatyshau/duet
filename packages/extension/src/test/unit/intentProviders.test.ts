/* eslint-disable @typescript-eslint/naming-convention */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ContextEntity } from '../../core/api-client';
import { ActiveIntent } from '../../core/intents/active';
import { BinNode } from '../../core/intents/binTree';
import { TicketInfo } from '../../core/intents/tickets';

vi.mock('vscode', () => ({
    workspace: {
        workspaceFolders: [] as { uri: { fsPath: string } }[],
        onDidChangeWorkspaceFolders: vi.fn(() => ({ dispose: vi.fn() })),
    },
    TreeItem: class {
        label: unknown;
        collapsibleState: number;
        id?: string;
        description?: string;
        contextValue?: string;
        tooltip?: string;
        command?: unknown;
        iconPath?: unknown;
        resourceUri?: unknown;
        constructor(label: unknown, collapsibleState: number) {
            this.label = label;
            this.collapsibleState = collapsibleState;
        }
    },
    TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
    ThemeColor: class {
        constructor(public id: string) {}
    },
    Uri: {
        parse: (value: string) => ({ scheme: value.split(':')[0], path: value.slice(value.indexOf(':') + 1), text: value }),
        from: (parts: { scheme: string; path: string }) => ({ ...parts, text: `${parts.scheme}:${parts.path}` }),
        file: (fsPath: string) => ({ scheme: 'file', path: fsPath, fsPath, text: `file:${fsPath}` }),
    },
    DataTransferItem: class {
        constructor(public value: unknown) {}
    },
    EventEmitter: class {
        private listeners: Array<(...args: unknown[]) => void> = [];
        event = (listener: (...args: unknown[]) => void) => {
            this.listeners.push(listener);
            return { dispose: () => undefined };
        };
        fire = (...args: unknown[]) => this.listeners.forEach(l => l(...args));
        dispose = () => undefined;
    },
}));

import * as vscode from 'vscode';
import { IntentsProvider } from '../../vscode/providers/IntentsProvider';
import { BinProvider } from '../../vscode/providers/BinProvider';
import { TreeDecorationProvider } from '../../vscode/providers/TreeDecorationProvider';
import { NotepadDecorationProvider } from '../../vscode/providers/NotepadDecorationProvider';
import { IntentsRuntime } from '../../vscode/intents/IntentsRuntime';
import { rowIconSvg } from '../../core/intents/rowIcon';

const B = '/drive/TestLab';
type FakeUri = { scheme: string; path: string; text: string };

function active(ticket: string, name: string, overrides: Partial<ActiveIntent> = {}): ActiveIntent {
    return {
        subject: 'intent',
        ticket,
        folder: `${ticket}_${name.replace(/ /g, '')}`,
        name,
        icon: '🚀',
        business: 'TestLab',
        workspaceFile: `/data/workspaces/TestLab/${ticket}.code-workspace`,
        color: '#1f6f43',
        own: false,
        pending: false,
        ...overrides
    };
}

function businessRow(name: string, overrides: Partial<ActiveIntent> = {}): ActiveIntent {
    return active(`@${name}`, name, {
        subject: 'business', folder: '', workspaceFile: `/data/workspaces/${name}.code-workspace`, ...overrides
    });
}

function ticket(
    folder: string, shelf: 'work' | 'backlog', workType: string, parent: string | null, icon = ''
): TicketInfo {
    const number = folder.split('_')[0];
    return {
        number, folder, name: folder.slice(number.length + 1), path: `${B}/${shelf}/${folder}`, shelf, workType, parent, icon
    };
}

/** What the providers use of the runtime. */
function fakeRuntime(rows: ActiveIntent[], tickets: TicketInfo[] = []) {
    const listeners: Array<() => void> = [];
    return {
        rows,
        getActive: () => rows,
        isOpen: (key: string) => rows.some(r => r.ticket === key),
        isOwn: (key: string) => rows.some(r => r.own && r.ticket === key),
        colorOf: (key: string) => rows.find(r => r.ticket === key)?.color ?? null,
        onDidChange: (listener: () => void) => { listeners.push(listener); return { dispose: () => undefined }; },
        saveActiveOrder: vi.fn(async (_order: string[]) => undefined),
        tickets: { readShelves: vi.fn(async () => tickets) },
        fire: () => listeners.forEach(l => l())
    };
}
const asRuntime = (fake: ReturnType<typeof fakeRuntime>) => fake as unknown as IntentsRuntime;

function transfer(value?: unknown): vscode.DataTransfer {
    const items = new Map<string, { value: unknown }>();
    const data = {
        set: (mime: string, item: { value: unknown }) => { items.set(mime, item); },
        get: (mime: string) => items.get(mime)
    };
    if (value !== undefined) {
        data.set('application/vnd.code.tree.duet.intents', { value });
        data.set('application/vnd.code.tree.duet.bin', { value });
    }
    return data as unknown as vscode.DataTransfer;
}

/** The emoji a row's icon picture draws; empty for the empty picture. */
function iconOf(item: vscode.TreeItem): string {
    const svg = Buffer.from((item.iconPath as unknown as FakeUri).text.split(',')[1], 'base64').toString('utf8');
    return /<text[^>]*>(.*)<\/text>/.exec(svg)?.[1] ?? '';
}

describe('IntentsProvider', () => {
    const rows = [
        businessRow('TestLab', { color: '#8f1f3f' }),
        active('DUE017', 'Intent Switcher', { own: true, icon: '🧰' }),
        active('DUE008', 'Core Protocols', { color: '#1f4f8f' })
    ];
    const provider = () => new IntentsProvider(asRuntime(fakeRuntime(rows)));

    it('lists the windows flat, in the order the runtime gives', () => {
        expect(provider().getChildren().map(r => r.ticket)).toEqual(['@TestLab', 'DUE017', 'DUE008']);
        expect(provider().getChildren(rows[0])).toEqual([]);
    });

    it('intent row: icon at the left edge, its number and the name, the ticket number after it — no business name', () => {
        const item = provider().getTreeItem(rows[2]);
        expect(item.label).toEqual({ label: '3: Core Protocols', highlights: [] });
        expect(item.description).toBe('DUE008');
        expect(iconOf(item)).toBe('🚀');
        expect(item.id).toBe('intent:DUE008');
    });

    it('business row: the emoji, the name and `biz` — no ticket number', () => {
        const item = provider().getTreeItem(rows[0]);
        expect(item.label).toEqual({ label: '1: TestLab', highlights: [] });
        expect(item.description).toBe('biz');
        expect(iconOf(item)).toBe('🚀');
        expect(item.contextValue).toBe('business');
    });

    it('every row is numbered from 1 as shown, the way tabs are — the business window too; rows past the ninth carry no number', () => {
        const many = [
            businessRow('TestLab'),
            ...Array.from({ length: 10 }, (_, i) => active(`DUE0${10 + i}`, `Task ${i}`))
        ];
        const p = new IntentsProvider(asRuntime(fakeRuntime(many)));
        const labels = many.map(row => (p.getTreeItem(row).label as vscode.TreeItemLabel).label);
        expect(labels).toEqual([
            '1: TestLab', '2: Task 0', '3: Task 1', '4: Task 2', '5: Task 3', '6: Task 4',
            '7: Task 5', '8: Task 6', '9: Task 7', 'Task 8', 'Task 9'
        ]);
    });

    it('the numbers follow the order the runtime gives now: after a new order the same rows show new numbers', () => {
        const runtime = fakeRuntime([businessRow('TestLab'), active('DUE017', 'Intent Switcher'), active('DUE008', 'Core Protocols')]);
        const p = new IntentsProvider(asRuntime(runtime));
        const labels = () => runtime.rows.map(row => (p.getTreeItem(row).label as vscode.TreeItemLabel).label);
        expect(labels()).toEqual(['1: TestLab', '2: Intent Switcher', '3: Core Protocols']);
        runtime.rows.splice(1, 2, runtime.rows[2], runtime.rows[1]);
        expect(labels()).toEqual(['1: TestLab', '2: Core Protocols', '3: Intent Switcher']);
        runtime.rows.splice(0, 1);
        expect(labels()).toEqual(['1: Core Protocols', '2: Intent Switcher']);
    });

    it("the row of this window: its name highlighted together with its number, the red dot at the end", () => {
        const item = provider().getTreeItem(rows[1]);
        const label = item.label as vscode.TreeItemLabel;
        expect(label.label.slice(...label.highlights![0])).toBe('2: Intent Switcher');
        expect(item.description).toBe('DUE017 🔴');
        expect(provider().ownRow()?.ticket).toBe('DUE017');
    });

    it('a row without any emoji still has the icon picture, an empty one, so the names stay in one column', () => {
        const item = provider().getTreeItem(active('DUE004', 'Shell Kick Start', { icon: '' }));
        expect(iconOf(item)).toBe('');
        expect((item.iconPath as unknown as FakeUri).text).toContain(Buffer.from(rowIconSvg(''), 'utf8').toString('base64'));
    });

    it('the text of every row takes the colour that is in force in its window', () => {
        const decorations = new TreeDecorationProvider();
        const colourOf = (row: ActiveIntent) => {
            const uri = provider().getTreeItem(row).resourceUri as unknown as vscode.Uri;
            return (decorations.provideFileDecoration(uri)?.color as unknown as { id: string } | undefined)?.id;
        };
        expect(colourOf(rows[1])).toBe('duet.intent.color1');
        expect(colourOf(rows[2])).toBe('duet.intent.color2');
        expect(colourOf(rows[0])).toBe('duet.intent.color7');
    });

    it('a window whose colour is not of the palette, or that has none, keeps the colour of the theme', () => {
        expect(provider().getTreeItem(active('DUE004', 'x', { color: '#123456' })).resourceUri).toBeUndefined();
        expect(provider().getTreeItem(active('DUE004', 'x', { color: null })).resourceUri).toBeUndefined();
    });

    it('one click switches to the window of the row', () => {
        expect(provider().getTreeItem(rows[2]).command).toMatchObject({ command: 'duet.intents.switch', arguments: [rows[2]] });
        expect(provider().getTreeItem(rows[0]).command).toMatchObject({ command: 'duet.intents.switch', arguments: [rows[0]] });
    });

    describe('drag and drop', () => {
        const three = [businessRow('TestLab'), active('A', 'a'), active('B', 'b'), active('C', 'c')];

        it('accepts only rows of its own view', () => {
            const p = new IntentsProvider(asRuntime(fakeRuntime(three)));
            expect(p.dropMimeTypes).toEqual(['application/vnd.code.tree.duet.intents']);
            expect(p.dragMimeTypes).toEqual(p.dropMimeTypes);
        });

        it('a row dragged up lands before the target, dragged down — after it', async () => {
            const runtime = fakeRuntime(three);
            const p = new IntentsProvider(asRuntime(runtime));

            await p.handleDrop(three[1], transfer('C'));
            expect(runtime.saveActiveOrder).toHaveBeenLastCalledWith(['C', 'A', 'B']);

            await p.handleDrop(three[2], transfer('A'));
            expect(runtime.saveActiveOrder).toHaveBeenLastCalledWith(['B', 'A', 'C']);
        });

        it('a drop past the rows puts the row at the end', async () => {
            const runtime = fakeRuntime(three);
            await new IntentsProvider(asRuntime(runtime)).handleDrop(undefined, transfer('A'));
            expect(runtime.saveActiveOrder).toHaveBeenCalledWith(['B', 'C', 'A']);
        });

        it('a business row is not dragged; a drop on it puts the intent first; its key is never saved', async () => {
            const runtime = fakeRuntime(three);
            const p = new IntentsProvider(asRuntime(runtime));

            const data = transfer();
            p.handleDrag([three[0]], data);
            expect(data.get('application/vnd.code.tree.duet.intents')).toBeUndefined();

            await p.handleDrop(three[2], transfer('@TestLab'));
            expect(runtime.saveActiveOrder).not.toHaveBeenCalled();

            await p.handleDrop(three[0], transfer('C'));
            expect(runtime.saveActiveOrder).toHaveBeenLastCalledWith(['C', 'A', 'B']);
        });

        it('writes nothing when the order does not change or the dragged thing is not a row of the view', async () => {
            const runtime = fakeRuntime(three);
            const p = new IntentsProvider(asRuntime(runtime));
            await p.handleDrop(three[1], transfer('A'));
            await p.handleDrop(three[1], transfer('ZZZ'));
            await p.handleDrop(three[1], transfer());
            expect(runtime.saveActiveOrder).not.toHaveBeenCalled();
        });

        it('reads the dragged row whatever shape the tree hands it back in', async () => {
            const runtime = fakeRuntime(three);
            const p = new IntentsProvider(asRuntime(runtime));
            await p.handleDrop(three[1], transfer([three[3]]));
            expect(runtime.saveActiveOrder).toHaveBeenLastCalledWith(['C', 'A', 'B']);
            await p.handleDrop(three[1], transfer(three[2]));
            expect(runtime.saveActiveOrder).toHaveBeenLastCalledWith(['B', 'A', 'C']);
        });

        it('handleDrag carries the ticket number', () => {
            const p = new IntentsProvider(asRuntime(fakeRuntime(three)));
            const data = transfer();
            p.handleDrag([three[2]], data);
            expect(data.get('application/vnd.code.tree.duet.intents')?.value).toBe('B');
        });
    });
});

describe('BinProvider', () => {
    const business: ContextEntity = {
        id: '1', type: 'context', name: 'TestLab', icon: '🧪', path: 'TestLab',
        absolute_path: B, parent_id: null, meta: false, git_repos: null
    };
    const tickets = [
        ticket('DUEX02_WorkDoctrine', 'work', 'program', null, '📜'),
        ticket('DUE008_CoreProtocols', 'work', 'project', 'DUEX02'),
        ticket('DUE011_DuetWork2', 'work', 'project', 'DUEX02'),
        ticket('DUE001_DuetWork_Full', 'backlog', 'project', 'DUEX02')
    ];
    const find = (nodes: BinNode[], number: string): BinNode => {
        for (const node of nodes) {
            if (node.kind === 'ticket' && node.ticket.number === number) {
                return node;
            }
            const deeper = node.children.length ? find(node.children, number) : undefined;
            if (deeper) {
                return deeper;
            }
        }
        return undefined as unknown as BinNode;
    };

    beforeEach(() => {
        (vscode.workspace as unknown as { workspaceFolders: unknown }).workspaceFolders = [{ uri: { fsPath: B } }];
    });

    async function loaded(openTickets: ActiveIntent[] = []) {
        const runtime = fakeRuntime(openTickets, tickets);
        const provider = new BinProvider([business], asRuntime(runtime));
        await provider.reload();
        return { provider, runtime };
    }

    it('is empty in a window without a business folder, and reads nothing', async () => {
        (vscode.workspace as unknown as { workspaceFolders: unknown }).workspaceFolders = [{ uri: { fsPath: '/elsewhere' } }];
        const runtime = fakeRuntime([], tickets);
        const provider = new BinProvider([business], asRuntime(runtime));
        await provider.reload();
        expect(provider.getChildren()).toEqual([]);
        expect(runtime.tickets.readShelves).not.toHaveBeenCalled();
    });

    it('serves rows from the snapshot: a tree refresh does not read the disk again', async () => {
        const { provider, runtime } = await loaded();
        provider.getChildren();
        provider.getChildren();
        runtime.fire();
        expect(runtime.tickets.readShelves).toHaveBeenCalledTimes(1);
    });

    it('asking for rows does not read the folders — becoming visible does, once', async () => {
        const runtime = fakeRuntime([], tickets);
        const provider = new BinProvider([business], asRuntime(runtime));
        expect(provider.getChildren()).toEqual([]);
        expect(runtime.tickets.readShelves).not.toHaveBeenCalled();

        provider.setVisible(true);
        await provider.reload();
        expect(provider.getChildren()).toHaveLength(1);
    });

    it('should the view never be told it is visible, the folders are read a moment after the first asking', async () => {
        vi.useFakeTimers();
        try {
            const runtime = fakeRuntime([], tickets);
            const provider = new BinProvider([business], asRuntime(runtime));
            provider.getChildren();
            provider.getChildren();
            await vi.advanceTimersByTimeAsync(400);
            expect(runtime.tickets.readShelves).toHaveBeenCalledTimes(1);
        } finally {
            vi.useRealTimers();
        }
    });

    it('readings asked for while one is under way are joined: one more reading, not one each', async () => {
        const runtime = fakeRuntime([], tickets);
        const provider = new BinProvider([business], asRuntime(runtime));
        await Promise.all([provider.reload(), provider.reload(), provider.reload()]);
        expect(runtime.tickets.readShelves).toHaveBeenCalledTimes(2);
    });

    it('several changes in a row redraw the tree once', async () => {
        vi.useFakeTimers();
        try {
            const runtime = fakeRuntime([], tickets);
            const provider = new BinProvider([business], asRuntime(runtime));
            const redrawn = vi.fn();
            provider.onDidChangeTreeData(redrawn);
            runtime.fire();
            runtime.fire();
            await provider.reload();
            expect(redrawn).not.toHaveBeenCalled();
            await vi.advanceTimersByTimeAsync(50);
            expect(redrawn).toHaveBeenCalledTimes(1);
        } finally {
            vi.useRealTimers();
        }
    });

    it("row: the ticket's own icon at the left edge, the name, the number after it; containers open, Backlog closed", async () => {
        const { provider } = await loaded();
        const root = provider.getChildren();
        const container = provider.getTreeItem(root[0]);
        expect(container.label).toEqual({ label: 'WorkDoctrine', highlights: [] });
        expect(container.description).toBe('DUEX02');
        expect(iconOf(container)).toBe('📜');
        expect(container.collapsibleState).toBe(vscode.TreeItemCollapsibleState.Expanded);

        const backlog = root[0].children[2];
        const backlogItem = provider.getTreeItem(backlog);
        expect(backlogItem.label).toBe('Backlog');
        expect(backlogItem.collapsibleState).toBe(vscode.TreeItemCollapsibleState.Collapsed);
        // toggled by the arrow only, as in «Все Бизнесы»
        expect(backlogItem.command).toMatchObject({ command: 'duet.selectNode' });
        expect(provider.getParent(backlog)).toBe(root[0]);
    });

    it('a ticket without an icon gets no emoji from its business — only the empty picture that keeps the column', async () => {
        const { provider } = await loaded();
        expect(iconOf(provider.getTreeItem(find(provider.getChildren(), 'DUE011')))).toBe('');
    });

    it('a ticket with an open window keeps its place and is told by the colour of that window — no red dot', async () => {
        const { provider } = await loaded([active('DUE008', 'x', { color: '#6b3fa0' })]);
        const item = provider.getTreeItem(find(provider.getChildren(), 'DUE008'));
        expect(item.label).toEqual({ label: 'CoreProtocols', highlights: [] });
        expect(item.description).toBe('DUE008');
        expect(`${item.label}${item.description}`).not.toContain('🔴');
        expect((item.resourceUri as unknown as FakeUri).path).toBe('/intent-color/duet.intent.color3/DUE008');
        expect(item.contextValue).toBe('ticket-open');
    });

    it("the ticket of this window: its name on the backdrop, as in «Активная Работа»; other open tickets are only coloured", async () => {
        const { provider } = await loaded([
            active('DUE008', 'x', { own: true, color: '#6b3fa0' }),
            active('DUE011', 'y', { color: '#1f4f8f' })
        ]);
        const own = provider.getTreeItem(find(provider.getChildren(), 'DUE008'));
        const label = own.label as vscode.TreeItemLabel;
        expect(label.label.slice(...label.highlights![0])).toBe('CoreProtocols');
        expect(`${label.label}${own.description}`).not.toContain('🔴');
        expect((own.resourceUri as unknown as FakeUri).path).toBe('/intent-color/duet.intent.color3/DUE008');

        const other = provider.getTreeItem(find(provider.getChildren(), 'DUE011'));
        expect((other.label as vscode.TreeItemLabel).highlights).toEqual([]);
        expect(other.resourceUri).toBeDefined();
    });

    it('the backdrop also marks a container when the window is opened on it; in a business window no row has it', async () => {
        const onProgram = await loaded([active('DUEX02', 'x', { own: true })]);
        const container = onProgram.provider.getTreeItem(find(onProgram.provider.getChildren(), 'DUEX02')).label as vscode.TreeItemLabel;
        expect(container.label.slice(...container.highlights![0])).toBe('WorkDoctrine');

        const inBusiness = await loaded([businessRow('TestLab', { own: true }), active('DUE008', 'x')]);
        for (const number of ['DUE008', 'DUE011', 'DUE001', 'DUEX02']) {
            const label = inBusiness.provider.getTreeItem(find(inBusiness.provider.getChildren(), number)).label;
            expect((label as vscode.TreeItemLabel).highlights).toEqual([]);
        }
    });

    it('a ticket without a window is not coloured', async () => {
        const { provider } = await loaded([active('DUE008', 'x')]);
        expect(provider.getTreeItem(find(provider.getChildren(), 'DUE011')).resourceUri).toBeUndefined();
    });

    it('a click on any row only selects it — the bin never switches windows', async () => {
        const { provider } = await loaded([active('DUE008', 'x')]);
        for (const number of ['DUE008', 'DUE011', 'DUE001', 'DUEX02']) {
            expect(provider.getTreeItem(find(provider.getChildren(), number)).command)
                .toMatchObject({ command: 'duet.selectNode' });
        }
    });

    it('a closed ticket has buttons by shelf; an open one has none', async () => {
        const { provider } = await loaded([active('DUE008', 'x')]);
        expect(provider.getTreeItem(find(provider.getChildren(), 'DUE011')).contextValue).toBe('ticket-work');
        expect(provider.getTreeItem(find(provider.getChildren(), 'DUE001')).contextValue).toBe('ticket-backlog');
        expect(provider.getTreeItem(find(provider.getChildren(), 'DUEX02')).contextValue).toBe('ticket-work');
        expect(provider.getTreeItem(find(provider.getChildren(), 'DUE008')).contextValue).toBe('ticket-open');
    });

    it('a window opening or closing redraws the rows without reading the disk', async () => {
        const { provider, runtime } = await loaded();
        const node = find(provider.getChildren(), 'DUE008');
        expect(provider.getTreeItem(node).resourceUri).toBeUndefined();
        runtime.rows.push(active('DUE008', 'x'));
        runtime.fire();
        expect(provider.getTreeItem(node).resourceUri).toBeDefined();
        expect(runtime.tickets.readShelves).toHaveBeenCalledTimes(1);
    });

    it('every showing of the view gives the rows new ids, so they return to the starting shape; a data refresh does not', async () => {
        const { provider } = await loaded();
        const node = find(provider.getChildren(), 'DUE008');
        const before = provider.getTreeItem(node).id;

        await provider.reload();
        expect(provider.getTreeItem(find(provider.getChildren(), 'DUE008')).id).toBe(before);

        provider.setVisible(true);
        expect(provider.getTreeItem(node).id).not.toBe(before);
    });

    it('showing the view reads the folders; hiding it does not', async () => {
        const { provider, runtime } = await loaded();
        provider.setVisible(false);
        expect(runtime.tickets.readShelves).toHaveBeenCalledTimes(1);
        provider.setVisible(true);
        expect(runtime.tickets.readShelves).toHaveBeenCalledTimes(2);
    });

    it('hands a drop over as row keys; a drop past the rows has no target', async () => {
        const { provider } = await loaded();
        const onDrop = vi.fn(async () => undefined);
        provider.onDrop = onDrop;
        const source = find(provider.getChildren(), 'DUE011');
        const target = find(provider.getChildren(), 'DUE008');

        const data = transfer();
        provider.handleDrag([source], data);
        expect(data.get('application/vnd.code.tree.duet.bin')?.value).toBe(source.key);

        await provider.handleDrop(target, transfer(source.key));
        expect(onDrop).toHaveBeenLastCalledWith(source.key, target.key);
        await provider.handleDrop(undefined, transfer(source.key));
        expect(onDrop).toHaveBeenLastCalledWith(source.key, null);
        // whatever shape the tree hands the dragged row back in
        await provider.handleDrop(target, transfer([source]));
        expect(onDrop).toHaveBeenLastCalledWith(source.key, target.key);
        await provider.handleDrop(target, transfer({ unrelated: true }));
        expect(onDrop).toHaveBeenCalledTimes(3);
        expect(provider.dropMimeTypes).toEqual(['application/vnd.code.tree.duet.bin']);
    });
});

describe('NotepadDecorationProvider — the name of this window\'s notepad in the colour of the window', () => {
    const NOTE = '/biz/work/DUE017_IntentSwitcher/notepad.md';
    const ownIntent = { subject: 'intent', key: 'DUE017' };

    function setup(own: { subject: string; key: string } | null, rows: ActiveIntent[]) {
        const runtime = { ...fakeRuntime(rows), own };
        const provider = new NotepadDecorationProvider(runtime as unknown as IntentsRuntime);
        const fired: string[] = [];
        provider.onDidChangeFileDecorations(uri => { fired.push((uri as unknown as FakeUri & { fsPath: string }).fsPath); });
        const colour = (fsPath: string, scheme = 'file') =>
            (provider.provideFileDecoration({ scheme, fsPath, path: fsPath } as unknown as vscode.Uri)?.color as unknown as { id: string } | undefined)?.id;
        return { runtime, provider, fired, colour };
    }

    it('colours only the notepad of the ticket the window is opened on, and not its folder', () => {
        const { provider, fired, colour } = setup(ownIntent, [active('DUE017', 'x', { own: true, color: '#6b3fa0' })]);
        expect(colour(NOTE)).toBeUndefined();
        provider.setNotepad(NOTE);
        expect(fired).toEqual([NOTE]);
        expect(colour(NOTE)).toBe('duet.intent.color3');
        expect(provider.provideFileDecoration({ scheme: 'file', fsPath: NOTE } as unknown as vscode.Uri)?.propagate).toBe(false);
        expect(colour('/biz/work/DUE008_CoreProtocols/notepad.md')).toBeUndefined();
        expect(colour('/biz/work/DUE017_IntentSwitcher/plan.md')).toBeUndefined();
        expect(colour(NOTE, 'duet-tree')).toBeUndefined();
    });

    it('follows the colour in force in the window: a change is told to the editor, no change is not', () => {
        const row = active('DUE017', 'x', { own: true, color: '#6b3fa0' });
        const { runtime, provider, fired, colour } = setup(ownIntent, [row]);
        provider.setNotepad(NOTE);
        runtime.fire();
        expect(fired).toEqual([NOTE]);
        row.color = '#1f4f8f';
        runtime.fire();
        expect(fired).toEqual([NOTE, NOTE]);
        expect(colour(NOTE)).toBe('duet.intent.color2');
    });

    it('a window without a palette colour, and a business window, colour nothing', () => {
        const plain = setup(ownIntent, [active('DUE017', 'x', { own: true, color: null })]);
        plain.provider.setNotepad(NOTE);
        expect(plain.colour(NOTE)).toBeUndefined();

        const business = setup({ subject: 'business', key: '@TestLab' }, [businessRow('TestLab', { own: true })]);
        business.provider.setNotepad(NOTE);
        expect(business.colour(NOTE)).toBeUndefined();
    });
});

describe('TreeDecorationProvider', () => {
    const provider = new TreeDecorationProvider();
    const colour = (path: string, scheme = 'duet-tree') =>
        (provider.provideFileDecoration({ scheme, path } as unknown as vscode.Uri)?.color as unknown as { id: string } | undefined)?.id;

    it('greys the separators of «Все Бизнесы»', () => {
        expect(colour('/separator/3')).toBe('disabledForeground');
    });

    it('gives the row of an active intent the colour named in its address', () => {
        expect(colour('/intent-color/duet.intent.color5/DUE017')).toBe('duet.intent.color5');
    });

    it('answers nothing for another scheme or a colour that is not one of its own', () => {
        expect(colour('/intent-color/duet.intent.color5/DUE017', 'file')).toBeUndefined();
        expect(colour('/intent-color/editor.background/DUE017')).toBeUndefined();
        expect(colour('/something/else')).toBeUndefined();
    });
});
