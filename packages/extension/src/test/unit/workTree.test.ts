/* eslint-disable @typescript-eslint/naming-convention */
import { describe, it, expect } from 'vitest';
import { compileExclude } from '../../core/folderView/glob';
import { Snapshot } from '../../core/folderView/snapshot';
import { NOTHING_SHOWN, ShownState, chooseOwnPlace, locateTicket, nextShown, viewTitle, workOrderPath } from '../../core/work/shown';
import { NO_FILTER, WorkTree } from '../../core/work/tree';
import {
    DEFAULT_TICKET_VIEW, DEFAULT_WINDOW_VIEW, parseTicketView, parseWindowView, serializeTicketView, serializeWindowView
} from '../../core/work/viewFiles';
import { Paths } from '../../core/paths';
import { createMemFs } from './helpers/memFs';

function snap(tree: Record<string, string[]>): Snapshot {
    const dirs = new Map();
    for (const [folder, names] of Object.entries(tree)) {
        dirs.set(folder, {
            state: 'ok',
            entries: names.map(n => (n.endsWith('/') ? { name: n.slice(0, -1), kind: 'dir' } : { name: n, kind: 'file' }))
        });
    }
    return { dirs };
}

/** A, A/x, A/x/y, B, B/y, C — and a file in each. */
function deepTree(): WorkTree {
    const tree = new WorkTree();
    tree.setSnapshot(snap({
        '.': ['A/', 'B/', 'C/', 'INDEX.md'], 'A': ['x/', 'a.md'], 'A/x': ['y/', 'f.md'], 'A/x/y': ['deep.md'],
        'B': ['y/', 'b.md'], 'B/y': ['g.md'], 'C': ['c.md']
    }));
    tree.dirty = false;
    return tree;
}
const open = (tree: WorkTree) => [...tree.expanded].sort();

describe('М2.2, М3.5: раскрытие рукой', () => {
    it('раскрытие и сворачивание меняют набор; повтор известного — эхо', () => {
        const tree = deepTree();
        expect(tree.didExpand('A')).toBe('plain');
        expect(tree.didExpand('A')).toBe('echo');
        expect(tree.dirty).toBe(true);
        expect(tree.didCollapse('A')).toBe(true);
        expect(tree.didCollapse('A')).toBe(false);
    });

    it('М3.5/2: сворачивание рукой помнит раскрытое под папкой', () => {
        const tree = deepTree();
        tree.didExpand('A');
        tree.didExpand('A/x');
        tree.didCollapse('A');
        expect(open(tree)).toEqual(['A/x']);
        expect(tree.facts().hasExpanded).toBe(false);
        expect(tree.facts().anyExpanded).toBe(true);
    });

    it('T20: появление и исчезновение файла набор не меняет; исчезнувшая папка из набора уходит', () => {
        const tree = deepTree();
        tree.didExpand('A');
        tree.didExpand('B');
        tree.dirty = false;
        tree.setSnapshot(snap({ '.': ['A/', 'B/', 'new.md'], 'A': ['a.md', 'more.md'], 'B': [] }));
        expect(open(tree)).toEqual(['A', 'B']);
        expect(tree.dirty).toBe(false);
        tree.setSnapshot(snap({ '.': ['A/'], 'A': [] }));
        expect(open(tree)).toEqual(['A']);
        expect(tree.dirty).toBe(true);
    });

    it('М4.25: папка, вернувшаяся под тем же именем, возвращается свёрнутой', () => {
        const tree = deepTree();
        tree.didExpand('C');
        tree.setSnapshot(snap({ '.': ['A/', 'B/'], 'A': [], 'B': [] }));
        tree.setSnapshot(snap({ '.': ['A/', 'B/', 'C/'], 'A': [], 'B': [], 'C': [] }));
        expect(open(tree)).toEqual([]);
    });

    it('папка, чей родитель не прочитан, из набора не уходит', () => {
        const tree = deepTree();
        tree.didExpand('A');
        tree.didExpand('A/x');
        const dirs = new Map(snap({ '.': ['A/'] }).dirs);
        dirs.set('A', { state: 'error', reason: 'не отвечает' });
        tree.setSnapshot({ dirs });
        expect(open(tree)).toEqual(['A', 'A/x']);
    });
});

describe('М1.3, М3.6, М4.4: действия над всем деревом', () => {
    it('навязанный вид меняет идентификаторы только у папок, чьё состояние изменилось', () => {
        const tree = deepTree();
        tree.didExpand('A');
        expect(tree.run('expandLevel1')).toBe(true);
        expect(open(tree)).toEqual(['A', 'B', 'C']);
        expect([tree.epochOf('A'), tree.epochOf('B'), tree.epochOf('C'), tree.epochOf('A/x')]).toEqual([0, 1, 1, 0]);
        expect(tree.run('expandLevel1')).toBe(false);
    });

    it('«свернуть всё» очищает и вложенную память, и раскрытие скрытых папок', () => {
        const tree = deepTree();
        tree.expanded = new Set(['A/x', 'B', 'C']);
        tree.setFilter({ ...NO_FILTER, exclude: compileExclude({ 'C': true }) });
        expect(tree.admitted()).not.toContain('C');
        tree.run('collapseAll');
        expect(open(tree)).toEqual([]);
    });

    it('массовое раскрытие относится к допущенным фильтром папкам; скрытые в наборе остаются', () => {
        const tree = deepTree();
        tree.expanded = new Set(['C']);
        tree.setFilter({ ...NO_FILTER, exclude: compileExclude({ 'C': true }) });
        tree.run('expandLevel2');
        expect(open(tree)).toEqual(['A', 'A/x', 'B', 'B/y', 'C']);
        tree.run('expandAll');
        expect(open(tree)).toEqual(['A', 'A/x', 'A/x/y', 'B', 'B/y', 'C']);
    });

    it('М4.4: «свернуть на один уровень» закрывает только самый глубокий видимый уровень', () => {
        const tree = deepTree();
        tree.expanded = new Set(['A', 'A/x', 'A/x/y', 'B']);
        tree.run('collapseLevel');
        expect(open(tree)).toEqual(['A', 'A/x', 'B']);
        tree.run('collapseLevel');
        expect(open(tree)).toEqual(['A', 'B']);
        tree.run('collapseLevel');
        expect(open(tree)).toEqual([]);
        expect(tree.run('collapseLevel')).toBe(false);
    });

    it('М1.2: минус-плюс сворачивает всё при видимой раскрытой папке, иначе раскрывает до глубины', () => {
        const tree = deepTree();
        tree.toggle('2');
        expect(open(tree)).toEqual(['A', 'A/x', 'B', 'B/y', 'C']);
        tree.toggle('2');
        expect(open(tree)).toEqual([]);
        tree.toggle('all');
        expect(open(tree)).toEqual(['A', 'A/x', 'A/x/y', 'B', 'B/y', 'C']);
    });

    it('кнопка показывает плюс, когда раскрытое есть только под свёрнутой папкой', () => {
        const tree = deepTree();
        tree.didExpand('A');
        tree.didExpand('A/x');
        tree.didCollapse('A');
        tree.toggle('1');
        expect(open(tree)).toEqual(['A', 'B', 'C']);
    });
});

describe('М2.2, М4.3, T46, T47: одна папка за раз', () => {
    it('М4.3: раскрытие верхней папки закрывает чужие подпапки, верхние остаются', () => {
        const tree = deepTree();
        tree.expanded = new Set(['A', 'A/x', 'B', 'B/y']);
        tree.setRule(true, 2, null, null);
        tree.expanded = new Set(['A', 'A/x', 'B', 'B/y']);
        expect(tree.didExpand('C')).toBe('enforced');
        expect(open(tree)).toEqual(['A', 'B', 'C']);
        expect(tree.epochOf('A/x')).toBeGreaterThan(0);
        expect(tree.epochOf('C')).toBe(0);
    });

    it('раскрытие, которому нечего закрывать, перерисовки дерева не требует', () => {
        const tree = deepTree();
        tree.setRule(true, 2, null, null);
        // Each expansion here is a gesture of its own: the events of one gesture have all come
        const expand = (folder: string) => { const outcome = tree.didExpand(folder); tree.endGesture(); return outcome; };
        expect(expand('A')).toBe('plain');
        expect(expand('A/x')).toBe('plain');
        // A top folder opened at border 2 closes the subfolder of the other branch
        expect(expand('B')).toBe('enforced');
        expect(open(tree)).toEqual(['A', 'B']);
        expect(expand('B/y')).toBe('plain');
        expect(open(tree)).toEqual(['A', 'B', 'B/y']);
    });

    it('М3.7/1: включение сразу приводит вид к правилу и ничего закрытого не раскрывает', () => {
        const tree = deepTree();
        tree.expanded = new Set(['A', 'A/x', 'B', 'B/y']);
        expect(tree.setRule(true, 2, 'B/y', null)).toBe(true);
        expect(open(tree)).toEqual(['A', 'B', 'B/y']);
        const other = deepTree();
        other.expanded = new Set(['A', 'A/x', 'B', 'B/y']);
        other.setRule(true, 2, null, null);
        expect(open(other)).toEqual(['A', 'A/x', 'B']);
    });

    it('включение берёт последнюю раскрывавшуюся ветку, когда рамка ничего не указывает', () => {
        const tree = deepTree();
        ['A', 'A/x', 'B', 'B/y'].forEach(folder => tree.didExpand(folder));
        tree.setRule(true, 2, 'C', null);
        expect(open(tree)).toEqual(['A', 'B', 'B/y']);
    });

    it('М3.7/1: при включённом показе веткой становится путь текущего файла', () => {
        const tree = deepTree();
        tree.expanded = new Set(['B', 'B/y']);
        tree.setRule(true, 2, 'B/y', 'A/x/f.md');
        expect(open(tree)).toEqual(['A', 'A/x', 'B']);
    });

    it('М3.7/2: выключение дерево не трогает; смена границы приводит вид заново', () => {
        const tree = deepTree();
        tree.expanded = new Set(['A', 'A/x', 'A/x/y', 'B']);
        expect(tree.setRule(false, 2, null, null)).toBe(false);
        expect(open(tree)).toEqual(['A', 'A/x', 'A/x/y', 'B']);
        tree.setRule(true, 3, 'A/x/y', null);
        expect(open(tree)).toEqual(['A', 'A/x', 'A/x/y', 'B']);
        tree.setRule(true, 1, 'A/x/y', null);
        expect(open(tree)).toEqual(['A', 'A/x', 'A/x/y']);
    });

    it('М4.17: рекурсивный жест платформы при галочке раскрывает одну указанную папку', () => {
        const tree = deepTree();
        tree.setRule(true, 2, null, null);
        expect(tree.didExpand('A')).toBe('plain');
        // The platform sends an event per folder of the branch
        expect(tree.didExpand('A/x')).toBe('enforced');
        expect(tree.didExpand('A/x/y')).toBe('enforced');
        expect(open(tree)).toEqual(['A']);
        expect(tree.epochOf('A/x')).toBe(1);
        tree.endGesture();
        expect(tree.didExpand('A/x')).toBe('plain');
        expect(open(tree)).toEqual(['A', 'A/x']);
    });

    it('без галочки рекурсивный жест раскрывает всю ветку', () => {
        const tree = deepTree();
        ['A', 'A/x', 'A/x/y'].forEach(folder => tree.didExpand(folder));
        expect(open(tree)).toEqual(['A', 'A/x', 'A/x/y']);
    });
});

describe('T75, T77: галочка во время перетаскивания', () => {
    const dragging = () => {
        const tree = deepTree();
        tree.expanded = new Set(['A', 'A/x']);
        tree.setRule(true, 2, 'A/x', null);
        tree.dirty = false;
        tree.beginDrag();
        return tree;
    };

    it('пока тащишь, ничего не сворачивается: раскрытое под курсором стоит раскрытым', () => {
        const tree = dragging();
        expect(tree.didExpand('B')).toBe('deferred');
        expect(tree.didExpand('B/y')).toBe('deferred');
        expect(open(tree)).toEqual(['A', 'A/x', 'B', 'B/y']);
        expect(tree.epochOf('A/x')).toBe(0);
    });

    it('перетаскивание закончено — раскрытой остаётся папка цели', () => {
        const tree = dragging();
        tree.didExpand('B');
        tree.didExpand('B/y');
        expect(tree.endDrag('B/y')).toBe(true);
        expect(open(tree)).toEqual(['A', 'B', 'B/y']);
        expect(tree.isDragging()).toBe(false);
    });

    it('отменено — раскрытой остаётся папка источника', () => {
        const tree = dragging();
        tree.didExpand('B');
        tree.didExpand('B/y');
        tree.endDrag('A/x');
        expect(open(tree)).toEqual(['A', 'A/x', 'B']);
    });

    it('ничего не раскрылось под курсором — вид не трогается', () => {
        const tree = dragging();
        expect(tree.endDrag('.')).toBe(false);
        expect(open(tree)).toEqual(['A', 'A/x']);
    });

    it('T75: без галочки папка, раскрытая под курсором, просто остаётся раскрытой и запоминается', () => {
        const tree = deepTree();
        tree.beginDrag();
        tree.didExpand('B');
        expect(tree.endDrag('.')).toBe(true);
        expect(open(tree)).toEqual(['B']);
        expect(tree.dirty).toBe(true);
    });
});

describe('М2.4, М3.4: показ открытого файла', () => {
    it('раскрывает путь; при галочке закрывает остальные ограничиваемые ветки', () => {
        const tree = deepTree();
        tree.expanded = new Set(['B', 'B/y']);
        expect(tree.reveal('A/x/f.md')).toBe(true);
        expect(open(tree)).toEqual(['A', 'A/x', 'B', 'B/y']);
        tree.setRule(true, 2, 'B/y', null);
        tree.reveal('A/x/f.md');
        expect(open(tree)).toEqual(['A', 'A/x', 'B']);
    });

    it('М3.5: путь уже раскрыт — показ ничего не меняет', () => {
        const tree = deepTree();
        tree.expanded = new Set(['A', 'A/x']);
        expect(tree.reveal('A/x/f.md')).toBe(false);
    });
});

describe('М3.11/2: папка переименована или перенесена через вью', () => {
    it('раскрытое следует за папкой; при галочке приводится к ограничению', () => {
        const tree = deepTree();
        tree.expanded = new Set(['A', 'A/x', 'B']);
        tree.folderMoved('A', 'B/A');
        expect(open(tree)).toEqual(['B', 'B/A', 'B/A/x']);
        const ruled = deepTree();
        ruled.expanded = new Set(['A', 'A/x', 'B', 'B/y']);
        ruled.oneFolder = true;
        ruled.folderMoved('A/x', 'C/x');
        expect(open(ruled)).toEqual(['A', 'B', 'C/x']);
    });

    it('удалённая папка уходит из набора со всем под ней', () => {
        const tree = deepTree();
        tree.expanded = new Set(['A', 'A/x', 'B']);
        tree.folderRemoved('A');
        expect(open(tree)).toEqual(['B']);
    });
});

describe('М4.18: останется ли имя скрытым', () => {
    it('судит по правилам скрытия; файл в видимом редакторе остаётся виден под новым именем', () => {
        const tree = new WorkTree();
        tree.setSnapshot(snap({ '.': ['d/', 'a.md'], 'd': [] }));
        tree.setFilter({ ...NO_FILTER, exclude: compileExclude({ '**/.*': true }), visibleEditors: ['a.md'] });
        expect(tree.wouldBeHidden('.', '.secret', true)).toBe(true);
        expect(tree.wouldBeHidden('d', 'plain', true)).toBe(false);
        expect(tree.wouldBeHidden('.', '.a.md', false)).toBe(true);
        expect(tree.wouldBeHidden('.', '.a.md', false, 'a.md')).toBe(false);
        tree.setFilter({ ...tree.getFilter(), showHidden: true });
        expect(tree.wouldBeHidden('.', '.secret', true)).toBe(false);
    });
});

describe('М2.1, М3.2, М3.14: какой тикет показан', () => {
    const own = { state: 'found' as const, number: 'DUE018', path: '/b/work/DUE018_WorkView' };
    const home = nextShown(NOTHING_SHOWN, { kind: 'home', own }).state;
    const other: ShownState = { ticket: { number: 'DUE017', path: '/b/work/DUE017_X', own: false }, trouble: null };

    it('при запуске и по «обновить» — тикет окна; в окне бизнеса — пусто', () => {
        expect(home.ticket).toEqual({ number: 'DUE018', path: '/b/work/DUE018_WorkView', own: true });
        expect(nextShown(other, { kind: 'home', own }).state.ticket?.number).toBe('DUE018');
        expect(nextShown(other, { kind: 'home', own: { state: 'none' } }).state).toEqual(NOTHING_SHOWN);
    });

    it('«обновить» на своём тикете перечитывает его', () => {
        expect(nextShown(home, { kind: 'home', own }).changed).toBe(true);
    });

    it('М3.2/1, М4.2: выбор в «Корзине» показывает тикет — и из пустого окна бизнеса', () => {
        const select = { kind: 'select' as const, number: 'DUE017', path: '/b/work/DUE017_X', sameBusiness: true, ownNumber: 'DUE018' };
        expect(nextShown(home, select)).toMatchObject({ changed: true, state: { ticket: { number: 'DUE017', own: false } } });
        expect(nextShown(NOTHING_SHOWN, { ...select, ownNumber: null }).state.ticket?.number).toBe('DUE017');
    });

    it('М3.14/4: выбор уже показанного тикета его вид не перезапускает; после возврата домой щелчок действует снова', () => {
        const select = { kind: 'select' as const, number: 'DUE017', path: '/b/work/DUE017_X', sameBusiness: true, ownNumber: 'DUE018' };
        expect(nextShown(other, select)).toEqual({ state: other, changed: false });
        expect(nextShown(home, select).changed).toBe(true);
    });

    it('выбор своего тикета в «Корзине» показывает его как свой', () => {
        expect(nextShown(other, { kind: 'select', number: 'DUE018', path: own.path, sameBusiness: true, ownNumber: 'DUE018' }).state.ticket?.own).toBe(true);
    });

    it('две папки одного номера — два разных показа: назначение задаёт строка', () => {
        const twin = { kind: 'select' as const, number: 'DUE017', path: '/b/backlog/DUE017_X', sameBusiness: true, ownNumber: 'DUE018' };
        expect(nextShown(other, twin)).toMatchObject({ changed: true, state: { ticket: { path: '/b/backlog/DUE017_X' } } });
    });

    it('М3.2/4: тикет другого бизнеса — показанное остаётся, одна строка', () => {
        const step = nextShown(home, { kind: 'select', number: 'ABC001', path: '/c/work/ABC001', sameBusiness: false, ownNumber: 'DUE018' });
        expect(step.state).toBe(home);
        expect(step.changed).toBe(false);
        expect(step.say).toBe('Тикеты другого бизнеса рабочая папка пока не открывает.');
    });

    it('М3.14/1: папка переехала — вью идёт за ней, чей тикет — не меняется', () => {
        expect(nextShown(home, { kind: 'gone', places: ['/b/backlog/DUE018_WorkView'], own: { state: 'none' } }).state.ticket)
            .toEqual({ number: 'DUE018', path: '/b/backlog/DUE018_WorkView', own: true });
        expect(nextShown(other, { kind: 'gone', places: ['/b/archive/DUE017_X'], own }).state.ticket)
            .toEqual({ number: 'DUE017', path: '/b/archive/DUE017_X', own: false });
    });

    it('М3.14/2: свой тикет исчез — пусто и причина; чужой — однократный возврат к своему', () => {
        expect(nextShown(home, { kind: 'gone', places: [], own: { state: 'none' } }).state)
            .toEqual({ ticket: null, trouble: { number: 'DUE018', own: true, why: 'missing' } });
        const back = nextShown(other, { kind: 'gone', places: [], own });
        expect(back.state.ticket?.number).toBe('DUE018');
        expect(back.say).toBe('Папка тикета DUE017 не найдена — рабочая папка вернулась к тикету окна.');
        expect(nextShown(other, { kind: 'gone', places: [], own: { state: 'none' } }).state).toEqual(NOTHING_SHOWN);
    });

    it('М3.14/3, М4.26: после исчезновения нашлось несколько папок — строк нет, номер и причина остаются', () => {
        const step = nextShown(other, { kind: 'gone', places: ['/b/work/DUE017_A', '/b/backlog/DUE017_B'], own });
        expect(step.state).toEqual({ ticket: null, trouble: { number: 'DUE017', own: false, why: 'ambiguous' } });
    });

    it('тикет не выбран — исчезновение папок ничего не выбирает', () => {
        expect(nextShown(NOTHING_SHOWN, { kind: 'gone', places: ['/b/work/DUE017_X'], own })).toEqual({ state: NOTHING_SHOWN, changed: false });
    });

    it('папки не ответили — показанное остаётся, шапка говорит почему', () => {
        const step = nextShown(other, { kind: 'home', own: { state: 'unknown', number: 'DUE018' } });
        expect(step.state.ticket).toEqual(other.ticket);
        expect(step.state.trouble?.why).toBe('unknown');
    });
});

describe('М1.1, М2.8: шапка', () => {
    it('номер показанного тикета; у чужого — приписка; без тикета — голое название и пустое тело', () => {
        expect(viewTitle(NOTHING_SHOWN, { state: 'none' })).toEqual({ title: 'Рабочая папка', description: '', message: undefined });
        const own: ShownState = { ticket: { number: 'DUE018', path: '/p', own: true }, trouble: null };
        expect(viewTitle(own, { state: 'ready' })).toEqual({ title: 'Рабочая папка DUE018', description: '', message: undefined });
        expect(viewTitle({ ticket: { number: 'DUE017', path: '/p', own: false }, trouble: null }, { state: 'ready' }).description).toBe('другой тикет');
    });

    it('загрузка, неподтверждённые данные и ошибка названы строкой, а не пустотой', () => {
        const own: ShownState = { ticket: { number: 'DUE018', path: '/p', own: true }, trouble: null };
        expect(viewTitle(own, { state: 'loading' }).message).toBe('Загрузка…');
        expect(viewTitle(own, { state: 'stale', reason: 'папка не отвечает' }).message).toBe('Данные не обновлены: папка не отвечает');
        expect(viewTitle(own, { state: 'error', reason: 'нет доступа' }).message).toBe('Папка не прочитана: нет доступа');
    });

    it('исчезнувшая и раздвоившаяся папка: номер в заголовке, причина — в приписке и строкой', () => {
        expect(viewTitle({ ticket: null, trouble: { number: 'DUE018', own: true, why: 'missing' } }, { state: 'none' }))
            .toEqual({ title: 'Рабочая папка DUE018', description: 'папка не найдена', message: 'Папка тикета DUE018 не найдена.' });
        expect(viewTitle({ ticket: null, trouble: { number: 'DUE017', own: false, why: 'ambiguous' } }, { state: 'none' }).description)
            .toBe('другой тикет · найдено несколько папок');
    });
});

describe('поиск папки тикета', () => {
    it('находит на полках и в архиве; отличает «нет» от «не ответила»', async () => {
        const mem = createMemFs({}, ['/b/work/DUE018_WorkView', '/b/backlog/DUE017_X', '/b/archive/2026/09/DUE001_Old', '/b/work/notes']);
        expect(await locateTicket(mem.fs, '/b', 'DUE018')).toEqual({ state: 'found', paths: ['/b/work/DUE018_WorkView'] });
        expect(await locateTicket(mem.fs, '/b', 'DUE001')).toEqual({ state: 'found', paths: ['/b/archive/2026/09/DUE001_Old'] });
        expect(await locateTicket(mem.fs, '/b', 'DUE999')).toEqual({ state: 'found', paths: [] });
        const failing = { ...mem.fs, readdir: async () => { throw new Error('диск не отвечает'); } };
        expect(await locateTicket(failing, '/b', 'DUE018')).toEqual({ state: 'unknown', reason: 'диск не отвечает' });
    });

    it('свой тикет среди нескольких папок — та, что названа как знает окно', () => {
        const places = { state: 'found' as const, paths: ['/b/work/DUE018_Old', '/b/backlog/DUE018_WorkView'] };
        expect(chooseOwnPlace('DUE018', 'DUE018_WorkView', places)).toEqual({ state: 'found', number: 'DUE018', path: '/b/backlog/DUE018_WorkView' });
        expect(chooseOwnPlace('DUE018', 'DUE018_Renamed', places)).toEqual({ state: 'ambiguous', number: 'DUE018' });
        expect(chooseOwnPlace('DUE018', 'x', { state: 'found', paths: [] })).toEqual({ state: 'missing', number: 'DUE018' });
        expect(chooseOwnPlace('DUE018', 'x', { state: 'found', paths: ['/b/archive/DUE018_Z'] }).state).toBe('found');
        expect(chooseOwnPlace('DUE018', 'x', { state: 'unknown', reason: '' }).state).toBe('unknown');
    });
});

describe('М2.3, М4.6: файлы вида', () => {
    it('места хранения: порядок — в бизнесе, вид тикета — по машине без программы, настройки окна — по программе и окну', () => {
        const paths = new Paths('/data');
        expect(workOrderPath('/drive/DuetLab', 'DUE018')).toBe('/drive/DuetLab/.vscode/duet-work-order/DUE018.json');
        expect(paths.workTicketViewPath('/drive/DuetLab', 'DUE018')).toBe('/data/views/work/tickets/DuetLab/DUE018.json');
        expect(paths.workWindowViewPath('cursor', 'DUE018')).toBe('/data/views/work/windows/cursor/DUE018.json');
    });

    it('нет файла вида — всё свёрнуто, галочка выключена, уровень 2', () => {
        expect(parseTicketView(null)).toEqual({ view: DEFAULT_TICKET_VIEW, writable: true });
        expect(parseTicketView('{oops').view).toEqual(DEFAULT_TICKET_VIEW);
    });

    it('раскрытое, галочка и её уровень хранятся и возвращаются вместе', () => {
        const text = serializeTicketView({ expanded: ['b', 'a'], oneFolder: true, oneFolderFromLevel: 3 });
        expect(text).toBe('{\n  "version": 1,\n  "expanded": [\n    "a",\n    "b"\n  ],\n  "oneFolder": true,\n  "oneFolderFromLevel": 3\n}\n');
        expect(parseTicketView(text)).toEqual({ view: { expanded: ['a', 'b'], oneFolder: true, oneFolderFromLevel: 3 }, writable: true });
    });

    it('файл более новой версии показывается и не пишется; уровень вне 1–3 читается как 2', () => {
        expect(parseTicketView('{"version":9,"expanded":["a"],"oneFolderFromLevel":7}'))
            .toEqual({ view: { expanded: ['a'], oneFolder: false, oneFolderFromLevel: 2 }, writable: false });
    });

    it('М5: настройки окна изначально — скрытые скрыты, показ выключен, плюс на один уровень', () => {
        expect(parseWindowView(null)).toEqual(DEFAULT_WINDOW_VIEW);
        expect(DEFAULT_WINDOW_VIEW).toEqual({ showHidden: false, followEditor: false, plusDepth: '1' });
        const text = serializeWindowView({ showHidden: true, followEditor: true, plusDepth: 'all' });
        expect(parseWindowView(text)).toEqual({ showHidden: true, followEditor: true, plusDepth: 'all' });
        expect(parseWindowView('{oops')).toEqual(DEFAULT_WINDOW_VIEW);
    });
});
