import * as vscode from 'vscode';
import { TreeAction } from '../../core/work/tree';
import { Paths } from '../../core/paths';
import { IntentsRuntime } from '../intents/IntentsRuntime';
import { WorkActions } from './workCommands';
import { WorkDeps, WorkView } from './WorkView';

/**
 * «Рабочая папка» view: the files of the window's ticket. Needs only the
 * DuetData path and the window's own marker, so it is registered next to
 * «Активная Работа», before the backend is asked for anything — a backend
 * that is down takes the bin away, not the folder of one's own ticket.
 *
 * Every command is hidden from the Command Palette: it acts on a row or
 * belongs to the title of the view.
 */
export function registerWorkView(
    context: vscode.ExtensionContext, runtime: IntentsRuntime, paths: Paths, deps: Partial<WorkDeps> = {}
): WorkView {
    const view = new WorkView(context, runtime, paths, deps);
    const actions = new WorkActions(view);
    view.dropHandler = actions;

    const nothing = () => undefined;
    const tree = (action: TreeAction) => () => view.runAction(action);
    /* eslint-disable @typescript-eslint/naming-convention -- the keys are command names */
    const commands: Record<string, (...args: unknown[]) => unknown> = {
        // The title: four buttons
        'showHidden': () => view.setShowHidden(true),
        'hideHidden': () => view.setShowHidden(false),
        'refresh': () => view.refreshHome ? view.refreshHome() : view.goHome(),
        'smartCollapse': () => view.smartToggle(),
        'smartExpand': () => view.smartToggle(),
        // Shown instead of the plus button to tell why it cannot be pressed
        'smartExpandBlocked': nothing,
        // Under «…»: what acts on the whole tree
        'newFileInRoot': () => actions.createInRoot('file'),
        'newFolderInRoot': () => actions.createInRoot('dir'),
        'resetRootOrder': () => actions.resetRootOrder(),
        'collapseAll': tree('collapseAll'),
        'expandAll': tree('expandAll'),
        'expandLevel1': tree('expandLevel1'),
        'expandLevel2': tree('expandLevel2'),
        'collapseLevel': tree('collapseLevel'),
        // Under «…»: settings. An item cannot carry a check mark, so each value is a pair of
        // commands with the mark in the title; the one that shows the chosen value does nothing
        'depth1': () => view.setDepth('1'), 'depth1.on': nothing,
        'depth2': () => view.setDepth('2'), 'depth2.on': nothing,
        'depthAll': () => view.setDepth('all'), 'depthAll.on': nothing,
        // A title command gets the focused row as its first argument
        'oneFolder.enable': focused => view.setRule(true, null, focused),
        'oneFolder.disable': focused => view.setRule(false, null, focused),
        'level1': focused => view.setRule(null, 1, focused), 'level1.on': nothing,
        'level2': focused => view.setRule(null, 2, focused), 'level2.on': nothing,
        'level3': focused => view.setRule(null, 3, focused), 'level3.on': nothing,
        'follow.enable': () => view.setFollow(true),
        'follow.disable': () => view.setFollow(false),
        // A row: a menu item gets the clicked row and, inside a selection, all of it;
        // a key gets the focused row through the `args` of its keybinding
        'newFile': row => actions.create(row, 'file'),
        'newFolder': row => actions.create(row, 'dir'),
        'newFileClosed': nothing,
        'newFolderClosed': nothing,
        'openWith': row => actions.openWith(row),
        'revealMac': row => actions.revealInOs(row),
        'revealWin': row => actions.revealInOs(row),
        'revealLinux': row => actions.revealInOs(row),
        'selectForCompare': row => actions.selectForCompare(row),
        'compareWithSelected': row => actions.compareWithSelected(row),
        'compareWithSelectedSelf': nothing,
        'compareSelected': (row, rows) => actions.compareSelected(row, rows),
        'copyPath': (row, rows) => actions.copyPath(row, rows),
        'copyAtPath': (row, rows) => actions.copyAtPath(row, rows),
        'rename': row => actions.rename(row),
        'duplicate': (row, rows) => actions.duplicate(row, rows),
        'delete': (row, rows) => actions.remove(row, rows),
        'pin': (row, rows) => actions.pin(row, rows),
        'unpin': (row, rows) => actions.unpin(row, rows),
        'resetOrder': row => actions.resetOrder(row)
    };
    /* eslint-enable @typescript-eslint/naming-convention */
    context.subscriptions.push(
        view,
        ...Object.entries(commands).map(([name, run]) => vscode.commands.registerCommand(`duet.work.${name}`, run))
    );
    view.create();
    // Not awaited: reading the ticket folder from a cloud drive must not hold up activation
    void view.begin().catch(e => console.error('[Duet] work view:', e));
    return view;
}
