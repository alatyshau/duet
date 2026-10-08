import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DISK_DEBOUNCE_MS, TicketBoard } from '../../core/intents/board';
import { binOrderPath } from '../../core/intents/binOrder';
import { binTickets } from '../../core/intents/binTree';
import { coalesce } from '../../core/intents/coalesce';
import { TicketReader, moveTicketFolder } from '../../core/intents/tickets';
import { createMemFs, MemFs } from './helpers/memFs';

const B = '/drive/DuetLab';
const OTHER = '/drive/Other';

function index(parent: string | null = null): string {
    return ['---', 'work-type: project', `parent: ${parent ?? 'null'}`, '---', '', '# Ticket'].join('\n');
}

function business(): MemFs {
    return createMemFs({
        [`${B}/work/DUE001_First/INDEX.md`]: index(),
        [`${B}/work/DUE002_Second/INDEX.md`]: index(),
        [`${B}/backlog/DUE003_Third/INDEX.md`]: index(),
        [`${OTHER}/work/OTH001_Alien/INDEX.md`]: index()
    }, [`${B}/archive`, `${B}/.vscode`]);
}

function boardOf(mem: MemFs): { board: TicketBoard; changes: () => number } {
    const board = new TicketBoard(new TicketReader(mem.fs), mem.fs);
    let count = 0;
    board.onDidChange(() => { count++; });
    board.setBusiness(B);
    return { board, changes: () => count };
}

const numbers = (board: TicketBoard): string[] => binTickets(board.getTree()).map(n => n.ticket.number).sort();

describe('DUE019: a read belongs to a particular source generation', () => {
    it('A → B → A never publishes the first A reading into the revisited A', async () => {
        const mem = business();
        const reader = new TicketReader(mem.fs);
        const old = await reader.readShelves(B);
        let releaseFirst!: () => void;
        let releaseNext!: () => void;
        let calls = 0;
        vi.spyOn(reader, 'readShelves').mockImplementation(async () => {
            if (++calls === 1) {
                await new Promise<void>(resolve => { releaseFirst = resolve; });
                return old;
            }
            await new Promise<void>(resolve => { releaseNext = resolve; });
            return [];
        });
        const board = new TicketBoard(reader, mem.fs);
        board.setBusiness(B);
        const reading = board.setShown(true);
        await vi.waitFor(() => expect(releaseFirst).toBeDefined());
        board.setBusiness(OTHER);
        board.setBusiness(B);
        releaseFirst();
        await vi.waitFor(() => expect(releaseNext).toBeDefined());
        expect(board.getTickets()).toBeNull();
        releaseNext();
        await reading;
        expect(board.getTickets()).toEqual([]);
        board.dispose();
    });
});

describe('coalesce', () => {
    it('joins the calls that come during a run into one more run', async () => {
        let runs = 0;
        let release: () => void = () => {};
        const run = coalesce(async () => {
            runs++;
            await new Promise<void>(resolve => { release = resolve; });
        });
        const first = run();
        const second = run();
        const third = run();
        expect(second).toBe(first);
        expect(third).toBe(first);
        release();
        await Promise.resolve();
        await Promise.resolve();
        release();
        await first;
        expect(runs).toBe(2);
    });

    it('runs again after a run that failed', async () => {
        let runs = 0;
        const run = coalesce(async () => {
            runs++;
            if (runs === 1) {
                throw new Error('disk');
            }
        });
        await expect(run()).rejects.toThrow('disk');
        await run();
        expect(runs).toBe(2);
    });
});

describe('TicketBoard', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    it('reads nothing until its rows are shown', async () => {
        const mem = business();
        const { board } = boardOf(mem);
        expect(board.getTickets()).toBeNull();
        expect(mem.calls.readdir).toBe(0);
        await board.setShown(true);
        expect(numbers(board)).toEqual(['DUE001', 'DUE002', 'DUE003']);
    });

    it('shows a ticket an agent made past the extension', async () => {
        const mem = business();
        const { board, changes } = boardOf(mem);
        await board.setShown(true);
        const before = changes();

        await mem.fs.mkdir(`${B}/work/DUE004_Fourth`);
        await mem.fs.writeFile(`${B}/work/DUE004_Fourth/INDEX.md`, index(), 'utf8');
        board.diskChanged('shelves');
        await vi.advanceTimersByTimeAsync(DISK_DEBOUNCE_MS);

        expect(numbers(board)).toEqual(['DUE001', 'DUE002', 'DUE003', 'DUE004']);
        expect(changes()).toBe(before + 1);
    });

    it('drops a ticket that went to the archive', async () => {
        const mem = business();
        const { board } = boardOf(mem);
        await board.setShown(true);

        await mem.fs.rename(`${B}/work/DUE002_Second`, `${B}/archive/DUE002_Second`);
        board.diskChanged('shelves');
        await vi.advanceTimersByTimeAsync(DISK_DEBOUNCE_MS);

        expect(numbers(board)).toEqual(['DUE001', 'DUE003']);
    });

    it('takes the order another window wrote', async () => {
        const mem = business();
        const { board } = boardOf(mem);
        await board.setShown(true);
        expect(board.getOrder()).toEqual([]);

        await mem.fs.writeFile(binOrderPath(B), JSON.stringify(['DUE002', 'DUE001']), 'utf8');
        board.diskChanged('shelves');
        await vi.advanceTimersByTimeAsync(DISK_DEBOUNCE_MS);

        expect(board.getOrder()).toEqual(['DUE002', 'DUE001']);
    });

    it('gathers the events of one burst into one reading', async () => {
        const mem = business();
        const { board } = boardOf(mem);
        await board.setShown(true);
        await mem.fs.mkdir(`${B}/work/DUE004_Fourth`);
        const before = mem.calls.readdir;

        for (let i = 0; i < 5; i++) {
            board.diskChanged('shelves');
            await vi.advanceTimersByTimeAsync(DISK_DEBOUNCE_MS / 2);
        }
        await vi.advanceTimersByTimeAsync(DISK_DEBOUNCE_MS);

        // One reading lists the two shelves
        expect(mem.calls.readdir - before).toBe(2);
    });

    it('does not read the folders twice after a move it has already read', async () => {
        const mem = business();
        const { board, changes } = boardOf(mem);
        await board.setShown(true);

        await moveTicketFolder(mem.fs, B, `${B}/work/DUE002_Second`, 'backlog');
        await board.reload();
        const readdirs = mem.calls.readdir;
        const told = changes();

        // The file event of the window's own move comes after the command has read the result
        board.diskChanged('shelves');
        await vi.advanceTimersByTimeAsync(DISK_DEBOUNCE_MS);

        expect(mem.calls.readdir).toBe(readdirs);
        expect(changes()).toBe(told);
    });

    it('reads the folders when an INDEX.md changed, which the stamps do not see', async () => {
        const mem = business();
        const { board } = boardOf(mem);
        await board.setShown(true);
        const first = binTickets(board.getTree()).find(n => n.ticket.number === 'DUE001');
        expect(first?.ticket.parent).toBeNull();

        await mem.fs.writeFile(`${B}/work/DUE001_First/INDEX.md`, index('DUE002'), 'utf8');
        board.diskChanged('ticket');
        await vi.advanceTimersByTimeAsync(DISK_DEBOUNCE_MS);

        expect(board.getTickets()?.find(t => t.number === 'DUE001')?.parent).toBe('DUE002');
    });

    it('tells no one when a reading finds what it had', async () => {
        const mem = business();
        const { board, changes } = boardOf(mem);
        await board.setShown(true);
        const told = changes();
        await board.reload();
        board.diskChanged('ticket');
        await vi.advanceTimersByTimeAsync(DISK_DEBOUNCE_MS);
        expect(changes()).toBe(told);
    });

    it('costs nothing while its rows are hidden, and reads when they are shown again', async () => {
        const mem = business();
        const { board } = boardOf(mem);
        await board.setShown(true);
        await board.setShown(false);
        const stats = mem.calls.stat;
        const readdirs = mem.calls.readdir;

        await mem.fs.rename(`${B}/work/DUE002_Second`, `${B}/archive/DUE002_Second`);
        board.diskChanged('shelves');
        await vi.advanceTimersByTimeAsync(DISK_DEBOUNCE_MS * 2);
        await board.check();
        expect(mem.calls.stat).toBe(stats);
        expect(mem.calls.readdir).toBe(readdirs);

        await board.setShown(true);
        expect(numbers(board)).toEqual(['DUE001', 'DUE003']);
    });

    it('finds on a check a change whose event never came', async () => {
        const mem = business();
        const { board } = boardOf(mem);
        await board.setShown(true);

        await board.check();
        const readdirs = mem.calls.readdir;
        await board.check();
        expect(mem.calls.readdir).toBe(readdirs);

        await mem.fs.rename(`${B}/backlog/DUE003_Third`, `${B}/archive/DUE003_Third`);
        await board.check();
        expect(numbers(board)).toEqual(['DUE001', 'DUE002']);
    });

    it('drops what it read when the business changes', async () => {
        const mem = business();
        const { board, changes } = boardOf(mem);
        await board.setShown(true);
        const told = changes();

        board.setBusiness(OTHER);
        expect(board.getTickets()).toBeNull();
        expect(board.getTree()).toEqual([]);
        expect(changes()).toBe(told + 1);
        await board.reload();
        expect(numbers(board)).toEqual(['OTH001']);

        board.setBusiness(OTHER);
        expect(numbers(board)).toEqual(['OTH001']);
    });

    it('keeps the last order and refuses to call it known when the order file cannot be read', async () => {
        const mem = business();
        await mem.fs.writeFile(binOrderPath(B), JSON.stringify(['DUE002', 'DUE001']), 'utf8');
        const { board } = boardOf(mem);
        await board.setShown(true);
        expect(board.isOrderKnown()).toBe(true);

        const readFile = mem.fs.readFile;
        mem.fs.readFile = async (target, encoding) => {
            if (target === binOrderPath(B)) {
                const error: NodeJS.ErrnoException = new Error('EIO');
                error.code = 'EIO';
                throw error;
            }
            return readFile(target, encoding);
        };
        await board.reload();

        expect(board.getOrder()).toEqual(['DUE002', 'DUE001']);
        expect(board.isOrderKnown()).toBe(false);
    });
});
