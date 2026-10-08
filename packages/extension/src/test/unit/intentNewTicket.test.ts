import { describe, it, expect } from 'vitest';
import {
    createTicket,
    localDate,
    newTicketIndexText,
    nextProjectNumber,
    pascalCaseName
} from '../../core/intents/newTicket';
import { TicketReader, parseTicketFrontmatter } from '../../core/intents/tickets';
import { createMemFs } from './helpers/memFs';

const B = '/drive/DuetLab';
const NOW = new Date(2026, 9, 5, 23, 30);

describe('pascalCaseName', () => {
    it.each([
        ['ui research', 'UiResearch'],
        ['UI research', 'UiResearch'],
        ['new ticket button', 'NewTicketButton'],
        ['синхронизация корзины', 'СинхронизацияКорзины'],
        ['duet work 2', 'DuetWork2'],
        ['  bin   sync  ', 'BinSync'],
        ['bin-sync_now.please', 'BinSyncNowPlease']
    ])('%s → %s', (typed, slug) => {
        expect(pascalCaseName(typed)).toBe(slug);
    });

    // The price of finding words in a name typed together: the same as in any PascalCase converter
    it('a capital after a single small letter starts a word', () => {
        expect(pascalCaseName('iPhone app')).toBe('IPhoneApp');
        expect(pascalCaseName('uI research')).toBe('UIResearch');
    });

    it('an apostrophe does not end a word', () => {
        expect(pascalCaseName("don't panic")).toBe('DontPanic');
        expect(pascalCaseName('it’s done')).toBe('ItsDone');
    });

    it('keeps the words of a name typed in PascalCase', () => {
        expect(pascalCaseName('IntentSwitcher')).toBe('IntentSwitcher');
        expect(pascalCaseName('СинхронизацияКорзины')).toBe('СинхронизацияКорзины');
        expect(pascalCaseName('UIResearch')).toBe('UiResearch');
        expect(pascalCaseName('Duet2Work')).toBe('Duet2Work');
    });

    it('never gives more than one folder name', () => {
        expect(pascalCaseName('a/b')).toBe('AB');
        expect(pascalCaseName('../up')).toBe('Up');
    });

    it('keeps a letter typed as a base and a combining mark', () => {
        expect(pascalCaseName('йод')).toBe('Йод');
    });

    it('is empty when there is nothing to name the ticket by', () => {
        expect(pascalCaseName('')).toBe('');
        expect(pascalCaseName('  — … ')).toBe('');
        expect(pascalCaseName('\u0301')).toBe('');
    });
});

describe('nextProjectNumber', () => {
    it('is one above the highest project number', () => {
        expect(nextProjectNumber('DUE', ['DUE004', 'DUE022', 'DUE017'])).toBe('DUE023');
    });

    it('starts at 001', () => {
        expect(nextProjectNumber('DUE', [])).toBe('DUE001');
    });

    it('does not count programs, processes and other codes', () => {
        expect(nextProjectNumber('DUE', ['DUE007', 'DUEX03', 'DUEA01', 'MET512'])).toBe('DUE008');
    });

    it('has nothing after 999', () => {
        expect(nextProjectNumber('DUE', ['DUE999'])).toBeNull();
    });
});

describe('newTicketIndexText', () => {
    it('is the frontmatter of a project with empty area and parent, and a heading', () => {
        const text = newTicketIndexText('DUE023', 'BinSync', '2026-10-05');
        expect(text).toBe([
            '---',
            'folder-type: work',
            'work-type: project',
            'opened: 2026-10-05',
            'business-area:',
            'parent:',
            '---',
            '',
            '# DUE023 — Bin Sync',
            ''
        ].join('\n'));
        expect(parseTicketFrontmatter(text)).toEqual({ parent: null, workType: 'project', processType: null, icon: '' });
    });

    it('a ticket without a name has the bare number as its heading', () => {
        expect(newTicketIndexText('DUE023', '', '2026-10-05')).toContain('\n# DUE023\n');
    });
});

describe('localDate', () => {
    it('is the day of the local clock', () => {
        expect(localDate(NOW)).toBe('2026-10-05');
        expect(localDate(new Date(2026, 0, 3, 0, 5))).toBe('2026-01-03');
    });
});

describe('TicketReader.allNumbers', () => {
    it('collects work, backlog and the archive with its month folders', async () => {
        const mem = createMemFs({}, [
            `${B}/work/DUE021_BinSync`,
            `${B}/work/DUEX03_WorkSupport`,
            `${B}/work/notes`,
            `${B}/backlog/DUE016_BusinessIndex`,
            `${B}/archive/202610/DUE017_IntentSwitcher`,
            `${B}/archive/2026/09/DUE002_DuetChat`,
            `${B}/archive/a/b/c/DUE900_TooDeep`
        ]);
        expect((await new TicketReader(mem.fs).allNumbers(B)).sort())
            .toEqual(['DUE002', 'DUE016', 'DUE017', 'DUE021', 'DUEX03']);
    });

    it('a folder that is there but cannot be read is an error, not an empty folder', async () => {
        const mem = createMemFs({}, [`${B}/work/DUE021_BinSync`, `${B}/backlog/DUE016_BusinessIndex`]);
        const fs = {
            ...mem.fs,
            readdir: async (target: string, options: { withFileTypes: true }) => {
                if (target === `${B}/work`) {
                    const error: NodeJS.ErrnoException = new Error('EIO: i/o error');
                    error.code = 'EIO';
                    throw error;
                }
                return mem.fs.readdir(target, options);
            }
        };
        await expect(new TicketReader(fs).allNumbers(B)).rejects.toThrow('work не читается');
    });

    it('a business without any of the folders has no numbers', async () => {
        expect(await new TicketReader(createMemFs({}, [B]).fs).allNumbers(B)).toEqual([]);
    });
});

describe('createTicket', () => {
    it('makes the next folder in work/ with an INDEX.md, above the archived numbers too', async () => {
        const mem = createMemFs({}, [
            `${B}/work/DUE004_ShellKickStart`,
            `${B}/backlog/DUE016_BusinessIndex`,
            `${B}/archive/202610/DUE017_IntentSwitcher`
        ]);
        const place = await createTicket(mem.fs, new TicketReader(mem.fs), B, 'DUE', 'BinSync', NOW);
        expect(place).toEqual({ number: 'DUE018', shelf: 'work', folder: 'DUE018_BinSync', path: `${B}/work/DUE018_BinSync` });
        expect(mem.files.get(`${B}/work/DUE018_BinSync/INDEX.md`)).toBe(newTicketIndexText('DUE018', 'BinSync', '2026-10-05'));
    });

    it('a ticket without a name is the bare number', async () => {
        const mem = createMemFs({}, [`${B}/work/DUE004_ShellKickStart`]);
        const place = await createTicket(mem.fs, new TicketReader(mem.fs), B, 'DUE', '', NOW);
        expect(place.folder).toBe('DUE005');
        expect(mem.files.has(`${B}/work/DUE005/INDEX.md`)).toBe(true);
    });

    it('makes work/ for a business that has none yet', async () => {
        const mem = createMemFs({}, [B]);
        expect((await createTicket(mem.fs, new TicketReader(mem.fs), B, 'DUE', 'First', NOW)).folder).toBe('DUE001_First');
    });

    const failing = (code: string, at: (target: string) => boolean, base = createMemFs({}, [`${B}/work/DUE004_ShellKickStart`])) => {
        const fail = (): never => {
            const error: NodeJS.ErrnoException = new Error(`${code}: failed`);
            error.code = code;
            throw error;
        };
        return {
            mem: base,
            fs: {
                ...base.fs,
                mkdir: async (target: string, options?: { recursive?: boolean }) => at(target) ? fail() : base.fs.mkdir(target, options),
                writeFile: async (target: string, data: string, encoding: 'utf8') =>
                    at(target) ? fail() : base.fs.writeFile(target, data, encoding)
            }
        };
    };

    it('a folder of the very same name that appeared meanwhile is not written into', async () => {
        const { mem, fs } = failing('EEXIST', target => target.endsWith('/DUE005_BinSync'));
        await expect(createTicket(fs, new TicketReader(fs), B, 'DUE', 'BinSync', NOW)).rejects.toThrow('появилась только что');
        expect([...mem.files.keys()]).toEqual([]);
    });

    it('another failure to make the folder is passed on as it is', async () => {
        const { fs } = failing('EACCES', target => target.endsWith('/DUE005_BinSync'));
        await expect(createTicket(fs, new TicketReader(fs), B, 'DUE', 'BinSync', NOW)).rejects.toThrow('EACCES');
    });

    it('says that the folder stays when INDEX.md could not be written', async () => {
        const { mem, fs } = failing('EIO', target => target.endsWith('/INDEX.md'));
        await expect(createTicket(fs, new TicketReader(fs), B, 'DUE', 'BinSync', NOW))
            .rejects.toThrow('папка work/DUE005_BinSync создана, но INDEX.md в ней не записан');
        expect(mem.dirs.has(`${B}/work/DUE005_BinSync`)).toBe(true);
    });

    it('makes nothing when the folders of the business cannot be read', async () => {
        const mem = createMemFs({}, [`${B}/work/DUE004_ShellKickStart`]);
        const fs = {
            ...mem.fs,
            readdir: async () => {
                const error: NodeJS.ErrnoException = new Error('EIO: i/o error');
                error.code = 'EIO';
                throw error;
            }
        };
        await expect(createTicket(fs, new TicketReader(fs), B, 'DUE', 'BinSync', NOW)).rejects.toThrow('не читается');
        expect([...mem.dirs].filter(dir => dir.includes('BinSync'))).toEqual([]);
    });

    it('refuses when the code has no number left', async () => {
        const mem = createMemFs({}, [`${B}/work/DUE999_Last`]);
        await expect(createTicket(mem.fs, new TicketReader(mem.fs), B, 'DUE', 'More', NOW)).rejects.toThrow('не осталось номеров');
    });
});
