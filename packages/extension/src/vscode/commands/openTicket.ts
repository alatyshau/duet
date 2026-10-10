import * as vscode from 'vscode';
import * as path from 'path';
import { ContextEntity } from '../../core/api-client';
import { FileSystem, nodeFs } from '../../core/fs';
import { Paths } from '../../core/paths';
import { intentIcon, intentIdentity, intentTabLabel } from '../../core/intents/naming';
import { TicketService } from '../../core/intents/ticketService';
import { TicketInfo, readBusinessManifest, resolveTicketNow } from '../../core/intents/tickets';
import { IntentWorkspacePlan, planIntentWorkspace } from '../../core/intents/workspaceFile';
import { metaExtraFolders } from '../../core/workspace';
import { IntentsRuntime } from '../intents/IntentsRuntime';
import { messageOf, say } from '../notify';
import { getVentureFolders } from '../ventures';
import { isSafeRepoName, prepareBusinessRepos } from './businessRepos';

export type TicketBusiness = Pick<ContextEntity, 'name' | 'absolute_path' | 'git_repos' | 'reference_repos' | 'meta'>;

/** One opening path for bin rows, newly created tickets, and a business's curator. */
export class TicketOpener {
    constructor(
        private readonly paths: Paths,
        private readonly runtime: IntentsRuntime,
        private readonly tickets: TicketService,
        private readonly changed: () => Promise<void> = async () => undefined,
        private readonly fs: FileSystem = nodeFs
    ) {}

    /**
     * Open the intent of a ticket: move it out of the backlog, bring the
     * business's repos to disk, build the workspace file anew, hold the intent
     * and its colour, open the file.
     *
     * @returns whether a window was opened or brought forward
     */
    async open(
        ticket: Pick<TicketInfo, 'number' | 'folder' | 'shelf'>,
        business: TicketBusiness,
        forceNewWindow: boolean,
        requireCurator = false
    ): Promise<boolean> {
        const businessPath = business?.absolute_path;
        if (!business || !businessPath) {
            return false;
        }
        const ticketNumber = ticket.number;

        await this.runtime.refresh();
        if (requireCurator) {
            const resolved = await resolveTicketNow(this.runtime.tickets, businessPath, ticket);
            if (!('place' in resolved) || !await this.runtime.tickets.isCuratorAt(resolved.place.path)) {
                throw new Error(`Куратор ${ticketNumber} изменился или перемещён — повторите открытие бизнеса.`);
            }
        }
        const active = this.runtime.getActive().find(row => row.ticket === ticketNumber);
        if (active) {
            // Its window is open: Duet does not write into the file of an open window
            await vscode.commands.executeCommand(
                'vscode.openFolder', vscode.Uri.file(active.workspaceFile), { forceNewWindow: true }
            );
            return true;
        }

        const now = await resolveTicketNow(this.runtime.tickets, businessPath, ticket);
        if (now.state === 'gone' || now.state === 'ambiguous') {
            say(now.state === 'gone'
                ? `Тикета ${ticketNumber} нет ни в work/, ни в backlog/ — корзина обновлена.`
                : `У номера ${ticketNumber} несколько папок — корзина обновлена, выберите строку заново.`);
            await this.changed();
            return false;
        }
        let place = now.place;
        let moved = now.state === 'moved';
        if (place.shelf === 'backlog') {
            try {
                const movedPath = await this.tickets.move(ticketNumber, 'work');
                place = { shelf: 'work', folder: place.folder, path: movedPath };
                moved = true;
            } catch (error) {
                say(`Не удалось перенести ${ticketNumber} в work/: ${messageOf(error)}`);
                await this.changed();
                return false;
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
                await this.changed();
            }
            return false;
        }

        const workspacePath = this.paths.intentWorkspacePath(business.name, place.folder);
        const manifest = await readBusinessManifest(businessPath, this.fs);
        const identity = intentIdentity(place.folder);
        if (!identity) {
            return false;
        }
        // One emoji for the row of the window and for the tab of its notepad
        const ticketIcon = await this.runtime.tickets.inheritedIcon(businessPath, place.path);
        const plan = await this.planWorkspaceFile(workspacePath, {
            businessPath,
            aliases: Object.keys(gitRepos),
            extraFolders: metaExtraFolders(business.meta, businessPath, getVentureFolders(), this.paths.root),
            ticketFolder: place.folder,
            tabLabel: intentTabLabel(intentIcon(ticketIcon, manifest.icon), identity)
        }, ticketNumber);

        // Repository preparation can wait on a clone: do not launch an obsolete criterion afterwards.
        if (requireCurator && !await this.runtime.tickets.isCuratorAt(place.path)) {
            throw new Error(`Куратор ${ticketNumber} изменился — повторите открытие бизнеса.`);
        }

        if (plan.action === 'write') {
            await this.fs.mkdir(path.dirname(workspacePath), { recursive: true });
            await this.fs.atomicWriteFile(workspacePath, plan.text, 'utf8');
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
            await this.changed();
        }
        await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(workspacePath), { forceNewWindow });
        return true;
    }

    private async planWorkspaceFile(
        workspacePath: string,
        spec: Parameters<typeof planIntentWorkspace>[1],
        ticketNumber: string
    ): Promise<IntentWorkspacePlan> {
        let existing: string | null;
        try {
            existing = await this.fs.readFile(workspacePath, 'utf8');
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
                // The file is there but cannot be read: do not rebuild what cannot be seen
                return { action: 'as-is', reason: 'unreadable', color: null };
            }
            existing = null;
        }
        return planIntentWorkspace(existing, spec, this.runtime.occupiedColors(ticketNumber));
    }

}
