import * as vscode from 'vscode';
import * as path from 'path';
import { nodeFs } from '../../core/fs';
import { Paths } from '../../core/paths';
import { ActiveIntent } from '../../core/intents/active';
import { TicketNode, binTickets, decideBinDrop } from '../../core/intents/binTree';
import { pruneArchived, writeBinOrder } from '../../core/intents/binOrder';
import { intentIcon, intentIdentity, intentTabLabel } from '../../core/intents/naming';
import { mergeOrderBlock } from '../../core/intents/order';
import { moveTicketFolder, readBusinessManifest, resolveTicketNow } from '../../core/intents/tickets';
import { IntentWorkspacePlan, planIntentWorkspace } from '../../core/intents/workspaceFile';
import { IntentsRuntime } from '../intents/IntentsRuntime';
import { BinProvider } from '../providers/BinProvider';
import { IntentsProvider } from '../providers/IntentsProvider';
import { isSafeRepoName, prepareBusinessRepos } from './openFolder';

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
 * The commands of the bin rows: open an intent, send a ticket to the backlog,
 * carry out a drop. They run one at a time, and each finds its ticket on disk
 * by number before it acts — the view is a snapshot, and no action runs on a
 * stale path.
 */
export class BinActions {
    private chain: Promise<void> = Promise.resolve();

    constructor(
        private readonly paths: Paths,
        private readonly runtime: IntentsRuntime,
        private readonly bin: BinProvider
    ) {}

    open(node: TicketNode | undefined, forceNewWindow: boolean): Promise<void> {
        return this.enqueue(() => this.doOpen(node, forceNewWindow));
    }

    toBacklog(node: TicketNode | undefined): Promise<void> {
        return this.enqueue(() => this.doToBacklog(node));
    }

    drop(sourceKey: string, targetKey: string | null): Promise<void> {
        return this.enqueue(() => this.doDrop(sourceKey, targetKey));
    }

    private enqueue(task: () => Promise<void>): Promise<void> {
        const next = this.chain.then(task).catch(error => {
            vscode.window.showErrorMessage(`Duet: ${messageOf(error)}`);
        });
        this.chain = next;
        return next;
    }

    /**
     * Open the intent of a ticket: move it out of the backlog, bring the
     * business's repos to disk, build the workspace file anew, hold the intent
     * and its colour, open the file.
     */
    private async doOpen(node: TicketNode | undefined, forceNewWindow: boolean): Promise<void> {
        const business = this.bin.currentBusiness();
        const businessPath = business?.absolute_path;
        if (!node || node.kind !== 'ticket' || !business || !businessPath) {
            return;
        }
        const ticketNumber = node.ticket.number;

        await this.runtime.refresh();
        const active = this.runtime.getActive().find(row => row.ticket === ticketNumber);
        if (active) {
            // Its window is open: Duet does not write into the file of an open window
            await vscode.commands.executeCommand(
                'vscode.openFolder', vscode.Uri.file(active.workspaceFile), { forceNewWindow: true }
            );
            return;
        }

        const now = await resolveTicketNow(this.runtime.tickets, businessPath, node.ticket);
        if (now.state === 'gone' || now.state === 'ambiguous') {
            say(now.state === 'gone'
                ? `Тикета ${ticketNumber} нет ни в work/, ни в backlog/ — корзина обновлена.`
                : `У номера ${ticketNumber} несколько папок — корзина обновлена, выберите строку заново.`);
            await this.bin.reload();
            return;
        }
        let place = now.place;
        let moved = now.state === 'moved';
        if (place.shelf === 'backlog') {
            try {
                const movedPath = await moveTicketFolder(nodeFs, businessPath, place.path, 'work');
                place = { shelf: 'work', folder: place.folder, path: movedPath };
                moved = true;
            } catch (error) {
                say(`Не удалось перенести ${ticketNumber} в work/: ${messageOf(error)}`);
                await this.bin.reload();
                return;
            }
        }

        const gitRepos = business.git_repos ?? {};
        const ready = isSafeRepoName(business.name)
            && await prepareBusinessRepos(business.name, gitRepos, business.reference_repos ?? undefined, this.paths);
        if (!ready) {
            if (!isSafeRepoName(business.name)) {
                say(`Имя бизнеса «${business.name}» не годится для имени папки — интент не открыт.`);
            }
            if (moved) {
                await this.bin.reload();
            }
            return;
        }

        const workspacePath = this.paths.intentWorkspacePath(business.name, place.folder);
        const manifest = await readBusinessManifest(businessPath);
        const identity = intentIdentity(place.folder);
        if (!identity) {
            return;
        }
        // One emoji for the row of the window and for the tab of its notepad
        const ticketIcon = await this.runtime.tickets.inheritedIcon(businessPath, place.path);
        const plan = await this.planWorkspaceFile(workspacePath, {
            businessPath,
            aliases: Object.keys(gitRepos),
            ticketFolder: place.folder,
            tabLabel: intentTabLabel(intentIcon(ticketIcon, manifest.icon), identity)
        }, ticketNumber);

        if (plan.action === 'write') {
            await nodeFs.mkdir(path.dirname(workspacePath), { recursive: true });
            await nodeFs.atomicWriteFile(workspacePath, plan.text, 'utf8');
        } else if (plan.action === 'as-is') {
            say(plan.reason === 'newer'
                ? `Файл окна ${ticketNumber} собран более новой версией Duet — открыт как есть.`
                : `Файл окна ${ticketNumber} не читается — открыт как есть, без пересборки.`);
        }

        await this.runtime.reserve({
            subject: 'intent',
            ticket: ticketNumber,
            ticketFolder: place.folder,
            business: business.name,
            businessPath,
            icon: manifest.icon,
            ticketIcon,
            workspaceFile: workspacePath,
            location: 'work',
            color: plan.color
        });
        if (moved) {
            await this.bin.reload();
        }
        await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(workspacePath), { forceNewWindow });
    }

    private async planWorkspaceFile(
        workspacePath: string,
        spec: Parameters<typeof planIntentWorkspace>[1],
        ticketNumber: string
    ): Promise<IntentWorkspacePlan> {
        let existing: string | null;
        try {
            existing = await nodeFs.readFile(workspacePath, 'utf8');
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
                // The file is there but cannot be read: do not rebuild what cannot be seen
                return { action: 'as-is', reason: 'unreadable', color: null };
            }
            existing = null;
        }
        return planIntentWorkspace(existing, spec, this.runtime.occupiedColors(ticketNumber));
    }

    private async doToBacklog(node: TicketNode | undefined): Promise<void> {
        const businessPath = this.bin.currentBusiness()?.absolute_path;
        if (!node || node.kind !== 'ticket' || !businessPath) {
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
                await moveTicketFolder(nodeFs, businessPath, now.place.path, 'backlog');
            } catch (error) {
                say(`Не удалось перенести ${ticketNumber} в backlog/: ${messageOf(error)}`);
            }
        }
        await this.bin.reload();
    }

    /**
     * Carry out a drop in the bin. The disk is read first and the decision is
     * made on the fresh rows; the order is written only when the move, if one
     * was needed, succeeded; the view shows the result only after the disk has it.
     */
    private async doDrop(sourceKey: string, targetKey: string | null): Promise<void> {
        const businessPath = this.bin.currentBusiness()?.absolute_path;
        if (!businessPath) {
            return;
        }
        await Promise.all([this.bin.reload(), this.runtime.refresh()]);

        const drop = decideBinDrop(this.bin.getTree(), sourceKey, targetKey, n => this.runtime.isOpen(n));
        if (!drop.ok) {
            if (drop.reason) {
                say(drop.reason);
            }
            return;
        }
        if (drop.move) {
            try {
                await moveTicketFolder(nodeFs, businessPath, drop.ticket.path, drop.shelf);
            } catch (error) {
                say(`Не удалось перенести ${drop.ticket.number} в ${drop.shelf}/: ${messageOf(error)}`);
                await this.bin.reload();
                return;
            }
        }
        try {
            const present = new Set(binTickets(this.bin.getTree()).map(n => n.ticket.number));
            const order = await pruneArchived(
                mergeOrderBlock(this.bin.getOrder(), drop.shelfOrder),
                present,
                async n => (await this.runtime.tickets.findInArchive(businessPath, n)) !== null
            );
            await writeBinOrder(businessPath, order);
        } catch (error) {
            say(`Порядок корзины не записан: ${messageOf(error)}`);
        }
        await this.bin.reload();
    }
}

/** A refusal or a notice is one line. */
function say(line: string): void {
    void vscode.window.showWarningMessage(line);
}

function messageOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
