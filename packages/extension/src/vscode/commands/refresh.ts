import * as vscode from 'vscode';
import { DuetApiClient, ContextEntity } from '../../core/api-client';
import { WorkspaceManager } from '../../core/workspace';
import { Paths } from '../../core/paths';

/**
 * Trigger backend scan and load fresh contexts.
 *
 * Flow: apiClient.scan() → apiClient.contexts() → workspace generation.
 * Returns fresh contexts for updating providers.
 */
export async function refreshFromBackend(
    apiClient: DuetApiClient,
    paths: Paths
): Promise<ContextEntity[]> {
    // 1. Trigger backend scan
    await apiClient.scan();

    // 2. Load fresh contexts
    const { contexts } = await apiClient.contexts();

    // 3. Generate root-contexts.code-workspace from root context paths
    const rootContextFolders = contexts
        .filter(c => c.parent_id === null && c.absolute_path)
        .map(c => c.absolute_path!);

    if (rootContextFolders.length > 0) {
        const workspaceManager = new WorkspaceManager(paths.workspacesPath, paths.reposPath);
        await workspaceManager.writeRootContextsWorkspace(
            rootContextFolders,
            paths.rootContextsWorkspacePath,
            paths.root
        );
    }

    return contexts;
}

/**
 * Dump contexts data to Output channel (debug command).
 */
export async function dumpIndex(apiClient: DuetApiClient): Promise<void> {
    try {
        const { contexts } = await apiClient.contexts();
        const output = vscode.window.createOutputChannel('Duet Index');
        output.appendLine(JSON.stringify(contexts, null, 2));
        output.show();
    } catch (error) {
        vscode.window.showErrorMessage(`Failed to dump index: ${error}`);
    }
}
