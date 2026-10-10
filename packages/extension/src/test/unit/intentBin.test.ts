import { describe, it, expect } from 'vitest';
import {
    INDEX_HEAD_BYTES,
    TicketInfo,
    TicketReader,
    parseTicketFrontmatter,
    readBusinessManifest,
    resolveTicketNow
} from '../../core/intents/tickets';
import { binOrderPath, pruneArchived, readBinOrder, writeBinOrder } from '../../core/intents/binOrder';
import {
    BinNode,
    binTickets,
    buildBinTree,
    decideBinDrop,
    findBinNode,
    parentOfBinNode
} from '../../core/intents/binTree';
import { createMockFs } from '../../core/fs';
import { createMemFs } from './helpers/memFs';

const B = '/drive/DuetLab';

function index(workType: string | null, parent: string | null): string {
    return [
        '---',
        'folder-type: work',
        ...(workType ? [`work-type: ${workType}`] : []),
        `parent: ${parent ?? 'null'}`,
        '---',
        '',
        '# Ticket'
    ].join('\n');
}

describe('parseTicketFrontmatter', () => {
    it('reads parent and work-type', () => {
        expect(parseTicketFrontmatter(index('project', 'DUEX02'))).toEqual({ parent: 'DUEX02', workType: 'project', processType: null, icon: '' });
    });

    it('an empty value and null both mean no parent', () => {
        expect(parseTicketFrontmatter('---\nparent:\nwork-type: program\n---\n').parent).toBeNull();
        expect(parseTicketFrontmatter('---\nparent: null\n---\n').parent).toBeNull();
        expect(parseTicketFrontmatter('---\nparent: ~\n---\n').parent).toBeNull();
    });

    it('reduces a parent written as a folder name or an alpha path to its number', () => {
        expect(parseTicketFrontmatter('---\nparent: DUEX02_WorkDoctrine\n---\n').parent).toBe('DUEX02');
        expect(parseTicketFrontmatter('---\nparent: "@DUEX02"\n---\n').parent).toBe('DUEX02');
        expect(parseTicketFrontmatter('---\nparent: DUEX02  # the doctrine\n---\n').parent).toBe('DUEX02');
    });

    it('keeps a parent it cannot read as a number — it will simply not be found', () => {
        expect(parseTicketFrontmatter('---\nparent: something else\n---\n').parent).toBe('something else');
    });

    it('reads the emoji of the ticket from icon', () => {
        expect(parseTicketFrontmatter('---\nicon: 🧰\nwork-type: program\n---\n').icon).toBe('🧰');
        expect(parseTicketFrontmatter('---\nicon: "🐚"\n---\n').icon).toBe('🐚');
        expect(parseTicketFrontmatter('---\nicon: 📜  # the doctrine\n---\n').icon).toBe('📜');
    });

    it('an empty icon and null both mean no icon; an emoji that starts with # is not a comment', () => {
        expect(parseTicketFrontmatter('---\nicon:\n---\n').icon).toBe('');
        expect(parseTicketFrontmatter('---\nicon: null\n---\n').icon).toBe('');
        expect(parseTicketFrontmatter('---\nicon: #️⃣\n---\n').icon).toBe('#️⃣');
    });

    it('lower-cases the work type', () => {
        expect(parseTicketFrontmatter('---\nwork-type: Program\n---\n').workType).toBe('program');
    });

    it('a file without frontmatter gives nothing', () => {
        expect(parseTicketFrontmatter('# Title\nparent: DUEX02\n')).toEqual({ parent: null, workType: null, processType: null, icon: '' });
        expect(parseTicketFrontmatter('')).toEqual({ parent: null, workType: null, processType: null, icon: '' });
    });

    it('does not read past the closing line', () => {
        expect(parseTicketFrontmatter('---\nwork-type: project\n---\nparent: DUEX02\n').parent).toBeNull();
    });

    it('reads Windows line breaks', () => {
        expect(parseTicketFrontmatter('---\r\nparent: DUEX02\r\nwork-type: project\r\n---\r\n'))
            .toEqual({ parent: 'DUEX02', workType: 'project', processType: null, icon: '' });
    });
});

describe('TicketReader', () => {
    const files = {
        [`${B}/work/DUE017_IntentSwitcher/INDEX.md`]: index('project', 'DUEX03'),
        [`${B}/work/DUEX03_WorkSupport/INDEX.md`]: index('program', null),
        [`${B}/work/DUE099_NoIndex/notes.md`]: 'x',
        [`${B}/work/notes/readme.md`]: 'not a ticket',
        [`${B}/work/README.md`]: 'a file, not a folder',
        [`${B}/backlog/DUE001_DuetWork_Full/INDEX.md`]: index('project', 'DUEX02'),
        [`${B}/archive/2026/09/DUE009_AlphaPaths/INDEX.md`]: index('project', null)
    };

    it('lists ticket folders right inside work/ and backlog/, and nothing else', async () => {
        const mem = createMemFs(files);
        const tickets = await new TicketReader(mem.fs).readShelves(B);

        expect(tickets.map(t => `${t.shelf}/${t.folder}`).sort()).toEqual([
            'backlog/DUE001_DuetWork_Full',
            'work/DUE017_IntentSwitcher',
            'work/DUE099_NoIndex',
            'work/DUEX03_WorkSupport'
        ]);
        expect(tickets.find(t => t.number === 'DUE017')).toEqual({
            number: 'DUE017',
            folder: 'DUE017_IntentSwitcher',
            name: 'Intent Switcher',
            path: `${B}/work/DUE017_IntentSwitcher`,
            shelf: 'work',
            workType: 'project', processType: null,
            parent: 'DUEX03',
            icon: ''
        });
        expect(tickets.find(t => t.number === 'DUE001')?.name).toBe('Duet Work Full');
    });

    it('a ticket without a readable INDEX.md has no parent, no type and no icon', async () => {
        const mem = createMemFs(files);
        const tickets = await new TicketReader(mem.fs).readShelves(B);
        expect(tickets.find(t => t.number === 'DUE099')).toMatchObject({ workType: null, processType: null, parent: null, icon: '' });
    });

    it('reads the icon of every ticket, and of one ticket by its folder', async () => {
        const mem = createMemFs({
            ...files,
            [`${B}/work/DUEX03_WorkSupport/INDEX.md`]: '---\nwork-type: program\nicon: 🧰\nparent: null\n---\n'
        });
        const reader = new TicketReader(mem.fs);
        expect((await reader.readShelves(B)).find(t => t.number === 'DUEX03')?.icon).toBe('🧰');
        expect(await reader.ticketIcon(`${B}/work/DUEX03_WorkSupport`)).toBe('🧰');
        expect(await reader.ticketIcon(`${B}/work/DUE099_NoIndex`)).toBe('');
    });

    it('a business without work/ or backlog/ has no tickets', async () => {
        const mem = createMemFs({ [`${B}/context.json`]: '{}' });
        expect(await new TicketReader(mem.fs).readShelves(B)).toEqual([]);
    });

    it('reads only the head of INDEX.md', async () => {
        let asked = 0;
        const mem = createMemFs(files);
        const readHead = mem.fs.readHead;
        mem.fs.readHead = async (p, bytes) => { asked = bytes; return readHead(p, bytes); };
        await new TicketReader(mem.fs).readShelves(B);
        expect(asked).toBe(INDEX_HEAD_BYTES);
    });

    it('remembers the frontmatter by modification time and size: a second read opens no file', async () => {
        const mem = createMemFs(files);
        const reader = new TicketReader(mem.fs);
        await reader.readShelves(B);
        const firstReads = mem.calls.readHead;
        expect(firstReads).toBe(3);

        await reader.readShelves(B);
        expect(mem.calls.readHead).toBe(firstReads);

        mem.touch(`${B}/work/DUE017_IntentSwitcher/INDEX.md`);
        await reader.readShelves(B);
        expect(mem.calls.readHead).toBe(firstReads + 1);
    });

    it('a file that hangs is given up after the timeout and its ticket goes on without a parent', async () => {
        const mem = createMemFs(files);
        const readHead = mem.fs.readHead;
        mem.fs.readHead = (p, bytes) => p.includes('DUE017')
            ? new Promise<string>(() => { /* never answers */ })
            : readHead(p, bytes);

        const tickets = await new TicketReader(mem.fs, 20).readShelves(B);
        expect(tickets.find(t => t.number === 'DUE017')).toMatchObject({ workType: null, processType: null, parent: null });
        expect(tickets.find(t => t.number === 'DUEX03')?.workType).toBe('program');
    });

    describe('inheritedIcon — the icon a ticket shows in «Активная Работа»', () => {
        const tree = (overrides: Record<string, string> = {}) => createMemFs({
            [`${B}/work/DUEX03_WorkSupport/INDEX.md`]: '---\nwork-type: program\nicon: 🧰\nparent: null\n---\n',
            [`${B}/work/DUE017_IntentSwitcher/INDEX.md`]: '---\nwork-type: project\nparent: DUEX03\n---\n',
            [`${B}/work/DUE020_SubProject/INDEX.md`]: '---\nwork-type: project\nparent: DUE017\n---\n',
            ...overrides
        });
        const icon = (mem: ReturnType<typeof createMemFs>, folder: string, shelf = 'work') =>
            new TicketReader(mem.fs).inheritedIcon(B, `${B}/${shelf}/${folder}`);

        it("1. the ticket's own icon wins", async () => {
            const mem = tree({ [`${B}/work/DUE017_IntentSwitcher/INDEX.md`]: '---\nicon: 🔀\nparent: DUEX03\n---\n' });
            expect(await icon(mem, 'DUE017_IntentSwitcher')).toBe('🔀');
        });

        it('2. without its own, the icon of the parent ticket', async () => {
            expect(await icon(tree(), 'DUE017_IntentSwitcher')).toBe('🧰');
        });

        it('the nearest ticket up the chain that has one — a parent without an icon passes the search on', async () => {
            expect(await icon(tree(), 'DUE020_SubProject')).toBe('🧰');
            const mem = tree({ [`${B}/work/DUE017_IntentSwitcher/INDEX.md`]: '---\nicon: 🔀\nparent: DUEX03\n---\n' });
            expect(await icon(mem, 'DUE020_SubProject')).toBe('🔀');
        });

        it('finds the parent in the backlog and in the archive too', async () => {
            const backlog = createMemFs({
                [`${B}/backlog/DUEX03_WorkSupport/INDEX.md`]: '---\nicon: 🧰\n---\n',
                [`${B}/work/DUE017_IntentSwitcher/INDEX.md`]: '---\nparent: DUEX03\n---\n'
            });
            expect(await icon(backlog, 'DUE017_IntentSwitcher')).toBe('🧰');
            const archived = createMemFs({
                [`${B}/archive/2026/10/DUEX03_WorkSupport/INDEX.md`]: '---\nicon: 🧰\n---\n',
                [`${B}/work/DUE017_IntentSwitcher/INDEX.md`]: '---\nparent: DUEX03\n---\n'
            });
            expect(await icon(archived, 'DUE017_IntentSwitcher')).toBe('🧰');
        });

        it('3. empty when no ticket of the chain has an icon — the business is then the last resort', async () => {
            const mem = tree({ [`${B}/work/DUEX03_WorkSupport/INDEX.md`]: '---\nwork-type: program\nparent: null\n---\n' });
            expect(await icon(mem, 'DUE017_IntentSwitcher')).toBe('');
        });

        it('a parent that cannot be found, a ticket without INDEX.md and a loop all end the search with nothing', async () => {
            const mem = createMemFs({
                [`${B}/work/DUE030_Orphan/INDEX.md`]: '---\nparent: DUEX99\n---\n',
                [`${B}/work/DUE031_NoIndex/notes.md`]: 'x',
                [`${B}/work/DUE032_LoopA/INDEX.md`]: '---\nparent: DUE033\n---\n',
                [`${B}/work/DUE033_LoopB/INDEX.md`]: '---\nparent: DUE032\n---\n'
            });
            expect(await icon(mem, 'DUE030_Orphan')).toBe('');
            expect(await icon(mem, 'DUE031_NoIndex')).toBe('');
            expect(await icon(mem, 'DUE032_LoopA')).toBe('');
        });
    });

    it('locates a ticket by number on both shelves', async () => {
        const mem = createMemFs({
            ...files,
            [`${B}/backlog/DUE017_IntentSwitcher/INDEX.md`]: index('project', null)
        });
        const reader = new TicketReader(mem.fs);
        expect((await reader.locate(B, 'DUE017')).map(p => p.shelf)).toEqual(['work', 'backlog']);
        expect(await reader.locate(B, 'DUE009')).toEqual([]);
    });

    it('finds a ticket in the archive at any grouping depth', async () => {
        const mem = createMemFs(files);
        const reader = new TicketReader(mem.fs);
        expect(await reader.findInArchive(B, 'DUE009')).toBe(`${B}/archive/2026/09/DUE009_AlphaPaths`);
        expect(await reader.findInArchive(B, 'DUE017')).toBeNull();
    });
});

describe('readBusinessManifest', () => {
    const readFile = (text: string) => createMockFs({ readFile: async () => text });

    it('reads the name and the emoji from context.json on disk', async () => {
        expect(await readBusinessManifest(B, readFile('{"version": 4, "name": "DuetLab", "icon": "🚀"}')))
            .toEqual({ name: 'DuetLab', icon: '🚀', ticketCode: null });
    });

    it('no icon in the manifest means no emoji — no default is made up', async () => {
        expect(await readBusinessManifest(B, readFile('{"version": 4, "name": "DuetLab"}')))
            .toEqual({ name: 'DuetLab', icon: '', ticketCode: null });
    });

    it("a context.json without a version is another tool's file, not a business", async () => {
        expect((await readBusinessManifest(B, readFile('{"name": "something"}'))).name).toBeNull();
    });

    it('reads the ticket code — three capital letters and nothing else', async () => {
        const code = async (value: string) =>
            (await readBusinessManifest(B, readFile(`{"version": 4, "name": "DuetLab", "ticket_code": ${value}}`))).ticketCode;
        expect(await code('"DUE"')).toBe('DUE');
        expect(await code('"due"')).toBeNull();
        expect(await code('"DUET"')).toBeNull();
        expect(await code('7')).toBeNull();
    });

    it('a missing or broken manifest gives nothing', async () => {
        expect(await readBusinessManifest(B, readFile('{ broken'))).toEqual({ name: null, icon: '', ticketCode: null });
        const missing = createMockFs({ readFile: async () => { throw new Error('ENOENT'); } });
        expect(await readBusinessManifest(B, missing)).toEqual({ name: null, icon: '', ticketCode: null });
    });
});

// ---------------------------------------------------------------------------

function ticket(folder: string, shelf: 'work' | 'backlog', workType: string | null, parent: string | null): TicketInfo {
    const number = folder.split('_')[0];
    return {
        number,
        folder,
        name: folder.slice(number.length + 1),
        path: `${B}/${shelf}/${folder}`,
        shelf,
        workType,
        processType: null,
        parent,
        icon: ''
    };
}

/** The tickets of the example in the task, as they stood when it was written. */
const EXAMPLE: TicketInfo[] = [
    ticket('DUE004_ShellKickStart', 'work', 'project', 'DUEX01'),
    ticket('DUE006_PromptAnalysis', 'work', 'research', 'DUEX02'),
    ticket('DUE007_UIResearch', 'work', 'project', 'DUEX01'),
    ticket('DUE008_CoreProtocols', 'work', 'project', 'DUEX02'),
    ticket('DUE011_DuetWork2', 'work', 'project', 'DUEX02'),
    ticket('DUE013_DuetOrientation', 'work', 'project', 'DUEX02'),
    ticket('DUE017_IntentSwitcher', 'work', 'project', null),
    ticket('DUEA01_DuetLabCuration', 'work', 'process', null),
    ticket('DUEX01_ShellPrototype', 'work', 'program', null),
    ticket('DUEX02_WorkDoctrine', 'work', 'program', null),
    ticket('DUE001_DuetWork_Full', 'backlog', 'project', 'DUEX02'),
    ticket('DUE003_DuetWork_Analysis', 'backlog', 'project', 'DUEX02')
];

/** Render the tree the way the task draws it. */
function draw(nodes: BinNode[], depth = 0): string[] {
    return nodes.flatMap(node => {
        const label = node.kind === 'ticket' ? node.ticket.number : node.kind === 'backlog' ? 'Backlog' : 'Unsorted';
        return [`${'  '.repeat(depth)}${label}`, ...draw(node.children, depth + 1)];
    });
}

describe('buildBinTree', () => {
    it('lays out the example of the task', () => {
        expect(draw(buildBinTree(EXAMPLE, []))).toEqual([
            'DUEA01',
            'DUEX01',
            '  DUE004',
            '  DUE007',
            'DUEX02',
            '  DUE006',
            '  DUE008',
            '  DUE011',
            '  DUE013',
            '  Backlog',
            '    DUE001',
            '    DUE003',
            'Unsorted',
            '  DUE017'
        ]);
    });

    it('root order: processes, programs, Unsorted, root Backlog', () => {
        const tree = buildBinTree([
            ticket('DUEX09_Late', 'backlog', 'program', null),
            ticket('DUE050_Loose', 'backlog', 'project', null),
            ticket('DUEX01_Program', 'work', 'program', null),
            ticket('DUEA02_SecondProcess', 'work', 'process', null),
            ticket('DUEA01_FirstProcess', 'work', 'process', null)
        ], []);
        expect(draw(tree)).toEqual([
            'DUEA01',
            'DUEA02',
            'DUEX01',
            'Unsorted',
            '  Backlog',
            '    DUE050',
            'Backlog',
            '  DUEX09'
        ]);
    });

    it('a container from work stands in the root even when empty', () => {
        expect(draw(buildBinTree([ticket('DUEX01_Empty', 'work', 'program', null)], []))).toEqual(['DUEX01']);
    });

    it('a program in the backlog does not hide while one of its tickets is in work', () => {
        const tree = buildBinTree([
            ticket('DUEX05_Parked', 'backlog', 'program', null),
            ticket('DUE051_Active', 'work', 'project', 'DUEX05'),
            ticket('DUE052_Waiting', 'backlog', 'project', 'DUEX05')
        ], []);
        expect(draw(tree)).toEqual(['DUEX05', '  DUE051', '  Backlog', '    DUE052']);
    });

    it('a program in the backlog with all its tickets there goes under the root Backlog, same shape', () => {
        const tree = buildBinTree([
            ticket('DUEX05_Parked', 'backlog', 'program', null),
            ticket('DUE052_Waiting', 'backlog', 'project', 'DUEX05')
        ], []);
        expect(draw(tree)).toEqual(['Backlog', '  DUEX05', '    Backlog', '      DUE052']);
    });

    it('the container is the nearest process or program up the parent chain', () => {
        const tree = buildBinTree([
            ticket('DUEX01_Program', 'work', 'program', null),
            ticket('DUE010_Project', 'work', 'project', 'DUEX01'),
            ticket('DUE011_SubProject', 'work', 'project', 'DUE010'),
            ticket('DUE012_Deeper', 'backlog', 'project', 'DUE011')
        ], []);
        expect(draw(tree)).toEqual(['DUEX01', '  DUE010', '  DUE011', '  Backlog', '    DUE012']);
    });

    it("a container's own parent is ignored: containers always stand flat", () => {
        const tree = buildBinTree([
            ticket('DUEX01_Outer', 'work', 'program', null),
            ticket('DUEX02_Inner', 'work', 'program', 'DUEX01'),
            ticket('DUE010_Task', 'work', 'project', 'DUEX02')
        ], []);
        expect(draw(tree)).toEqual(['DUEX01', 'DUEX02', '  DUE010']);
    });

    it('a parent that is not in work or backlog, a chain without a container and a loop all mean Unsorted', () => {
        const tree = buildBinTree([
            ticket('DUE020_ParentArchived', 'work', 'project', 'DUEX77'),
            ticket('DUE021_NoContainer', 'work', 'project', 'DUE022'),
            ticket('DUE022_Plain', 'work', 'project', null),
            ticket('DUE023_LoopA', 'work', 'project', 'DUE024'),
            ticket('DUE024_LoopB', 'work', 'project', 'DUE023'),
            ticket('DUE025_Unreadable', 'work', null, null)
        ], []);
        expect(draw(tree)).toEqual([
            'Unsorted', '  DUE020', '  DUE021', '  DUE022', '  DUE023', '  DUE024', '  DUE025'
        ]);
    });

    it('empty Backlog and empty Unsorted are not shown', () => {
        const tree = buildBinTree([
            ticket('DUEX01_Program', 'work', 'program', null),
            ticket('DUE010_Task', 'work', 'project', 'DUEX01')
        ], []);
        expect(draw(tree)).toEqual(['DUEX01', '  DUE010']);
        expect(buildBinTree([], [])).toEqual([]);
    });

    it('tickets inside a group follow the remembered order, the rest after by number', () => {
        const tree = buildBinTree(EXAMPLE, ['DUE013', 'DUE003', 'DUE008']);
        expect(draw(tree).slice(4, 12)).toEqual([
            'DUEX02', '  DUE013', '  DUE008', '  DUE006', '  DUE011', '  Backlog', '    DUE003', '    DUE001'
        ]);
    });

    it('containers follow the remembered order among themselves, processes and programs mixed', () => {
        const tree = buildBinTree(EXAMPLE, ['DUEX02', 'DUEX01', 'DUEA01']);
        expect(draw(tree).filter(l => !l.startsWith(' '))).toEqual(['DUEX02', 'DUEX01', 'DUEA01', 'Unsorted']);
    });

    it('a container the order does not hold stands after the listed ones: processes, then programs, by number', () => {
        const tree = buildBinTree(
            [...EXAMPLE, ticket('DUEA02_SecondProcess', 'work', 'process', null), ticket('DUEX05_Late', 'work', 'program', null)],
            ['DUEX02', 'DUE008']
        );
        expect(draw(tree).filter(l => !l.startsWith(' ')))
            .toEqual(['DUEX02', 'DUEA01', 'DUEA02', 'DUEX01', 'DUEX05', 'Unsorted']);
    });

    it('two folders with one number are two rows with different keys', () => {
        const tree = buildBinTree([
            ticket('DUE010_Task', 'work', 'project', null),
            { ...ticket('DUE010_Task', 'backlog', 'project', null) }
        ], []);
        const keys = binTickets(tree).map(n => n.key);
        expect(keys).toHaveLength(2);
        expect(new Set(keys).size).toBe(2);
    });

    it('every row appears once', () => {
        const tree = buildBinTree(EXAMPLE, []);
        expect(binTickets(tree).map(n => n.ticket.number).sort()).toEqual(EXAMPLE.map(t => t.number).sort());
    });

    it('finds a node and its parent by key', () => {
        const tree = buildBinTree(EXAMPLE, []);
        const key = `ticket:${B}/backlog/DUE001_DuetWork_Full`;
        expect(findBinNode(tree, key)?.kind).toBe('ticket');
        expect(parentOfBinNode(tree, key)?.kind).toBe('backlog');
        expect(parentOfBinNode(tree, `ticket:${B}/work/DUEA01_DuetLabCuration`)).toBeNull();
        expect(findBinNode(tree, 'nope')).toBeNull();
    });
});

describe('decideBinDrop', () => {
    const tree = buildBinTree(EXAMPLE, []);
    const key = (folder: string, shelf = 'work') => `ticket:${B}/${shelf}/${folder}`;
    const X02 = `${B}/work/DUEX02_WorkDoctrine`;
    const closed = () => false;

    it('a ticket dragged up lands before the target', () => {
        const drop = decideBinDrop(tree, key('DUE013_DuetOrientation'), key('DUE008_CoreProtocols'), closed);
        expect(drop).toMatchObject({
            ok: true, shelf: 'work', move: false, shelfOrder: ['DUE006', 'DUE013', 'DUE008', 'DUE011']
        });
    });

    it('a ticket dragged down lands after the target', () => {
        const drop = decideBinDrop(tree, key('DUE006_PromptAnalysis'), key('DUE011_DuetWork2'), closed);
        expect(drop).toMatchObject({
            ok: true, shelf: 'work', move: false, shelfOrder: ['DUE008', 'DUE011', 'DUE006', 'DUE013']
        });
    });

    it('a drop on the header puts the ticket first in work', () => {
        const fromWork = decideBinDrop(tree, key('DUE011_DuetWork2'), key('DUEX02_WorkDoctrine'), closed);
        expect(fromWork).toMatchObject({ ok: true, move: false, shelfOrder: ['DUE011', 'DUE006', 'DUE008', 'DUE013'] });

        const fromBacklog = decideBinDrop(tree, key('DUE003_DuetWork_Analysis', 'backlog'), key('DUEX02_WorkDoctrine'), closed);
        expect(fromBacklog).toMatchObject({
            ok: true, shelf: 'work', move: true, shelfOrder: ['DUE003', 'DUE006', 'DUE008', 'DUE011', 'DUE013']
        });
    });

    it('a drop on Backlog from work puts the ticket first in the backlog', () => {
        const drop = decideBinDrop(tree, key('DUE011_DuetWork2'), `backlog:${X02}`, closed);
        expect(drop).toMatchObject({ ok: true, shelf: 'backlog', move: true, shelfOrder: ['DUE011', 'DUE001', 'DUE003'] });
    });

    it('a drop on Backlog from the backlog puts the ticket last in work', () => {
        const drop = decideBinDrop(tree, key('DUE001_DuetWork_Full', 'backlog'), `backlog:${X02}`, closed);
        expect(drop).toMatchObject({
            ok: true, shelf: 'work', move: true, shelfOrder: ['DUE006', 'DUE008', 'DUE011', 'DUE013', 'DUE001']
        });
    });

    it('a ticket from work dropped on a backlog ticket goes down: after it, and its folder moves', () => {
        const drop = decideBinDrop(tree, key('DUE008_CoreProtocols'), key('DUE001_DuetWork_Full', 'backlog'), closed);
        expect(drop).toMatchObject({ ok: true, shelf: 'backlog', move: true, shelfOrder: ['DUE001', 'DUE008', 'DUE003'] });
    });

    it('a ticket from the backlog dropped on a work ticket goes up: before it', () => {
        const drop = decideBinDrop(tree, key('DUE003_DuetWork_Analysis', 'backlog'), key('DUE011_DuetWork2'), closed);
        expect(drop).toMatchObject({
            ok: true, shelf: 'work', move: true, shelfOrder: ['DUE006', 'DUE008', 'DUE003', 'DUE011', 'DUE013']
        });
    });

    it('reorders inside the backlog without moving the folder', () => {
        const drop = decideBinDrop(tree, key('DUE003_DuetWork_Analysis', 'backlog'), key('DUE001_DuetWork_Full', 'backlog'), closed);
        expect(drop).toMatchObject({ ok: true, shelf: 'backlog', move: false, shelfOrder: ['DUE003', 'DUE001'] });
    });

    it('works the same in Unsorted, whose header is the Unsorted row', () => {
        const unsorted = buildBinTree([
            ticket('DUE030_A', 'work', 'project', null),
            ticket('DUE031_B', 'work', 'project', null),
            ticket('DUE032_C', 'backlog', 'project', null)
        ], []);
        expect(decideBinDrop(unsorted, key('DUE032_C', 'backlog'), 'unsorted', closed))
            .toMatchObject({ ok: true, shelf: 'work', move: true, shelfOrder: ['DUE032', 'DUE030', 'DUE031'] });
        expect(decideBinDrop(unsorted, key('DUE030_A'), 'backlog:unsorted', closed))
            .toMatchObject({ ok: true, shelf: 'backlog', move: true, shelfOrder: ['DUE030', 'DUE032'] });
    });

    it('a ticket with an open window is not dragged into the Backlog, but is reordered in work', () => {
        const open = (n: string) => n === 'DUE008';
        const toBacklog = decideBinDrop(tree, key('DUE008_CoreProtocols'), `backlog:${X02}`, open);
        expect(toBacklog.ok).toBe(false);
        expect(toBacklog).toMatchObject({ reason: expect.stringContaining('открыто окно') });

        expect(decideBinDrop(tree, key('DUE008_CoreProtocols'), key('DUE013_DuetOrientation'), open).ok).toBe(true);
    });

    describe('a dragged process or program', () => {
        const A01 = key('DUEA01_DuetLabCuration');
        const X01 = key('DUEX01_ShellPrototype');
        const X02 = key('DUEX02_WorkDoctrine');

        it('dragged down lands after the target, dragged up — before it; its folder never moves', () => {
            expect(decideBinDrop(tree, A01, X01, closed)).toMatchObject({
                ok: true, move: false, shelf: 'work', shelfOrder: ['DUEX01', 'DUEA01', 'DUEX02'],
                ticket: { number: 'DUEA01' }
            });
            expect(decideBinDrop(tree, X02, A01, closed))
                .toMatchObject({ ok: true, move: false, shelfOrder: ['DUEX02', 'DUEA01', 'DUEX01'] });
        });

        it('a program can stand before a process: the two kinds are one sequence', () => {
            const drop = decideBinDrop(tree, X01, A01, closed);
            expect(drop).toMatchObject({ ok: true, shelfOrder: ['DUEX01', 'DUEA01', 'DUEX02'] });
            const reordered = buildBinTree(EXAMPLE, (drop as { shelfOrder: string[] }).shelfOrder);
            expect(draw(reordered).filter(l => !l.startsWith(' '))).toEqual(['DUEX01', 'DUEA01', 'DUEX02', 'Unsorted']);
        });

        it('a drop on a row inside another container is a drop on that container', () => {
            expect(decideBinDrop(tree, A01, key('DUE008_CoreProtocols'), closed))
                .toMatchObject({ ok: true, shelfOrder: ['DUEX01', 'DUEX02', 'DUEA01'] });
            expect(decideBinDrop(tree, A01, `backlog:${B}/work/DUEX02_WorkDoctrine`, closed))
                .toMatchObject({ ok: true, shelfOrder: ['DUEX01', 'DUEX02', 'DUEA01'] });
            expect(decideBinDrop(tree, X02, key('DUE004_ShellKickStart'), closed))
                .toMatchObject({ ok: true, shelfOrder: ['DUEA01', 'DUEX02', 'DUEX01'] });
        });

        it('a drop on Unsorted or past the rows puts it last', () => {
            expect(decideBinDrop(tree, A01, 'unsorted', closed))
                .toMatchObject({ ok: true, shelfOrder: ['DUEX01', 'DUEX02', 'DUEA01'] });
            expect(decideBinDrop(tree, A01, key('DUE017_IntentSwitcher'), closed))
                .toMatchObject({ ok: true, shelfOrder: ['DUEX01', 'DUEX02', 'DUEA01'] });
            expect(decideBinDrop(tree, X01, null, closed))
                .toMatchObject({ ok: true, shelfOrder: ['DUEA01', 'DUEX02', 'DUEX01'] });
        });

        it('a drop on itself, on its own rows or to the place it holds says nothing', () => {
            expect(decideBinDrop(tree, X02, X02, closed)).toEqual({ ok: false, reason: null });
            expect(decideBinDrop(tree, X02, key('DUE008_CoreProtocols'), closed)).toEqual({ ok: false, reason: null });
            expect(decideBinDrop(tree, X02, null, closed)).toEqual({ ok: false, reason: null });
            expect(decideBinDrop(tree, X01, X02, closed)).toMatchObject({ ok: true });
            expect(decideBinDrop(tree, X02, X01, closed)).toMatchObject({ ok: true });
        });

        it('changes place only inside its level: the root and the root Backlog do not mix', () => {
            const shelved = buildBinTree([
                ticket('DUEX01_Program', 'work', 'program', null),
                ticket('DUEX02_Other', 'work', 'program', null),
                ticket('DUEX08_Parked', 'backlog', 'program', null),
                ticket('DUEX09_Late', 'backlog', 'program', null),
                ticket('DUE050_InParked', 'backlog', 'project', 'DUEX08'),
                ticket('DUE060_Loose', 'work', 'project', null)
            ], []);
            const work = (folder: string) => `ticket:${B}/work/${folder}`;
            const back = (folder: string) => `ticket:${B}/backlog/${folder}`;
            const refusal = { ok: false, reason: expect.stringContaining('только меняет место') };

            expect(decideBinDrop(shelved, work('DUEX01_Program'), `backlog:${'root'}`, closed)).toMatchObject(refusal);
            expect(decideBinDrop(shelved, work('DUEX01_Program'), back('DUEX09_Late'), closed)).toMatchObject(refusal);
            expect(decideBinDrop(shelved, work('DUEX01_Program'), back('DUE050_InParked'), closed)).toMatchObject(refusal);
            expect(decideBinDrop(shelved, back('DUEX09_Late'), work('DUEX01_Program'), closed)).toMatchObject(refusal);
            expect(decideBinDrop(shelved, back('DUEX09_Late'), 'unsorted', closed)).toMatchObject(refusal);

            expect(decideBinDrop(shelved, back('DUEX09_Late'), back('DUEX08_Parked'), closed))
                .toMatchObject({ ok: true, move: false, shelf: 'backlog', shelfOrder: ['DUEX09', 'DUEX08'] });
            expect(decideBinDrop(shelved, back('DUEX09_Late'), back('DUE050_InParked'), closed))
                .toMatchObject({ ok: true, shelfOrder: ['DUEX09', 'DUEX08'] });
            expect(decideBinDrop(shelved, back('DUEX09_Late'), 'backlog:root', closed))
                .toMatchObject({ ok: true, shelfOrder: ['DUEX09', 'DUEX08'] });
            expect(decideBinDrop(shelved, back('DUEX08_Parked'), 'backlog:root', closed)).toEqual({ ok: false, reason: null });
        });
    });

    it('group rows are not dragged', () => {
        expect(decideBinDrop(tree, `backlog:${X02}`, key('DUE008_CoreProtocols'), closed).ok).toBe(false);
        expect(decideBinDrop(tree, 'unsorted', key('DUE008_CoreProtocols'), closed).ok).toBe(false);
    });

    it('a ticket is not dragged into another program, another header or past the rows', () => {
        const other = decideBinDrop(tree, key('DUE008_CoreProtocols'), key('DUE004_ShellKickStart'), closed);
        expect(other).toMatchObject({ ok: false, reason: expect.stringContaining('внутри своей группы') });
        expect(decideBinDrop(tree, key('DUE008_CoreProtocols'), key('DUEX01_ShellPrototype'), closed).ok).toBe(false);
        expect(decideBinDrop(tree, key('DUE008_CoreProtocols'), 'unsorted', closed).ok).toBe(false);
        expect(decideBinDrop(tree, key('DUE008_CoreProtocols'), null, closed).ok).toBe(false);
    });

    it('a drop that changes nothing says nothing', () => {
        expect(decideBinDrop(tree, key('DUE008_CoreProtocols'), key('DUE008_CoreProtocols'), closed))
            .toEqual({ ok: false, reason: null });
        expect(decideBinDrop(tree, key('DUE006_PromptAnalysis'), key('DUEX02_WorkDoctrine'), closed))
            .toEqual({ ok: false, reason: null });
    });

    it('a row that is gone from the fresh tree is refused in one line', () => {
        expect(decideBinDrop(tree, key('DUE999_Gone'), key('DUE008_CoreProtocols'), closed))
            .toMatchObject({ ok: false, reason: expect.stringContaining('Корзина изменилась') });
    });
});

// ---------------------------------------------------------------------------

describe('resolveTicketNow', () => {
    const row = { number: 'DUE017', folder: 'DUE017_IntentSwitcher', shelf: 'work' as const };
    const at = (...folders: string[]) =>
        new TicketReader(createMemFs(Object.fromEntries(folders.map(f => [`${B}/${f}/INDEX.md`, '']))).fs);

    it('here: the row still stands where the view showed it', async () => {
        expect(await resolveTicketNow(at('work/DUE017_IntentSwitcher'), B, row))
            .toEqual({ state: 'here', place: { shelf: 'work', folder: row.folder, path: `${B}/work/${row.folder}` } });
    });

    it('moved: the number is found on the other shelf or under another name', async () => {
        expect(await resolveTicketNow(at('backlog/DUE017_IntentSwitcher'), B, row))
            .toMatchObject({ state: 'moved', place: { shelf: 'backlog' } });
        expect(await resolveTicketNow(at('work/DUE017_Switcher'), B, row))
            .toMatchObject({ state: 'moved', place: { folder: 'DUE017_Switcher' } });
    });

    it('here wins when a copy of the ticket also lies elsewhere', async () => {
        expect(await resolveTicketNow(at('work/DUE017_IntentSwitcher', 'backlog/DUE017_IntentSwitcher'), B, row))
            .toMatchObject({ state: 'here', place: { shelf: 'work' } });
    });

    it('ambiguous: several folders carry the number and none is the row', async () => {
        expect(await resolveTicketNow(at('work/DUE017_A', 'backlog/DUE017_B'), B, row)).toEqual({ state: 'ambiguous' });
    });

    it('gone: the number is on neither shelf', async () => {
        expect(await resolveTicketNow(at('work/DUE008_CoreProtocols'), B, row)).toEqual({ state: 'gone' });
    });
});

describe('bin order file', () => {
    it('lies in the business folder, in .vscode', () => {
        expect(binOrderPath(B)).toBe(`${B}/.vscode/duet-intents.json`);
    });

    it('is written in place by a single write, creating .vscode when needed', async () => {
        const mem = createMemFs({ [`${B}/context.json`]: '{}' });
        await writeBinOrder(B, ['DUE017', 'DUE008'], mem.fs);

        expect(mem.calls.writeFile).toBe(1);
        expect(mem.calls.atomicWriteFile).toBe(0);
        expect(await readBinOrder(B, mem.fs)).toEqual(['DUE017', 'DUE008']);
    });

    it('an absent file is an empty order', async () => {
        expect(await readBinOrder(B, createMemFs().fs)).toEqual([]);
    });

    it('an unreadable file gives null, so the last good order stays', async () => {
        const mem = createMemFs({ [binOrderPath(B)]: '{ broken' });
        expect(await readBinOrder(B, mem.fs)).toBeNull();

        const failing = createMockFs({ readFile: async () => { throw new Error('EIO'); } });
        expect(await readBinOrder(B, failing)).toBeNull();
    });

    it('a conflict copy next to the file is not read', async () => {
        const mem = createMemFs({
            [binOrderPath(B)]: '{"order": ["DUE017"]}',
            [`${B}/.vscode/duet-intents (1).json`]: '{"order": ["DUE999"]}'
        });
        expect(await readBinOrder(B, mem.fs)).toEqual(['DUE017']);
    });

    it('pruneArchived drops only the numbers found in the archive', async () => {
        const asked: string[] = [];
        const pruned = await pruneArchived(
            ['DUE017', 'DUE009', 'DUE777', 'DUE008'],
            new Set(['DUE017', 'DUE008']),
            async (n) => { asked.push(n); return n === 'DUE009'; }
        );
        expect(pruned).toEqual(['DUE017', 'DUE777', 'DUE008']);
        expect(asked).toEqual(['DUE009', 'DUE777']);
    });
});
