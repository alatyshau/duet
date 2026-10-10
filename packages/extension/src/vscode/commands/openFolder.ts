import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import { TreeNode } from '../../core/tree/contextTree';
import { WorkspaceManager, metaExtraFolders } from '../../core/workspace';
import { Paths } from '../../core/paths';
import { readPointer } from '../../core/pointer';
import { planBusinessColor } from '../../core/intents/workspaceFile';
import { TicketReader, readBusinessManifest } from '../../core/intents/tickets';
import { businessKey } from '../../core/intents/window';
import { getIntentsRuntime, getTicketService } from '../intents/current';
import { getVentureFolders } from '../ventures';
import { isSafeRepoName, prepareBusinessRepos } from './businessRepos';
import { TicketOpener } from './openTicket';
export { buildGitCloneArgs, findUnsafeAliases, isSafeRepoName, prepareBusinessRepos, disposeGitOutputChannel } from './businessRepos';

/**
 * Open a context node. Every context is opened through a workspace file Duet
 * writes for it — `DuetData/workspaces/<context>.code-workspace`: the Drive
 * folder first, then one folder per `git_repos` alias, cloned when missing. A
 * context without `git_repos` gets a file of one folder. The window is opened
 * by a file in both cases because the file is where its colour lives. A meta
 * business gets the folders of the other ventures and DuetData after its own.
 */
async function openNode(
    node: TreeNode,
    forceNewWindow: boolean,
    paths: Paths
): Promise<void> {
    if (!node || !node.id) {
        vscode.window.showErrorMessage('Invalid node: missing path');
        return;
    }

    if (!path.isAbsolute(node.id)) {
        vscode.window.showErrorMessage(
            `Cannot open "${node.label}": backend returned relative path. Check settings.json root_context_folders and reposPath.`
        );
        return;
    }

    const runtime = getIntentsRuntime();
    const reader = runtime?.tickets ?? new TicketReader();
    const curator = await reader.findCurator(node.id);
    if (curator) {
        const tickets = getTicketService();
        if (!runtime || !tickets) {
            throw new Error('Запуск тикетов недоступен — Куратор не открыт.');
        }
        await new TicketOpener(paths, runtime, tickets).open(curator, {
            name: node.label, absolute_path: node.id, git_repos: node.gitRepos,
            reference_repos: node.referenceRepos, meta: node.meta
        }, forceNewWindow, true);
        return;
    }
    const hasGitRepos = node.hasGit && Object.keys(node.gitRepos).length > 0;
    if (!await prepareBusinessRepos(node.label, hasGitRepos ? node.gitRepos : {}, node.referenceRepos, paths)) {
        return;
    }

    // The context name becomes the name of its workspace file. A name that cannot be a
    // file name is the one case left where the folder is opened directly, without a file.
    if (!isSafeRepoName(node.label)) {
        await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(node.id), { forceNewWindow });
        return;
    }

    await openContextWorkspace(node, hasGitRepos ? Object.keys(node.gitRepos) : [], forceNewWindow, paths);
}

/**
 * Write the workspace file of a context and open it.
 *
 * Until 0.0.48 a context without `git_repos` was opened as a plain folder, and
 * only a context with repos got a file. That split left the windows of such
 * businesses without a colour, which is kept in the file — so the file is now
 * written for every context, and `aliases` is simply empty when it has no repos.
 *
 * @param aliases - `git_repos` keys in declared order; already cloned
 */
async function openContextWorkspace(
    node: TreeNode,
    aliases: string[],
    forceNewWindow: boolean,
    paths: Paths
): Promise<void> {
    const workspaceManager = new WorkspaceManager(paths.workspacesPath, paths.reposPath);
    const workspacePath = workspaceManager.getContextWithReposWorkspacePath(node.label);

    // The window of a business gets a colour by the same rules as the window of an intent.
    // Without the intents runtime the file is written exactly as it always was: folders only.
    const runtime = getIntentsRuntime();
    let settings: Record<string, unknown> | undefined;
    let write = true;
    let reserveColor: string | null | undefined;
    if (runtime) {
        const key = businessKey(node.label);
        await runtime.refresh();
        // The file of a window that is open is not recoloured under it
        const windowOpen = runtime.hasFileOpen(workspacePath);
        let existing: string | null = null;
        try {
            existing = await fs.readFile(workspacePath, 'utf8');
        } catch {
            // no file yet: the first open
        }
        const plan = planBusinessColor(existing, runtime.occupiedColors(key), windowOpen);
        write = plan.action === 'write';
        settings = plan.action === 'write' ? plan.settings : undefined;
        // An open window keeps its marker; only a window that is about to start needs its colour held
        reserveColor = windowOpen ? undefined : plan.color;
    }

    if (write) {
        const extraFolders = metaExtraFolders(node.meta, node.id, getVentureFolders(), paths.root);
        await workspaceManager.writeContextWithReposWorkspace(node.label, aliases, node.id, settings, extraFolders);
    }
    if (runtime && reserveColor !== undefined) {
        const manifest = await readBusinessManifest(node.id);
        await runtime.reserve({
            subject: 'business',
            ticket: businessKey(node.label),
            ticketFolder: '',
            business: manifest.name ?? node.label,
            businessPath: node.id,
            icon: manifest.icon,
            ticketIcon: '',
            workspaceFile: workspacePath,
            location: 'missing',
            color: reserveColor
        });
    }

    const uri = vscode.Uri.file(workspacePath);
    await vscode.commands.executeCommand('vscode.openFolder', uri, { forceNewWindow });
}

export async function openInCurrentWindow(node: TreeNode): Promise<void> {
    const pointer = readPointer();
    const dataFolder = pointer?.duetDataPath;
    if (!dataFolder) {
        vscode.window.showErrorMessage('Duet не настроен. Запустите Duet Host.');
        return;
    }

    const paths = new Paths(dataFolder);
    try { await openNode(node, false, paths); } catch (error) {
        vscode.window.showErrorMessage(`Duet: ${error instanceof Error ? error.message : String(error)}`);
    }
}

export async function openInNewWindow(node: TreeNode): Promise<void> {
    const pointer = readPointer();
    const dataFolder = pointer?.duetDataPath;
    if (!dataFolder) {
        vscode.window.showErrorMessage('Duet не настроен. Запустите Duet Host.');
        return;
    }

    const paths = new Paths(dataFolder);
    try { await openNode(node, true, paths); } catch (error) {
        vscode.window.showErrorMessage(`Duet: ${error instanceof Error ? error.message : String(error)}`);
    }
}
