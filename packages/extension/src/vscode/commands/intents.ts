import * as vscode from 'vscode';
import { messageOf, say } from '../notify';
import { FileSystem, nodeFs } from '../../core/fs';
import { Paths } from '../../core/paths';
import { ActiveIntent } from '../../core/intents/active';
import { TicketNode, binTickets, decideBinDrop } from '../../core/intents/binTree';
import { TicketBoard } from '../../core/intents/board';
import { pruneArchived, writeBinOrder } from '../../core/intents/binOrder';
import { MAX_TICKET_NAME_LENGTH, NewTicket, createTicket, pascalCaseName } from '../../core/intents/newTicket';
import { mergeOrderBlock } from '../../core/intents/order';
import { moveTicketFolder, readBusinessManifest, resolveTicketNow } from '../../core/intents/tickets';
import { IntentsRuntime } from '../intents/IntentsRuntime';
import { BinProvider } from '../providers/BinProvider';
import { IntentsProvider } from '../providers/IntentsProvider';
import { isSafeRepoName } from './businessRepos';
import { TicketBusiness, TicketOpener } from './openTicket';

/**
 * Switch to the window of a row of the «Активная Работа» view — an intent or a business.
 * Only that view switches; the bin is for managing the backlog and the order.
 *
 * The API has no call to bring another window forward. Switching is opening
 * the intent's workspace file again: the program itself brings forward the
 * window that already has it open. `forceNewWindow` is true so that, should no
 * window have the file after all, a new one opens instead of this window being
 * replaced.
 */
export async function switchToIntent(
    runtime: IntentsRuntime,
    row: ActiveIntent | undefined,
    view: vscode.TreeView<ActiveIntent>,
    provider: IntentsProvider
): Promise<void> {
    if (!row || typeof row.ticket !== 'string') {
        return;
    }
    const target = runtime.getActive().find(active => active.ticket === row.ticket);
    if (target && !target.own) {
        try {
            await vscode.commands.executeCommand(
                'vscode.openFolder', vscode.Uri.file(target.workspaceFile), { forceNewWindow: true }
            );
        } catch (error) {
            vscode.window.showWarningMessage(`Не удалось переключиться на ${target.name || target.ticket}: ${messageOf(error)}`);
        }
    }
    // The clicked row stays selected in this window and outshines the bold one;
    // the selection goes back to this window's own row, but only while the view is shown
    const own = provider.ownRow();
    if (own && view.visible) {
        try {
            await view.reveal(own, { select: true, focus: false });
        } catch {
            // the rows changed meanwhile
        }
    }
}

/**
 * The commands of the bin rows — open an intent, send a ticket to the backlog,
 * carry out a drop — and the creation of a new ticket. They run one at a
 * time. A command of a row finds its ticket on disk by number before it acts —
 * a row is what the board read last, and no action runs on a stale path. After
 * it changed the business folder a command has the board read it at once, so
 * its own window shows the result without waiting for the file events.
 */
export class BinActions {
    private readonly opener: TicketOpener;
    private chain: Promise<void> = Promise.resolve();

    constructor(
        paths: Paths,
        private readonly runtime: IntentsRuntime,
        private readonly bin: BinProvider,
        private readonly board: TicketBoard,
        private readonly fs: FileSystem = nodeFs
    ) { this.opener = new TicketOpener(paths, runtime, () => board.reload(), this.fs); }

    open(node: TicketNode | undefined, forceNewWindow: boolean): Promise<void> {
        const target = this.capture(node);
        return target ? this.enqueue(() => this.doOpen(node, target.business, forceNewWindow)) : Promise.resolve();
    }

    /**
     * Create the next ticket of the window's business and open its window.
     * The name is asked before the command takes its turn, so an open input
     * box holds up no other command.
     */
    async create(): Promise<void> {
        const business = this.bin.windowBusiness();
        if (!business?.absolute_path) {
            say('В этом окне нет бизнеса — новый тикет создать негде.');
            return;
        }
        // Known before anything is made: the window of the ticket could not be opened
        if (!isSafeRepoName(business.name)) {
            say(`Имя бизнеса «${business.name}» не годится для имени папки — тикет не создан.`);
            return;
        }
        const typed = await vscode.window.showInputBox({
            title: `Новый тикет ${business.name}`,
            prompt: 'Название тикета; номер Duet подставит сам. Пустое — тикет без названия',
            validateInput: value => pascalCaseName(value).length > MAX_TICKET_NAME_LENGTH
                ? `Слишком длинно: в названии не больше ${MAX_TICKET_NAME_LENGTH} букв и цифр`
                : undefined
        });
        // Escape cancels; Enter on an empty box is a ticket with a bare number
        if (typed === undefined) {
            return;
        }
        return this.enqueue(() => this.doCreate(business, pascalCaseName(typed)));
    }

    toBacklog(node: TicketNode | undefined): Promise<void> {
        const target = this.capture(node);
        return target ? this.enqueue(() => this.doToBacklog(node, target.business.absolute_path!)) : Promise.resolve();
    }

    drop(sourceKey: string, targetKey: string | null): Promise<void> {
        const business = this.bin.currentBusiness();
        const generation = this.board.getGeneration();
        return business?.absolute_path ? this.enqueue(() => this.doDrop(sourceKey, targetKey, business.absolute_path!, generation))
            : Promise.resolve();
    }

    private capture(node: TicketNode | undefined): { business: TicketBusiness } | null {
        const business = this.bin.currentBusiness();
        return node?.kind === 'ticket' && business?.absolute_path && this.bin.hasNode(node) ? { business } : null;
    }

    private enqueue(task: () => Promise<void>): Promise<void> {
        const next = this.chain.then(task).catch(error => {
            vscode.window.showErrorMessage(`Duet: ${messageOf(error)}`);
        });
        this.chain = next;
        return next;
    }

    private async doOpen(node: TicketNode | undefined, business: TicketBusiness, forceNewWindow: boolean): Promise<void> {
        if (!node || node.kind !== 'ticket') {
            return;
        }
        await this.opener.open(node.ticket, business, forceNewWindow);
    }

    /** Make the ticket folder with the next number, show it in the bin, open its window. */
    private async doCreate(business: TicketBusiness, slug: string): Promise<void> {
        const businessPath = business.absolute_path!;
        if (this.bin.windowBusiness()?.absolute_path !== businessPath) {
            say('Пока вводилось название, у окна сменился бизнес — тикет не создан.');
            return;
        }
        const code = (await readBusinessManifest(businessPath, this.fs)).ticketCode;
        if (!code) {
            say('В context.json бизнеса нет ticket_code — трёх заглавных букв кода тикетов; номер выдать не из чего.');
            return;
        }
        let ticket: NewTicket;
        try {
            ticket = await createTicket(this.fs, this.runtime.tickets, businessPath, code, slug, new Date());
        } finally {
            // Also after a failure: a folder may have been made before it
            await this.board.reload();
        }
        // Nothing holds a number while it is being taken: an agent or another window may have taken it too
        // Names are compared in one Unicode form: a volume may list «й» as two characters
        const own = ticket.folder.normalize('NFC');
        const twins = (await this.runtime.tickets.locate(businessPath, ticket.number))
            .filter(place => place.folder.normalize('NFC') !== own);
        if (twins.length > 0) {
            say(`Номер ${ticket.number} заняли одновременно: он у папок ${ticket.folder} и ${twins.map(place => place.folder).join(', ')}. `
                + 'Одну надо перенумеровать; окно не открыто.');
            return;
        }
        if (!await this.opener.open(ticket, business, true)) {
            say(`Тикет ${ticket.folder} создан в work/, но его окно не открылось — откройте его из корзины.`);
        }
    }

    private async doToBacklog(node: TicketNode | undefined, businessPath: string): Promise<void> {
        if (!node || node.kind !== 'ticket') {
            return;
        }
        const ticketNumber = node.ticket.number;

        await this.runtime.refresh();
        if (this.runtime.isOpen(ticketNumber)) {
            say(`У тикета ${ticketNumber} открыто окно: в бэклог он не переносится.`);
            return;
        }
        const now = await resolveTicketNow(this.runtime.tickets, businessPath, node.ticket);
        if (now.state === 'gone' || now.state === 'ambiguous') {
            say(now.state === 'gone'
                ? `Тикета ${ticketNumber} нет ни в work/, ни в backlog/ — корзина обновлена.`
                : `У номера ${ticketNumber} несколько папок — корзина обновлена, выберите строку заново.`);
        } else if (now.place.shelf === 'work') {
            try {
                await moveTicketFolder(this.fs, businessPath, now.place.path, 'backlog');
            } catch (error) {
                say(`Не удалось перенести ${ticketNumber} в backlog/: ${messageOf(error)}`);
            }
        }
        await this.board.reload();
    }

    /**
     * Carry out a drop in the bin. The disk is read first and the decision is
     * made on the fresh rows; the order is written only when the move, if one
     * was needed, succeeded; the view shows the result only after the disk has it.
     */
    private async doDrop(sourceKey: string, targetKey: string | null, businessPath: string, generation: number): Promise<void> {
        if (generation !== this.board.getGeneration()) {
            return;
        }
        await Promise.all([this.board.reload(), this.runtime.refresh()]);
        if (generation !== this.board.getGeneration()) {
            return;
        }
        const tree = this.board.getTree();
        const previousOrder = this.board.getOrder();
        if (!this.board.isOrderKnown()) {
            // What the window remembers is an older order; written, it would replace the newer one in the file.
            // Refused before anything is moved: a drag is a place and an order together
            say('Файл порядка корзины не читается — перетаскивание не выполнено.');
            return;
        }

        const drop = decideBinDrop(tree, sourceKey, targetKey, n => this.runtime.isOpen(n));
        if (!drop.ok) {
            if (drop.reason) {
                say(drop.reason);
            }
            return;
        }
        if (drop.move) {
            try {
                await moveTicketFolder(this.fs, businessPath, drop.ticket.path, drop.shelf);
            } catch (error) {
                say(`Не удалось перенести ${drop.ticket.number} в ${drop.shelf}/: ${messageOf(error)}`);
                await this.board.reload();
                return;
            }
        }
        try {
            const present = new Set(binTickets(tree).map(n => n.ticket.number));
            const order = await pruneArchived(
                mergeOrderBlock(previousOrder, drop.shelfOrder),
                present,
                async n => (await this.runtime.tickets.findInArchive(businessPath, n)) !== null
            );
            await writeBinOrder(businessPath, order, this.fs);
        } catch (error) {
            say(`Порядок корзины не записан: ${messageOf(error)}`);
        }
        await this.board.reload();
    }
}
