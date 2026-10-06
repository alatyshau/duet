/* eslint-disable @typescript-eslint/naming-convention */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('vscode', async () => (await import('./helpers/fakeVscode')).fakeVscode);

import { fake, resetFake, FakeTreeView, FakeUri } from './helpers/fakeVscode';
import { MemDisk, asFileSystem, createMemDisk } from './helpers/memDisk';
import { Paths } from '../../core/paths';
import { WorkView } from '../../vscode/work/WorkView';
import { WorkActions } from '../../vscode/work/workCommands';

const B = '/drive/Lab';
const T = `${B}/work/DUE018_WorkView`;
const OTHER = `${B}/work/DUE017_Switcher`;
const ORDER = `${B}/.vscode/duet-work-order/DUE018.json`;
const VIEW = '/data/views/work/tickets/Lab/DUE018.json';
const WINDOW = '/data/views/work/windows/vscode/DUE018.json';

const TICKET = {
    [`${T}/INDEX.md`]: '', [`${T}/notepad.md`]: '', [`${T}/b.md`]: '', [`${T}/a.md`]: '',
    [`${T}/01_Дизайн/x.md`]: '', [`${T}/01_Дизайн/y.md`]: '', [`${T}/01_Дизайн/Экспертиза/1.md`]: '',
    [`${T}/02_Модель/Модель.md`]: '',
    [`${OTHER}/INDEX.md`]: '', [`${OTHER}/drafts/plan.md`]: ''
};

interface Opened { disk: MemDisk; fs: ReturnType<typeof asFileSystem>; view: WorkView; actions: WorkActions; tree: FakeTreeView; fired: Array<string | undefined> }

async function open(files: Record<string, string> = TICKET, own: 'intent' | 'business' | null = 'intent', dirs: string[] = []): Promise<Opened> {
    const disk = createMemDisk(files, dirs);
    const fs = asFileSystem(disk);
    const runtime = {
        own: own === null ? null : {
            subject: own, key: own === 'intent' ? 'DUE018' : '@Lab', ticketFolder: own === 'intent' ? 'DUE018_WorkView' : '',
            businessDir: 'Lab', businessPath: B, workspaceFile: '/w.code-workspace'
        }
    };
    const context = {
        workspaceState: {
            get: (key: string) => fake.workspaceState.get(key),
            update: async (key: string, value: unknown) => { fake.workspaceState.set(key, value); }
        }
    };
    const view = new WorkView(context as never, runtime as never, new Paths('/data'), { disk: disk.ops, snapshotFs: disk.fs, fs });
    const actions = new WorkActions(view);
    view.dropHandler = actions;
    const fired: Array<string | undefined> = [];
    view.onDidChangeTreeData(element => { fired.push(element as string | undefined); });
    await view.start();
    return { disk, fs, view, actions, tree: fake.trees.get('duet.work') as FakeTreeView, fired };
}

const el = (kind: 'f' | 'd' | 'e', rel: string, number = 'DUE018') => `${number}|${kind}|${rel}`;
/** The rows right inside a folder, as the tree is given them. */
const names = (view: WorkView, folder?: string) => view.getChildren(folder).map(e => e.split('|').slice(1).join('|'));
const ticketNode = (number: string, folderPath: string) => ({ kind: 'ticket', key: number, ticket: { number, path: folderPath }, children: [] });

function transfer() {
    const items = new Map<string, { value: unknown; asFile: () => unknown; asString: () => Promise<string> }>();
    return {
        set: (mime: string, item: never) => { items.set(mime, item); },
        get: (mime: string) => items.get(mime),
        forEach: (fn: (item: never, mime: string) => void) => items.forEach((item, mime) => fn(item as never, mime))
    };
}
/** Begin a drag of rows; returns what to drop and how to cancel. */
function drag(view: WorkView, elements: string[]) {
    const data = transfer();
    let cancel = () => undefined as void;
    view.handleDrag(elements, data as never, { onCancellationRequested: (l: () => void) => { cancel = l; return { dispose: () => undefined }; } } as never);
    return { data, cancel: () => cancel() };
}
async function dragDrop(view: WorkView, elements: string[], target: string | undefined): Promise<void> {
    const { data } = drag(view, elements);
    await view.handleDrop(target, data as never);
}
/** Answer the name box that is open now. */
async function typeName(name: string): Promise<void> {
    await vi.waitFor(() => expect(fake.inputBoxes.at(-1)?.shown).toBe(true));
    const box = fake.inputBoxes.at(-1)!;
    box.type(name);
    box.enter();
}

beforeEach(() => { resetFake(); });
afterEach(() => { vi.useRealTimers(); });

describe('М1.1, М2.1: что показано при запуске', () => {
    it('окно тикета: заголовок с номером, сразу файлы и папки — корневой строки нет', async () => {
        const { view, tree } = await open();
        expect(tree.title).toBe('Рабочая папка DUE018');
        expect(tree.description).toBe('');
        expect(tree.message).toBeUndefined();
        expect(names(view)).toEqual(['d|01_Дизайн', 'd|02_Модель', 'f|INDEX.md', 'f|notepad.md', 'f|a.md', 'f|b.md']);
        expect(tree.options).toMatchObject({ canSelectMany: true, showCollapseAll: false });
    });

    it('М4.2: окно бизнеса — пусто, без текста; окно, которое Duet не открывал, — тоже', async () => {
        for (const own of ['business', null] as const) {
            resetFake();
            const { view, tree } = await open(TICKET, own);
            expect(tree.title).toBe('Рабочая папка');
            expect(tree.message).toBeUndefined();
            expect(names(view)).toEqual([]);
            expect(fake.contexts['duet.work.ready']).toBe(false);
        }
    });

    it('папка тикета окна не найдена — номер в заголовке, причина названа, строк нет', async () => {
        const { view, tree } = await open({ [`${OTHER}/INDEX.md`]: '' });
        expect(tree.title).toBe('Рабочая папка DUE018');
        expect(tree.description).toBe('папка не найдена');
        expect(tree.message).toBe('Папка тикета DUE018 не найдена.');
        expect(names(view)).toEqual([]);
    });

    it('папка не читается — ошибка названа сообщением, а не пустотой', async () => {
        const disk = createMemDisk(TICKET);
        disk.failing.add(T);
        const view = new WorkView({ workspaceState: { get: () => undefined, update: async () => undefined } } as never,
            { own: { subject: 'intent', key: 'DUE018', ticketFolder: 'DUE018_WorkView', businessPath: B } } as never,
            new Paths('/data'), { disk: disk.ops, snapshotFs: disk.fs, fs: asFileSystem(disk) });
        await view.start();
        expect(fake.trees.get('duet.work')?.message).toBe('Папка не прочитана: папка не читается');
        expect(view.getChildren()).toEqual([]);
        expect(fake.contexts['duet.work.ready']).toBe(false);
    });
});

describe('T18, T57: строки дерева', () => {
    it('файл: адрес для значка и команда открытия ровно с одним аргументом', async () => {
        const { view } = await open();
        const item = view.getTreeItem(el('f', 'a.md')) as unknown as { resourceUri: FakeUri; command: { command: string; arguments: unknown[] }; contextValue: string; collapsibleState: number };
        expect(item.resourceUri.fsPath).toBe(`${T}/a.md`);
        expect(item.command.command).toBe('vscode.open');
        expect(item.command.arguments).toHaveLength(1);
        expect(item.contextValue).toBe('file');
        expect(item.collapsibleState).toBe(0);
    });

    it('папка: без команды, свёрнута при первом показе, слово состояния для меню', async () => {
        const { view } = await open();
        const item = view.getTreeItem(el('d', '01_Дизайн')) as unknown as { command?: unknown; contextValue: string; collapsibleState: number; id: string };
        expect(item.command).toBeUndefined();
        expect(item.collapsibleState).toBe(1);
        expect(item.contextValue).toBe('folder.closed');
        expect(item.id).toMatch(/^\d+\|DUE018\|d\|0\|01_Дизайн$/);
    });

    it('М4.23: раскрытая папка без видимых детей отдаёт пустую строку без меню и адреса', async () => {
        const { view } = await open({ [`${T}/INDEX.md`]: '' }, 'intent', [`${T}/пусто`]);
        expect(names(view, el('d', 'пусто'))).toEqual(['e|пусто']);
        const item = view.getTreeItem(el('e', 'пусто')) as unknown as { label: string; contextValue: string; resourceUri?: unknown; command?: unknown };
        expect(item).toMatchObject({ label: '', contextValue: 'empty' });
        expect(item.resourceUri).toBeUndefined();
        expect(item.command).toBeUndefined();
    });

    it('строка другого тикета и чужая строка не принимаются за строку показанного', async () => {
        const { view } = await open();
        expect(view.rowOf(el('f', 'INDEX.md', 'DUE017'))).toBeUndefined();
        expect(view.rowOf(el('f', 'нет.md'))).toBeUndefined();
        expect(view.rowOf({ $treeViewId: 'duet.work', $focusedTreeItem: true })).toBeUndefined();
    });
});

describe('T48, М2.3: раскрытое запоминается по тикету', () => {
    it('вид возвращается из файла; возврат записи не вызывает', async () => {
        const { view, fs } = await open({ ...TICKET, [VIEW]: '{"version":1,"expanded":["01_Дизайн"],"oneFolder":true,"oneFolderFromLevel":3}' });
        expect((view.getTreeItem(el('d', '01_Дизайн')) as unknown as { collapsibleState: number }).collapsibleState).toBe(2);
        expect(view.tree.oneFolder).toBe(true);
        expect(view.tree.oneFolderLevel).toBe(3);
        expect(fake.contexts['duet.work.oneFolderLevel']).toBe('3');
        await view.flushView();
        expect(fs.writes).toEqual([]);
    });

    it('раскрытие рукой пишется в файл вида с задержкой, а не на каждое событие', async () => {
        vi.useFakeTimers();
        const { tree, disk } = await open();
        tree.expand.fire({ element: el('d', '01_Дизайн') });
        tree.expand.fire({ element: el('d', '02_Модель') });
        expect(disk.files.has(VIEW)).toBe(false);
        await vi.advanceTimersByTimeAsync(600);
        expect(JSON.parse(disk.files.get(VIEW)!)).toEqual({ version: 1, expanded: ['01_Дизайн', '02_Модель'], oneFolder: false, oneFolderFromLevel: 2 });
    });

    it('несохранённое дописывается синхронно при закрытии окна и перед уходом с тикета', async () => {
        const { view, tree, disk } = await open();
        tree.expand.fire({ element: el('d', '02_Модель') });
        await view.selectFromBin(ticketNode('DUE017', OTHER));
        expect(JSON.parse(disk.files.get(VIEW)!).expanded).toEqual(['02_Модель']);
    });

    it('T20: файл появился на диске — дерево обновилось, ничего не раскрылось', async () => {
        vi.useFakeTimers();
        const { view, disk, fired } = await open();
        disk.files.set(`${T}/01_Дизайн/new.md`, '');
        fired.length = 0;
        fake.watchers[0].create.fire({ scheme: 'file', fsPath: `${T}/01_Дизайн/new.md`, path: '', toString: () => '' });
        await vi.advanceTimersByTimeAsync(400);
        expect(names(view, el('d', '01_Дизайн'))).toContain('f|01_Дизайн/new.md');
        expect([...view.tree.expanded]).toEqual([]);
        expect(fired).toEqual([el('d', '01_Дизайн')]);
    });

    it('событие, ничего не изменившее в папке, дерева не трогает', async () => {
        vi.useFakeTimers();
        const { fired } = await open();
        fired.length = 0;
        fake.watchers[0].change.fire({ scheme: 'file', fsPath: `${T}/a.md`, path: '', toString: () => '' });
        await vi.advanceTimersByTimeAsync(400);
        expect(fired).toEqual([]);
    });
});

describe('М1.2, М3.6: кнопки шапки и доступность', () => {
    it('минус-плюс: плюс раскрывает до выбранной глубины, минус сворачивает всё', async () => {
        const { view } = await open();
        expect(fake.contexts['duet.work.hasExpanded']).toBe(false);
        view.smartToggle();
        expect([...view.tree.expanded].sort()).toEqual(['01_Дизайн', '02_Модель']);
        expect(fake.contexts['duet.work.hasExpanded']).toBe(true);
        view.smartToggle();
        expect([...view.tree.expanded]).toEqual([]);
    });

    it('М1.4: смена глубины плюса пишет настройку окна и не трогает дерево', async () => {
        const { view, disk, fired } = await open();
        fired.length = 0;
        await view.setDepth('2');
        expect(JSON.parse(disk.files.get(WINDOW)!)).toMatchObject({ plusDepth: '2' });
        expect(fake.contexts['duet.work.depth']).toBe('2');
        expect(fired).toEqual([]);
        view.smartToggle();
        expect([...view.tree.expanded].sort()).toEqual(['01_Дизайн', '01_Дизайн/Экспертиза', '02_Модель']);
    });

    it('М3.6: при галочке «раскрыть всё» недоступно и ничего не делает; несовместимый плюс заблокирован', async () => {
        const { view } = await open();
        await view.setRule(true, null, undefined);
        expect(fake.contexts).toMatchObject({ 'duet.work.oneFolder': true, 'duet.work.blockAll': true, 'duet.work.block2': true, 'duet.work.block1': false, 'duet.work.blockDepth': false });
        view.runAction('expandAll');
        view.runAction('expandLevel2');
        expect([...view.tree.expanded]).toEqual([]);
        view.runAction('expandLevel1');
        expect([...view.tree.expanded].sort()).toEqual(['01_Дизайн', '02_Модель']);
        view.runAction('collapseAll');
        await view.setDepth('all');
        expect(fake.contexts['duet.work.blockDepth']).toBe(true);
        view.smartToggle();
        expect([...view.tree.expanded]).toEqual([]);
    });

    it('М3.3: без тикета галочка «одна папка» недоступна, а настройки окна меняются', async () => {
        const { view } = await open(TICKET, 'business');
        await view.setRule(true, null, undefined);
        expect(view.tree.oneFolder).toBe(false);
        await view.setShowHidden(true);
        await view.setFollow(true);
        expect(fake.contexts).toMatchObject({ 'duet.work.showHidden': true, 'duet.work.followEditor': true, 'duet.work.hasViewState': false });
    });

    it('окно без ключа Duet хранит свои настройки в состоянии рабочего пространства', async () => {
        const { view } = await open(TICKET, null);
        await view.setShowHidden(true);
        expect(JSON.parse(fake.workspaceState.get('duet.work.window') as string)).toMatchObject({ showHidden: true });
    });
});

describe('T46, T47, М4.3: одна папка за раз', () => {
    it('раскрытие рукой закрывает другие ветки с выбранного уровня и перерисовывает дерево', async () => {
        vi.useFakeTimers();
        const files = { ...TICKET, [`${T}/02_Модель/старое/z.md`]: '', [VIEW]: '{"version":1,"expanded":["01_Дизайн","01_Дизайн/Экспертиза","02_Модель"],"oneFolder":true,"oneFolderFromLevel":2}' };
        const { view, tree, fired } = await open(files);
        fired.length = 0;
        tree.expand.fire({ element: el('d', '02_Модель/старое') });
        expect([...view.tree.expanded].sort()).toEqual(['01_Дизайн', '02_Модель', '02_Модель/старое']);
        await vi.advanceTimersByTimeAsync(60);
        expect(fired).toEqual([undefined]);
        // The collapsed folder comes back under a new id, so the tree draws it in the declared state
        expect((view.getTreeItem(el('d', '01_Дизайн/Экспертиза')) as unknown as { id: string }).id).toContain('|d|1|');
    });

    it('включение сразу приводит вид к правилу и сохраняется с тикетом', async () => {
        const { view, disk } = await open({ ...TICKET, [VIEW]: '{"version":1,"expanded":["01_Дизайн","01_Дизайн/Экспертиза","02_Модель"]}' });
        await view.setRule(true, 1, el('f', '02_Модель/Модель.md'));
        expect([...view.tree.expanded]).toEqual(['02_Модель']);
        await view.flushView();
        expect(JSON.parse(disk.files.get(VIEW)!)).toMatchObject({ oneFolder: true, oneFolderFromLevel: 1, expanded: ['02_Модель'] });
    });
});

describe('T77: галочка во время перетаскивания', () => {
    const RULED = { ...TICKET, [VIEW]: '{"version":1,"expanded":["01_Дизайн","01_Дизайн/Экспертиза"],"oneFolder":true,"oneFolderFromLevel":1}' };

    it('пока тащишь, ничего не сворачивается и не перерисовывается; после броска остаётся папка цели', async () => {
        vi.useFakeTimers();
        const { view, tree, fired } = await open(RULED);
        fired.length = 0;
        const { data } = drag(view, [el('f', 'a.md')]);
        tree.expand.fire({ element: el('d', '02_Модель') });
        await vi.advanceTimersByTimeAsync(100);
        expect([...view.tree.expanded].sort()).toEqual(['01_Дизайн', '01_Дизайн/Экспертиза', '02_Модель']);
        expect(fired).toEqual([]);
        await view.handleDrop(el('f', '02_Модель/Модель.md'), data as never);
        expect([...view.tree.expanded]).toEqual(['02_Модель']);
        expect(fired).toContain(undefined);
    });

    it('перетаскивание отменено — раскрытой остаётся папка источника', async () => {
        const { view, tree } = await open(RULED);
        const { cancel } = drag(view, [el('f', '01_Дизайн/x.md')]);
        tree.expand.fire({ element: el('d', '02_Модель') });
        cancel();
        expect([...view.tree.expanded]).toEqual(['01_Дизайн']);
    });

    it('конец, о котором платформа не сообщила, считается отменой при следующем действии', async () => {
        const { view, tree } = await open(RULED);
        drag(view, [el('f', '01_Дизайн/x.md')]);
        tree.expand.fire({ element: el('d', '02_Модель') });
        fake.tabs.fire();
        expect(view.tree.isDragging()).toBe(false);
        expect([...view.tree.expanded]).toEqual(['01_Дизайн']);
    });
});

describe('T21, T22, М3.8: скрытие и глаз', () => {
    const HIDDEN = { ...TICKET, [`${T}/.claude/settings.json`]: '', [`${T}/.claude/other.json`]: '' };
    beforeEach(() => { fake.config['files.exclude'] = { '**/.claude': true }; fake.workspaceFolder = B; });

    it('скрывается то же, что скрывает Explorer; глаз показывает всё и запоминается за окном', async () => {
        const { view, disk } = await open(HIDDEN);
        expect(names(view)).not.toContain('d|.claude');
        await view.setShowHidden(true);
        expect(names(view)).toContain('d|.claude');
        expect(JSON.parse(disk.files.get(WINDOW)!)).toMatchObject({ showHidden: true });
        await view.setShowHidden(false);
        expect(names(view)).not.toContain('d|.claude');
    });

    it('состояние глаза возвращается после повторного открытия окна', async () => {
        const { view } = await open({ ...HIDDEN, [WINDOW]: '{"version":1,"showHidden":true}' });
        expect(names(view)).toContain('d|.claude');
        expect(fake.contexts['duet.work.showHidden']).toBe(true);
    });

    it('М3.8/1: вкладка скрытого файла допускает его и предков, но ничего не раскрывает; закрытие убирает', async () => {
        const { view } = await open(HIDDEN);
        fake.visibleFiles = [`${T}/.claude/settings.json`];
        fake.tabs.fire();
        expect(names(view)).toContain('d|.claude');
        expect(names(view, el('d', '.claude'))).toEqual(['f|.claude/settings.json']);
        expect([...view.tree.expanded]).toEqual([]);
        fake.visibleFiles = [];
        fake.tabs.fire();
        expect(names(view)).not.toContain('d|.claude');
    });

    it('М3.8/2: смена правил скрытия пересчитывает строки, раскрытое не меняется', async () => {
        const { view, tree } = await open(HIDDEN);
        tree.expand.fire({ element: el('d', '01_Дизайн') });
        fake.config['files.exclude'] = { '**/*.md': true };
        fake.configuration.fire({ affectsConfiguration: section => section === 'files.exclude' });
        await vi.waitFor(() => expect(names(view)).toEqual(['d|.claude', 'd|01_Дизайн', 'd|02_Модель']));
        expect([...view.tree.expanded]).toEqual(['01_Дизайн']);
    });

    it('папка с одними скрытыми детьми показывает пустую строку', async () => {
        fake.config['files.exclude'] = { '**/*.json': true };
        const { view } = await open(HIDDEN);
        expect(names(view, el('d', '.claude'))).toEqual(['e|.claude']);
    });
});

describe('T49, М2.4, М3.4: показ открытого файла', () => {
    it('изначально выключен: смена вкладки дерево не трогает', async () => {
        const { view, tree } = await open();
        fake.activeFile = `${T}/01_Дизайн/x.md`;
        fake.editors.fire();
        await Promise.resolve();
        expect([...view.tree.expanded]).toEqual([]);
        expect(tree.revealed).toEqual([]);
    });

    it('включение сразу показывает текущий файл: путь раскрыт, строка выделена, фокус не забран', async () => {
        const { view, tree } = await open();
        fake.activeFile = `${T}/01_Дизайн/Экспертиза/1.md`;
        await view.setFollow(true);
        expect([...view.tree.expanded].sort()).toEqual(['01_Дизайн', '01_Дизайн/Экспертиза']);
        expect(tree.revealed).toEqual([{ element: el('f', '01_Дизайн/Экспертиза/1.md'), options: { select: true, focus: false, expand: false } }]);
    });

    it('файл вне тикета и документ без пути ничего не меняют', async () => {
        const { view, tree } = await open({ ...TICKET, [WINDOW]: '{"followEditor":true}' });
        fake.activeFile = `${OTHER}/INDEX.md`;
        fake.editors.fire();
        fake.activeFile = null;
        fake.editors.fire();
        await Promise.resolve();
        expect(tree.revealed).toEqual([]);
        expect(view.ticket?.number).toBe('DUE018');
    });

    it('скрытая панель не поднимается; когда её показали — текущий файл показан один раз', async () => {
        const { view, tree } = await open({ ...TICKET, [WINDOW]: '{"followEditor":true}' });
        tree.visible = false;
        fake.activeFile = `${T}/02_Модель/Модель.md`;
        fake.editors.fire();
        await Promise.resolve();
        expect(tree.revealed).toEqual([]);
        expect([...view.tree.expanded]).toEqual([]);
        tree.visible = true;
        tree.visibility.fire({ visible: true });
        await vi.waitFor(() => expect(tree.revealed).toHaveLength(1));
        expect([...view.tree.expanded]).toEqual(['02_Модель']);
    });

    it('М4.5: при возврате к тикету показ сильнее сохранённого вида; выключенный — возвращает вид точно', async () => {
        const { view } = await open({ ...TICKET, [WINDOW]: '{"followEditor":true}' });
        fake.activeFile = `${T}/02_Модель/Модель.md`;
        await view.selectFromBin(ticketNode('DUE017', OTHER));
        await view.goHome();
        expect([...view.tree.expanded]).toEqual(['02_Модель']);
        await view.setFollow(false);
        view.runAction('collapseAll');
        await view.goHome();
        expect([...view.tree.expanded]).toEqual([]);
    });

    it('М3.5/3: «свернуть всё» действует и при включённом показе — неподвижная вкладка не возвращает раскрытое', async () => {
        vi.useFakeTimers();
        const { view } = await open({ ...TICKET, [WINDOW]: '{"followEditor":true}' });
        fake.activeFile = `${T}/02_Модель/Модель.md`;
        fake.editors.fire();
        await vi.advanceTimersByTimeAsync(10);
        expect([...view.tree.expanded]).toEqual(['02_Модель']);
        view.runAction('collapseAll');
        await vi.advanceTimersByTimeAsync(1000);
        expect([...view.tree.expanded]).toEqual([]);
    });
});

describe('T9–T12, М3.2: другой тикет и «обновить»', () => {
    it('выбор в «Корзине» показывает другой тикет с припиской; группа ничего не переключает', async () => {
        const { view, tree } = await open();
        await view.selectFromBin({ kind: 'backlog', key: 'backlog', children: [] });
        expect(tree.title).toBe('Рабочая папка DUE018');
        await view.selectFromBin(ticketNode('DUE017', OTHER));
        expect(tree.title).toBe('Рабочая папка DUE017');
        expect(tree.description).toBe('другой тикет');
        expect(names(view)).toEqual(['d|drafts', 'f|INDEX.md']);
    });

    it('«обновить» возвращает тикет окна; повторный щелчок по тому же тикету снова его показывает', async () => {
        const { view, tree } = await open();
        await view.selectFromBin(ticketNode('DUE017', OTHER));
        await view.goHome();
        expect(tree.title).toBe('Рабочая папка DUE018');
        expect(tree.description).toBe('');
        await view.selectFromBin(ticketNode('DUE017', OTHER));
        expect(tree.title).toBe('Рабочая папка DUE017');
    });

    it('щелчок по уже показанному тикету его вид не перезапускает', async () => {
        const { view, fired } = await open();
        await view.selectFromBin(ticketNode('DUE017', OTHER));
        fired.length = 0;
        await view.selectFromBin(ticketNode('DUE017', OTHER));
        expect(fired).toEqual([]);
    });

    it('окно бизнеса: выбор показывает тикет, «обновить» снова даёт пустоту', async () => {
        const { view, tree } = await open(TICKET, 'business');
        await view.selectFromBin(ticketNode('DUE017', OTHER));
        expect(names(view)).toEqual(['d|drafts', 'f|INDEX.md']);
        await view.goHome();
        expect(tree.title).toBe('Рабочая папка');
        expect(names(view)).toEqual([]);
    });

    it('T13: тикет другого бизнеса — показанное остаётся, одна строка', async () => {
        const { view, tree } = await open();
        await view.selectFromBin(ticketNode('ABC001', '/drive/Other/work/ABC001_X'));
        expect(tree.title).toBe('Рабочая папка DUE018');
        expect(fake.warnings).toEqual(['Тикеты другого бизнеса рабочая папка пока не открывает.']);
    });

    it('М2.8: запоздавший результат прежнего выбора не показывается', async () => {
        const { view, tree, disk } = await open();
        const readdir = disk.fs.readdir;
        let release = () => undefined as void;
        disk.fs.readdir = async folder => {
            if (folder === OTHER) {
                await new Promise<void>(resolve => { release = resolve; });
            }
            return readdir(folder);
        };
        const slow = view.selectFromBin(ticketNode('DUE017', OTHER));
        await vi.waitFor(() => expect(tree.message).toBe('Загрузка…'));
        expect(tree.title).toBe('Рабочая папка DUE017');
        expect(names(view)).toEqual([]);
        await view.goHome();
        release();
        await slow;
        expect(tree.title).toBe('Рабочая папка DUE018');
        expect(names(view)).toContain('f|a.md');
    });

    it('М2.7: при возврате к тикету возвращается выделение сохранившейся строки, файл не открывается', async () => {
        const { view, tree } = await open();
        tree.select.fire({ selection: [el('f', 'a.md')] });
        await view.selectFromBin(ticketNode('DUE017', OTHER));
        tree.revealed.length = 0;
        await view.goHome();
        expect(tree.revealed).toEqual([{ element: el('f', 'a.md'), options: { select: true, focus: false, expand: false } }]);
        expect(fake.opened).toEqual([]);
    });

    it('М3.14/1: папка тикета переехала — вью идёт за ней по номеру', async () => {
        vi.useFakeTimers();
        const { view, tree, disk } = await open();
        await disk.ops.rename(T, `${B}/backlog/DUE018_WorkView`);
        fake.watchers[0].remove.fire({ scheme: 'file', fsPath: T, path: '', toString: () => '' });
        await vi.advanceTimersByTimeAsync(400);
        expect(view.ticket?.path).toBe(`${B}/backlog/DUE018_WorkView`);
        expect(tree.title).toBe('Рабочая папка DUE018');
        expect(names(view)).toContain('f|a.md');
    });
});

describe('Пины: порядок и перетаскивание', () => {
    const value = (view: WorkView, element: string) => (view.getTreeItem(element) as unknown as { contextValue: string }).contextValue;
    const pins = (disk: MemDisk, folder = '.') => JSON.parse(disk.files.get(ORDER)!).folders[folder];

    it('«Закрепить»: строка встаёт в конец закреплённых своего рода; «Открепить» возвращает её в алфавит', async () => {
        const { view, actions, disk } = await open();
        expect([value(view, el('f', 'INDEX.md')), value(view, el('f', 'b.md')), value(view, el('d', '02_Модель'))]).toEqual(['file.pin', 'file', 'folder.closed']);
        await actions.pin(el('f', 'b.md'), undefined);
        await actions.pin(el('d', '02_Модель'), undefined);
        expect(names(view)).toEqual(['d|02_Модель', 'd|01_Дизайн', 'f|INDEX.md', 'f|notepad.md', 'f|b.md', 'f|a.md']);
        expect(pins(disk)).toEqual({ dirs: ['02_Модель'], files: ['INDEX.md', 'AGENDA.md', 'notepad.md', 'b.md'] });
        expect([value(view, el('f', 'b.md')), value(view, el('d', '02_Модель'))]).toEqual(['file.pin', 'folder.closed.pin']);
        expect(fake.contexts['duet.work.rootManual']).toBe(true);
        await actions.unpin(el('f', 'INDEX.md'), undefined);
        expect(names(view)).toEqual(['d|02_Модель', 'd|01_Дизайн', 'f|notepad.md', 'f|b.md', 'f|a.md', 'f|INDEX.md']);
        // Back to the pins the folder starts with: nothing of it is kept
        await actions.pin(el('f', 'INDEX.md'), undefined);
        await actions.unpin(el('f', 'b.md'), undefined);
        await actions.unpin(el('d', '02_Модель'), undefined);
        await actions.unpin(el('f', 'INDEX.md'), undefined);
        expect(pins(disk)).toEqual({ files: ['AGENDA.md', 'notepad.md'] });
    });

    it('закреплённые переставляются между собой: вниз — после цели, вверх — перед ней; файлов это не двигает', async () => {
        const { view, disk } = await open();
        await dragDrop(view, [el('f', 'notepad.md')], el('f', 'INDEX.md'));
        expect(pins(disk)).toEqual({ files: ['notepad.md', 'INDEX.md', 'AGENDA.md'] });
        expect(names(view)).toEqual(['d|01_Дизайн', 'd|02_Модель', 'f|notepad.md', 'f|INDEX.md', 'f|a.md', 'f|b.md']);
        await dragDrop(view, [el('f', 'notepad.md')], el('f', 'INDEX.md'));
        expect(pins(disk).files).toEqual(['INDEX.md', 'notepad.md', 'AGENDA.md']);
        expect(disk.log).toEqual([]);
        expect(fake.infos).toEqual([]);
    });

    it('незакреплённая строка не переставляется: порядок меняют только у закреплённых', async () => {
        const { view, disk } = await open();
        await dragDrop(view, [el('f', 'b.md')], el('f', 'a.md'));
        await dragDrop(view, [el('f', 'INDEX.md')], el('f', 'a.md'));
        await dragDrop(view, [el('f', 'INDEX.md')], undefined);
        expect(fake.warnings).toEqual([
            'Порядок меняют только у закреплённых строк: бросьте на закреплённый файл или закрепите из меню.',
            'Закреплённый файл ставят рядом с другим закреплённым файлом.',
            'Закреплённый файл ставят рядом с другим закреплённым файлом.'
        ]);
        expect(disk.files.has(ORDER)).toBe(false);
        expect(names(view)).toEqual(['d|01_Дизайн', 'd|02_Модель', 'f|INDEX.md', 'f|notepad.md', 'f|a.md', 'f|b.md']);
    });

    it('незакреплённая строка, брошенная на закреплённую того же рода, закрепляется и встаёт рядом с ней', async () => {
        const { view, actions, disk } = await open();
        await dragDrop(view, [el('f', 'b.md')], el('f', 'notepad.md'));
        expect(pins(disk)).toEqual({ files: ['INDEX.md', 'AGENDA.md', 'b.md', 'notepad.md'] });
        expect(names(view)).toEqual(['d|01_Дизайн', 'd|02_Модель', 'f|INDEX.md', 'f|b.md', 'f|notepad.md', 'f|a.md']);
        expect(value(view, el('f', 'b.md'))).toBe('file.pin');
        // A folder has no pinned neighbour to be dropped on until one is pinned from the menu
        await dragDrop(view, [el('d', '02_Модель')], el('d', '01_Дизайн'));
        expect(fake.warnings).toEqual(['Порядок меняют только у закреплённых строк: бросьте на закреплённую папку или закрепите из меню.']);
        await actions.pin(el('d', '01_Дизайн'), undefined);
        await dragDrop(view, [el('d', '02_Модель')], el('d', '01_Дизайн'));
        expect(pins(disk).dirs).toEqual(['02_Модель', '01_Дизайн']);
    });

    it('перенос в другую папку никогда не закрепляет — и когда брошено на закреплённую строку', async () => {
        const seed = '{"version":2,"folders":{"01_Дизайн":{"files":["y.md"]}}}';
        const { view, disk, tree } = await open({ ...TICKET, [ORDER]: seed });
        tree.expand.fire({ element: el('d', '01_Дизайн') });
        await dragDrop(view, [el('f', 'INDEX.md'), el('f', 'a.md')], el('f', '01_Дизайн/y.md'));
        expect(disk.log).toEqual([`rename ${T}/INDEX.md -> ${T}/01_Дизайн/INDEX.md`, `rename ${T}/a.md -> ${T}/01_Дизайн/a.md`]);
        expect(disk.files.get(ORDER)).toBe(seed);
        expect(names(view, el('d', '01_Дизайн'))).toEqual(
            ['d|01_Дизайн/Экспертиза', 'f|01_Дизайн/y.md', 'f|01_Дизайн/a.md', 'f|01_Дизайн/INDEX.md', 'f|01_Дизайн/x.md']);
    });

    it('папки и файлы не смешиваются: файл не встаёт среди папок, папка — среди файлов', async () => {
        const { view, actions, disk } = await open();
        await actions.pin(el('d', '01_Дизайн'), undefined);
        await actions.pin(el('d', '02_Модель'), undefined);
        fake.warnings.length = 0;
        await dragDrop(view, [el('f', 'INDEX.md')], el('d', '01_Дизайн'));
        await dragDrop(view, [el('d', '02_Модель')], el('f', 'INDEX.md'));
        await dragDrop(view, [el('d', '02_Модель'), el('f', 'INDEX.md')], el('d', '01_Дизайн'));
        expect(fake.warnings).toEqual([
            'Закреплённый файл ставят рядом с другим закреплённым файлом.',
            'Закреплённую папку ставят рядом с другой закреплённой папкой.',
            'Папки и файлы переставляют отдельно: они не смешиваются.'
        ]);
        await dragDrop(view, [el('d', '02_Модель')], el('d', '01_Дизайн'));
        expect(pins(disk)).toEqual({ dirs: ['02_Модель', '01_Дизайн'] });
        expect(names(view).slice(0, 3)).toEqual(['d|02_Модель', 'd|01_Дизайн', 'f|INDEX.md']);
    });

    it('новый файл встаёт по алфавиту — и в папке, где пины меняли; пин имени, которого нет, ждёт файл', async () => {
        vi.useFakeTimers();
        const { view, disk } = await open({ ...TICKET, [ORDER]: '{"version":2,"folders":{".":{"files":["b.md","AGENDA.md"]}}}' });
        expect(names(view)).toEqual(['d|01_Дизайн', 'd|02_Модель', 'f|b.md', 'f|a.md', 'f|INDEX.md', 'f|notepad.md']);
        disk.files.set(`${T}/0.md`, '');
        disk.files.set(`${T}/AGENDA.md`, '');
        disk.files.set(`${T}/01_Дизайн/INDEX.md`, '');
        for (const created of ['0.md', 'AGENDA.md', '01_Дизайн/INDEX.md']) {
            fake.watchers[0].create.fire({ scheme: 'file', fsPath: `${T}/${created}`, path: '', toString: () => '' });
        }
        await vi.advanceTimersByTimeAsync(400);
        expect(names(view)).toEqual(['d|01_Дизайн', 'd|02_Модель', 'f|b.md', 'f|AGENDA.md', 'f|0.md', 'f|a.md', 'f|INDEX.md', 'f|notepad.md']);
        // Below the root no folder starts with pins: an `INDEX.md` there stands by the alphabet
        expect(names(view, el('d', '01_Дизайн'))).toEqual(['d|01_Дизайн/Экспертиза', 'f|01_Дизайн/INDEX.md', 'f|01_Дизайн/x.md', 'f|01_Дизайн/y.md']);
        expect((view.getTreeItem(el('f', '01_Дизайн/INDEX.md')) as unknown as { contextValue: string }).contextValue).toBe('file');
    });

    it('свободная расстановка прежней версии не действует: порядок по умолчанию', async () => {
        const { view } = await open({ ...TICKET, [ORDER]: '{"version":1,"folders":{".":["b.md","a.md"]}}' });
        expect(names(view)).toEqual(['d|01_Дизайн', 'd|02_Модель', 'f|INDEX.md', 'f|notepad.md', 'f|a.md', 'f|b.md']);
        expect(fake.contexts['duet.work.rootManual']).toBe(false);
    });

    it('T37, T43: бросок на строку внутри раскрытой папки переносит файл и сообщает одной строкой', async () => {
        const { view, disk, tree } = await open();
        tree.expand.fire({ element: el('d', '01_Дизайн') });
        await dragDrop(view, [el('f', 'a.md'), el('f', 'b.md')], el('f', '01_Дизайн/y.md'));
        expect(disk.log).toEqual([`rename ${T}/a.md -> ${T}/01_Дизайн/a.md`, `rename ${T}/b.md -> ${T}/01_Дизайн/b.md`]);
        expect(fake.infos).toEqual(['Перенесено в 01_Дизайн/: a.md и ещё 1.']);
        // What came into the folder stands by the alphabet, wherever it was dropped
        expect(names(view, el('d', '01_Дизайн'))).toEqual(['d|01_Дизайн/Экспертиза', 'f|01_Дизайн/a.md', 'f|01_Дизайн/b.md', 'f|01_Дизайн/x.md', 'f|01_Дизайн/y.md']);
    });

    it('T39: занятое имя в папке назначения — отказ одной строкой, ничего не тронуто', async () => {
        const { view, disk, tree } = await open({ ...TICKET, [`${T}/01_Дизайн/a.md`]: '' });
        tree.expand.fire({ element: el('d', '01_Дизайн') });
        await dragDrop(view, [el('f', 'a.md')], el('f', '01_Дизайн/x.md'));
        expect(fake.warnings).toEqual(['В 01_Дизайн/ уже есть a.md — ничего не перенесено.']);
        expect(disk.log).toEqual([]);
        expect(disk.files.has(ORDER)).toBe(false);
    });

    it('T78: файл с несохранёнными правками не переносится', async () => {
        const { view, disk, tree } = await open();
        tree.expand.fire({ element: el('d', '01_Дизайн') });
        fake.dirtyFiles = [`${T}/a.md`];
        await dragDrop(view, [el('f', 'a.md')], el('f', '01_Дизайн/x.md'));
        expect(fake.warnings).toEqual(['«a.md» не перенесён: в нём несохранённые правки.']);
        expect(disk.log).toEqual([]);
    });

    it('М4.27: файл порядка не читается — просмотр остаётся, закрепление отклонено с причиной, файл цел', async () => {
        const { view, actions, disk } = await open({ ...TICKET, [ORDER]: '{oops' });
        expect(names(view)[0]).toBe('d|01_Дизайн');
        expect(fake.contexts['duet.work.orderLocked']).toBe(true);
        fake.warnings.length = 0;
        await actions.pin(el('f', 'b.md'), undefined);
        await dragDrop(view, [el('f', 'notepad.md')], el('f', 'INDEX.md'));
        expect(fake.warnings).toEqual(['Закрепление не изменено: файл порядка не разбирается.', 'Порядок не изменён: файл порядка не разбирается.']);
        expect(disk.files.get(ORDER)).toBe('{oops');
    });

    it('М4.7: сброс возвращает папке изначальные пины и не трогает вложенные', async () => {
        const { view, actions, disk } = await open({ ...TICKET, [ORDER]: '{"version":2,"folders":{".":{"files":["b.md"]},"01_Дизайн":{"files":["y.md"]},"01_Дизайн/Экспертиза":{"files":["1.md"]}}}' });
        expect((view.getTreeItem(el('d', '01_Дизайн')) as unknown as { contextValue: string }).contextValue).toBe('folder.closed.manual');
        await actions.resetOrder(el('d', '01_Дизайн'));
        expect(Object.keys(JSON.parse(disk.files.get(ORDER)!).folders).sort()).toEqual(['.', '01_Дизайн/Экспертиза']);
        await actions.resetRootOrder();
        expect(Object.keys(JSON.parse(disk.files.get(ORDER)!).folders)).toEqual(['01_Дизайн/Экспертиза']);
        expect(fake.contexts['duet.work.rootManual']).toBe(false);
        expect(names(view).slice(2)).toEqual(['f|INDEX.md', 'f|notepad.md', 'f|a.md', 'f|b.md']);
    });

    it('М3.10/6: пины, записанные другим окном, переставляют строки; раскрытое не меняется', async () => {
        const { view, tree, disk } = await open();
        tree.expand.fire({ element: el('d', '01_Дизайн') });
        disk.files.set(ORDER, '{"version":2,"folders":{".":{"files":["b.md"]}}}');
        fake.watchers[1].change.fire({ scheme: 'file', fsPath: ORDER, path: '', toString: () => '' });
        await vi.waitFor(() => expect(names(view)[2]).toBe('f|b.md'));
        expect([...view.tree.expanded]).toEqual(['01_Дизайн']);
    });

    it('строка из другого окна, из Explorer или из «Корзины» — отказ одной строкой', async () => {
        const { view, disk } = await open();
        const foreign = transfer();
        foreign.set('application/vnd.code.tree.duet.work', { value: '{"paths":["a.md"]}', asFile: () => undefined, asString: async () => '' } as never);
        await view.handleDrop(el('d', '01_Дизайн'), foreign as never);
        expect(fake.warnings).toEqual(['Рабочая папка принимает только свои строки и файлы из системы.']);
        expect(disk.log).toEqual([]);
    });

    it('бросок в редактор: в списке адресов только файлы', async () => {
        const { view } = await open();
        const { data } = drag(view, [el('f', 'a.md'), el('d', '01_Дизайн')]);
        expect(data.get('text/uri-list')?.value).toBe(`file://${T}/a.md`);
    });
});

describe('T61, T62: создание и переименование', () => {
    it('на файле — в его папке, на своём месте по алфавиту; файл открыт закреплённой вкладкой и выделен', async () => {
        const { view, actions, disk, tree } = await open();
        const done = actions.create(el('f', 'INDEX.md'), 'file');
        await typeName('план.md');
        await done;
        expect(disk.log).toEqual([`createFile ${T}/план.md`]);
        expect(names(view)).toEqual(['d|01_Дизайн', 'd|02_Модель', 'f|INDEX.md', 'f|notepad.md', 'f|a.md', 'f|b.md', 'f|план.md']);
        expect(disk.files.has(ORDER)).toBe(false);
        expect(fake.opened).toEqual([{ path: `${T}/план.md`, options: { preview: false } }]);
        expect(tree.revealed.at(-1)).toEqual({ element: el('f', 'план.md'), options: { select: true, focus: false, expand: false } });
    });

    it('на раскрытой папке — внутри неё, порядок не пишется; папка создаётся без редактора', async () => {
        const { view, actions, disk, tree } = await open();
        tree.expand.fire({ element: el('d', '01_Дизайн') });
        const done = actions.create(el('d', '01_Дизайн'), 'dir');
        await typeName('новая');
        await done;
        expect(disk.log).toEqual([`createDir ${T}/01_Дизайн/новая`]);
        expect(disk.files.has(ORDER)).toBe(false);
        expect(fake.opened).toEqual([]);
        expect([...view.tree.expanded]).toEqual(['01_Дизайн']);
    });

    it('на свёрнутой папке создание отклонено: сначала раскройте папку', async () => {
        const { actions, disk } = await open();
        await actions.create(el('d', '01_Дизайн'), 'file');
        expect(fake.warnings).toEqual(['Сначала раскройте папку.']);
        expect(fake.inputBoxes).toEqual([]);
        expect(disk.log).toEqual([]);
    });

    it('М4.1: в корне пустого тикета — через пункт под тремя точками', async () => {
        const { view, actions } = await open({}, 'intent', [T]);
        const done = actions.createInRoot('file');
        await typeName('INDEX.md');
        await done;
        expect(names(view)).toEqual(['f|INDEX.md']);
    });

    it('занятое имя помечается в поле, Enter не применяет; Escape ничего не меняет', async () => {
        const { actions, disk } = await open();
        const done = actions.create(el('f', 'a.md'), 'file');
        await vi.waitFor(() => expect(fake.inputBoxes).toHaveLength(1));
        const box = fake.inputBoxes[0];
        box.type('b.md');
        expect(box.validationMessage).toEqual({ message: 'В этой папке уже есть b.md.', severity: 3 });
        box.enter();
        expect(box.disposed).toBe(false);
        box.escape();
        await done;
        expect(disk.log).toEqual([]);
    });

    it('М4.18: имя папки, которое останется скрытым, — сведение, а не ошибка; после глаза применяется', async () => {
        fake.config['files.exclude'] = { '**/.*': true };
        fake.workspaceFolder = B;
        const { view, actions, disk } = await open();
        const done = actions.createInRoot('dir');
        await vi.waitFor(() => expect(fake.inputBoxes).toHaveLength(1));
        const box = fake.inputBoxes[0];
        box.type('.черновики');
        expect(box.validationMessage?.severity).toBe(1);
        box.enter();
        expect(box.disposed).toBe(false);
        await view.setShowHidden(true);
        expect(box.validationMessage).toBeUndefined();
        expect(box.value).toBe('.черновики');
        box.enter();
        await done;
        expect(disk.log).toEqual([`createDir ${T}/.черновики`]);
    });

    it('переименование: в поле прежнее имя с выделенной основой; пин идёт за новым именем', async () => {
        const { view, actions, disk } = await open({ ...TICKET, [ORDER]: '{"version":2,"folders":{".":{"files":["b.md","a.md"]}}}' });
        const done = actions.rename(el('f', 'b.md'));
        await vi.waitFor(() => expect(fake.inputBoxes).toHaveLength(1));
        expect(fake.inputBoxes[0]).toMatchObject({ value: 'b.md', valueSelection: [0, 1] });
        await typeName('z.md');
        await done;
        expect(disk.log).toEqual([`rename ${T}/b.md -> ${T}/z.md`]);
        expect(names(view).slice(2, 4)).toEqual(['f|z.md', 'f|a.md']);
        expect(JSON.parse(disk.files.get(ORDER)!).folders['.']).toEqual({ files: ['z.md', 'a.md'] });
    });

    it('изначально закреплённый файл переименован через вью — остаётся закреплённым; незакреплённый пинов не пишет', async () => {
        const { view, actions, disk } = await open();
        const pinned = actions.rename(el('f', 'notepad.md'));
        await typeName('блокнот.md');
        await pinned;
        expect(names(view).slice(2)).toEqual(['f|INDEX.md', 'f|блокнот.md', 'f|a.md', 'f|b.md']);
        expect(JSON.parse(disk.files.get(ORDER)!).folders['.']).toEqual({ files: ['INDEX.md', 'AGENDA.md', 'блокнот.md'] });
        const loose = actions.rename(el('f', 'a.md'));
        await typeName('c.md');
        await loose;
        expect(JSON.parse(disk.files.get(ORDER)!).folders['.']).toEqual({ files: ['INDEX.md', 'AGENDA.md', 'блокнот.md'] });
    });

    it('переименование мимо вью пин теряет: новое имя встаёт по алфавиту, а прежнее ждёт в перечне', async () => {
        vi.useFakeTimers();
        const { view, disk } = await open();
        disk.files.delete(`${T}/notepad.md`);
        disk.files.set(`${T}/заметки.md`, '');
        fake.watchers[0].remove.fire({ scheme: 'file', fsPath: `${T}/notepad.md`, path: '', toString: () => '' });
        await vi.advanceTimersByTimeAsync(400);
        expect(names(view).slice(2)).toEqual(['f|INDEX.md', 'f|a.md', 'f|b.md', 'f|заметки.md']);
        expect(disk.files.has(ORDER)).toBe(false);
    });

    it('T62: с клавиши переименовывается строка под рамкой, а не прежнее выделение', async () => {
        const { actions, tree } = await open();
        tree.selection = [el('f', 'a.md'), el('f', 'b.md')];
        void actions.rename(el('f', 'INDEX.md'));
        await vi.waitFor(() => expect(fake.inputBoxes).toHaveLength(1));
        expect(fake.inputBoxes[0].value).toBe('INDEX.md');
        fake.inputBoxes[0].escape();
    });

    it('Enter без изменения имени просто закрывает поле', async () => {
        const { actions, disk } = await open();
        const done = actions.rename(el('f', 'a.md'));
        await vi.waitFor(() => expect(fake.inputBoxes).toHaveLength(1));
        fake.inputBoxes[0].enter();
        await done;
        expect(disk.log).toEqual([]);
    });

    it('переименованная папка сохраняет раскрытие и пины внутри себя', async () => {
        const { view, actions, tree, disk } = await open({ ...TICKET, [ORDER]: '{"version":2,"folders":{"01_Дизайн":{"files":["y.md","x.md"]}}}' });
        tree.expand.fire({ element: el('d', '01_Дизайн') });
        const done = actions.rename(el('d', '01_Дизайн'));
        await typeName('Дизайн');
        await done;
        expect([...view.tree.expanded]).toEqual(['Дизайн']);
        expect(names(view, el('d', 'Дизайн'))).toEqual(['d|Дизайн/Экспертиза', 'f|Дизайн/y.md', 'f|Дизайн/x.md']);
        expect(Object.keys(JSON.parse(disk.files.get(ORDER)!).folders)).toEqual(['Дизайн']);
    });

    it('T78: файл с несохранёнными правками не переименовывается', async () => {
        const { actions } = await open();
        fake.dirtyFiles = [`${T}/a.md`];
        await actions.rename(el('f', 'a.md'));
        expect(fake.warnings).toEqual(['«a.md» не переименован: в нём несохранённые правки.']);
        expect(fake.inputBoxes).toEqual([]);
    });

    it('М3.13/1: выбор другого тикета закрывает поле имени без изменений', async () => {
        const { view, actions, disk } = await open();
        const done = actions.rename(el('f', 'a.md'));
        await vi.waitFor(() => expect(fake.inputBoxes).toHaveLength(1));
        await view.selectFromBin(ticketNode('DUE017', OTHER));
        await done;
        expect(fake.inputBoxes[0].disposed).toBe(true);
        expect(disk.log).toEqual([]);
    });
});

describe('T61, T74, М4.15, М4.32: удаление', () => {
    it('одно подтверждение на набор; в корзину; рамка переходит к следующей оставшейся строке', async () => {
        const { view, actions, disk, tree } = await open();
        await actions.remove(el('f', 'a.md'), [el('f', 'a.md'), el('f', 'notepad.md')]);
        expect(fake.warnings).toEqual(['Удалить в корзину объектов: 2?']);
        expect(disk.trashed).toEqual([`${T}/notepad.md`, `${T}/a.md`]);
        expect(names(view)).toEqual(['d|01_Дизайн', 'd|02_Модель', 'f|INDEX.md', 'f|b.md']);
        expect(tree.revealed.at(-1)).toEqual({ element: el('f', 'b.md'), options: { select: true, focus: true, expand: false } });
        expect(fake.opened).toEqual([]);
    });

    it('без подтверждения ничего не удаляется', async () => {
        const { actions, disk } = await open();
        fake.answer = undefined;
        await actions.remove(el('f', 'a.md'), undefined);
        expect(fake.warnings).toEqual(['Удалить a.md в корзину?']);
        expect(disk.trashed).toEqual([]);
    });

    it('М4.15: корзина отказала — объект остаётся, причина названа, безвозвратного удаления нет', async () => {
        const { view, actions, disk } = await open();
        disk.refuse.set('trash', 'у тома нет корзины');
        await actions.remove(el('f', 'a.md'), undefined);
        expect(fake.warnings.at(-1)).toBe('«a.md» не удалён: у тома нет корзины');
        expect(names(view)).toContain('f|a.md');
        expect(disk.log).toEqual([]);
    });

    it('T78: объект с несохранёнными правками внутри не удаляется — до вопроса', async () => {
        const { actions, disk } = await open();
        fake.dirtyFiles = [`${T}/01_Дизайн/x.md`];
        await actions.remove(el('d', '01_Дизайн'), undefined);
        expect(fake.warnings).toEqual(['«01_Дизайн» не удалён: в нём несохранённые правки.']);
        expect(disk.trashed).toEqual([]);
    });

    it('на пустой строке удаление ничего не делает', async () => {
        const { actions } = await open({ [`${T}/INDEX.md`]: '' }, 'intent', [`${T}/пусто`]);
        await actions.remove(el('e', 'пусто'), undefined);
        expect(fake.warnings).toEqual([]);
    });
});

describe('T63, T64, М4.9, М4.10: дублирование', () => {
    it('нажал и готово: трижды подряд — copy01, copy02, copy03, без поля и вопросов; выделение и вкладка не меняются', async () => {
        const { view, actions, disk, tree } = await open();
        for (let i = 0; i < 3; i++) {
            await actions.duplicate(el('f', 'a.md'), undefined);
        }
        expect(disk.log).toEqual([1, 2, 3].map(n => `copy ${T}/a.md -> ${T}/a copy0${n}.md`));
        expect(names(view).slice(4)).toEqual(['f|a.md', 'f|a copy01.md', 'f|a copy02.md', 'f|a copy03.md', 'f|b.md']);
        expect(fake.inputBoxes).toEqual([]);
        expect(fake.warnings).toEqual([]);
        expect(tree.revealed).toEqual([]);
        expect(fake.opened).toEqual([]);
        expect(disk.files.has(ORDER)).toBe(false);
    });

    it('копия закреплённого файла не закреплена: она встаёт по алфавиту, пины не меняются', async () => {
        const seed = '{"version":2,"folders":{".":{"files":["a.md"]}}}';
        const { view, actions, disk } = await open({ ...TICKET, [ORDER]: seed });
        await actions.duplicate(el('f', 'a.md'), undefined);
        expect(disk.files.get(ORDER)).toBe(seed);
        expect(names(view).slice(2)).toEqual(['f|a.md', 'f|a copy01.md', 'f|b.md', 'f|INDEX.md', 'f|notepad.md']);
    });

    it('М3.13/3: имя заняли между проверкой и копированием — копия берёт следующий номер', async () => {
        const { actions, disk } = await open();
        disk.before = (op, target) => {
            if (op === 'copy' && target.endsWith('copy01.md')) {
                disk.files.set(target, 'чужой файл');
            }
        };
        await actions.duplicate(el('f', 'a.md'), undefined);
        expect(disk.files.get(`${T}/a copy01.md`)).toBe('чужой файл');
        expect(disk.files.has(`${T}/a copy02.md`)).toBe(true);
    });

    it('М4.29: папка копируется целиком, копия свёрнута; потомок выбранной папки отдельно не копируется', async () => {
        const { view, actions, disk, tree } = await open();
        tree.expand.fire({ element: el('d', '01_Дизайн') });
        await actions.duplicate(el('d', '01_Дизайн'), [el('d', '01_Дизайн'), el('f', '01_Дизайн/x.md')]);
        expect(disk.log).toEqual([`copy ${T}/01_Дизайн -> ${T}/01_Дизайн copy01`]);
        expect(disk.files.has(`${T}/01_Дизайн copy01/Экспертиза/1.md`)).toBe(true);
        expect([...view.tree.expanded]).toEqual(['01_Дизайн']);
    });

    it('М4.20: при несохранённых правках копируется версия с диска, и об этом сказано', async () => {
        const { actions, disk } = await open();
        fake.dirtyFiles = [`${T}/a.md`];
        await actions.duplicate(el('f', 'a.md'), undefined);
        expect(disk.files.has(`${T}/a copy01.md`)).toBe(true);
        expect(fake.infos).toEqual(['В «a.md» есть несохранённые правки — скопирована версия с диска.']);
    });
});

describe('T59, T60, T66, T67: открытие, пути, сравнение', () => {
    it('два пути: абсолютные — по одному в строке, в экранном порядке', async () => {
        const { actions, tree } = await open();
        tree.selection = [el('f', 'b.md'), el('d', '01_Дизайн')];
        await actions.copyPath(el('f', 'b.md'), undefined);
        expect(fake.clipboard).toBe(`${T}/01_Дизайн\n${T}/b.md`);
    });

    it('правое нажатие вне выделения берёт только нажатую строку', async () => {
        const { actions, tree } = await open();
        tree.selection = [el('f', 'b.md'), el('f', 'a.md')];
        await actions.copyPath(el('f', 'INDEX.md'), undefined);
        expect(fake.clipboard).toBe(`${T}/INDEX.md`);
    });

    it('«Открыть с помощью…» и «Показать в Finder» получают адрес строки, а не активного редактора', async () => {
        const { actions } = await open();
        fake.activeFile = `${T}/b.md`;
        await actions.openWith(el('f', 'a.md'));
        await actions.revealInOs(el('d', '01_Дизайн'));
        expect(fake.executed.map(e => [e.command, (e.args[0] as FakeUri).fsPath]))
            .toEqual([['explorer.openWith', `${T}/a.md`], ['revealFileInOS', `${T}/01_Дизайн`]]);
    });

    it('сравнение: образец общий с редактором; у строки-образца свой недоступный пункт', async () => {
        const { view, actions } = await open();
        await actions.selectForCompare(el('f', 'a.md'));
        expect((view.getTreeItem(el('f', 'a.md')) as unknown as { contextValue: string }).contextValue).toBe('file.cmp');
        await actions.compareWithSelected(el('f', 'b.md'));
        expect(fake.executed.map(e => e.command)).toEqual(['selectForCompare', 'compareFiles']);
    });

    it('образец исчез — сравнение говорит об этом и замену не выбирает', async () => {
        const { actions, disk } = await open();
        await actions.selectForCompare(el('f', 'a.md'));
        disk.files.delete(`${T}/a.md`);
        await actions.compareWithSelected(el('f', 'b.md'));
        expect(fake.warnings).toEqual(['Файла, выбранного для сравнения, больше нет.']);
        expect(fake.executed.map(e => e.command)).toEqual(['selectForCompare']);
    });

    it('переименование образца через вью сообщает редактору новый адрес', async () => {
        const { actions } = await open();
        await actions.selectForCompare(el('f', 'a.md'));
        const done = actions.rename(el('f', 'a.md'));
        await typeName('c.md');
        await done;
        expect(fake.executed.filter(e => e.command === 'selectForCompare').map(e => (e.args[0] as FakeUri).fsPath)).toEqual([`${T}/a.md`, `${T}/c.md`]);
    });

    it('два выделенных файла сравниваются: верхний слева, нижний справа', async () => {
        const { actions, tree } = await open();
        tree.selection = [el('f', 'b.md'), el('f', 'a.md')];
        await actions.compareSelected(el('f', 'b.md'), [el('f', 'b.md'), el('f', 'a.md')]);
        expect(fake.executed.at(-1)).toMatchObject({ command: 'vscode.diff' });
        expect((fake.executed.at(-1)!.args as FakeUri[]).map(u => u.fsPath)).toEqual([`${T}/a.md`, `${T}/b.md`]);
    });
});

describe('М3.13, М4.31: смена тикета во время операции', () => {
    it('операция заканчивается в прежнем тикете, называет его в сообщении и не трогает новое дерево', async () => {
        const { view, disk, tree } = await open();
        tree.expand.fire({ element: el('d', '01_Дизайн') });
        const rename = disk.ops.rename;
        let release = () => undefined as void;
        let held = false;
        disk.ops.rename = async (from, to) => {
            if (!held) {
                held = true;
                await new Promise<void>(resolve => { release = resolve; });
            }
            return rename(from, to);
        };
        const dropped = dragDrop(view, [el('f', 'a.md'), el('f', 'b.md')], el('f', '01_Дизайн/x.md'));
        await vi.waitFor(() => expect(held).toBe(true));
        await view.selectFromBin(ticketNode('DUE017', OTHER));
        release();
        await dropped;
        expect(disk.files.has(`${T}/01_Дизайн/a.md`) && disk.files.has(`${T}/01_Дизайн/b.md`)).toBe(true);
        expect(fake.infos).toEqual(['DUE018: Перенесено в 01_Дизайн/: a.md и ещё 1.']);
        expect(tree.title).toBe('Рабочая папка DUE017');
        expect(names(view)).toEqual(['d|drafts', 'f|INDEX.md']);
    });

    it('подтверждение удаления, на которое ответили после смены тикета, ничего не удаляет', async () => {
        const { view, actions, disk } = await open();
        const original = fake.answer;
        Object.defineProperty(fake, 'answer', {
            configurable: true,
            get: () => { void view.selectFromBin(ticketNode('DUE017', OTHER)); return original; }
        });
        await actions.remove(el('f', 'a.md'), undefined);
        expect(disk.trashed).toEqual([]);
    });
});

describe('М3.13: одна операция за раз', () => {
    it('пока идёт операция, вторая не выполняется и не копится', async () => {
        const { view, actions, disk } = await open();
        let release = () => undefined as void;
        const gate = new Promise<void>(resolve => { release = resolve; });
        const first = view.exclusive('копирование', () => gate);
        expect(fake.contexts['duet.work.busy']).toBe(true);
        await actions.duplicate(el('f', 'a.md'), undefined);
        expect(fake.warnings).toEqual(['Рабочая папка занята: идёт копирование.']);
        release();
        await first;
        expect(disk.log).toEqual([]);
        expect(fake.contexts['duet.work.busy']).toBe(false);
    });
});

describe('Ревью: операция действует по подтверждённому знанию', () => {
    const uriOf = (fsPath: string) => ({ scheme: 'file', fsPath, path: fsPath, toString: () => `file://${fsPath}` });

    it('R8: бросок на строку ниже ставит после неё, на строку выше — перед ней', async () => {
        const { view, actions, disk } = await open();
        await actions.pin(el('f', 'a.md'), undefined);
        await actions.pin(el('f', 'b.md'), undefined);
        await dragDrop(view, [el('f', 'a.md')], el('f', 'b.md'));
        expect(JSON.parse(disk.files.get(ORDER)!).folders['.'].files).toEqual(['INDEX.md', 'AGENDA.md', 'notepad.md', 'b.md', 'a.md']);
        await dragDrop(view, [el('f', 'a.md')], el('f', 'INDEX.md'));
        expect(JSON.parse(disk.files.get(ORDER)!).folders['.'].files).toEqual(['a.md', 'INDEX.md', 'AGENDA.md', 'notepad.md', 'b.md']);
    });

    it('R7, T31: тикет сменили, пока операция дочитывала папку, — порядок пишется в её тикет, чужой не тронут', async () => {
        const { view, actions, disk } = await open({ ...TICKET, [ORDER]: '{"version":2,"folders":{".":{"files":["b.md","a.md"]}}}', [`${OTHER}/a.md`]: '' });
        const readdir = disk.fs.readdir;
        let release = () => undefined as void;
        let held = false;
        disk.fs.readdir = async folderPath => {
            if (folderPath === T && !held && disk.log.some(line => line.startsWith('rename'))) {
                held = true;
                await new Promise<void>(resolve => { release = resolve; });
            }
            return readdir(folderPath);
        };
        const renamed = actions.rename(el('f', 'a.md'));
        await typeName('z.md');
        await vi.waitFor(() => expect(held).toBe(true));
        await view.selectFromBin(ticketNode('DUE017', OTHER));
        release();
        await renamed;
        expect(JSON.parse(disk.files.get(ORDER)!).folders['.']).toEqual({ files: ['b.md', 'z.md'] });
        expect(disk.files.has(`${B}/.vscode/duet-work-order/DUE017.json`)).toBe(false);
        expect(names(view)).toEqual(['d|drafts', 'f|INDEX.md', 'f|a.md']);
    });

    it('R1: папка не перечиталась — её состав неизвестен, создание отклонено, файл человека цел', async () => {
        const { actions, disk, tree } = await open();
        tree.expand.fire({ element: el('d', '01_Дизайн') });
        const created = actions.create(el('d', '01_Дизайн'), 'file');
        await vi.waitFor(() => expect(fake.inputBoxes.at(-1)?.shown).toBe(true));
        disk.files.set(`${T}/01_Дизайн/new.md`, 'HUMAN');
        disk.failing.add(`${T}/01_Дизайн`);
        await typeName('new.md');
        await created;
        expect(disk.files.get(`${T}/01_Дизайн/new.md`)).toBe('HUMAN');
        expect(disk.log).toEqual([]);
        expect(fake.warnings.at(-1)).toBe('Папка 01_Дизайн/ не прочитана: папка не читается — действие не выполнено.');
    });

    it('R1: имя заняли между проверкой и созданием — существующий файл не обнуляется', async () => {
        const { actions, disk } = await open();
        disk.before = (op, target) => { if (op === 'createFile') { disk.files.set(target, 'HUMAN'); } };
        const created = actions.createInRoot('file');
        await typeName('new.md');
        await created;
        expect(disk.files.get(`${T}/new.md`)).toBe('HUMAN');
        expect(fake.warnings.at(-1)).toBe('В этой папке уже есть new.md.');
        expect(fake.opened).toEqual([]);
    });

    it('R3, М4.30: внутри ссылки, ведущей за пределы тикета, ничего не создаётся', async () => {
        const { actions, disk, tree, view } = await open(TICKET, 'intent', ['/elsewhere']);
        disk.links.set(`${T}/external`, '/elsewhere');
        await view.goHome();
        tree.expand.fire({ element: el('d', 'external') });
        await actions.create(el('d', 'external'), 'file');
        expect(fake.inputBoxes).toEqual([]);
        expect(disk.log).toEqual([]);
        expect(disk.files.has('/elsewhere/new.md')).toBe(false);
        expect(fake.warnings.at(-1)).toBe('Ссылка ведёт за пределы тикета: в external/ ничего не меняется.');
    });

    it('R4, T78: правки появились, пока поле имени было открыто, — переименование отклонено', async () => {
        const { actions, disk } = await open();
        const renamed = actions.rename(el('f', 'a.md'));
        await vi.waitFor(() => expect(fake.inputBoxes.at(-1)?.shown).toBe(true));
        fake.dirtyFiles = [`${T}/a.md`];
        await typeName('z.md');
        await renamed;
        expect(disk.log).toEqual([]);
        expect(fake.warnings.at(-1)).toBe('«a.md» не переименован: в нём несохранённые правки.');
    });

    it('R4, T78: правки появились, пока висел вопрос об удалении, — объект не удалён', async () => {
        const { actions, disk } = await open();
        const original = fake.answer;
        Object.defineProperty(fake, 'answer', {
            configurable: true,
            get: () => { fake.dirtyFiles = [`${T}/b.md`]; return original; }
        });
        await actions.remove(el('f', 'a.md'), [el('f', 'a.md'), el('f', 'b.md')]);
        expect(disk.trashed).toEqual([`${T}/a.md`]);
        expect(fake.warnings.at(-1)).toBe('«b.md» не удалён: в нём несохранённые правки. Удалено: a.md.');
    });

    it('R5, T78: несохранённый файл узнаётся и через ссылку на его папку', async () => {
        const { actions, disk, tree, view } = await open();
        disk.links.set(`${T}/alias`, `${T}/01_Дизайн`);
        await view.goHome();
        tree.expand.fire({ element: el('d', 'alias') });
        fake.dirtyFiles = [`${T}/01_Дизайн/x.md`];
        await actions.remove(el('f', 'alias/x.md'), undefined);
        expect(disk.trashed).toEqual([]);
        expect(fake.warnings.at(-1)).toBe('«x.md» не удалён: в нём несохранённые правки.');
    });

    it('R5: сама ссылка на папку с несохранённым файлом удаляется — файл она не трогает', async () => {
        const { actions, disk, view } = await open();
        disk.links.set(`${T}/alias`, `${T}/01_Дизайн`);
        await view.goHome();
        fake.dirtyFiles = [`${T}/01_Дизайн/x.md`];
        await actions.remove(el('d', 'alias'), undefined);
        expect(disk.trashed).toEqual([`${T}/alias`]);
    });

    it('R6, М4.31: папка назначения исчезла до броска — она не создаётся заново, файл на месте', async () => {
        const { view, disk, tree } = await open(TICKET, 'intent', [`${T}/пусто`]);
        tree.expand.fire({ element: el('d', 'пусто') });
        disk.dirs.delete(`${T}/пусто`);
        await dragDrop(view, [el('f', 'a.md')], el('e', 'пусто'));
        expect(disk.log).toEqual([]);
        expect(disk.files.has(`${T}/a.md`)).toBe(true);
        expect(fake.warnings.at(-1)).toBe('Дерево изменилось: папки пусто/ больше нет.');
    });

    it.runIf(process.platform === 'darwin')('R6, R12: импорт — строка цели исчезла; частичный результат назван целиком', async () => {
        const { actions, disk, view } = await open({ ...TICKET, '/out/p.md': 'p', '/out/q.md': 'q', '/out/r.md': 'r' });
        const sources = ['/out/p.md', '/out/q.md', '/out/r.md'].map(uriOf);
        const target = view.rowOf(el('f', 'a.md'));
        disk.files.delete(`${T}/a.md`);
        await actions.importFiles(sources as never, target);
        expect(disk.log).toEqual([]);
        expect(fake.warnings.at(-1)).toBe('Дерево изменилось: a.md больше нет.');

        disk.before = (op, to) => { if (op === 'copy' && to.endsWith('q.md')) { throw new Error('диск занят'); } };
        await actions.importFiles(sources as never, view.rowOf(el('f', 'b.md')));
        expect(disk.files.get(`${T}/p.md`)).toBe('p');
        expect(fake.warnings.at(-1)).toBe('Не удалось скопировать «q.md»: диск занят. Скопировано: p.md. Не скопировано также: r.md.');
    });

    it('R9, T19: правка и удаление .gitignore пересчитывают скрытие', async () => {
        vi.useFakeTimers();
        fake.config['explorer.excludeGitIgnore'] = true;
        fake.workspaceFolder = B;
        const { view, disk } = await open({ ...TICKET, [`${T}/.gitignore`]: 'a.md\n' });
        expect(names(view)).not.toContain('f|a.md');
        const ignoreFile = uriOf(`${T}/.gitignore`);
        disk.files.set(`${T}/.gitignore`, 'b.md\n');
        fake.watchers[0].change.fire(ignoreFile);
        await vi.advanceTimersByTimeAsync(400);
        expect(names(view)).toContain('f|a.md');
        expect(names(view)).not.toContain('f|b.md');
        disk.files.delete(`${T}/.gitignore`);
        fake.watchers[0].remove.fire(ignoreFile);
        await vi.advanceTimersByTimeAsync(400);
        expect(names(view)).toEqual(expect.arrayContaining(['f|a.md', 'f|b.md']));
    });

    it('R9: .gitignore выше тикета тоже скрывает его строки, и его правка пересчитывает скрытие', async () => {
        vi.useFakeTimers();
        fake.config['explorer.excludeGitIgnore'] = true;
        fake.workspaceFolder = B;
        const { view, disk } = await open();
        const above = fake.watchers.find(watcher => watcher.pattern === '**/.gitignore')!;
        expect(above.base).toBe(B);
        disk.files.set(`${B}/.gitignore`, 'notepad.md\n');
        above.create.fire({ scheme: 'file', fsPath: `${B}/.gitignore`, path: '', toString: () => '' });
        await vi.advanceTimersByTimeAsync(400);
        expect(names(view)).not.toContain('f|notepad.md');
        // An ignore file of a neighbouring ticket says nothing about this one
        disk.files.set(`${B}/.gitignore`, '');
        above.change.fire({ scheme: 'file', fsPath: `${OTHER}/.gitignore`, path: '', toString: () => '' });
        await vi.advanceTimersByTimeAsync(400);
        expect(names(view)).not.toContain('f|notepad.md');
    });

    it('R10, T21: скрытый файл, показанный во вкладке сравнения, допущен в дерево', async () => {
        fake.config['files.exclude'] = { '**/.claude': true };
        fake.workspaceFolder = B;
        const { view } = await open({ ...TICKET, [`${T}/.claude/settings.json`]: '' });
        fake.visibleDiffs = [{ original: `${T}/a.md`, modified: `${T}/.claude/settings.json` }];
        fake.tabs.fire();
        expect(names(view, el('d', '.claude'))).toEqual(['f|.claude/settings.json']);
    });

    it('R12, М4.22: удаление остановилось на втором объекте — названы удалённое и оставшееся', async () => {
        const { actions, disk } = await open();
        disk.before = (op, target) => { if (op === 'trash' && target.endsWith('/a.md')) { throw new Error('файл занят'); } };
        await actions.remove(el('f', 'a.md'), [el('f', 'notepad.md'), el('f', 'a.md'), el('f', 'b.md')]);
        expect(disk.trashed).toEqual([`${T}/notepad.md`]);
        expect(fake.warnings.at(-1)).toBe('«a.md» не удалён: файл занят. Удалено: notepad.md. Не удалено также: b.md.');
    });

    it('Облачное ревью 2: дублирование остановлено сменой тикета — нетронутая строка названа', async () => {
        const { view, actions, disk } = await open();
        const copy = disk.ops.copy;
        let release = () => undefined as void;
        let held = false;
        disk.ops.copy = async (from, to) => {
            if (!held) {
                held = true;
                await new Promise<void>(resolve => { release = resolve; });
            }
            return copy(from, to);
        };
        const duplicated = actions.duplicate(el('f', 'a.md'), [el('f', 'a.md'), el('f', 'b.md')]);
        await vi.waitFor(() => expect(held).toBe(true));
        await view.selectFromBin(ticketNode('DUE017', OTHER));
        release();
        await duplicated;
        expect(fake.warnings.at(-1)).toBe('DUE018: Дублирование остановлено: показан другой тикет. Скопировано: a.md. Не скопировано: b.md.');
    });

    it('Облачное ревью 3: ссылки одной папки разрешаются разом, а не по одной', async () => {
        const disk = createMemDisk(TICKET);
        for (const name of ['l1', 'l2', 'l3', 'l4']) {
            disk.links.set(`${T}/${name}`, `${T}/a.md`);
        }
        const resolveLink = disk.fs.resolveLink;
        let running = 0;
        let most = 0;
        disk.fs.resolveLink = async linkPath => {
            most = Math.max(most, ++running);
            await new Promise(resolve => setTimeout(resolve, 5));
            running--;
            return resolveLink(linkPath);
        };
        const view = new WorkView({ workspaceState: { get: () => undefined, update: async () => undefined } } as never,
            { own: { subject: 'intent', key: 'DUE018', ticketFolder: 'DUE018_WorkView', businessPath: B } } as never,
            new Paths('/data'), { disk: disk.ops, snapshotFs: disk.fs, fs: asFileSystem(disk) });
        await view.start();
        expect(most).toBe(4);
        expect(names(view).filter(name => name.startsWith('f|l'))).toEqual(['f|l1', 'f|l2', 'f|l3', 'f|l4']);
    });

    it('R11, М2.7: из нескольких выделенных строк возвращается верхняя на экране, в каком бы порядке их ни выделяли', async () => {
        const { view, tree } = await open();
        tree.selection = [el('f', 'b.md'), el('f', 'INDEX.md')];
        tree.select.fire({ selection: tree.selection });
        await view.selectFromBin(ticketNode('DUE017', OTHER));
        await view.goHome();
        expect(tree.revealed.at(-1)).toEqual({ element: el('f', 'INDEX.md'), options: { select: true, focus: false, expand: false } });
    });

    it('R2: смена одного регистра проходит, только когда такого имени у другого файла нет', async () => {
        const { actions, disk } = await open({ ...TICKET, [`${T}/A.md`]: 'OTHER' });
        const renamed = actions.rename(el('f', 'a.md'));
        await vi.waitFor(() => expect(fake.inputBoxes.at(-1)?.shown).toBe(true));
        const box = fake.inputBoxes.at(-1)!;
        box.type('A.md');
        box.enter();
        expect(box.validationMessage?.message).toBe('В этой папке уже есть A.md.');
        box.escape();
        await renamed;
        expect(disk.files.get(`${T}/A.md`)).toBe('OTHER');
        expect(disk.log).toEqual([]);

        const again = actions.rename(el('f', 'b.md'));
        await typeName('B.md');
        await again;
        expect(disk.log).toEqual([`rename ${T}/b.md -> ${T}/B.md`]);
    });
});
