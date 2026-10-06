/* eslint-disable @typescript-eslint/naming-convention */
import { describe, it, expect } from 'vitest';
import {
    Entry, compareDefault, copyNameOf, duplicateName, isCopyOf, nameKey, renameSelection, splitName, validateName
} from '../../core/folderView/names';
import { compileExclude, compileGlob } from '../../core/folderView/glob';
import { parseIgnore } from '../../core/folderView/ignore';
import { composeIgnore, computeHidden, FilterInput } from '../../core/folderView/filter';
import {
    applyOrderOps, changeOrder, emptyOrder, isPinned, mergeOrder, parseOrder, pinsOf, readOrder, serializeOrder
} from '../../core/folderView/order';
import { Snapshot, foldersToReread, readSnapshot, rereadFolders, LINK_CYCLE, LINK_OUTSIDE } from '../../core/folderView/snapshot';
import { Row, childRows, screenRows } from '../../core/folderView/rows';
import {
    collapseDeepestLevel, expandAll, expandToLevel, oneAtATime, pickBranch, revealPath, visiblyExpanded
} from '../../core/folderView/expand';
import { afterDeleteFocus, commandTargets, moveLine, resolveDrop, resolveImport } from '../../core/folderView/drop';
import { availability, ViewFacts } from '../../core/folderView/availability';
import { createMemFs } from './helpers/memFs';
import { createMemDisk } from './helpers/memDisk';

const PINNED = ['INDEX.md', 'AGENDA.md', 'notepad.md'];
const file = (name: string): Entry => ({ name, kind: 'file' });
const dir = (name: string): Entry => ({ name, kind: 'dir' });
const sorted = (entries: Entry[]) => [...entries].sort((a, b) => compareDefault(a, b, PINNED)).map(e => e.name);

/** A snapshot from a plain description: folder → names; a name ending with `/` is a folder. */
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

const NO_FILTER: FilterInput = { showHidden: false, prefix: '', exclude: compileExclude({}), ignored: null, visibleEditors: [] };

describe('М2.5: порядок по умолчанию', () => {
    it('папки первыми, затем INDEX, AGENDA, notepad, затем остальное', () => {
        expect(sorted([file('z.md'), file('notepad.md'), dir('b'), file('AGENDA.md'), file('a.md'), file('INDEX.md'), dir('a')]))
            .toEqual(['a', 'b', 'INDEX.md', 'AGENDA.md', 'notepad.md', 'a.md', 'z.md']);
    });

    it('закреплены только точные имена', () => {
        expect(sorted([file('index.md'), file('INDEX.md'), file('a.md')])).toEqual(['INDEX.md', 'a.md', 'index.md']);
    });

    it('числа сравниваются как числа, при равенстве короче раньше', () => {
        expect(sorted([file('10.md'), file('02.md'), file('2.md'), file('1.md')])).toEqual(['1.md', '2.md', '02.md', '10.md']);
        expect(sorted([dir('10_Б'), dir('2_А'), dir('01_В')])).toEqual(['01_В', '2_А', '10_Б']);
    });

    it('сначала основа, затем расширение: копия стоит под исходным', () => {
        expect(sorted([file('name copy01.md'), file('name.md'), file('name.txt')])).toEqual(['name.md', 'name.txt', 'name copy01.md']);
    });

    it('регистр не учитывается, равенство разрешает точное имя; латиница раньше кириллицы', () => {
        expect(sorted([file('b.md'), file('A.md'), file('a.md'), file('Я.md')])).toEqual(['A.md', 'a.md', 'b.md', 'Я.md']);
    });

    it('ведущая точка расширения не начинает', () => {
        expect(splitName('.env')).toEqual({ stem: '.env', ext: '' });
        expect(splitName('a.b.md')).toEqual({ stem: 'a.b', ext: '.md' });
        expect(splitName('README')).toEqual({ stem: 'README', ext: '' });
    });
});

describe('М4.33: сопоставление имён по правилам системы', () => {
    it('macOS не различает регистр и форму Юникода, Windows — регистр, Linux различает всё', () => {
        const nfc = 'й.md';
        const nfd = nfc.normalize('NFD');
        expect(nameKey(nfd, 'darwin')).toBe(nameKey(nfc, 'darwin'));
        expect(nameKey('A.md', 'darwin')).toBe(nameKey('a.md', 'darwin'));
        expect(nameKey('A.md', 'win32')).toBe(nameKey('a.md', 'win32'));
        expect(nameKey(nfd, 'linux')).not.toBe(nameKey(nfc, 'linux'));
        expect(nameKey('A.md', 'linux')).not.toBe(nameKey('a.md', 'linux'));
    });
});

describe('М4.9: имя копии', () => {
    const free = () => false;
    it('суффикс перед расширением, у папки и .env — после всего имени', () => {
        expect(duplicateName('a.b.md', false, free)?.name).toBe('a.b copy01.md');
        expect(duplicateName('.env', false, free)?.name).toBe('.env copy01');
        expect(duplicateName('v1.2', true, free)?.name).toBe('v1.2 copy01');
        expect(duplicateName('план copy01.md', false, free)?.name).toBe('план copy01 copy01.md');
    });

    it('первый свободный номер; после 99 — отказ, третья цифра не вводится', () => {
        const taken = new Set(['a copy01.md', 'a copy02.md']);
        expect(duplicateName('a.md', false, n => taken.has(n))?.name).toBe('a copy03.md');
        expect(duplicateName('a.md', false, () => true)).toBeNull();
        expect(copyNameOf('a.md', false, 99)).toBe('a copy99.md');
    });

    it('М3.13/3: копия, проигравшая гонку, пробует следующий номер', () => {
        expect(duplicateName('a.md', false, free, 2)?.name).toBe('a copy02.md');
    });

    it('T63: копия распознаётся по виду имени', () => {
        expect(isCopyOf('a copy01.md', 'a.md', false)).toBe(true);
        expect(isCopyOf('a copy1.md', 'a.md', false)).toBe(false);
        expect(isCopyOf('b copy01.md', 'a.md', false)).toBe(false);
        expect(isCopyOf('d copy07', 'd', true)).toBe(true);
    });
});

describe('М4.19: проверка имени', () => {
    const context = {
        system: 'darwin' as const,
        isTaken: (n: string, except?: string) => ['taken.md'].some(held => held !== except && held === n.toLowerCase())
    };
    it('пусто, точки, разделители, длина', () => {
        expect(validateName('  ', context)?.severity).toBe('error');
        expect(validateName('..', context)?.severity).toBe('error');
        expect(validateName('a/b', context)?.severity).toBe('error');
        expect(validateName('a\\b', context)?.severity).toBe('error');
        expect(validateName('x'.repeat(256), context)?.severity).toBe('error');
        expect(validateName('x'.repeat(255), context)).toBeNull();
    });

    it('занятое имя — ошибка; смена только регистра у переименовываемого разрешена', () => {
        expect(validateName('Taken.md', context)?.message).toBe('В этой папке уже есть Taken.md.');
        expect(validateName('TAKEN.md', { ...context, original: 'taken.md' })).toBeNull();
    });

    it('пробел по краям — предупреждение, Enter применяет', () => {
        expect(validateName(' a.md', context)?.severity).toBe('warning');
    });

    it('М4.18: скрываемое имя — сведение, а не ошибка', () => {
        expect(validateName('.hidden', { ...context, wouldBeHidden: () => true })?.severity).toBe('info');
    });

    it('Windows: запрещённые знаки, имена устройств, точка в конце', () => {
        const win = { system: 'win32' as const, isTaken: () => false };
        expect(validateName('a:b', win)?.severity).toBe('error');
        expect(validateName('con', win)?.severity).toBe('error');
        expect(validateName('CON.txt', win)?.severity).toBe('error');
        expect(validateName('a.', win)?.severity).toBe('error');
        expect(validateName('con', context)).toBeNull();
    });

    it('при переименовании выделена основа; у папки и .env — всё имя', () => {
        expect(renameSelection('a.b.md', false)).toEqual([0, 3]);
        expect(renameSelection('.env', false)).toEqual([0, 4]);
        expect(renameSelection('v1.2', true)).toEqual([0, 4]);
    });
});

describe('М2.6: шаблоны files.exclude', () => {
    it('диалект Explorer', () => {
        expect(compileGlob('**/.git')('.git')).toBe(true);
        expect(compileGlob('**/.git')('a/b/.git')).toBe(true);
        expect(compileGlob('**/*.log')('a/x.log')).toBe(true);
        expect(compileGlob('*.log')('x.log')).toBe(true);
        expect(compileGlob('*.log')('a/x.log')).toBe(false);
        expect(compileGlob('node_modules')('a/node_modules')).toBe(false);
        expect(compileGlob('a/**')('a')).toBe(true);
        expect(compileGlob('a/**')('a/b/c')).toBe(true);
        expect(compileGlob('a/**/c')('a/c')).toBe(true);
        expect(compileGlob('**/a/b')('x/a/b')).toBe(true);
        expect(compileGlob('{**/a,**/b}')('x/b')).toBe(true);
        expect(compileGlob('**/*.{js,ts}')('x/y.ts')).toBe(true);
        expect(compileGlob('**/[ab].md')('x/a.md')).toBe(true);
        expect(compileGlob('**/[!ab].md')('x/a.md')).toBe(false);
        expect(compileGlob('**/?.md')('ab.md')).toBe(false);
        expect(compileGlob('**/.*')('x/.env')).toBe(true);
        expect(compileGlob(' **/a/ ')('x/a')).toBe(true);
    });

    it('регистр учитывается; ведущий / не совпадает с относительным путём', () => {
        expect(compileGlob('**/README.md')('readme.md')).toBe(false);
        expect(compileGlob('/a')('a')).toBe(false);
    });

    it('false выключает шаблон; when ищет соседа по имени без последнего расширения', () => {
        const exclude = compileExclude({ '**/*.js': { when: '$(basename).ts' }, '**/.vscode': true, '**/keep': false });
        expect(exclude('a/x.js', 'x.js', n => n === 'x.ts')).toBe(true);
        expect(exclude('a/x.js', 'x.js', () => false)).toBe(false);
        expect(exclude('.vscode', '.vscode', () => false)).toBe(true);
        expect(exclude('keep', 'keep', () => false)).toBe(false);
    });
});

describe('М4.14: .gitignore как его читает Explorer', () => {
    it('имя без косой черты действует на любой глубине; строка с / — только на папки; ! возвращает', () => {
        const rules = parseIgnore('# c\nbuild/\n*.log\n!keep.log\n/top.txt\nsub/x.md\n', '/ws');
        expect(rules('/ws/a/build', true)).toBe(true);
        expect(rules('/ws/a/build', false)).toBe(false);
        expect(rules('/ws/a/x.log', false)).toBe(true);
        expect(rules('/ws/keep.log', false)).toBe(false);
        expect(rules('/ws/top.txt', false)).toBe(true);
        expect(rules('/ws/a/top.txt', false)).toBe(false);
        expect(rules('/ws/sub/x.md', false)).toBe(true);
        expect(rules('/other/x.log', false)).toBe(false);
    });

    it('ближайший файл говорит первым, родительский — за ним', () => {
        const rules = composeIgnore([{ dir: '', text: '*.tmp\n' }, { dir: 'work/T', text: 'draft.md\n' }]);
        expect(rules('/work/T/draft.md', false)).toBe(true);
        expect(rules('/work/T/a.tmp', false)).toBe(true);
        expect(rules('/work/draft.md', false)).toBe(false);
    });
});

describe('М2.6, М3.8: что скрыто', () => {
    const tree = snap({ '.': ['.claude/', 'a.md', 'x.js', 'x.ts'], '.claude': ['settings.json', 'other.json'] });
    const exclude = compileExclude({ '**/.claude': true, '**/*.js': { when: '$(basename).ts' } });

    it('скрытая папка скрывает всё под собой; сосед скрывает по условию', () => {
        const hidden = computeHidden(tree, { ...NO_FILTER, exclude });
        expect([...hidden].sort()).toEqual(['.claude', '.claude/other.json', '.claude/settings.json', 'x.js']);
    });

    it('глаз показывает всё', () => {
        expect(computeHidden(tree, { ...NO_FILTER, exclude, showHidden: true }).size).toBe(0);
    });

    it('М3.8/1: файл в видимом редакторе допущен вместе с предками, его соседи — нет', () => {
        const hidden = computeHidden(tree, { ...NO_FILTER, exclude, visibleEditors: ['.claude/settings.json'] });
        expect([...hidden].sort()).toEqual(['.claude/other.json', 'x.js']);
    });

    it('путь судится от корня рабочего пространства, а не от тикета', () => {
        const inTicket = computeHidden(snap({ '.': ['drafts/'], 'drafts': ['a.md'] }),
            { ...NO_FILTER, prefix: 'work/T', exclude: compileExclude({ 'work/T/drafts': true, 'drafts': true }) });
        expect([...inTicket].sort()).toEqual(['drafts', 'drafts/a.md']);
        const rootOnly = computeHidden(snap({ '.': ['drafts/'], 'drafts': [] }),
            { ...NO_FILTER, prefix: 'work/T', exclude: compileExclude({ 'drafts': true }) });
        expect(rootOnly.size).toBe(0);
    });

    it('М4.14: скрытая папка над тикетом скрывает всё дерево', () => {
        const hidden = computeHidden(snap({ '.': ['a.md', 'd/'], 'd': ['b.md'] }),
            { ...NO_FILTER, prefix: 'backlog/T', exclude: compileExclude({ '**/backlog': true }) });
        expect([...hidden].sort()).toEqual(['a.md', 'd', 'd/b.md']);
    });

    it('.gitignore скрывает по настройке, сам файл .gitignore виден', () => {
        const ignored = composeIgnore([{ dir: 'work/T', text: 'out/\n*.log\n' }]);
        const hidden = computeHidden(snap({ '.': ['.gitignore', 'out/', 'a.log', 'a.md'], 'out': ['x'] }),
            { ...NO_FILTER, prefix: 'work/T', ignored });
        expect([...hidden].sort()).toEqual(['a.log', 'out', 'out/x']);
    });
});

describe('Пины: порядок строк папки', () => {
    const present = [file('b.md'), dir('y'), file('INDEX.md'), dir('x'), file('a.md'), file('notepad.md'), dir('10'), dir('2')];
    const order = (folder: string, saved?: { dirs?: string[]; files?: string[] }) => (saved ? { version: 2, folders: { [folder]: saved } } : null);
    const names = (saved?: { dirs?: string[]; files?: string[] }, folder = '.') =>
        mergeOrder(present, pinsOf(order(folder, saved), folder, PINNED)).map(e => e.name);

    it('без записи: папки по алфавиту, затем три изначально закреплённых файла, затем файлы по алфавиту', () => {
        expect(names()).toEqual(['2', '10', 'x', 'y', 'INDEX.md', 'notepad.md', 'a.md', 'b.md']);
    });

    it('три изначальных пина действуют только в корне: в любой другой папке — чистый алфавит', () => {
        expect(names(undefined, 'd')).toEqual(['2', '10', 'x', 'y', 'a.md', 'b.md', 'INDEX.md', 'notepad.md']);
        expect(names({ dirs: ['y'] }, 'd')).toEqual(['y', '2', '10', 'x', 'a.md', 'b.md', 'INDEX.md', 'notepad.md']);
        expect(isPinned(null, 'd', PINNED, 'INDEX.md', false)).toBe(false);
    });

    it('закреплённые папки стоят перед остальными папками, закреплённые файлы — перед остальными файлами, в заданной последовательности', () => {
        expect(names({ dirs: ['y', '10'], files: ['b.md', 'INDEX.md'] })).toEqual(['y', '10', '2', 'x', 'b.md', 'INDEX.md', 'a.md', 'notepad.md']);
    });

    it('папки и файлы не смешиваются: пин говорит только о своём роде', () => {
        expect(names({ dirs: ['a.md'], files: ['x'] })).toEqual(['2', '10', 'x', 'y', 'a.md', 'b.md', 'INDEX.md', 'notepad.md']);
    });

    it('пустой перечень файлов — изначальные пины сняты; имени нет на диске — пин молчит и остаётся', () => {
        expect(names({ files: [] })).toEqual(['2', '10', 'x', 'y', 'a.md', 'b.md', 'INDEX.md', 'notepad.md']);
        expect(names({ files: ['gone.md', 'b.md'] }).slice(4)).toEqual(['b.md', 'a.md', 'INDEX.md', 'notepad.md']);
    });

    it('имя в NFD находит свой пин, записанный в NFC', () => {
        const nfd = 'й.md'.normalize('NFD');
        const saved = order('.', { files: ['й.md'.normalize('NFC')] });
        expect(mergeOrder([file('a.md'), file(nfd)], pinsOf(saved, '.', PINNED)).map(e => e.name)).toEqual([nfd, 'a.md']);
        expect(isPinned(saved, '.', PINNED, nfd, false)).toBe(true);
    });

    it('что закреплено: изначальные три у файлов, у папок — ничего', () => {
        expect(isPinned(null, '.', PINNED, 'INDEX.md', false)).toBe(true);
        expect(isPinned(null, '.', PINNED, 'INDEX.md', true)).toBe(false);
        expect(isPinned(order('.', { dirs: ['d'] }), '.', PINNED, 'notepad.md', false)).toBe(true);
        expect(isPinned(order('.', { files: ['a.md'] }), '.', PINNED, 'INDEX.md', false)).toBe(false);
    });
});

describe('Пины: операции', () => {
    const apply = (folders: Record<string, { dirs?: string[]; files?: string[] }>, ...ops: Parameters<typeof applyOrderOps>[1]) =>
        applyOrderOps({ version: 2, folders }, ops, PINNED).folders;

    it('закрепить: имя встаёт в конец пинов своего рода; перечень файлов выписывается из изначальных', () => {
        expect(apply({}, { kind: 'pin', folder: '.', name: 'a.md', isDir: false })).toEqual({ '.': { files: ['INDEX.md', 'AGENDA.md', 'notepad.md', 'a.md'] } });
        expect(apply({}, { kind: 'pin', folder: '.', name: 'd', isDir: true })).toEqual({ '.': { dirs: ['d'] } });
        expect(apply({ '.': { dirs: ['d'] } }, { kind: 'pin', folder: '.', name: 'd', isDir: true })).toEqual({ '.': { dirs: ['d'] } });
    });

    it('открепить: имя уходит из перечня; папка, вернувшаяся к изначальным пинам, теряет ключ', () => {
        expect(apply({}, { kind: 'unpin', folder: '.', name: 'AGENDA.md', isDir: false })).toEqual({ '.': { files: ['INDEX.md', 'notepad.md'] } });
        expect(apply({ '.': { dirs: ['d'] } }, { kind: 'unpin', folder: '.', name: 'd', isDir: true })).toEqual({});
        expect(apply({ '.': { files: ['INDEX.md', 'AGENDA.md', 'notepad.md', 'a.md'] } }, { kind: 'unpin', folder: '.', name: 'a.md', isDir: false })).toEqual({});
    });

    it('переставить можно только закреплённое рядом с закреплённым того же рода', () => {
        const place = (block: string[], anchor: string, after: boolean) =>
            apply({}, { kind: 'place', folder: '.', isDir: false, block, anchor, after })['.']?.files;
        expect(place(['notepad.md'], 'INDEX.md', false)).toEqual(['notepad.md', 'INDEX.md', 'AGENDA.md']);
        expect(place(['INDEX.md'], 'notepad.md', true)).toEqual(['AGENDA.md', 'notepad.md', 'INDEX.md']);
        expect(place(['INDEX.md', 'notepad.md'], 'AGENDA.md', true)).toEqual(['AGENDA.md', 'INDEX.md', 'notepad.md']);
        // Not pinned — no place: the list stays as it was, and nothing is written
        expect(place(['a.md'], 'INDEX.md', true)).toBeUndefined();
        expect(place(['INDEX.md'], 'a.md', true)).toBeUndefined();
    });

    it('в подпапке изначальных пинов нет: закрепление пишет одно имя, пустой перечень ключа не оставляет', () => {
        expect(apply({}, { kind: 'pin', folder: 'd', name: 'a.md', isDir: false })).toEqual({ 'd': { files: ['a.md'] } });
        expect(apply({ 'd': { files: ['a.md'] } }, { kind: 'unpin', folder: 'd', name: 'a.md', isDir: false })).toEqual({});
        expect(apply({}, { kind: 'rename', folder: 'd', from: 'notepad.md', to: 'n.md' })).toEqual({});
    });

    it('М4.7: сброс возвращает изначальные пины папки и не трогает вложенные', () => {
        expect(apply({ 'd': { dirs: ['x'] }, 'd/e': { files: ['q'] } }, { kind: 'reset', folder: 'd' })).toEqual({ 'd/e': { files: ['q'] } });
    });

    it('переименование через вью: пин идёт за именем — и изначальный тоже; незакреплённое имя ничего не пишет', () => {
        expect(apply({ '.': { dirs: ['d'], files: ['a.md'] } }, { kind: 'rename', folder: '.', from: 'a.md', to: 'c.md' })).toEqual({ '.': { dirs: ['d'], files: ['c.md'] } });
        expect(apply({ '.': { dirs: ['d'] } }, { kind: 'rename', folder: '.', from: 'd', to: 'e' })).toEqual({ '.': { dirs: ['e'] } });
        expect(apply({}, { kind: 'rename', folder: '.', from: 'notepad.md', to: 'n.md' })).toEqual({ '.': { files: ['INDEX.md', 'AGENDA.md', 'n.md'] } });
        expect(apply({}, { kind: 'rename', folder: '.', from: 'a.md', to: 'c.md' })).toEqual({});
    });

    it('папка переехала — её пины и пины вложенных идут за ней; М4.29: копия папки получает её пины', () => {
        const base = { '.': { dirs: ['d'] }, 'd': { files: ['y'] }, 'd/e': { dirs: ['q'] } };
        expect(Object.keys(apply(base, { kind: 'moveFolder', from: 'd', to: 'z/d' })).sort()).toEqual(['.', 'z/d', 'z/d/e']);
        const copied = apply(base, { kind: 'copyFolder', from: 'd', to: 'd copy01' });
        expect(copied['d copy01']).toEqual({ files: ['y'] });
        expect(copied['d copy01/e']).toEqual({ dirs: ['q'] });
        expect(copied['d']).toEqual({ files: ['y'] });
    });
});

describe('М2.8, М4.27: файл порядка', () => {
    const FILE = '/b/.vscode/duet-work-order/DUE001.json';

    it('разбор: свой, испорченный, более новый; свободная расстановка прежней версии не читается', () => {
        expect(parseOrder('{"version":2,"folders":{".":{"files":["a","a","b"],"dirs":["d"]}}}'))
            .toEqual({ state: 'ok', file: { version: 2, folders: { '.': { dirs: ['d'], files: ['a', 'b'] } } } });
        expect(parseOrder('{"version":1,"folders":{".":["b.md","a.md"]}}')).toEqual({ state: 'ok', file: { version: 2, folders: {} } });
        expect(parseOrder('').state).toBe('corrupt');
        expect(parseOrder('{"version":2').state).toBe('corrupt');
        expect(parseOrder('[]').state).toBe('corrupt');
        const newer = parseOrder('{"version":3,"folders":{".":{"dirs":["a"]}}}');
        expect(newer.state).toBe('newer');
        expect(newer.state === 'newer' && newer.file?.folders['.']).toEqual({ dirs: ['a'] });
    });

    it('текст детерминирован: ключи папок по порядку, неизвестные поля целы', () => {
        const text = serializeOrder({ version: 2, folders: { 'b': { dirs: ['x'] }, '.': { dirs: ['y'] } }, note: 'keep' });
        expect(JSON.parse(text)).toEqual({ version: 2, folders: { '.': { dirs: ['y'] }, 'b': { dirs: ['x'] } }, note: 'keep' });
        expect(text.indexOf('"."')).toBeLessThan(text.indexOf('"b"'));
        expect(text.endsWith('}\n')).toBe(true);
    });

    it('файла нет — пинов нет; запись создаёт папку и пишет одной записью на месте', async () => {
        const mem = createMemFs({}, ['/b']);
        expect(await readOrder(mem.fs, FILE)).toEqual({ state: 'none' });
        const result = await changeOrder(mem.fs, FILE, [{ kind: 'pin', folder: '.', name: 'd', isDir: true }], PINNED);
        expect(result.ok && result.written).toBe(true);
        expect(JSON.parse(mem.files.get(FILE)!)).toEqual({ version: 2, folders: { '.': { dirs: ['d'] } } });
        expect(mem.calls.writeFile).toBe(1);
        expect(mem.calls.atomicWriteFile).toBe(0);
    });

    it('операция применяется к свежему чтению и меняет только свои ключи', async () => {
        const mem = createMemFs({ [FILE]: '{"version":2,"folders":{"other":{"dirs":["x"]},".":{"dirs":["a","b"]}}}' });
        await changeOrder(mem.fs, FILE, [{ kind: 'unpin', folder: '.', name: 'a', isDir: true }], PINNED);
        expect(JSON.parse(mem.files.get(FILE)!).folders).toEqual({ '.': { dirs: ['b'] }, 'other': { dirs: ['x'] } });
    });

    it('ничего не изменилось — файл не пишется; сброс без файла файла не создаёт', async () => {
        const mem = createMemFs({ [FILE]: serializeOrder({ version: 2, folders: { '.': { dirs: ['a'] } } }) });
        expect(await changeOrder(mem.fs, FILE, [{ kind: 'unpin', folder: '.', name: 'zzz', isDir: true }], PINNED)).toMatchObject({ ok: true, written: false });
        const none = createMemFs({}, ['/b']);
        expect(await changeOrder(none.fs, FILE, [{ kind: 'reset', folder: '.' }], PINNED)).toMatchObject({ ok: true, written: false });
        expect(none.files.has(FILE)).toBe(false);
    });

    it('файл прежней версии заменяется при первом закреплении', async () => {
        const mem = createMemFs({ [FILE]: '{"version":1,"folders":{".":["b.md","a.md"]}}' });
        await changeOrder(mem.fs, FILE, [{ kind: 'pin', folder: '.', name: 'd', isDir: true }], PINNED);
        expect(JSON.parse(mem.files.get(FILE)!)).toEqual({ version: 2, folders: { '.': { dirs: ['d'] } } });
    });

    it('нечитаемый и более новый файл не перезаписываются — отказ с причиной', async () => {
        for (const text of ['{oops', '{"version":9,"folders":{}}']) {
            const mem = createMemFs({ [FILE]: text });
            const result = await changeOrder(mem.fs, FILE, [{ kind: 'reset', folder: '.' }], PINNED);
            expect(result.ok).toBe(false);
            expect(mem.files.get(FILE)).toBe(text);
        }
    });
});

describe('М2.8, М4.30: снимок папки', () => {
    const options = { system: 'linux' as const, join: (root: string, rel: string) => `${root}/${rel}`, timeoutMs: 1000 };

    it('читает дерево целиком', async () => {
        const disk = createMemDisk({ '/t/INDEX.md': '', '/t/d/a.md': '', '/t/d/e/b.md': '' });
        const snapshot = await readSnapshot(disk.fs, '/t', options);
        expect([...snapshot.dirs.keys()].sort()).toEqual(['.', 'd', 'd/e']);
        expect(snapshot.dirs.get('d')).toEqual({ state: 'ok', entries: [{ name: 'e', kind: 'dir' }, { name: 'a.md', kind: 'file' }] });
    });

    it('корень не читается — ошибка; вложенная папка не читается — ошибка в её листинге', async () => {
        const disk = createMemDisk({ '/t/d/a.md': '' });
        disk.failing.add('/t/d');
        expect((await readSnapshot(disk.fs, '/t', options)).dirs.get('d')).toMatchObject({ state: 'error' });
        disk.failing.add('/t');
        await expect(readSnapshot(disk.fs, '/t', options)).rejects.toThrow();
    });

    it('на macOS имена приводятся к NFC', async () => {
        const nfd = 'й.md'.normalize('NFD');
        const disk = createMemDisk({ [`/t/${nfd}`]: '' });
        const snapshot = await readSnapshot(disk.fs, '/t', { ...options, system: 'darwin' });
        expect(snapshot.dirs.get('.')).toMatchObject({ entries: [{ name: 'й.md'.normalize('NFC') }] });
        const asIs = await readSnapshot(disk.fs, '/t', options);
        expect(asIs.dirs.get('.')).toMatchObject({ entries: [{ name: nfd }] });
    });

    it('ссылки: на файл, на папку внутри, наружу, на свою папку', async () => {
        const disk = createMemDisk({ '/t/a.md': '', '/t/d/b.md': '', '/out/c.md': '' });
        disk.links.set('/t/toFile', '/t/a.md');
        disk.links.set('/t/toDir', '/t/d');
        disk.links.set('/t/toOut', '/out');
        disk.links.set('/t/d/toUp', '/t');
        const snapshot = await readSnapshot(disk.fs, '/t', options);
        const root = snapshot.dirs.get('.');
        expect(root?.state === 'ok' && root.entries.map(e => [e.name, e.kind, e.link])).toEqual([
            ['d', 'dir', undefined], ['a.md', 'file', undefined],
            ['toDir', 'dir', 'dir'], ['toFile', 'file', 'file'], ['toOut', 'dir', 'outside']
        ]);
        expect(snapshot.dirs.get('toOut')).toEqual({ state: 'limit', reason: LINK_OUTSIDE });
        expect(snapshot.dirs.get('d/toUp')).toEqual({ state: 'limit', reason: LINK_CYCLE });
        expect(snapshot.dirs.get('toDir')).toMatchObject({ state: 'ok' });
    });

    it('T19: перечитывание находит изменившиеся папки, читает новые вглубь и забывает ушедшие', async () => {
        const disk = createMemDisk({ '/t/a.md': '', '/t/d/b.md': '' });
        const first = await readSnapshot(disk.fs, '/t', options);
        disk.files.set('/t/n/deep/x.md', '');
        disk.files.delete('/t/d/b.md');
        disk.dirs.delete('/t/d');
        const { snapshot, changed } = await rereadFolders(disk.fs, '/t', first, ['.'], options);
        expect(changed).toEqual(['.']);
        expect([...snapshot.dirs.keys()].sort()).toEqual(['.', 'n', 'n/deep']);
        expect((await rereadFolders(disk.fs, '/t', snapshot, ['.', 'n'], options)).changed).toEqual([]);
    });

    it('событие указывает папку-родителя или ближайшую известную папку над ним', () => {
        const snapshot = snap({ '.': ['d/'], 'd': [] });
        expect(foldersToReread(['d/a.md', 'd/new/deep/x.md', 'top.md'], snapshot).sort()).toEqual(['.', 'd']);
    });
});

describe('М1.5, М2.8, М4.23: строки', () => {
    const context = { snapshot: snap({ '.': ['d/', 'e/', 'a.md'], 'd': ['.x'], 'e': ['b.md'] }), hidden: new Set(['d/.x']), order: null, pinned: PINNED };

    it('корень пустого тикета не получает пустой строки', () => {
        expect(childRows({ ...context, snapshot: snap({ '.': [] }) }, '.')).toEqual([]);
    });

    it('раскрытая папка без видимых детей отдаёт пустую строку — и когда в ней лежат скрытые файлы', () => {
        expect(childRows(context, 'd')).toEqual([{ kind: 'empty', parent: 'd' }]);
    });

    it('ошибка чтения — строка с причиной, а не пустая папка; непрочитанная папка строк не отдаёт', () => {
        const dirs = new Map(context.snapshot.dirs);
        dirs.set('e', { state: 'error', reason: 'нет доступа' });
        dirs.delete('d');
        expect(childRows({ ...context, snapshot: { dirs } }, 'e')).toEqual([{ kind: 'note', parent: 'e', text: 'нет доступа' }]);
        expect(childRows({ ...context, snapshot: { dirs } }, 'd')).toEqual([]);
    });

    it('экранный порядок: строки папки идут за ней, пока она раскрыта', () => {
        const names = (rows: Row[]) => rows.map(r => (r.kind === 'empty' ? '(пусто)' : r.kind === 'note' ? '(!)' : r.path));
        expect(names(screenRows(context, new Set(['e'])))).toEqual(['d', 'e', 'e/b.md', 'a.md']);
        expect(names(screenRows(context, new Set(['d', 'e'])))).toEqual(['d', '(пусто)', 'e', 'e/b.md', 'a.md']);
    });
});

describe('М2.2, М3.5, М3.6, М4.3, М4.4: раскрытие', () => {
    const admitted = ['A', 'A/x', 'A/x/y', 'B', 'B/y', 'C'];

    it('видимо раскрыта папка, у которой раскрыты все папки над ней', () => {
        expect(visiblyExpanded(new Set(['A/x', 'B']), admitted)).toEqual(['B']);
        expect(visiblyExpanded(new Set(['A', 'A/x', 'hidden']), admitted)).toEqual(['A', 'A/x']);
    });

    it('«раскрыть всё» добавляет допущенные папки; скрытые в наборе остаются', () => {
        expect([...expandAll(new Set(['hidden']), admitted)].sort()).toEqual([...admitted, 'hidden'].sort());
    });

    it('«раскрыть на N» ставит ровно глубину N, какие бы ветки ни были открыты', () => {
        expect([...expandToLevel(new Set(['A/x/y', 'hidden']), admitted, 1)].sort()).toEqual(['A', 'B', 'C', 'hidden']);
        expect([...expandToLevel(new Set(), admitted, 2)].sort()).toEqual(['A', 'A/x', 'B', 'B/y', 'C']);
    });

    it('М4.4: «свернуть на один уровень» закрывает только самый глубокий видимый уровень', () => {
        expect([...collapseDeepestLevel(new Set(['A', 'A/x', 'A/x/y', 'B']), admitted)].sort()).toEqual(['A', 'A/x', 'B']);
        expect([...collapseDeepestLevel(new Set(['A', 'B', 'C/deep']), admitted)].sort()).toEqual(['C/deep']);
        expect([...collapseDeepestLevel(new Set(), admitted)]).toEqual([]);
    });

    it('М4.3: раскрытие верхней папки при границе 2 закрывает чужие подпапки, верхние остаются', () => {
        expect([...oneAtATime(new Set(['A', 'A/x', 'B', 'B/y', 'C']), 'C', 2)].sort()).toEqual(['A', 'B', 'C']);
    });

    it('правило закрывает и запомненных потомков раскрываемой папки, а её предков оставляет', () => {
        expect([...oneAtATime(new Set(['A', 'A/x', 'A/x/y', 'B', 'B/y']), 'A/x', 2)].sort()).toEqual(['A', 'A/x', 'B']);
        expect([...oneAtATime(new Set(['A', 'A/x', 'B']), 'B', 1)].sort()).toEqual(['B']);
    });

    it('М3.7/1: ветка при включении — у строки под рамкой, затем последняя раскрывавшаяся, затем первая по экрану', () => {
        const open = new Set(['A', 'A/x', 'B', 'B/y']);
        expect(pickBranch(open, admitted, 'B/y', 'A/x', 2)).toBe('B/y');
        expect(pickBranch(open, admitted, 'A/x/y', null, 2)).toBe('A/x');
        expect(pickBranch(open, admitted, 'C', 'B/y', 2)).toBe('B/y');
        expect(pickBranch(open, admitted, null, 'C', 2)).toBe('A/x');
        expect(pickBranch(new Set(['A']), admitted, 'A', null, 2)).toBeNull();
    });

    it('М2.4: показ файла раскрывает путь, при правиле — в одной ветке', () => {
        expect([...revealPath(new Set(['B', 'B/y']), 'A/x/f.md', null)].sort()).toEqual(['A', 'A/x', 'B', 'B/y']);
        expect([...revealPath(new Set(['B', 'B/y']), 'A/x/f.md', 2)].sort()).toEqual(['A', 'A/x', 'B']);
        expect([...revealPath(new Set(['B', 'B/y']), 'top.md', 2)].sort()).toEqual(['B']);
    });
});

describe('М1.10, М3.10, М4.22, М4.23: бросок', () => {
    const context = {
        snapshot: snap({ '.': ['d/', 'e/', 'a.md', 'b.md', 'c.md'], 'd': ['x.md', 'y.md'], 'e': [] }),
        hidden: new Set<string>(), order: null, pinned: PINNED
    };
    const rows = screenRows(context, new Set(['d', 'e']));
    const row = (p: string) => rows.find(r => (r.kind === 'file' || r.kind === 'dir') && r.path === p)!;
    const emptyOf = (folder: string) => rows.find(r => r.kind === 'empty' && r.parent === folder)!;
    const base = { rows, isTaken: () => false, exists: () => true, system: 'darwin' as const };

    it('T40: тащили вниз — после цели, вверх — перед ней', () => {
        expect(resolveDrop({ ...base, dragged: ['a.md'], target: row('c.md') })).toMatchObject({ kind: 'apply', folder: '.', anchor: 'c.md', after: true, moves: [] });
        expect(resolveDrop({ ...base, dragged: ['c.md'], target: row('a.md') })).toMatchObject({ kind: 'apply', anchor: 'a.md', after: false, moves: [] });
    });

    it('T35, T36: строка папки, свёрнутой или раскрытой, значит «рядом с ней», а не внутрь', () => {
        expect(resolveDrop({ ...base, dragged: ['c.md'], target: row('d') })).toMatchObject({ kind: 'apply', folder: '.', anchor: 'd', after: false, moves: [] });
    });

    it('T37: внутрь попадают броском на строку внутри; М4.23: файл на строку своей папки выходит наружу', () => {
        expect(resolveDrop({ ...base, dragged: ['a.md'], target: row('d/x.md') })).toMatchObject({
            kind: 'apply', folder: 'd', anchor: 'x.md', after: false, moves: [{ from: 'a.md', to: 'd/a.md', isDir: false }]
        });
        expect(resolveDrop({ ...base, dragged: ['d/y.md'], target: row('d') })).toMatchObject({
            kind: 'apply', folder: '.', anchor: 'd', after: false, moves: [{ from: 'd/y.md', to: 'y.md' }]
        });
    });

    it('T38: пустая строка — в её папку; ниже строк — в конец корня', () => {
        expect(resolveDrop({ ...base, dragged: ['a.md'], target: emptyOf('e') })).toMatchObject({ kind: 'apply', folder: 'e', anchor: null, via: 'empty' });
        expect(resolveDrop({ ...base, dragged: ['d/x.md'], target: undefined })).toMatchObject({ kind: 'apply', folder: '.', anchor: null, via: 'end', moves: [{ to: 'x.md' }] });
    });

    it('блок в экранном порядке, направление — от верхней строки; потомок выбранной папки едет в ней', () => {
        const plan = resolveDrop({ ...base, dragged: ['c.md', 'a.md', 'd', 'd/x.md'], target: row('b.md') });
        expect(plan.kind === 'apply' && plan.block.map(r => r.path)).toEqual(['d', 'a.md', 'c.md']);
        expect(plan).toMatchObject({ after: true });
    });

    it('бросок на строку блока ничего не делает; папка внутрь себя — отказ всего набора', () => {
        expect(resolveDrop({ ...base, dragged: ['a.md', 'b.md'], target: row('b.md') })).toEqual({ kind: 'none' });
        expect(resolveDrop({ ...base, dragged: ['d', 'd/x.md'], target: row('d/x.md') })).toEqual({ kind: 'none' });
        expect(resolveDrop({ ...base, dragged: ['d', 'a.md'], target: row('d/x.md') }).kind).toBe('refuse');
        expect(resolveDrop({ ...base, dragged: ['d'], target: emptyOf('e') }).kind).toBe('apply');
        const nested = { ...context, snapshot: snap({ '.': ['d/'], 'd': ['in/'], 'd/in': ['f.md'] }) };
        const nestedRows = screenRows(nested, new Set(['d', 'd/in']));
        expect(resolveDrop({ ...base, rows: nestedRows, dragged: ['d'], target: nestedRows[2] }))
            .toEqual({ kind: 'refuse', say: 'Папка не переносится внутрь самой себя.' });
    });

    it('М4.22: занятое имя, считая скрытые, и одинаковые имена в блоке отклоняют весь бросок', () => {
        expect(resolveDrop({ ...base, dragged: ['a.md'], target: row('d/x.md'), isTaken: (f, n) => f === 'd' && n === 'a.md' }))
            .toEqual({ kind: 'refuse', say: 'В d/ уже есть a.md — ничего не перенесено.' });
        const twin = { ...context, snapshot: snap({ '.': ['d/', 'e/', 'x.md'], 'd': ['x.md'], 'e': [] }) };
        const twinRows = screenRows(twin, new Set(['d', 'e']));
        expect(resolveDrop({ ...base, rows: twinRows, dragged: ['x.md', 'd/x.md'], target: twinRows.find(r => r.kind === 'empty') }).kind).toBe('refuse');
    });

    it('М4.31: исчезнувшая строка или цель — отказ, ближайшая строка её не заменяет', () => {
        expect(resolveDrop({ ...base, dragged: ['a.md'], target: row('c.md'), exists: p => p !== 'a.md' }))
            .toEqual({ kind: 'refuse', say: 'Дерево изменилось: a.md больше нет.' });
        expect(resolveDrop({ ...base, dragged: ['a.md'], target: row('c.md'), exists: p => p !== 'c.md' }).kind).toBe('refuse');
    });

    it('строка ошибки бросков не принимает', () => {
        expect(resolveDrop({ ...base, dragged: ['a.md'], target: { kind: 'note', parent: 'd', text: '!' } })).toEqual({ kind: 'none' });
    });

    it('М4.8: импорт на строку папки — рядом с ней; занятое имя — отказ без замены', () => {
        expect(resolveImport({ target: row('d'), names: ['n.md'], isTaken: () => false, system: 'darwin' }))
            .toEqual({ kind: 'apply', folder: '.', anchor: 'd', via: 'row' });
        expect(resolveImport({ target: undefined, names: ['n.md'], isTaken: () => false, system: 'darwin' }))
            .toEqual({ kind: 'apply', folder: '.', anchor: null, via: 'end' });
        expect(resolveImport({ target: row('d/x.md'), names: ['n.md'], isTaken: () => true, system: 'darwin' }).kind).toBe('refuse');
    });

    it('T43: одна строка на перенос', () => {
        expect(moveLine('drafts', ['plan.md'])).toBe('Перенесено в drafts/: plan.md.');
        expect(moveLine('.', ['a.md', 'b.md', 'c.md'])).toBe('Перенесено в корень тикета: a.md и ещё 2.');
    });
});

describe('М1.5, М4.32: цель команды и рамка после удаления', () => {
    const context = { snapshot: snap({ '.': ['d/', 'a.md', 'b.md', 'c.md'], 'd': ['x.md'] }), hidden: new Set<string>(), order: null, pinned: PINNED };
    const rows = screenRows(context, new Set(['d']));
    const row = (p: string) => rows.find(r => (r.kind === 'file' || r.kind === 'dir') && r.path === p)!;
    const empty: Row = { kind: 'empty', parent: 'q' };

    it('внутри выделения — весь набор, вне — только нажатая строка', () => {
        const selection = [row('a.md'), row('b.md')];
        expect(commandTargets(row('a.md'), undefined, selection).map(r => r.path)).toEqual(['a.md', 'b.md']);
        expect(commandTargets(row('c.md'), undefined, selection).map(r => r.path)).toEqual(['c.md']);
        expect(commandTargets(row('a.md'), selection, []).map(r => r.path)).toEqual(['a.md', 'b.md']);
        expect(commandTargets(undefined, undefined, selection).map(r => r.path)).toEqual(['a.md', 'b.md']);
    });

    it('пустая строка отбрасывается; если настоящих не осталось — набор пуст', () => {
        expect(commandTargets(row('a.md'), [row('a.md'), empty], []).map(r => r.path)).toEqual(['a.md']);
        expect(commandTargets(empty, undefined, [])).toEqual([]);
    });

    it('потомок выбранной папки отдельно не берётся', () => {
        expect(commandTargets(row('d'), [row('d'), row('d/x.md'), row('a.md')], [], true).map(r => r.path)).toEqual(['d', 'a.md']);
    });

    it('после удаления: следующая, затем предыдущая, затем родитель; в пустом корне — ничего', () => {
        expect(afterDeleteFocus(rows, ['a.md'])?.path).toBe('b.md');
        expect(afterDeleteFocus(rows, ['b.md', 'c.md'])?.path).toBe('a.md');
        expect(afterDeleteFocus(rows, ['d/x.md'])?.path).toBe('d');
        expect(afterDeleteFocus(rows, ['d', 'a.md', 'b.md', 'c.md'])).toBeNull();
    });
});

describe('М3.3, М3.6: доступность', () => {
    const facts: ViewFacts = {
        hasTicket: true, ready: true, busy: false, hasViewState: true, showHidden: false, followEditor: false,
        plusDepth: '1', oneFolder: false, oneFolderLevel: 2, hasFolders: true, hasExpanded: false, anyExpanded: false,
        rootManual: false, orderLocked: false
    };

    it('без галочки ничего не блокируется', () => {
        expect(availability(facts)).toMatchObject({ block1: false, block2: false, blockAll: false, blockDepth: false });
    });

    it('М3.6: при галочке «раскрыть всё» блокируется всегда, глубина — когда достигает границы', () => {
        expect(availability({ ...facts, oneFolder: true, oneFolderLevel: 2 })).toMatchObject({ block1: false, block2: true, blockAll: true, blockDepth: false });
        expect(availability({ ...facts, oneFolder: true, oneFolderLevel: 3 })).toMatchObject({ block1: false, block2: false, blockAll: true });
        expect(availability({ ...facts, oneFolder: true, oneFolderLevel: 1 })).toMatchObject({ block1: true, block2: true, blockAll: true, blockDepth: true });
    });

    it('М1.4: несовместимая выбранная глубина блокирует плюс и не меняется', () => {
        expect(availability({ ...facts, oneFolder: true, plusDepth: 'all' })).toMatchObject({ depth: 'all', blockDepth: true });
        expect(availability({ ...facts, oneFolder: true, plusDepth: '2' })).toMatchObject({ depth: '2', blockDepth: true });
    });

    it('М3.3: без тикета настройки окна остаются, всё остальное недоступно', () => {
        expect(availability({ ...facts, hasTicket: false, showHidden: true, followEditor: true, oneFolder: true, anyExpanded: true }))
            .toMatchObject({ showHidden: true, followEditor: true, ready: false, hasViewState: false, hasFolders: false, anyExpanded: false, oneFolder: false, blockAll: false });
    });
});
