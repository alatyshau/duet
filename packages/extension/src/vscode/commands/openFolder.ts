import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import { spawn } from 'child_process';
import { TreeNode } from '../../core/tree/contextTree';
import { WorkspaceManager } from '../../core/workspace';
import { Paths } from '../../core/paths';
import { readPointer } from '../../core/pointer';
import { planBusinessColor } from '../../core/intents/workspaceFile';
import { readBusinessManifest } from '../../core/intents/tickets';
import { businessKey } from '../../core/intents/window';
import { getIntentsRuntime } from '../intents/current';

let gitOutputChannel: vscode.OutputChannel | undefined;

function getGitOutputChannel(): vscode.OutputChannel {
    if (!gitOutputChannel) {
        gitOutputChannel = vscode.window.createOutputChannel('Duet Git');
    }
    return gitOutputChannel;
}

async function dirExists(dirPath: string): Promise<boolean> {
    try {
        const stat = await fs.stat(dirPath);
        return stat.isDirectory();
    } catch {
        return false;
    }
}

/**
 * Run git clone with progress reporting.
 *
 * The `--` separator guards against option-injection: a git URL beginning with
 * `-` (e.g. someone's mistyped manifest) would otherwise be interpreted as a
 * flag.
 *
 * Uses a `resolved` flag so concurrent close/error/cancel events don't double-log.
 */
async function gitClone(
    gitUrl: string,
    targetDir: string,
    repoName: string,
    token: vscode.CancellationToken
): Promise<boolean> {
    const outputChannel = getGitOutputChannel();
    outputChannel.show(true);
    outputChannel.appendLine(`\n=== Cloning ${repoName} ===`);
    outputChannel.appendLine(`URL: ${gitUrl}`);
    outputChannel.appendLine(`Target: ${targetDir}`);
    outputChannel.appendLine('');

    return new Promise((resolve) => {
        let resolved = false;

        const finalize = (success: boolean, message: string) => {
            if (resolved) {
                return;
            }
            resolved = true;
            cancelListener.dispose();
            outputChannel.appendLine(message);
            resolve(success);
        };

        const proc = spawn('git', buildGitCloneArgs(gitUrl, targetDir), {
            stdio: ['ignore', 'pipe', 'pipe']
        });

        const cancelListener = token.onCancellationRequested(() => {
            proc.kill('SIGTERM');
            finalize(false, '\n[Cancelled by user]');
        });

        proc.stdout?.on('data', (data: Buffer) => {
            outputChannel.append(data.toString());
        });

        proc.stderr?.on('data', (data: Buffer) => {
            outputChannel.append(data.toString());
        });

        proc.on('close', (code) => {
            if (code === 0) {
                finalize(true, '\n[Clone completed successfully]');
            } else {
                finalize(false, `\n[Clone failed with code ${code}]`);
            }
        });

        proc.on('error', (err) => {
            finalize(false, `\n[Error: ${err.message}]`);
        });
    });
}

function getRepoPath(reposDir: string, name: string): string {
    return path.join(reposDir, `${name}.git`);
}

/**
 * Build argv for `git clone`. The `--` separator is mandatory — without it a
 * git URL beginning with `-` (typo in a manifest, hostile input) gets parsed
 * as a flag.
 *
 * Exported for unit-testing; production code uses `gitClone()` below.
 */
export function buildGitCloneArgs(gitUrl: string, targetDir: string): string[] {
    return ['clone', '--progress', '--', gitUrl, targetDir];
}

/**
 * Validate that an alias from a manifest is safe to use as a folder name.
 * Aliases come from user-authored JSON keys, so we guard against path traversal
 * or illegal characters before joining with `reposDir`.
 *
 * Exported for unit-testing.
 */
export function isSafeRepoName(name: string): boolean {
    if (!name || name === '.' || name === '..') {
        return false;
    }
    return !/[\\/]|^\.|[\x00-\x1f]/.test(name);
}

/**
 * Return all aliases in `repos` that fail `isSafeRepoName`. Used by the
 * pre-flight in `openNode` to abort the whole open if any name would escape
 * `reposPath` — both the clone target and the generated workspace folder
 * paths share the same alias namespace, so one validation must cover both.
 *
 * Exported for unit-testing.
 */
export function findUnsafeAliases(repos: Record<string, string>): string[] {
    return Object.keys(repos).filter(name => !isSafeRepoName(name));
}

function reportUnsafeAliases(unsafe: string[], origin: string): void {
    const quoted = unsafe.map(n => `"${n}"`).join(', ');
    vscode.window.showErrorMessage(
        `Небезопасные имена в ${origin}: ${quoted}. Исправь манифест и открой контекст снова.`
    );
}

/**
 * Clone a set of aliased repos into `reposDir`. Skips entries that already exist.
 *
 * Same semantics as the main launcher clone: any failure or user cancel aborts
 * the entire batch. The caller must not proceed with a partial environment.
 *
 * Contract: all aliases in `repos` are assumed safe (pre-flight validated in
 * `openNode` via `findUnsafeAliases`). The function trusts its input — silent
 * skipping of unsafe names here would diverge from the workspace generator
 * downstream and leave a `.code-workspace` referencing escaped paths.
 */
async function cloneRepoSet(
    repos: Record<string, string>,
    reposDir: string,
    progressTitle: string
): Promise<boolean> {
    const pending: Array<{ name: string; url: string; target: string }> = [];

    for (const [name, url] of Object.entries(repos)) {
        const target = getRepoPath(reposDir, name);
        if (!(await dirExists(target))) {
            pending.push({ name, url, target });
        }
    }

    if (pending.length === 0) {
        return true;
    }

    return await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: progressTitle,
            cancellable: true
        },
        async (progress, token) => {
            try {
                await fs.mkdir(reposDir, { recursive: true });
            } catch { /* ignore if exists */ }

            for (let i = 0; i < pending.length; i++) {
                if (token.isCancellationRequested) {
                    return false;
                }
                const { name, url, target } = pending[i];
                progress.report({ message: `${name} (${i + 1}/${pending.length})` });
                const ok = await gitClone(url, target, name, token);
                if (!ok) {
                    return false;
                }
            }
            return true;
        }
    );
}

/**
 * Bring the repos of a business to disk before a window on it is opened: the
 * same pre-flight and the same cloning that opening the business itself does.
 * Used by intent windows, which show the business folder and its repos.
 *
 * @returns false when an alias is unsafe, a clone failed or the user cancelled —
 *          the caller must not open the window on a partial set of folders.
 */
export async function prepareBusinessRepos(
    label: string,
    gitRepos: Record<string, string>,
    referenceRepos: Record<string, string> | undefined,
    paths: Paths
): Promise<boolean> {
    const unsafeGit = findUnsafeAliases(gitRepos);
    if (unsafeGit.length > 0) {
        reportUnsafeAliases(unsafeGit, `${label}.git_repos`);
        return false;
    }
    const unsafeRef = findUnsafeAliases(referenceRepos ?? {});
    if (unsafeRef.length > 0) {
        reportUnsafeAliases(unsafeRef, `${label}.reference_repos`);
        return false;
    }
    if (!(await cloneRepoSet(gitRepos, paths.reposPath, `Cloning ${label}...`))) {
        return false;
    }
    return !referenceRepos || cloneRepoSet(referenceRepos, paths.reposPath, 'Cloning reference repos...');
}

/**
 * Open a context node. Every context is opened through a workspace file Duet
 * writes for it — `DuetData/workspaces/<context>.code-workspace`: the Drive
 * folder first, then one folder per `git_repos` alias, cloned when missing. A
 * context without `git_repos` gets a file of one folder. The window is opened
 * by a file in both cases because the file is where its colour lives.
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

    // Pre-flight: any unsafe alias in either `git_repos` or `reference_repos`
    // aborts the whole open. Clone and workspace generation share the same
    // alias namespace, so one validation must cover both.
    const hasGitRepos = node.hasGit && Object.keys(node.gitRepos).length > 0;
    if (hasGitRepos) {
        const unsafeGit = findUnsafeAliases(node.gitRepos);
        if (unsafeGit.length > 0) {
            reportUnsafeAliases(unsafeGit, `${node.label}.git_repos`);
            return;
        }
    }
    if (node.referenceRepos) {
        const unsafeRef = findUnsafeAliases(node.referenceRepos);
        if (unsafeRef.length > 0) {
            reportUnsafeAliases(unsafeRef, `${node.label}.reference_repos`);
            return;
        }
    }

    if (hasGitRepos) {
        const ok = await cloneRepoSet(node.gitRepos, paths.reposPath, `Cloning ${node.label}...`);
        if (!ok) {
            return;
        }
    }
    if (node.referenceRepos) {
        const refOk = await cloneRepoSet(node.referenceRepos, paths.reposPath, 'Cloning reference repos...');
        if (!refOk) {
            return;
        }
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
        await workspaceManager.writeContextWithReposWorkspace(node.label, aliases, node.id, settings);
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
    await openNode(node, false, paths);
}

export async function openInNewWindow(node: TreeNode): Promise<void> {
    const pointer = readPointer();
    const dataFolder = pointer?.duetDataPath;
    if (!dataFolder) {
        vscode.window.showErrorMessage('Duet не настроен. Запустите Duet Host.');
        return;
    }

    const paths = new Paths(dataFolder);
    await openNode(node, true, paths);
}

export function disposeGitOutputChannel(): void {
    gitOutputChannel?.dispose();
    gitOutputChannel = undefined;
}
