import * as path from 'path';
import * as vscode from 'vscode';
import { commandTargets, afterDeleteFocus, folderLabel, moveLine, resolveDrop, resolveImport } from '../../core/folderView/drop';
import { ROOT, compareDefault, duplicateName, isUnder, joinRel, parentOf, renameSelection, validateName } from '../../core/folderView/names';
import { OrderOp } from '../../core/folderView/order';
import { FileRow, Row, isFileRow } from '../../core/folderView/rows';
import { entryAt } from '../../core/folderView/snapshot';
import { isTakenError, reasonOf } from '../../core/work/disk';
import { PINNED_FILES } from '../../core/work/tree';
import { copyAtPath } from '../commands/copyAtPath';
import { inform, say } from '../notify';
import { DropHandler, Operation, WorkView } from './WorkView';

/**
 * Files dropped from the system are copied only on the systems where it was
 * checked by hand that the original stays where it was: a tree view of an
 * extension always tells the source «move», and what a file manager does on
 * that word is not seen in the code.
 */
export const IMPORT_CONFIRMED: Partial<Record<NodeJS.Platform, boolean>> = { darwin: true };

/**
 * One line for an act on several objects that stopped half-way: why it
 * stopped, then what was done before that and what was not begun — a person
 * must not have to guess which part of the set to repeat.
 */
function partial(failure: string, done: [label: string, names: string[]], left: [label: string, names: string[]]): string {
    const tail = [done, left].filter(([, names]) => names.length > 0).map(([label, names]) => `${label}: ${names.join(', ')}.`);
    return tail.length === 0 ? failure : `${failure.replace(/\.$/, '')}. ${tail.join(' ')}`;
}

/**
 * What the «Рабочая папка» view does with files. Every act reads the folders
 * it touches first, decides on what it read, and shows the result only after
 * the disk has it — the rule of the bin. The operations are the ordinary ones
 * of the editor's file service; a name found taken by the reading is a
 * refusal in one line.
 */
export class WorkActions implements DropHandler {
    constructor(private readonly view: WorkView) {}

    private targets(clicked: unknown, many: unknown, withoutNested = false): FileRow[] {
        const rows = Array.isArray(many) ? many.map(element => this.view.rowOf(element)).filter((row): row is Row => !!row) : undefined;
        const chosen = commandTargets(this.view.rowOf(clicked), rows, this.view.selectionRows(), withoutNested);
        // Top to bottom as on the screen, in whatever sequence the rows were selected
        const place = new Map(this.view.tree.rows().filter(isFileRow).map((row, i) => [row.path, i]));
        return [...chosen].sort((a, b) => (place.get(a.path) ?? 0) - (place.get(b.path) ?? 0));
    }

    /** The one row a command for a single row acts on: the clicked or focused one, else the only selected one. */
    private single(clicked: unknown): FileRow | undefined {
        const row = this.view.rowOf(clicked);
        if (isFileRow(row)) {
            return row;
        }
        const selected = clicked === undefined || typeof clicked !== 'string' ? this.view.selectionRows().filter(isFileRow) : [];
        return selected.length === 1 ? selected[0] : undefined;
    }

    private canChange(): boolean {
        if (!this.view.ticket) {
            return false;
        }
        if (!this.view.isReady) {
            say('Данные рабочей папки не обновлены — действие не выполнено.');
            return false;
        }
        return true;
    }

    private uri(row: FileRow): vscode.Uri {
        return vscode.Uri.file(this.view.abs(row.path));
    }

    // ----- create -----

    /** «Новый файл…» / «Новая папка…» on a row: in the folder of a file, inside an expanded folder. The new row stands by the alphabet. */
    async create(clicked: unknown, kind: 'file' | 'dir'): Promise<void> {
        this.view.beforeCommand();
        const row = this.single(clicked);
        if (!row || !this.canChange()) {
            return;
        }
        if (row.kind === 'dir') {
            // Creating must not expand a folder by itself, and the new row must be seen
            if (!this.view.tree.expanded.has(row.path)) {
                say('Сначала раскройте папку.');
                return;
            }
            // A folder whose content is not shown — a link out of the ticket, a folder that did not answer — takes nothing
            const trouble = this.view.folderTrouble(row.path);
            if (trouble) {
                say(trouble);
                return;
            }
            await this.createIn(row.path, kind);
        } else {
            await this.createIn(row.parent, kind);
        }
    }

    /** «Новый файл в корне…» / «Новая папка в корне…»: right in the folder of the shown ticket. */
    async createInRoot(kind: 'file' | 'dir'): Promise<void> {
        this.view.beforeCommand();
        if (this.canChange()) {
            await this.createIn(ROOT, kind);
        }
    }

    private async createIn(folder: string, kind: 'file' | 'dir'): Promise<void> {
        const view = this.view;
        const request = view.requestNumber;
        const judge = (name: string) => validateName(name, {
            system: view.system,
            isTaken: candidate => view.isTaken(folder, candidate),
            // A new file opens at once, and a file shown in an editor is not hidden
            wouldBeHidden: kind === 'dir' ? candidate => view.tree.wouldBeHidden(folder, candidate, true) : undefined
        });
        const name = await view.askName({ title: kind === 'file' ? 'Новый файл' : 'Новая папка', value: '', validate: judge });
        if (name === undefined || request !== view.requestNumber) {
            return;
        }
        await view.exclusive(kind === 'file' ? 'создание файла' : 'создание папки', async op => {
            if (!(await this.confirmed([folder], op))) {
                return;
            }
            const verdict = judge(name);
            if (verdict && verdict.severity === 'error') {
                op.say(verdict.message);
                return;
            }
            const rel = joinRel(folder, name);
            try {
                await (kind === 'file' ? view.disk.createFile(op.abs(rel)) : view.disk.createDir(op.abs(rel)));
            } catch (error) {
                // Another writer took the name after the reading: the file that is there stays as it is
                op.say(isTakenError(error) ? `В этой папке уже есть ${name}.` : `Не удалось создать «${name}»: ${reasonOf(error)}`);
                return;
            }
            if (!op.alive()) {
                // Another ticket is shown by now: the file is there, its tree is not this one
                return;
            }
            await view.readFolders([folder]);
            if (!op.alive()) {
                return;
            }
            if (kind === 'file') {
                await vscode.window.showTextDocument(vscode.Uri.file(op.abs(rel)), { preview: false });
            }
            if (!op.alive()) {
                return;
            }
            view.redrawNow();
            await view.select(rel, false);
        });
    }

    /**
     * Read the folders an operation is about to write into and tell whether
     * each is there and read. Every operation that changes files begins with
     * this: it acts on what the disk says now, not on what the tree showed.
     */
    private async confirmed(folders: readonly string[], op: Operation): Promise<boolean> {
        const why = await this.view.unconfirmed(folders, op);
        if (why) {
            op.say(why);
        }
        return why === null;
    }

    // ----- rename -----

    async rename(clicked: unknown): Promise<void> {
        this.view.beforeCommand();
        const view = this.view;
        const row = this.single(clicked);
        if (!row || !this.canChange()) {
            return;
        }
        const refusal = `«${row.name}» не переименован: в нём несохранённые правки.`;
        if (view.hasUnsaved(view.abs(row.path))) {
            say(refusal);
            return;
        }
        const isDir = row.kind === 'dir';
        const request = view.requestNumber;
        const judge = (name: string) => validateName(name, {
            system: view.system,
            original: row.name,
            isTaken: (candidate, except) => view.isTaken(row.parent, candidate, except),
            wouldBeHidden: candidate => view.tree.wouldBeHidden(row.parent, candidate, isDir, row.path)
        });
        const name = await view.askName({
            title: 'Переименовать', value: row.name, selection: renameSelection(row.name, isDir), validate: judge
        });
        if (name === undefined || name === row.name || request !== view.requestNumber) {
            return;
        }
        await view.exclusive('переименование', async op => {
            if (!(await this.confirmed([row.parent], op))) {
                return;
            }
            if (!entryAt(view.tree.snapshot!, row.path)) {
                op.say(`Дерево изменилось: ${row.name} больше нет.`);
                return;
            }
            const verdict = judge(name);
            if (verdict && verdict.severity === 'error') {
                op.say(verdict.message);
                return;
            }
            const to = joinRel(row.parent, name);
            const from = op.abs(row.path);
            // The name box may have stood open for any time: what is unsaved is asked again right before the change
            if (await view.unsaved(from)) {
                op.say(refusal);
                return;
            }
            if (!op.alive()) {
                return;
            }
            const arranged = view.arrangedFolders();
            const pinned = view.tree.isPinned(row.parent, row.name, isDir);
            try {
                await view.disk.rename(from, op.abs(to));
            } catch (error) {
                op.say(`Не удалось переименовать «${row.name}»: ${reasonOf(error)}`);
                return;
            }
            const ops: OrderOp[] = [];
            if (pinned) {
                ops.push({ kind: 'rename', folder: row.parent, from: row.name, to: name });
            }
            if (isDir && [...arranged].some(folder => folder === row.path || isUnder(folder, row.path))) {
                ops.push({ kind: 'moveFolder', from: row.path, to });
            }
            const fail = (why: string) => `«${name}» переименован, но закрепление не сохранено: ${why}.`;
            // The choice for comparison belongs to the window, not to the ticket shown
            this.sampleMoved(from, op.abs(to));
            if (!op.alive()) {
                // The object is renamed in the ticket it lies in, and so is its place in that ticket's order
                await op.writeOrder(ops, fail);
                return;
            }
            if (isDir) {
                view.tree.folderMoved(row.path, to);
            }
            await view.readFolders([row.parent]);
            await op.writeOrder(ops, fail);
            if (!op.alive()) {
                return;
            }
            view.redrawNow();
            if (!(await view.follow())) {
                await view.select(to, true);
            }
        });
    }

    // ----- delete -----

    async remove(clicked: unknown, many: unknown): Promise<void> {
        this.view.beforeCommand();
        const view = this.view;
        const rows = this.targets(clicked, many, true);
        if (rows.length === 0 || !this.canChange()) {
            return;
        }
        const refusal = (row: FileRow) => `«${row.name}» не удалён: в нём несохранённые правки.`;
        const unsaved = rows.find(row => view.hasUnsaved(view.abs(row.path)));
        if (unsaved) {
            say(refusal(unsaved));
            return;
        }
        const request = view.requestNumber;
        const question = rows.length === 1 ? `Удалить ${rows[0].name} в корзину?` : `Удалить в корзину объектов: ${rows.length}?`;
        const answer = await vscode.window.showWarningMessage(question, { modal: true }, 'Удалить');
        // A confirmation answered after another ticket was shown deletes nothing
        if (answer !== 'Удалить' || request !== view.requestNumber) {
            return;
        }
        await view.exclusive('удаление', async op => {
            const before = view.tree.rows();
            const deleted: FileRow[] = [];
            let failure: string | null = null;
            for (const row of rows) {
                // The question may have hung for any time, and each deletion takes its own: asked again before every object
                if (await view.unsaved(op.abs(row.path))) {
                    failure = refusal(row);
                    break;
                }
                try {
                    await view.disk.trash(op.abs(row.path));
                    deleted.push(row);
                } catch (error) {
                    // Never deleted for good: the object stays, and the trash's own reason is told
                    failure = `«${row.name}» не удалён: ${reasonOf(error)}`;
                    break;
                }
            }
            if (failure) {
                op.say(partial(failure,
                    ['Удалено', deleted.map(row => row.name)],
                    ['Не удалено также', rows.slice(deleted.length + 1).map(row => row.name)]));
            }
            if (deleted.length === 0) {
                return;
            }
            // A pin is a name in a folder: it stays, and a file that comes back under the name is pinned again
            if (!op.alive()) {
                return;
            }
            deleted.filter(row => row.kind === 'dir').forEach(row => view.tree.folderRemoved(row.path));
            await view.readFolders([...new Set(deleted.map(row => row.parent))]);
            if (!op.alive()) {
                return;
            }
            const next = afterDeleteFocus(before, deleted.map(row => row.path));
            view.redrawNow();
            if (next) {
                await view.select(next.path, true);
            }
        });
    }

    // ----- duplicate -----

    async duplicate(clicked: unknown, many: unknown): Promise<void> {
        this.view.beforeCommand();
        const view = this.view;
        const rows = this.targets(clicked, many, true);
        if (rows.length === 0 || !this.canChange()) {
            return;
        }
        await view.exclusive('дублирование', async op => {
            const arranged = view.arrangedFolders();
            const done: string[] = [];
            const ops: OrderOp[] = [];
            let failure: string | null = null;
            // True when the failure names the row it stopped at; a stop before a row was begun names none
            let named = true;
            for (const row of rows) {
                const why = op.alive() ? await view.unconfirmed([row.parent], op) : '';
                if (why !== null) {
                    failure = why || 'Дублирование остановлено: показан другой тикет.';
                    named = false;
                    break;
                }
                const isDir = row.kind === 'dir';
                let copy: string | null = null;
                for (let from = 1; copy === null; ) {
                    const free = duplicateName(row.name, isDir, candidate => view.isTaken(row.parent, candidate), from);
                    if (!free) {
                        failure = `У «${row.name}» уже 99 копий — копия не создана.`;
                        break;
                    }
                    try {
                        await view.disk.copy(op.abs(row.path), op.abs(joinRel(row.parent, free.name)));
                        copy = free.name;
                    } catch (error) {
                        if (isTakenError(error) && op.alive()) {
                            // Another writer took the name between the reading and the copy: the next number
                            from = free.copyNumber + 1;
                            continue;
                        }
                        failure = `Не удалось дублировать «${row.name}»: ${reasonOf(error)}`
                            + (isDir ? ` Копия «${free.name}» могла остаться неполной.` : '');
                        break;
                    }
                }
                if (copy === null) {
                    break;
                }
                done.push(row.name);
                if (isDir && [...arranged].some(folder => folder === row.path || isUnder(folder, row.path))) {
                    ops.push({ kind: 'copyFolder', from: row.path, to: joinRel(row.parent, copy) });
                }
                if (view.hasUnsaved(op.abs(row.path))) {
                    op.inform(`В «${row.name}» есть несохранённые правки — скопирована версия с диска.`);
                }
            }
            if (op.alive()) {
                await view.readFolders([...new Set(rows.map(row => row.parent))]);
            }
            await op.writeOrder(ops, why => `Копия создана, но закрепления внутри неё не сохранены: ${why}.`);
            if (failure) {
                const left = rows.slice(done.length + (named ? 1 : 0)).map(row => row.name);
                op.say(partial(failure, ['Скопировано', done], [named ? 'Не скопировано также' : 'Не скопировано', left]));
            }
            // The selection stays on the source: pressing again gives copy02, copy03
        });
    }

    // ----- drop -----

    async drop(paths: string[], target: Row | undefined): Promise<string | null> {
        const view = this.view;
        if (!view.ticket || paths.length === 0) {
            return null;
        }
        if (!this.canChange()) {
            return null;
        }
        let landed: string | null = null;
        await view.exclusive('перетаскивание', async op => {
            const targetFolder = target ? target.parent : ROOT;
            // The folder the rows go into must be there and read: a folder that is gone is not made again by the move
            if (!(await this.confirmed([...new Set([...paths.map(parentOf), targetFolder])], op))) {
                return;
            }
            const snapshot = view.tree.snapshot!;
            const plan = resolveDrop({
                rows: view.tree.rows(),
                dragged: paths,
                target,
                isTaken: (folder, name) => view.isTaken(folder, name),
                exists: rel => entryAt(snapshot, rel) !== undefined,
                system: view.system
            });
            if (plan.kind === 'refuse') {
                op.say(plan.say);
            }
            if (plan.kind !== 'apply') {
                return;
            }
            landed = plan.folder;
            if (plan.moves.length === 0) {
                // Nothing changes its folder: the drop asks for another order, and only pinned rows have one
                const refusal = this.reorder(plan, target);
                if (typeof refusal === 'string') {
                    op.say(refusal);
                    return;
                }
                await op.writeOrder(refusal, why => `Порядок не изменён: ${why}.`);
                if (op.alive()) {
                    view.redrawNow();
                }
                return;
            }
            for (const move of plan.moves) {
                if (await view.unsaved(op.abs(move.from))) {
                    op.say(`«${path.posix.basename(move.from)}» не перенесён: в нём несохранённые правки.`);
                    return;
                }
            }
            if (!op.alive()) {
                return;
            }

            // Rows go into another folder and stand there by the alphabet; a pin does not travel with them
            const moved: typeof plan.moves = [];
            let failure: string | null = null;
            for (const move of plan.moves) {
                // Each move takes its time: what is unsaved is asked again before every one after the first
                if (moved.length > 0 && await view.unsaved(op.abs(move.from))) {
                    failure = `${path.posix.basename(move.from)} — в нём несохранённые правки`;
                    break;
                }
                try {
                    await view.disk.rename(op.abs(move.from), op.abs(move.to));
                    moved.push(move);
                    this.sampleMoved(op.abs(move.from), op.abs(move.to));
                } catch (error) {
                    failure = `${path.posix.basename(move.from)} — ${reasonOf(error)}`;
                    break;
                }
            }
            const done = moved.map(move => path.posix.basename(move.from));
            const left = plan.moves.slice(moved.length + 1).map(move => path.posix.basename(move.from));
            // The pins inside a moved folder go with it
            const ops: OrderOp[] = moved.filter(move => move.isDir).map(move => ({ kind: 'moveFolder', from: move.from, to: move.to }));
            if (op.alive()) {
                moved.filter(move => move.isDir).forEach(move => view.tree.folderMoved(move.from, move.to));
                await view.readFolders([...new Set([...plan.moves.map(move => parentOf(move.from)), plan.folder])]);
            }
            await op.writeOrder(ops, why => `Закрепления внутри перенесённой папки не сохранены: ${why}.`);
            if (failure) {
                op.say((done.length > 0 ? `${moveLine(plan.folder, done)} ` : '')
                    + `Не перенесено: ${failure}${left.length > 0 ? `; ${left.join(', ')}` : ''}.`);
            } else if (done.length > 0) {
                op.inform(moveLine(plan.folder, done));
            }
            if (!op.alive()) {
                return;
            }
            view.redrawNow();
            void view.follow();
        });
        return landed;
    }

    /**
     * A drop inside one folder: what it does to the pins, or the line that
     * says why it does nothing. Pinned rows are put next to a pinned row of
     * their kind; a row that is not pinned and lands on a pinned one is pinned
     * there — one gesture instead of «Закрепить» and a drag. Folders and
     * files are never mixed, nothing is unpinned by a drag, and what is not
     * pinned stands by the alphabet.
     */
    private reorder(plan: Extract<ReturnType<typeof resolveDrop>, { kind: 'apply' }>, target: Row | undefined): OrderOp[] | string {
        const tree = this.view.tree;
        const isDir = plan.block[0].kind === 'dir';
        if (plan.block.some(row => (row.kind === 'dir') !== isDir)) {
            return 'Папки и файлы переставляют отдельно: они не смешиваются.';
        }
        const kind = isDir ? 'папкой' : 'файлом';
        if (!isFileRow(target) || (target.kind === 'dir') !== isDir || !tree.isPinned(target.parent, target.name, isDir)) {
            return plan.block.every(row => tree.isPinned(row.parent, row.name, isDir))
                ? `Закреплённ${isDir ? 'ую папку' : 'ый файл'} ставят рядом с друг${isDir ? 'ой закреплённой' : 'им закреплённым'} ${kind}.`
                : `Порядок меняют только у закреплённых строк: бросьте на закреплённ${isDir ? 'ую папку' : 'ый файл'} или закрепите из меню.`;
        }
        const loose = plan.block.filter(row => !tree.isPinned(row.parent, row.name, isDir));
        return [
            ...loose.map((row): OrderOp => ({ kind: 'pin', folder: plan.folder, name: row.name, isDir })),
            { kind: 'place', folder: plan.folder, isDir, block: plan.block.map(row => row.name), anchor: target.name, after: plan.after }
        ];
    }

    // ----- pins -----

    /** «Закрепить»: the row goes to the end of the pinned rows of its kind. */
    async pin(clicked: unknown, many: unknown): Promise<void> {
        await this.changePins(clicked, many, 'pin');
    }

    /** «Открепить»: the row goes back to its place by the alphabet. */
    async unpin(clicked: unknown, many: unknown): Promise<void> {
        await this.changePins(clicked, many, 'unpin');
    }

    private async changePins(clicked: unknown, many: unknown, kind: 'pin' | 'unpin'): Promise<void> {
        this.view.beforeCommand();
        const rows = this.targets(clicked, many);
        if (rows.length === 0 || !this.view.ticket) {
            return;
        }
        const ops: OrderOp[] = rows.map(row => ({ kind, folder: row.parent, name: row.name, isDir: row.kind === 'dir' }));
        if (await this.view.writeOrder(ops, why => `Закрепление не изменено: ${why}.`)) {
            this.view.redrawNow();
        }
    }

    async importFiles(sources: vscode.Uri[], target: Row | undefined): Promise<void> {
        const view = this.view;
        if (!this.canChange()) {
            return;
        }
        if (!IMPORT_CONFIRMED[process.platform]) {
            say('Импорт файлов на этой системе не включён.');
            return;
        }
        await view.exclusive('импорт', async op => {
            const targetFolder = target ? target.parent : ROOT;
            if (!(await this.confirmed([targetFolder], op))) {
                return;
            }
            if (target && isFileRow(target) && !entryAt(view.tree.snapshot!, target.path)) {
                op.say(`Дерево изменилось: ${target.name} больше нет.`);
                return;
            }
            const items: Array<{ uri: vscode.Uri; name: string; isDir: boolean }> = [];
            for (const uri of sources) {
                let isDir = false;
                try {
                    isDir = ((await vscode.workspace.fs.stat(uri)).type & vscode.FileType.Directory) !== 0;
                } catch {
                    // Told below, when the copy fails
                }
                items.push({ uri, name: path.basename(uri.fsPath), isDir });
            }
            if (!op.alive()) {
                return;
            }
            // A set brought from outside has no place of its own in the tree: it stands by name
            items.sort((a, b) => compareDefault(
                { name: a.name, kind: a.isDir ? 'dir' : 'file' }, { name: b.name, kind: b.isDir ? 'dir' : 'file' }, PINNED_FILES));
            const plan = resolveImport({
                target, names: items.map(item => item.name), isTaken: (folder, name) => view.isTaken(folder, name), system: view.system
            });
            if (plan.kind === 'refuse') {
                op.say(plan.say);
            }
            if (plan.kind !== 'apply') {
                return;
            }
            const copied: string[] = [];
            for (const item of items) {
                try {
                    // A copy, never a move: the original stays where it was
                    await view.disk.copy(item.uri.fsPath, op.abs(joinRel(plan.folder, item.name)));
                    copied.push(item.name);
                } catch (error) {
                    op.say(partial(
                        `Не удалось скопировать «${item.name}»: ${reasonOf(error)}`
                            + (item.isDir ? ` Копия «${item.name}» могла остаться неполной.` : ''),
                        ['Скопировано', copied],
                        ['Не скопировано также', items.slice(copied.length + 1).map(left => left.name)]));
                    break;
                }
            }
            if (!op.alive()) {
                return;
            }
            // The copies stand in the folder by the alphabet
            await view.readFolders([plan.folder]);
        });
    }

    // ----- the order -----

    /** «Сбросить закрепления папки»: back to the pins it starts with; folders below keep theirs. */
    async resetOrder(clicked: unknown): Promise<void> {
        this.view.beforeCommand();
        const row = this.single(clicked);
        if (row?.kind === 'dir' && this.view.tree.isManual(row.path)) {
            await this.view.writeOrder([{ kind: 'reset', folder: row.path }], why => `Закрепления не сброшены: ${why}.`);
        }
    }

    async resetRootOrder(): Promise<void> {
        this.view.beforeCommand();
        if (this.view.ticket && this.view.tree.isManual(ROOT)) {
            await this.view.writeOrder([{ kind: 'reset', folder: ROOT }], why => `Порядок не изменён: ${why}.`);
        }
    }

    // ----- open, paths, compare -----

    async openWith(clicked: unknown): Promise<void> {
        this.view.beforeCommand();
        const row = this.single(clicked);
        if (row?.kind === 'file') {
            await vscode.commands.executeCommand('explorer.openWith', this.uri(row));
        }
    }

    async revealInOs(clicked: unknown): Promise<void> {
        this.view.beforeCommand();
        const row = this.single(clicked);
        if (row) {
            await vscode.commands.executeCommand('revealFileInOS', this.uri(row));
        }
    }

    /** Absolute paths of the rows, one per line, top to bottom as on the screen. */
    async copyPath(clicked: unknown, many: unknown): Promise<void> {
        this.view.beforeCommand();
        const rows = this.targets(clicked, many);
        if (rows.length > 0) {
            await vscode.env.clipboard.writeText(rows.map(row => this.view.abs(row.path)).join('\n'));
        }
    }

    async copyAtPath(clicked: unknown, many: unknown): Promise<void> {
        this.view.beforeCommand();
        const uris = this.targets(clicked, many).map(row => this.uri(row));
        if (uris.length > 0) {
            await copyAtPath(uris[0], uris);
        }
    }

    async selectForCompare(clicked: unknown): Promise<void> {
        this.view.beforeCommand();
        const row = this.single(clicked);
        if (row?.kind === 'file') {
            await vscode.commands.executeCommand('selectForCompare', this.uri(row));
            this.view.compareSample = this.view.abs(row.path);
            this.view.redraw();
        }
    }

    async compareWithSelected(clicked: unknown): Promise<void> {
        this.view.beforeCommand();
        const view = this.view;
        const row = this.single(clicked);
        if (row?.kind !== 'file') {
            return;
        }
        const sample = view.compareSample;
        if (sample) {
            const rel = view.toRel(sample);
            let there = true;
            try {
                await view.fs.access(sample);
            } catch {
                there = false;
            }
            if (!there || (rel && !entryAt(view.tree.snapshot!, rel))) {
                say('Файла, выбранного для сравнения, больше нет.');
                return;
            }
        }
        await vscode.commands.executeCommand('compareFiles', this.uri(row));
    }

    /** Exactly two selected files: the upper one on the left. */
    async compareSelected(clicked: unknown, many: unknown): Promise<void> {
        this.view.beforeCommand();
        const rows = this.targets(clicked, many).filter(row => row.kind === 'file');
        if (rows.length === 2) {
            await vscode.commands.executeCommand('vscode.diff', this.uri(rows[0]), this.uri(rows[1]));
        }
    }

    /** The file chosen for comparison got another path through the view: the editor is told the new one. */
    private sampleMoved(from: string, to: string): void {
        const sample = this.view.compareSample;
        if (!sample || (sample !== from && !sample.startsWith(from + path.sep))) {
            return;
        }
        const moved = to + sample.slice(from.length);
        this.view.compareSample = moved;
        void vscode.commands.executeCommand('selectForCompare', vscode.Uri.file(moved));
    }
}
