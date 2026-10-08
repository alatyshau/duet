import { describe, it, expect } from 'vitest';
import { INDEX_HEAD_BYTES, TicketReader, parseTicketFrontmatter, pickCurator } from '../../core/intents/tickets';
import { createMemFs } from './helpers/memFs';

const B = '/drive/Lab';
const header = (work = 'process', process = 'curator') => `---\nwork-type: ${work}\nprocess-type: ${process}\n---\n`;

describe('DUE019: curator selection', () => {
    it('requires both fields, normalises quoted values, and chooses the lowest number independently of shelf/order/name', async () => {
        const mem = createMemFs({
            [`${B}/work/DUEA02_Curator/INDEX.md`]: header(),
            [`${B}/backlog/DUEA01_Bare/INDEX.md`]: header('"Process" # note', "'CURATOR'"),
            [`${B}/work/DUE001_Curator/INDEX.md`]: header('project'),
            [`${B}/work/DUEA00_NotCurator/INDEX.md`]: header('process', 'other'),
            [`${B}/work/DUEX01_Curator/INDEX.md`]: '---\nwork-type: program\n---\n',
            [`${B}/archive/DUEA00_Old/INDEX.md`]: header(),
            [`${B}/child/work/OTH001_Curator/INDEX.md`]: header()
        });
        const reader = new TicketReader(mem.fs);
        expect(parseTicketFrontmatter(header('"Process" # note', "'CURATOR'")))
            .toMatchObject({ workType: 'process', processType: 'curator' });
        expect((await reader.findCurator(B))?.number).toBe('DUEA01');
        const all = await reader.readShelves(B);
        expect(pickCurator(all.reverse())?.number).toBe('DUEA01');
        expect(await reader.isCuratorAt(`${B}/work/DUE001_Curator`)).toBe(false);
    });

    it('missing shelves and missing INDEX are confirmed absence, not an error', async () => {
        const mem = createMemFs({}, [`${B}/work/DUEA01_NoIndex`]);
        expect(await new TicketReader(mem.fs).findCurator(B)).toBeNull();
        expect(await new TicketReader(mem.fs).findCurator('/absent')).toBeNull();
    });

    it('an unreadable shelf does not mean no curator', async () => {
        const mem = createMemFs();
        mem.fs.readdir = async () => { throw Object.assign(new Error('denied'), { code: 'EACCES' }); };
        await expect(new TicketReader(mem.fs).findCurator(B)).rejects.toThrow('не читается');
    });

    it('an unreadable INDEX or timeout prevents selecting a later curator', async () => {
        const first = `${B}/work/DUEA01_First/INDEX.md`;
        const mem = createMemFs({ [first]: header(), [`${B}/work/DUEA02_Second/INDEX.md`]: header() });
        const read = mem.fs.readHead;
        mem.fs.readHead = async (file, bytes) => {
            if (file === first) { throw new Error('denied'); }
            return read(file, bytes);
        };
        await expect(new TicketReader(mem.fs).findCurator(B)).rejects.toThrow(first);
        mem.fs.readHead = async () => new Promise<string>(() => undefined);
        await expect(new TicketReader(mem.fs, 5).findCurator(B)).rejects.toThrow('timeout');
    });

    it('a truncated/unfinished header stays unknown even after a soft bin read cached it', async () => {
        const mem = createMemFs({ [`${B}/work/DUEA01_First/INDEX.md`]: `---\n${'x'.repeat(INDEX_HEAD_BYTES)}\n---\n` });
        const reader = new TicketReader(mem.fs);
        await reader.readShelves(B);
        await expect(reader.findCurator(B)).rejects.toThrow('шапка');
    });

    it('shares header cache with the bin, and notices changed process-type', async () => {
        const file = `${B}/work/DUEA01_First/INDEX.md`;
        const mem = createMemFs({ [file]: header() });
        const reader = new TicketReader(mem.fs);
        await reader.readShelves(B);
        const reads = mem.calls.readHead;
        expect((await reader.findCurator(B))?.number).toBe('DUEA01');
        expect(mem.calls.readHead).toBe(reads);
        await mem.fs.writeFile(file, header('process', 'other'), 'utf8');
        expect(await reader.findCurator(B)).toBeNull();
        expect(await reader.isCuratorAt(`${B}/work/DUEA01_First`)).toBe(false);
    });
});
