import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import { spawn } from 'child_process';
import { Paths } from '../../core/paths';

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

export function disposeGitOutputChannel(): void {
    gitOutputChannel?.dispose();
    gitOutputChannel = undefined;
}
