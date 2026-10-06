import { describe, it, expect, beforeEach } from 'vitest';
import {
    ACTIVE_ORDER_LIMIT,
    MarkerEnv,
    MarkerStore,
    RESERVATION_MS,
    WindowMarker,
    markerFileName,
    occupiedColors,
    parseMarker,
    splitMarkers
} from '../../core/intents/markers';
import {
    LINGER_MS,
    LingerState,
    activeFromMarkers,
    activeRowText,
    applyLinger,
    rowByNumber,
    rowNumber,
    numberedRows,
    orderActive,
    reorderActive
} from '../../core/intents/active';
import { placeNextTo } from '../../core/intents/order';
import { createMemFs, MemFs } from './helpers/memFs';

const BOOT = 1_000_000;
const NOW = 2_000_000;

function marker(overrides: Partial<WindowMarker> = {}): WindowMarker {
    return {
        kind: 'window',
        subject: 'intent',
        ticket: 'DUE017',
        ticketFolder: 'DUE017_IntentSwitcher',
        business: 'DuetLab',
        businessPath: '/drive/DuetLab',
        icon: '🚀',
        ticketIcon: '',
        workspaceFile: '/data/workspaces/DuetLab/DUE017_IntentSwitcher.code-workspace',
        location: 'work',
        color: '#1f6f43',
        pid: 100,
        writtenAt: NOW - 1000,
        ...overrides
    };
}

const clock = (alive: number[]) => ({ now: NOW, bootTime: BOOT, isAlive: (pid: number) => alive.includes(pid) });

describe('marker files', () => {
    it('are named by ticket and process, so two windows on one ticket never share a file', () => {
        expect(markerFileName(marker())).toBe('DUE017-100.json');
        expect(markerFileName(marker({ pid: 200 }))).toBe('DUE017-200.json');
        expect(markerFileName(marker({ kind: 'reservation' }))).toBe('DUE017-100.reserve.json');
    });

    it('round-trip through JSON', () => {
        const original = marker({ kind: 'reservation', expiresAt: NOW + 5 });
        expect(parseMarker(JSON.stringify(original))).toEqual(original);
    });

    it('text that is not a marker parses to null', () => {
        expect(parseMarker('{ broken')).toBeNull();
        expect(parseMarker('[]')).toBeNull();
        expect(parseMarker(JSON.stringify({ kind: 'window', ticket: 'DUE017' }))).toBeNull();
        expect(parseMarker(JSON.stringify({ ...marker(), kind: 'other' }))).toBeNull();
    });

    it('a marker of the first version, without subject and ticket icon, reads as an intent without an icon', () => {
        const old: Record<string, unknown> = { ...marker() };
        delete old.subject;
        delete old.ticketIcon;
        expect(parseMarker(JSON.stringify(old))).toMatchObject({ subject: 'intent', ticketIcon: '' });
    });

    it('the marker of a business window is named by its key', () => {
        const business = marker({ subject: 'business', ticket: '@DuetLab', ticketFolder: '' });
        expect(markerFileName(business)).toBe('@DuetLab-100.json');
        expect(parseMarker(JSON.stringify(business))?.subject).toBe('business');
    });

    it('an unknown location reads as missing', () => {
        expect(parseMarker(JSON.stringify({ ...marker(), location: 'moon' }))?.location).toBe('missing');
    });
});

describe('splitMarkers', () => {
    it('a window marker lives while its process does', () => {
        const { live, dead } = splitMarkers([marker({ pid: 100 }), marker({ pid: 200, ticket: 'DUE008' })], clock([100]));
        expect(live.map(m => m.pid)).toEqual([100]);
        expect(dead.map(m => m.pid)).toEqual([200]);
    });

    it('a marker written before the last boot is dead even when the pid is alive again', () => {
        const { live, dead } = splitMarkers([marker({ writtenAt: BOOT - 1 })], clock([100]));
        expect(live).toHaveLength(0);
        expect(dead).toHaveLength(1);
    });

    it('a reservation counts until its time is out, whatever became of the process that wrote it', () => {
        const fresh = marker({ kind: 'reservation', pid: 999, expiresAt: NOW + 1 });
        const stale = marker({ kind: 'reservation', pid: 998, ticket: 'DUE008', expiresAt: NOW });
        const { live, dead } = splitMarkers([fresh, stale], clock([]));
        expect(live).toEqual([fresh]);
        expect(dead).toEqual([stale]);
    });

    it('a reservation dies when the real window of the ticket shows up', () => {
        const reservation = marker({ kind: 'reservation', pid: 999, expiresAt: NOW + 1000 });
        const { live, dead } = splitMarkers([reservation, marker({ pid: 100 })], clock([100]));
        expect(live.map(m => m.kind)).toEqual(['window']);
        expect(dead).toEqual([reservation]);
    });

    it('a dead window does not cancel a reservation', () => {
        const reservation = marker({ kind: 'reservation', pid: 999, expiresAt: NOW + 1000 });
        const { live } = splitMarkers([reservation, marker({ pid: 100 })], clock([]));
        expect(live).toEqual([reservation]);
    });
});

describe('occupiedColors', () => {
    it('lists one colour per open window, except those of the ticket being opened', () => {
        const live = [
            marker({ color: '#1F6F43' }),
            marker({ ticket: 'DUE008', pid: 200, color: '#1f4f8f' }),
            marker({ ticket: 'DUE013', pid: 300, color: null })
        ];
        expect(occupiedColors(live)).toEqual(['#1f6f43', '#1f4f8f']);
        expect(occupiedColors(live, 'DUE017')).toEqual(['#1f4f8f']);
    });
});

describe('MarkerStore', () => {
    const DIR = '/data/intents/vscode';
    let mem: MemFs;
    let alive: number[];
    let now: number;
    const env = (pid: number): MarkerEnv => ({
        pid,
        now: () => now,
        bootTime: () => BOOT,
        isAlive: (p) => alive.includes(p)
    });
    /** What a window passes to `write`: the store fills in the process and the time. */
    const base = (overrides: Partial<WindowMarker> = {}) => {
        const fields: Partial<WindowMarker> = marker(overrides);
        delete fields.pid;
        delete fields.writtenAt;
        delete fields.expiresAt;
        return fields as Omit<WindowMarker, 'pid' | 'writtenAt' | 'expiresAt'>;
    };

    beforeEach(() => {
        mem = createMemFs();
        alive = [100, 200];
        now = NOW;
    });

    it('writes the marker of its own process into windows/, creating the folder', async () => {
        const store = new MarkerStore(DIR, mem.fs, env(100));
        const written = await store.write(base());

        expect(written.pid).toBe(100);
        expect(written.writtenAt).toBe(NOW);
        expect([...mem.files.keys()]).toEqual([`${DIR}/windows/DUE017-100.json`]);
        expect(mem.calls.atomicWriteFile).toBe(1);
    });

    it('reads the live markers of every window of the program', async () => {
        await new MarkerStore(DIR, mem.fs, env(100)).write(base());
        await new MarkerStore(DIR, mem.fs, env(200)).write(base({ ticket: 'DUE008', ticketFolder: 'DUE008_CoreProtocols' }));

        const live = await new MarkerStore(DIR, mem.fs, env(300)).read();
        expect(live.map(m => m.ticket).sort()).toEqual(['DUE008', 'DUE017']);
    });

    it('removes dead markers on read — any reader may', async () => {
        await new MarkerStore(DIR, mem.fs, env(100)).write(base());
        await new MarkerStore(DIR, mem.fs, env(200)).write(base({ ticket: 'DUE008' }));
        alive = [100];

        const live = await new MarkerStore(DIR, mem.fs, env(300)).read();
        expect(live.map(m => m.ticket)).toEqual(['DUE017']);
        expect([...mem.files.keys()]).toEqual([`${DIR}/windows/DUE017-100.json`]);
    });

    it('a window removes only its own marker', async () => {
        const first = new MarkerStore(DIR, mem.fs, env(100));
        const second = new MarkerStore(DIR, mem.fs, env(200));
        const own = await first.write(base());
        await second.write(base());

        await first.remove(own);
        expect([...mem.files.keys()]).toEqual([`${DIR}/windows/DUE017-200.json`]);
        expect(await first.exists(own)).toBe(false);
    });

    it('a reservation is written with a 30 second life and replaced by the real window', async () => {
        const opener = new MarkerStore(DIR, mem.fs, env(100));
        const reservation = await opener.write(base({ kind: 'reservation', ticket: 'DUE008' }));
        expect(reservation.expiresAt).toBe(NOW + RESERVATION_MS);
        expect((await opener.read()).map(m => m.kind)).toEqual(['reservation']);

        await new MarkerStore(DIR, mem.fs, env(200)).write(base({ ticket: 'DUE008' }));
        expect((await opener.read()).map(m => m.kind)).toEqual(['window']);
        expect([...mem.files.keys()]).toEqual([`${DIR}/windows/DUE008-200.json`]);
    });

    it('a reservation whose window never came is dropped after its time', async () => {
        const opener = new MarkerStore(DIR, mem.fs, env(100));
        await opener.write(base({ kind: 'reservation' }));
        now = NOW + RESERVATION_MS;
        expect(await opener.read()).toEqual([]);
        expect(mem.files.size).toBe(0);
    });

    it('ignores a copy under another name and files that are not markers', async () => {
        const store = new MarkerStore(DIR, mem.fs, env(100));
        const own = await store.write(base());
        mem.files.set(`${DIR}/windows/DUE017-100 (1).json`, JSON.stringify(own));
        mem.files.set(`${DIR}/windows/garbage.json`, '{ broken');
        mem.files.set(`${DIR}/windows/notes.txt`, 'x');

        expect(await store.read()).toHaveLength(1);
        expect(mem.files.has(`${DIR}/windows/garbage.json`)).toBe(true);
    });

    it('an absent folder reads as no markers', async () => {
        expect(await new MarkerStore(DIR, mem.fs, env(100)).read()).toEqual([]);
    });

    it('keeps the order of active intents next to the markers, cut to a limit', async () => {
        const store = new MarkerStore(DIR, mem.fs, env(100));
        expect(await store.readOrder()).toEqual([]);

        await store.writeOrder(['DUE017', 'DUE008']);
        expect(mem.files.has(`${DIR}/active.json`)).toBe(true);
        expect(await store.readOrder()).toEqual(['DUE017', 'DUE008']);

        const long = Array.from({ length: ACTIVE_ORDER_LIMIT + 50 }, (_, i) => `T${i}`);
        await store.writeOrder(long);
        expect(await store.readOrder()).toHaveLength(ACTIVE_ORDER_LIMIT);
    });

    it('an unreadable order file reads as no order', async () => {
        const store = new MarkerStore(DIR, mem.fs, env(100));
        await store.writeOrder(['DUE017']);
        mem.files.set(`${DIR}/active.json`, '{ broken');
        expect(await store.readOrder()).toEqual([]);
    });
});

describe('activeFromMarkers', () => {
    it('gives one row per ticket, with the readable name and the emoji of the business', () => {
        const rows = activeFromMarkers([marker(), marker({ pid: 200 })], 999);
        expect(rows).toEqual([{
            subject: 'intent',
            ticket: 'DUE017',
            folder: 'DUE017_IntentSwitcher',
            name: 'Intent Switcher',
            icon: '🚀',
            business: 'DuetLab',
            workspaceFile: '/data/workspaces/DuetLab/DUE017_IntentSwitcher.code-workspace',
            color: '#1f6f43',
            own: false,
            pending: false
        }]);
    });

    it("shows the ticket's emoji — its own or the one inherited from its parent — and the emoji of the business only when there is none", () => {
        expect(activeFromMarkers([marker({ ticketIcon: '🧰' })], 0)[0].icon).toBe('🧰');
        expect(activeFromMarkers([marker({ ticketIcon: '' })], 0)[0].icon).toBe('🚀');
        expect(activeFromMarkers([marker({ ticketIcon: '', icon: '' })], 0)[0].icon).toBe('');
    });

    it('carries the colour that is in force in the window now', () => {
        expect(activeFromMarkers([marker({ color: '#8f1f3f' })], 0)[0].color).toBe('#8f1f3f');
        expect(activeFromMarkers([marker({ color: null })], 0)[0].color).toBeNull();
    });

    it('a business window is a row named by the business, with its emoji', () => {
        const rows = activeFromMarkers(
            [marker({ subject: 'business', ticket: '@DuetLab', ticketFolder: '', pid: 100 })], 100
        );
        expect(rows[0]).toMatchObject({ subject: 'business', ticket: '@DuetLab', name: 'DuetLab', icon: '🚀', own: true });
    });

    it('marks the intent of the asking window, also when another window holds the same ticket', () => {
        const rows = activeFromMarkers(
            [marker({ pid: 200, writtenAt: NOW }), marker({ pid: 100, writtenAt: NOW - 5000 })],
            100
        );
        expect(rows).toHaveLength(1);
        expect(rows[0].own).toBe(true);
    });

    it('shows a reservation as an intent that is being opened', () => {
        const rows = activeFromMarkers([marker({ kind: 'reservation', expiresAt: NOW + 1 })], 100);
        expect(rows[0].pending).toBe(true);
        expect(rows[0].own).toBe(false);
    });
});

describe('activeRowText', () => {
    const rowOf = (overrides: Partial<WindowMarker>, ownPid = 0) => activeFromMarkers([marker(overrides)], ownPid)[0];

    it('intent: the name, then the number', () => {
        expect(activeRowText(rowOf({}))).toMatchObject({ label: 'Intent Switcher', description: 'DUE017' });
    });

    it('business: the name, then biz — no ticket number', () => {
        expect(activeRowText(rowOf({ subject: 'business', ticket: '@DuetLab', ticketFolder: '' })))
            .toMatchObject({ label: 'DuetLab', description: 'biz' });
    });

    it('a numbered row carries its number in the name, the way tabs do; the whole of it is the name', () => {
        const text = activeRowText(rowOf({}), 2);
        expect(text).toMatchObject({ label: '2: Intent Switcher', description: 'DUE017' });
        expect(text.label.slice(...text.name)).toBe('2: Intent Switcher');
        expect(activeRowText(rowOf({}), null).label).toBe('Intent Switcher');
    });

    it("the row of this window ends with the red dot; other rows have none", () => {
        expect(activeRowText(rowOf({ pid: 100 }, 100)).description).toBe('DUE017 🔴');
        expect(activeRowText(rowOf({ pid: 100 }, 200)).description).toBe('DUE017');
        expect(activeRowText(rowOf({ subject: 'business', ticket: '@DuetLab', ticketFolder: '', pid: 100 }, 100)).description)
            .toBe('biz 🔴');
    });
});

describe('numbers of rows', () => {
    const row = (ticket: string, subject: 'intent' | 'business' = 'intent') =>
        activeFromMarkers([marker({ ticket, subject, ticketFolder: subject === 'intent' ? `${ticket}_Some` : '' })], 0)[0];
    const shown = [row('@DuetLab', 'business'), row('DUE017'), row('DUE013')];

    it('every row is counted from 1 in shown order — business windows and intents alike', () => {
        expect(numberedRows(shown).map(r => r.ticket)).toEqual(['@DuetLab', 'DUE017', 'DUE013']);
        expect(rowNumber(shown, '@DuetLab')).toBe(1);
        expect(rowNumber(shown, 'DUE017')).toBe(2);
        expect(rowNumber(shown, 'DUE013')).toBe(3);
        expect(rowNumber(shown, 'DUE999')).toBeNull();
    });

    it('the number a row shows is the number that finds it', () => {
        for (const each of numberedRows(shown)) {
            expect(rowByNumber(shown, rowNumber(shown, each.ticket))?.ticket).toBe(each.ticket);
        }
    });

    it('a number is the place of a row: a new order, a closed or an opened window renumber the rows', () => {
        const dragged = [shown[0], shown[2], shown[1]];
        expect(rowByNumber(dragged, 2)?.ticket).toBe('DUE013');
        expect(rowNumber(dragged, 'DUE017')).toBe(3);

        const closed = [shown[0], shown[2]];
        expect(rowByNumber(closed, 2)?.ticket).toBe('DUE013');
        expect(rowByNumber(closed, 3)).toBeNull();

        const opened = orderActive([...shown, row('@LOS', 'business')], ['DUE017', 'DUE013']);
        expect(opened.map(r => `${rowNumber(opened, r.ticket)}:${r.ticket}`))
            .toEqual(['1:@DuetLab', '2:@LOS', '3:DUE017', '4:DUE013']);
    });

    it('only the first nine carry a number', () => {
        const twelve = [row('@DuetLab', 'business'), ...Array.from({ length: 11 }, (_, i) => row(`DUE1${String(i).padStart(2, '0')}`))];
        expect(numberedRows(twelve)).toHaveLength(9);
        expect(rowNumber(twelve, 'DUE107')).toBe(9);
        expect(rowNumber(twelve, 'DUE108')).toBeNull();
        expect(rowByNumber(twelve, 9)?.ticket).toBe('DUE107');
        expect(rowByNumber(twelve, 10)).toBeNull();
    });

    it('a number no row carries, or a value that is not a number, finds nothing', () => {
        expect(rowByNumber(shown, 4)).toBeNull();
        expect(rowByNumber(shown, 0)).toBeNull();
        expect(rowByNumber(shown, -1)).toBeNull();
        expect(rowByNumber(shown, 1.5)).toBeNull();
        expect(rowByNumber(shown, '1')).toBeNull();
        expect(rowByNumber(shown, undefined)).toBeNull();
        expect(rowByNumber([], 1)).toBeNull();
    });
});

describe('orderActive', () => {
    const row = (ticket: string) => activeFromMarkers([marker({ ticket, ticketFolder: `${ticket}_X` })], 0)[0];
    const business = (name: string) => activeFromMarkers(
        [marker({ subject: 'business', ticket: `@${name}`, ticketFolder: '', business: name })], 0
    )[0];

    it('follows the remembered order; an intent it does not hold stands after, by number', () => {
        const rows = [row('DUE013'), row('DUE004'), row('DUE017'), row('DUE008')];
        expect(orderActive(rows, ['DUE017', 'DUE008']).map(r => r.ticket))
            .toEqual(['DUE017', 'DUE008', 'DUE004', 'DUE013']);
    });

    it('business windows always come first, by name, whatever the remembered order says', () => {
        const rows = [row('DUE017'), business('МетаЛаб'), row('DUE008'), business('DuetLab')];
        expect(orderActive(rows, ['DUE008', '@МетаЛаб', 'DUE017']).map(r => r.ticket))
            .toEqual(['@DuetLab', '@МетаЛаб', 'DUE008', 'DUE017']);
    });
});

describe('reorderActive', () => {
    const row = (ticket: string) => activeFromMarkers([marker({ ticket, ticketFolder: `${ticket}_X` })], 0)[0];
    const biz = activeFromMarkers([marker({ subject: 'business', ticket: '@DuetLab', ticketFolder: '' })], 0)[0];
    const shown = [biz, row('A'), row('B'), row('C')];

    it('moves an intent among the intents: up — before the target, down — after it, past the rows — to the end', () => {
        expect(reorderActive(shown, 'C', 'A', placeNextTo)).toEqual(['C', 'A', 'B']);
        expect(reorderActive(shown, 'A', 'B', placeNextTo)).toEqual(['B', 'A', 'C']);
        expect(reorderActive(shown, 'A', null, placeNextTo)).toEqual(['B', 'C', 'A']);
    });

    it('a drop on a business row puts the intent first among the intents', () => {
        expect(reorderActive(shown, 'C', '@DuetLab', placeNextTo)).toEqual(['C', 'A', 'B']);
    });

    it('a business row is not dragged, and its key never enters the order', () => {
        expect(reorderActive(shown, '@DuetLab', 'B', placeNextTo)).toBeNull();
        expect(reorderActive(shown, 'C', '@DuetLab', placeNextTo)).not.toContain('@DuetLab');
    });

    it('a drop that changes nothing gives null', () => {
        expect(reorderActive(shown, 'A', 'A', placeNextTo)).toBeNull();
        expect(reorderActive(shown, 'A', '@DuetLab', placeNextTo)).toBeNull();
        expect(reorderActive(shown, 'ZZZ', 'A', placeNextTo)).toBeNull();
    });
});

describe('applyLinger', () => {
    const row = (ticket: string) => activeFromMarkers([marker({ ticket })], 0)[0];
    const empty: LingerState = { rows: [], goneAt: new Map() };

    it('shows current rows at once', () => {
        const { state, recheckIn } = applyLinger(empty, [row('DUE017')], NOW);
        expect(state.rows.map(r => r.ticket)).toEqual(['DUE017']);
        expect(recheckIn).toBeNull();
    });

    it('keeps a row whose marker has just gone, and asks to be called again', () => {
        const shown = applyLinger(empty, [row('DUE017'), row('DUE008')], NOW).state;
        const { state, recheckIn } = applyLinger(shown, [row('DUE008')], NOW + 10);
        expect(state.rows.map(r => r.ticket).sort()).toEqual(['DUE008', 'DUE017']);
        expect(recheckIn).toBe(LINGER_MS);
    });

    it('drops the row once the delay is over', () => {
        const shown = applyLinger(empty, [row('DUE017')], NOW).state;
        const gone = applyLinger(shown, [], NOW + 10).state;
        const later = applyLinger(gone, [], NOW + 10 + LINGER_MS);
        expect(later.state.rows).toEqual([]);
        expect(later.recheckIn).toBeNull();
    });

    it('a window reload does not blink: the row comes back within the delay', () => {
        const shown = applyLinger(empty, [row('DUE017')], NOW).state;
        const gone = applyLinger(shown, [], NOW + 10).state;
        const back = applyLinger(gone, [row('DUE017')], NOW + 500);
        expect(back.state.rows.map(r => r.ticket)).toEqual(['DUE017']);
        expect(back.state.goneAt.size).toBe(0);
        expect(back.recheckIn).toBeNull();
    });
});
