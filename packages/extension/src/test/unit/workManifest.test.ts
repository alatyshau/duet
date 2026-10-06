/* eslint-disable @typescript-eslint/naming-convention */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * What the «Рабочая папка» view declares in `package.json`: where it stands,
 * its four buttons, what each menu item needs to be shown and to be
 * available, the keys. A menu is all declaration — these tests read it.
 */
interface MenuItem { command?: string; submenu?: string; when?: string; group?: string }
interface Command { command: string; title: string; icon?: string; enablement?: string }
interface Keybinding { command: string; key?: string; mac?: string; when?: string; args?: unknown }

const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '../../../package.json'), 'utf8'));
const contributes = manifest.contributes;
const commands: Command[] = contributes.commands;
const command = (id: string) => commands.find(c => c.command === `duet.work.${id}`) as Command;
const menu = (id: string): MenuItem[] => contributes.menus[id];
const workTitle = menu('view/title').filter(item => item.when?.includes('view == duet.work'));
const workRows = menu('view/item/context').filter(item => item.when?.includes('view == duet.work'));
const row = (id: string) => workRows.find(item => item.command === `duet.work.${id}`) as MenuItem;
const keys: Keybinding[] = contributes.keybindings;

describe('М1.1, T7: вью', () => {
    it('называется «Рабочая папка», стоит сразу после «Корзины», видно там же, где «Активная Работа»', () => {
        const views: Array<{ id: string; name: string; when: string }> = contributes.views['duet-explorer'];
        const at = views.findIndex(view => view.id === 'duet.work');
        expect(views[at - 1].id).toBe('duet.bin');
        expect(views[at]).toEqual({ id: 'duet.work', name: 'Рабочая папка', when: 'duet.hasPointer' });
        expect(views.find(view => view.id === 'duet.intents')?.when).toBe('duet.hasPointer');
    });

    it('перед вью бизнесов: между «Рабочей папкой» и «Все Бизнесы» только вью, которых при готовом Duet не видно', () => {
        const views: Array<{ id: string; when: string; visibility?: string }> = contributes.views['duet-explorer'];
        const between = views.slice(views.findIndex(view => view.id === 'duet.work') + 1, views.findIndex(view => view.id === 'duet.contexts'));
        expect(between.map(view => view.id)).toEqual(['duet.status', 'duet.context']);
        expect(between[0].when).toBe('!duet.ready');
    });

    it('«КОНТЕКСТ» устарел: изначально скрыт, остаётся в меню панели', () => {
        const views: Array<{ id: string; visibility?: string }> = contributes.views['duet-explorer'];
        expect(views.find(view => view.id === 'duet.context')?.visibility).toBe('hidden');
    });

    it('все команды вью и «Корзины» скрыты из палитры', () => {
        const hidden = new Set(menu('commandPalette').filter(item => item.when === 'false').map(item => item.command));
        const ids = commands.map(c => c.command).filter(id => id.startsWith('duet.work.') || id.startsWith('duet.bin.'));
        expect(ids.filter(id => !hidden.has(id))).toEqual([]);
    });
});

describe('T51, T55, М1.2: шапка', () => {
    const buttons = workTitle.filter(item => item.group?.startsWith('navigation'));

    it('четыре кнопки по порядку: глаз, обновить, минус-плюс; три точки добавляет платформа', () => {
        expect(buttons.map(item => [item.command, item.group]).sort((a, b) => a[1]!.localeCompare(b[1]!))).toEqual([
            ['duet.work.showHidden', 'navigation@1'], ['duet.work.hideHidden', 'navigation@1'],
            ['duet.work.refresh', 'navigation@2'],
            ['duet.work.smartCollapse', 'navigation@3'], ['duet.work.smartExpand', 'navigation@3'], ['duet.work.smartExpandBlocked', 'navigation@3']
        ]);
        expect(workTitle.some(item => !item.group?.startsWith('navigation'))).toBe(true);
    });

    it('у каждой кнопки есть значок; кнопок создания в шапке нет', () => {
        for (const item of buttons) {
            expect(commands.find(c => c.command === item.command)?.icon).toBeTruthy();
        }
        expect(buttons.some(item => /newFile|newFolder/.test(item.command!))).toBe(false);
    });

    it('глаз и минус-плюс показывают одну кнопку из пары, подсказка называет следующее действие', () => {
        expect(buttons.find(item => item.command === 'duet.work.showHidden')?.when).toBe('view == duet.work && !duet.work.showHidden');
        expect(buttons.find(item => item.command === 'duet.work.hideHidden')?.when).toBe('view == duet.work && duet.work.showHidden');
        expect(command('showHidden').title).toBe('Показать скрытые файлы');
        expect(buttons.find(item => item.command === 'duet.work.smartCollapse')?.when).toBe('view == duet.work && duet.work.hasExpanded');
        expect(buttons.find(item => item.command === 'duet.work.smartExpand')?.when).toBe('view == duet.work && !duet.work.hasExpanded && !duet.work.blockDepth');
        expect(buttons.find(item => item.command === 'duet.work.smartExpandBlocked')?.when).toBe('view == duet.work && !duet.work.hasExpanded && duet.work.blockDepth');
    });

    it('глаз и «обновить» доступны всегда; плюс недоступен без папок; заблокированный плюс несёт причину и недоступен', () => {
        expect(command('showHidden').enablement).toBeUndefined();
        expect(command('refresh').enablement).toBeUndefined();
        expect(command('smartCollapse').enablement).toBeUndefined();
        expect(command('smartExpand').enablement).toBe('duet.work.ready && duet.work.hasFolders');
        expect(command('smartExpandBlocked').enablement).toBe('duet.work.never');
        expect(command('smartExpandBlocked').title).toContain('Одна папка за раз');
    });
});

describe('М1.3, М1.4: три точки', () => {
    const under = (group: string) => workTitle.filter(item => item.group?.startsWith(group))
        .sort((a, b) => a.group!.localeCompare(b.group!)).map(item => item.command ?? item.submenu);

    it('действия в порядке модели: корень, затем дерево', () => {
        expect(under('1_root')).toEqual(['duet.work.newFileInRoot', 'duet.work.newFolderInRoot', 'duet.work.resetRootOrder']);
        expect(under('2_tree')).toEqual([
            'duet.work.collapseAll', 'duet.work.expandAll', 'duet.work.expandLevel1', 'duet.work.expandLevel2', 'duet.work.collapseLevel'
        ]);
        expect(['newFileInRoot', 'newFolderInRoot', 'resetRootOrder', 'collapseAll', 'expandAll', 'expandLevel1', 'expandLevel2', 'collapseLevel']
            .map(id => command(id).title)).toEqual([
            'Новый файл в корне…', 'Новая папка в корне…', 'Сбросить закрепления верхнего уровня', 'Свернуть всё', 'Раскрыть всё',
            'Раскрыть на один уровень', 'Раскрыть на два уровня', 'Свернуть на один уровень'
        ]);
    });

    it('доступность действий: создание — при прочитанном тикете; сброс — при ручном порядке; раскрытие — пока галочка не мешает', () => {
        expect(command('newFileInRoot').enablement).toBe('duet.work.ready && !duet.work.busy');
        expect(command('resetRootOrder').enablement).toBe('duet.work.ready && !duet.work.busy && duet.work.rootManual && !duet.work.orderLocked');
        expect(command('collapseAll').enablement).toBe('duet.work.hasViewState && duet.work.anyExpanded');
        expect(command('expandAll').enablement).toBe('duet.work.ready && duet.work.hasFolders && !duet.work.blockAll');
        expect(command('expandLevel1').enablement).toBe('duet.work.ready && duet.work.hasFolders && !duet.work.block1');
        expect(command('expandLevel2').enablement).toBe('duet.work.ready && duet.work.hasFolders && !duet.work.block2');
    });

    it('настройки: глубина плюса и уровень галочки — подменю, обе галочки — пары команд', () => {
        expect(under('3_settings')).toEqual([
            'duet.work.depthMenu', 'duet.work.oneFolder.enable', 'duet.work.oneFolder.disable',
            'duet.work.levelMenu', 'duet.work.follow.enable', 'duet.work.follow.disable'
        ]);
        const submenus: Array<{ id: string; label: string }> = contributes.submenus;
        expect(submenus.find(s => s.id === 'duet.work.depthMenu')?.label).toBe('Кнопка плюс раскрывает');
        expect(submenus.find(s => s.id === 'duet.work.levelMenu')?.label).toBe('Начиная с уровня');
    });

    it('отметка — знак в заголовке; из пары виден один пункт, и невыставленный ключ даёт умолчание', () => {
        expect(['depth1', 'depth1.on', 'depth2.on', 'depthAll.on', 'oneFolder.enable', 'oneFolder.disable'].map(id => command(id).title))
            .toEqual(['○ Один уровень', '● Один уровень', '● Два уровня', '● Всё', '☐ Одна папка за раз', '☑ Одна папка за раз']);
        const depth = menu('duet.work.depthMenu');
        expect(depth.find(item => item.command === 'duet.work.depth1.on')?.when).toBe("duet.work.depth != '2' && duet.work.depth != 'all'");
        expect(depth.find(item => item.command === 'duet.work.depth1')?.when).toBe("duet.work.depth == '2' || duet.work.depth == 'all'");
        const level = menu('duet.work.levelMenu');
        expect(level.find(item => item.command === 'duet.work.level2.on')?.when).toBe("duet.work.oneFolderLevel != '1' && duet.work.oneFolderLevel != '3'");
        expect(level.map(item => item.command)).toHaveLength(6);
    });

    it('несовместимое значение глубины видно, но недоступно — и выбранное тоже; без тикета галочка и уровень недоступны', () => {
        expect([command('depth1').enablement, command('depth1.on').enablement]).toEqual(['!duet.work.block1', '!duet.work.block1']);
        expect([command('depth2').enablement, command('depthAll.on').enablement]).toEqual(['!duet.work.block2', '!duet.work.blockAll']);
        expect(['oneFolder.enable', 'oneFolder.disable', 'level1', 'level3.on'].map(id => command(id).enablement)).toEqual(Array(4).fill('duet.work.hasViewState'));
        expect(command('follow.enable').enablement).toBeUndefined();
    });
});

describe('М1.5–М1.8: меню строки', () => {
    it('набор пунктов и их группы', () => {
        expect(workRows.map(item => [item.command!.replace('duet.work.', ''), item.group])).toEqual([
            ['newFile', 'navigation@1'], ['newFolder', 'navigation@2'], ['newFileClosed', 'navigation@1'], ['newFolderClosed', 'navigation@2'],
            ['openWith', 'navigation@3'], ['revealMac', 'navigation@4'], ['revealWin', 'navigation@4'], ['revealLinux', 'navigation@4'],
            ['selectForCompare', '3_compare@1'], ['compareWithSelected', '3_compare@2'], ['compareWithSelectedSelf', '3_compare@2'],
            ['compareSelected', '3_compare@3'], ['copyPath', '6_copypath@1'], ['copyAtPath', '6_copypath@2'],
            ['rename', '7_modification@1'], ['duplicate', '7_modification@2'], ['delete', '7_modification@3'],
            ['pin', '8_order@1'], ['unpin', '8_order@2'], ['resetOrder', '8_order@3']
        ]);
    });

    it('T58, T65, T66: отклонённых пунктов нет', () => {
        const titles = commands.filter(c => c.command.startsWith('duet.work.')).map(c => c.title).join('\n');
        expect(titles).not.toMatch(/сбоку|терминал|Вырезать|Вставить|относительн|Отменить/i);
        expect(commands.filter(c => c.command.startsWith('duet.work.') && /Копировать/.test(c.title)).map(c => c.title))
            .toEqual(['Копировать абсолютный путь', 'Копировать @-путь']);
    });

    const matches = (id: string, viewItem: string) => {
        const source = /viewItem =~ \/(.+?)\/(?: |$)/.exec(row(id).when!)?.[1] as string;
        return new RegExp(source).test(viewItem);
    };

    it('создание — у файла и у раскрытой папки; у свёрнутой — недоступный пункт с объяснением', () => {
        expect(['file', 'file.cmp', 'folder.open', 'folder.open.manual', 'folder.closed', 'empty', 'note'].map(v => matches('newFile', v)))
            .toEqual([true, true, true, true, false, false, false]);
        expect(['folder.closed', 'folder.closed.manual', 'folder.open', 'file'].map(v => matches('newFileClosed', v))).toEqual([true, true, false, false]);
        expect(command('newFileClosed')).toMatchObject({ title: 'Новый файл… — сначала раскройте папку', enablement: 'duet.work.never' });
        expect(command('newFolderClosed')).toMatchObject({ title: 'Новая папка… — сначала раскройте папку', enablement: 'duet.work.never' });
    });

    it('на пустой строке и строке ошибки не откликается ни один пункт', () => {
        for (const item of workRows) {
            const id = item.command!.replace('duet.work.', '');
            expect([id, matches(id, 'empty'), matches(id, 'note')]).toEqual([id, false, false]);
        }
    });

    it('пункты одной строки при нескольких выделенных отсутствуют; дублирование, удаление и пути — для любого набора', () => {
        const single = ['newFile', 'newFolder', 'openWith', 'revealMac', 'revealWin', 'revealLinux', 'selectForCompare', 'compareWithSelected', 'rename', 'resetOrder'];
        for (const id of single) {
            expect([id, row(id).when!.includes('!listMultiSelection')]).toEqual([id, true]);
        }
        for (const id of ['duplicate', 'delete', 'copyPath', 'copyAtPath']) {
            expect([id, row(id).when!.includes('listMultiSelection')]).toEqual([id, false]);
        }
    });

    it('«Открыть с помощью…» — только у файла; показ в файловом менеджере — свой пункт на каждой системе', () => {
        expect([matches('openWith', 'file'), matches('openWith', 'folder.open')]).toEqual([true, false]);
        expect([row('revealMac').when, row('revealWin').when, row('revealLinux').when].map(w => w!.split(' && ').pop()))
            .toEqual(['isMac', 'isWindows', 'isLinux']);
        expect(['revealMac', 'revealWin', 'revealLinux'].map(id => command(id).title))
            .toEqual(['Показать в Finder', 'Показать в Проводнике', 'Открыть содержащую папку']);
    });

    it('сравнение: «с выбранным» — после выбора и не у строки-образца; «выделенные» — у ровно двух файлов', () => {
        expect(row('compareWithSelected').when).toContain('resourceSelectedForCompare');
        expect([matches('compareWithSelected', 'file'), matches('compareWithSelected', 'file.cmp')]).toEqual([true, false]);
        expect([matches('compareWithSelectedSelf', 'file.cmp'), matches('compareWithSelectedSelf', 'file')]).toEqual([true, false]);
        expect(command('compareWithSelectedSelf').enablement).toBe('duet.work.never');
        expect(row('compareSelected').when).toBe('view == duet.work && listDoubleSelection && viewItem =~ /^file/');
        expect(matches('compareSelected', 'folder.open')).toBe(false);
    });

    it('сброс закреплений — только у папки, где их меняли', () => {
        expect(['folder.open.manual', 'folder.closed.pin.manual', 'folder.open', 'folder.open.pin', 'file'].map(v => matches('resetOrder', v)))
            .toEqual([true, true, false, false, false]);
        expect(command('resetOrder').title).toBe('Сбросить закрепления папки');
    });

    it('«Закрепить» — у незакреплённой строки, «Открепить» — у закреплённой; у пустой строки нет ни того, ни другого', () => {
        const values = ['file', 'file.cmp', 'folder.open', 'folder.closed.manual', 'file.pin', 'file.cmp.pin', 'folder.open.pin', 'folder.closed.pin.manual', 'empty', 'note'];
        expect(values.map(v => matches('pin', v))).toEqual([true, true, true, true, false, false, false, false, false, false]);
        expect(values.map(v => matches('unpin', v))).toEqual([false, false, false, false, true, true, true, true, false, false]);
        expect([command('pin').title, command('unpin').title]).toEqual(['Закрепить', 'Открепить']);
        expect(command('pin').enablement).toBe('duet.work.ready && !duet.work.busy && !duet.work.orderLocked');
        expect(command('unpin').enablement).toBe(command('pin').enablement);
    });

    it('слово закрепления не ломает остальные пункты: они узнают строку по началу слова', () => {
        expect(['file.pin', 'file.cmp.pin', 'folder.open.pin', 'folder.open.pin.manual'].map(v => matches('newFile', v))).toEqual([true, true, true, true]);
        expect(['folder.closed.pin', 'folder.open.pin'].map(v => matches('newFileClosed', v))).toEqual([true, false]);
        expect(['file.pin', 'folder.closed.pin'].map(v => matches('rename', v))).toEqual([true, true]);
    });
});

describe('T62, T66, T74, М1.9: клавиши', () => {
    const W = "focusedView == 'duet.work' && listFocus && !inputFocus && !treestickyScrollFocused";
    const A = { $treeViewId: 'duet.work', $focusedTreeItem: true };
    const work = keys.filter(k => k.command.startsWith('duet.work.'));

    it('Enter и F2 переименовывают на всех трёх системах; удаление и @-путь — свои клавиши', () => {
        expect(work).toEqual([
            { command: 'duet.work.rename', key: 'f2', when: W, args: A },
            { command: 'duet.work.rename', key: 'enter', when: W, args: A },
            { command: 'duet.work.delete', key: 'delete', mac: 'cmd+backspace', when: W, args: A },
            { command: 'duet.work.copyAtPath', key: 'alt+shift+c', mac: 'cmd+shift+c', when: W, args: A }
        ]);
    });

    it('команда с клавишей не несёт enablement: выключенная вернула бы клавишу встроенному открытию', () => {
        for (const id of ['rename', 'delete', 'copyAtPath']) {
            expect([id, command(id).enablement]).toEqual([id, undefined]);
        }
    });

    it('пробел, стрелки и Escape во вью не привязаны — их исполняет платформа', () => {
        expect(keys.filter(k => k.when?.includes("'duet.work'")).map(k => k.key).sort()).toEqual(['alt+shift+c', 'delete', 'enter', 'f2']);
    });

    it('T9: в «Корзине» каждая клавиша, двигающая рамку, показывает тикет под рамкой', () => {
        const B = "focusedView == 'duet.bin' && listFocus && !inputFocus && !treestickyScrollFocused";
        const F = { command: 'duet.bin.select', args: { $treeViewId: 'duet.bin', $focusedTreeItem: true } };
        const bin = keys.filter(k => k.command === 'runCommands' && k.when === B);
        expect(bin.map(k => [k.key ?? `mac:${k.mac}`, (k.args as { commands: unknown[] }).commands[0]])).toEqual([
            ['down', 'list.focusDown'], ['up', 'list.focusUp'], ['left', 'list.collapse'], ['right', 'list.expand'],
            ['home', 'list.focusFirst'], ['end', 'list.focusLast'], ['pageup', 'list.focusPageUp'], ['pagedown', 'list.focusPageDown'],
            ['mac:ctrl+n', 'list.focusDown'], ['mac:ctrl+p', 'list.focusUp']
        ]);
        for (const binding of bin) {
            expect((binding.args as { commands: unknown[] }).commands[1]).toEqual(F);
        }
    });
});

describe('T71: добавка к «Корзине»', () => {
    it('«Копировать @-путь» — у строки любого тикета, не у служебных групп', () => {
        const item = menu('view/item/context').find(i => i.command === 'duet.bin.copyAtPath') as MenuItem;
        expect(item).toEqual({ command: 'duet.bin.copyAtPath', when: 'view == duet.bin && viewItem =~ /^ticket-/', group: '6_copypath@1' });
        expect(['ticket-open', 'ticket-work', 'ticket-backlog', 'bin-group'].map(v => /^ticket-/.test(v))).toEqual([true, true, true, false]);
        expect(commands.find(c => c.command === 'duet.bin.copyAtPath')?.title).toBe('Копировать @-путь');
    });
});
