import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import { spawn } from 'child_process';
import { TreeNode } from '../../core/tree/businessTree';
import { WorkspaceManager } from '../../core/workspace';
import { Paths } from '../../core/paths';
import { readPointer } from '../../core/pointer';

// Output channel for git operations
let gitOutputChannel: vscode.OutputChannel | undefined;

function getGitOutputChannel(): vscode.OutputChannel {
    if (!gitOutputChannel) {
        gitOutputChannel = vscode.window.createOutputChannel('Duet Git');
    }
    return gitOutputChannel;
}

/**
 * Check if directory exists
 */
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
 * Returns true on success, false on failure/cancel.
 *
 * Uses a resolved flag to prevent duplicate finalization when:
 * - User cancels (cancelListener fires before process closes)
 * - Process errors (error event may fire before/after close)
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

        const proc = spawn('git', ['clone', '--progress', gitUrl, targetDir], {
            stdio: ['ignore', 'pipe', 'pipe']
        });

        // Handle cancellation
        const cancelListener = token.onCancellationRequested(() => {
            proc.kill('SIGTERM');
            finalize(false, '\n[Cancelled by user]');
        });

        proc.stdout?.on('data', (data: Buffer) => {
            outputChannel.append(data.toString());
        });

        proc.stderr?.on('data', (data: Buffer) => {
            // Git sends progress to stderr
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

/**
 * Get repo path in DuetData/repos/ for a product.
 * Format: {ProductName}.git
 */
function getRepoPath(reposDir: string, productName: string): string {
    return path.join(reposDir, `${productName}.git`);
}

/**
 * Open a node (business/stream/product/project).
 * For products with git_url: clone if needed, generate workspace, open.
 * For others: just open the Drive folder.
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

    // Guard: node.id must be an absolute path (from backend absolute_path).
    // If backend returned null absolute_path, node.id falls back to relative drive_path
    // which is meaningless for filesystem operations.
    if (!path.isAbsolute(node.id)) {
        vscode.window.showErrorMessage(
            `Cannot open "${node.label}": backend returned relative path. Check settings.json business_folders and reposPath.`
        );
        return;
    }

    // For products with git_url: handle git clone and workspace
    if (node.type === 'product' && node.gitUrl) {
        await openProductWithGit(node, forceNewWindow, paths);
        return;
    }

    // For everything else: just open the Drive folder
    const uri = vscode.Uri.file(node.id);
    await vscode.commands.executeCommand('vscode.openFolder', uri, { forceNewWindow });
}

/**
 * Open a product with git repository.
 * Clones if needed, generates workspace, opens workspace file.
 */
async function openProductWithGit(
    node: TreeNode,
    forceNewWindow: boolean,
    paths: Paths
): Promise<void> {
    const repoPath = getRepoPath(paths.reposPath, node.label);
    const repoExists = await dirExists(repoPath);

    // Clone if repo doesn't exist
    if (!repoExists) {
        const shouldClone = await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: `Cloning ${node.label}...`,
                cancellable: true
            },
            async (progress, token) => {
                // Ensure repos directory exists
                try {
                    await fs.mkdir(paths.reposPath, { recursive: true });
                } catch { /* ignore if exists */ }

                progress.report({ message: 'Running git clone...' });
                return await gitClone(node.gitUrl!, repoPath, node.label, token);
            }
        );

        if (!shouldClone) {
            // Cancelled or failed
            return;
        }
    }

    // Generate/update workspace file
    const workspaceManager = new WorkspaceManager(paths.workspacesPath, paths.reposPath);
    const workspacePath = await workspaceManager.writeProductWorkspace(node.label, node.id);

    // Open workspace
    const uri = vscode.Uri.file(workspacePath);
    await vscode.commands.executeCommand('vscode.openFolder', uri, { forceNewWindow });
}

/**
 * Command: Open in current window (button [↵])
 */
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

/**
 * Command: Open in new window (button [→])
 */
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

/**
 * Dispose output channel (call on extension deactivate)
 */
export function disposeGitOutputChannel(): void {
    gitOutputChannel?.dispose();
    gitOutputChannel = undefined;
}
