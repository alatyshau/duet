/* eslint-disable @typescript-eslint/naming-convention */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as vscode from 'vscode';
import { ContextEntity } from '../../core/api-client';
import { Paths } from '../../core/paths';
import { TicketReader } from '../../core/intents/tickets';
import { TicketBoard } from '../../core/intents/board';
import { binTickets } from '../../core/intents/binTree';
import { BinProvider } from '../../vscode/providers/BinProvider';
import { BinActions } from '../../vscode/commands/intents';
import { TicketOpener } from '../../vscode/commands/openTicket';
import { createMemFs } from './helpers/memFs';

vi.mock('vscode', () => ({
    workspace: {
        workspaceFolders: [{ uri: { fsPath: '/drive/Home' } }],
        onDidChangeWorkspaceFolders: () => ({ dispose: () => undefined })
    },
    window: {
        showWarningMessage: vi.fn(), showErrorMessage: vi.fn(),
        showInputBox: vi.fn(async () => 'New Ticket')
    },
    commands: { executeCommand: vi.fn() },
    Uri: { file: (fsPath: string) => ({ fsPath }) },
    EventEmitter: class {
        event = () => ({ dispose: () => undefined });
        fire = () => undefined;
        dispose = () => undefined;
    }
}));
vi.mock('../../vscode/commands/businessRepos', () => ({
    prepareBusinessRepos: async () => true, isSafeRepoName: () => true
}));

const H = '/drive/Home';
const F = '/drive/Foreign';
const C = `${F}/backlog/OTHA01_Curator`;
const business = (id: string, name: string, absolute_path: string): ContextEntity => ({
    id, name, absolute_path, path: name, type: 'context', icon: null, parent_id: null, meta: false, git_repos: null
});
const curator = '---\nwork-type: process\nprocess-type: curator\n---\n';

function setup() {
    const mem = createMemFs({
        [`${H}/context.json`]: '{"version":4,"name":"Home","ticket_code":"HOM"}',
        [`${H}/work/HOM001_Own/INDEX.md`]: '',
        [`${F}/context.json`]: '{"version":4,"name":"Foreign","ticket_code":"OTH"}',
        [`${F}/work/OTH001_First/INDEX.md`]: '',
        [`${F}/work/OTH002_Second/INDEX.md`]: '',
        [`${C}/INDEX.md`]: curator
    });
    const tickets = new TicketReader(mem.fs);
    const runtime = {
        tickets,
        refresh: vi.fn(async () => undefined), getActive: vi.fn(() => [] as { ticket: string; workspaceFile: string }[]),
        isOpen: () => false, onDidChange: () => ({ dispose: () => undefined }),
        occupiedColors: () => [], reserve: vi.fn(async () => undefined)
    };
    const board = new TicketBoard(tickets, mem.fs);
    const bin = new BinProvider([business('1', 'Home', H), business('2', 'Foreign', F)], runtime as never, board);
    const actions = new BinActions(new Paths('/data'), runtime as never, bin, board, mem.fs);
    return { mem, tickets, runtime, board, bin, actions };
}

beforeEach(() => { vi.clearAllMocks(); });

describe('DUE019: explicit ownership of bin actions and shared ticket opening', () => {
    it('a queued move keeps the shown business even if preview changes before execution', async () => {
        const { bin, board, actions, mem } = setup();
        bin.showBusiness(2); await board.reload();
        const row = binTickets(board.getTree()).find(n => n.ticket.number === 'OTH001')!;
        const moving = actions.toBacklog(row);
        await bin.goHome();
        await moving;
        expect(mem.dirs.has(`${F}/backlog/OTH001_First`)).toBe(true);
        expect(mem.dirs.has(`${H}/backlog/OTH001_First`)).toBe(false);
        // Invoking an old row after switching is ignored, not resolved in Home.
        await actions.toBacklog(row);
        expect(board.getBusinessPath()).toBe(H);
        bin.dispose(); board.dispose();
    });

    it('reorder writes only the shown business; a stale queued drop writes nothing', async () => {
        const { bin, board, actions, mem } = setup();
        bin.showBusiness(2); await board.reload();
        let rows = binTickets(board.getTree());
        await actions.drop(rows.find(n => n.ticket.number === 'OTH002')!.key, rows.find(n => n.ticket.number === 'OTH001')!.key);
        expect(mem.files.has(`${F}/.vscode/duet-intents.json`)).toBe(true);
        expect(mem.files.has(`${H}/.vscode/duet-intents.json`)).toBe(false);
        rows = binTickets(board.getTree());
        const before = mem.calls.writeFile;
        const dropping = actions.drop(rows[0].key, rows[1].key);
        await bin.goHome();
        await dropping;
        expect(mem.calls.writeFile).toBe(before);
        bin.dispose(); board.dispose();
    });

    it('new ticket belongs to the window, not the preview, and opens through the same service', async () => {
        const { bin, board, actions, mem, runtime } = setup();
        bin.showBusiness(2); await board.reload();
        await actions.create();
        expect(mem.dirs.has(`${H}/work/HOM002_NewTicket`)).toBe(true);
        expect(mem.dirs.has(`${F}/work/OTH003_NewTicket`)).toBe(false);
        expect(runtime.reserve).toHaveBeenCalledWith(expect.objectContaining({ business: 'Home', ticket: 'HOM002' }));
        expect(vscode.commands.executeCommand).toHaveBeenCalledWith('vscode.openFolder', expect.objectContaining({ fsPath: '/data/workspaces/Home/HOM002_NewTicket.code-workspace' }), { forceNewWindow: true });
        expect(bin.currentBusiness()?.name).toBe('Foreign');
        bin.dispose(); board.dispose();
    });

    it('curator from backlog is opened as a normal ticket with the correct business and moved into work', async () => {
        const { bin, board, tickets, runtime, mem } = setup();
        const row = await tickets.findCurator(F);
        const changed = vi.fn(async () => undefined);
        const opener = new TicketOpener(new Paths('/data'), runtime as never, changed, mem.fs);
        expect(await opener.open(row!, business('2', 'Foreign', F), false, true)).toBe(true);
        expect(mem.dirs.has(`${F}/work/OTHA01_Curator`)).toBe(true);
        expect(mem.dirs.has(C)).toBe(false);
        expect(changed).toHaveBeenCalled();
        expect(runtime.reserve).toHaveBeenCalledWith(expect.objectContaining({ subject: 'intent', businessPath: F, ticket: 'OTHA01' }));
        expect(vscode.commands.executeCommand).toHaveBeenCalledWith('vscode.openFolder', expect.objectContaining({ fsPath: '/data/workspaces/Foreign/OTHA01_Curator.code-workspace' }), { forceNewWindow: false });
        bin.dispose(); board.dispose();
    });

    it('existing curator window is focused without rewriting its workspace or moving its folder', async () => {
        const { bin, board, tickets, runtime, mem } = setup();
        runtime.getActive.mockReturnValue([{ ticket: 'OTHA01', workspaceFile: '/existing.code-workspace' }]);
        const row = await tickets.findCurator(F);
        const before = mem.calls.atomicWriteFile;
        await new TicketOpener(new Paths('/data'), runtime as never, undefined, mem.fs)
            .open(row!, business('2', 'Foreign', F), false, true);
        expect(mem.calls.atomicWriteFile).toBe(before);
        expect(mem.dirs.has(C)).toBe(true);
        expect(vscode.commands.executeCommand).toHaveBeenCalledWith('vscode.openFolder', expect.objectContaining({ fsPath: '/existing.code-workspace' }), { forceNewWindow: true });
        bin.dispose(); board.dispose();
    });

    it('changed criterion is revalidated before moving or opening the selected curator', async () => {
        const { bin, board, tickets, runtime, mem } = setup();
        const row = await tickets.findCurator(F);
        await mem.fs.writeFile(`${C}/INDEX.md`, '', 'utf8');
        await expect(new TicketOpener(new Paths('/data'), runtime as never, undefined, mem.fs)
            .open(row!, business('2', 'Foreign', F), true, true)).rejects.toThrow('изменился');
        expect(mem.dirs.has(C)).toBe(true);
        expect(vscode.commands.executeCommand).not.toHaveBeenCalled();
        bin.dispose(); board.dispose();
    });
});
