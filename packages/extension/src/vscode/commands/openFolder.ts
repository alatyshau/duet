import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import { spawn } from 'child_process';
import { TreeNode } from '../../core/tree/contextTree';
import { WorkspaceManager } from '../../core/workspace';
import { Paths } from '../../core/paths';
import { readPointer } from '../../core/pointer';

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
 * Open a context node.
 * For contexts with `git_repos`: clone all aliases, generate
 * multi-root workspace, open it. For others: open the Drive folder directly.
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
        await openContextWithRepos(node, forceNewWindow, paths);
        return;
    }

    // Context without git_repos: clone any reference repos first, then open Drive folder.
    if (node.referenceRepos) {
        const ok = await cloneRepoSet(node.referenceRepos, paths.reposPath, 'Cloning reference repos...');
        if (!ok) {
            return;
        }
    }

    const uri = vscode.Uri.file(node.id);
    await vscode.commands.executeCommand('vscode.openFolder', uri, { forceNewWindow });
}

/**
 * Open a context that declares `git_repos`.
 * Clones all missing aliases, then generates and opens a multi-root workspace.
 */
async function openContextWithRepos(
    node: TreeNode,
    forceNewWindow: boolean,
    paths: Paths
): Promise<void> {
    const aliases = Object.keys(node.gitRepos);

    const ok = await cloneRepoSet(node.gitRepos, paths.reposPath, `Cloning ${node.label}...`);
    if (!ok) {
        return;
    }

    if (node.referenceRepos) {
        const refOk = await cloneRepoSet(node.referenceRepos, paths.reposPath, 'Cloning reference repos...');
        if (!refOk) {
            return;
        }
    }

    const workspaceManager = new WorkspaceManager(paths.workspacesPath, paths.reposPath);
    const workspacePath = await workspaceManager.writeContextWithReposWorkspace(
        node.label,
        aliases,
        node.id
    );

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
