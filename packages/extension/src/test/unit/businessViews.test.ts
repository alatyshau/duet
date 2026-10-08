/* eslint-disable @typescript-eslint/naming-convention */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const handlers = vi.hoisted(() => new Map<string, (...args: unknown[]) => unknown>());
vi.mock('vscode', async () => {
    const { fakeVscode } = await import('./helpers/fakeVscode');
    return {
        ...fakeVscode,
        workspace: {
            ...fakeVscode.workspace,
            workspaceFolders: [{ uri: { fsPath: '/drive/Lab' } }],
            onDidChangeWorkspaceFolders: () => ({ dispose: () => undefined })
        },
        commands: {
            ...fakeVscode.commands,
            registerCommand: (id: string, run: (...args: unknown[]) => unknown) => {
                handlers.set(id, run);
                return { dispose: () => handlers.delete(id) };
            }
        }
    };
});

import { fake, resetFake } from './helpers/fakeVscode';
import { asFileSystem, createMemDisk } from './helpers/memDisk';
import { Paths } from '../../core/paths';
import { ContextEntity } from '../../core/api-client';
import { TicketReader } from '../../core/intents/tickets';
import { TicketBoard } from '../../core/intents/board';
import { binTickets } from '../../core/intents/binTree';
import { BinProvider } from '../../vscode/providers/BinProvider';
import { registerWorkView } from '../../vscode/work/registerWorkView';
import { BusinessViews } from '../../vscode/intents/businessViews';

const B = '/drive/Lab';
const O = '/drive/Other';
const T = `${B}/work/DUE018_WorkView`;
const F = `${O}/work/OTH001_Foreign`;
const disposables: Array<{ dispose(): void }> = [];
const entity = (id: string, name: string, absolute_path: string): ContextEntity => ({
    id, name, absolute_path, path: name, type: 'context', icon: null, parent_id: null, meta: false, git_repos: null
});

beforeEach(() => { resetFake(); handlers.clear(); });
afterEach(() => { disposables.splice(0).forEach(d => d.dispose()); });

async function setup(subject: 'intent' | 'business') {
    const disk = createMemDisk({ [`${T}/INDEX.md`]: '', [`${F}/INDEX.md`]: '', [`${F}/file.md`]: '' });
    const fs = asFileSystem(disk);
    const context = { subscriptions: disposables, workspaceState: { get: () => undefined, update: async () => undefined } };
    const runtime = {
        own: { subject, key: subject === 'intent' ? 'DUE018' : '@Lab', ticketFolder: 'DUE018_WorkView', businessPath: B },
        tickets: new TicketReader(fs), onDidChange: () => ({ dispose: () => undefined })
    };
    const work = registerWorkView(context as never, runtime as never, new Paths('/data'), { fs, disk: disk.ops, snapshotFs: disk.fs });
    await work.begin();
    const board = new TicketBoard(runtime.tickets, fs);
    const bin = new BinProvider([entity('1', 'Lab', B), entity('2', 'Other', O)], runtime as never, board);
    const linked = new BusinessViews(bin, work);
    linked.register(context as never);
    disposables.push(bin, board);
    await board.setShown(true);
    return { work, bin, board, linked };
}

describe('DUE019: linked business/bin/work commands', () => {
    it.each(['intent', 'business'] as const)('both refresh buttons restore the %s window binding', async subject => {
        const { work, bin, board } = await setup(subject);
        for (const command of ['duet.bin.refresh', 'duet.work.refresh']) {
            await handlers.get('duet.contexts.select')!({ type: 'context', entityId: 2 });
            expect(bin.currentBusiness()?.name).toBe('Other');
            expect(bin.windowBusiness()?.name).toBe('Lab');
            expect(bin.isForeignBusiness()).toBe(true);
            expect(work.ticket).toBeNull();
            await board.reload();
            const foreign = binTickets(board.getTree())[0];
            await work.selectFromBin(foreign);
            expect(work.ticket?.number).toBe('OTH001');
            expect(fake.trees.get('duet.work')?.description).toBe('другой тикет');
            await handlers.get(command)!();
            expect(bin.currentBusiness()?.name).toBe('Lab');
            expect(bin.isForeignBusiness()).toBe(false);
            expect(work.ticket?.number ?? null).toBe(subject === 'intent' ? 'DUE018' : null);
            expect(fake.executed.some(c => c.command === 'vscode.openFolder')).toBe(false);
        }
    });

    it('ignores separators and missing rows, but a repeated valid selection empties Work again', async () => {
        const { work, linked, board } = await setup('intent');
        await linked.select(undefined);
        await linked.select({ entityId: 2 });
        await linked.select({ type: 'context', entityId: 999 });
        expect(work.ticket?.number).toBe('DUE018');
        await linked.select({ type: 'context', entityId: 2 });
        await board.reload();
        await work.selectFromBin(binTickets(board.getTree())[0]);
        await linked.select({ type: 'context', entityId: 2 });
        expect(work.ticket).toBeNull();
    });
});
