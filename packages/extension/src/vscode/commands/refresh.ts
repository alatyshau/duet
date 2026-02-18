import * as vscode from 'vscode';
import { DuetApiClient, StreamEntity } from '../../core/api-client';
import { WorkspaceManager } from '../../core/workspace';
import { Paths } from '../../core/paths';

/**
 * Trigger backend scan and load fresh streams.
 *
 * Flow: apiClient.scan() → apiClient.streams() → workspace generation.
 * Returns fresh streams for updating providers.
 */
export async function refreshFromBackend(
    apiClient: DuetApiClient,
    paths: Paths
): Promise<StreamEntity[]> {
    // 1. Trigger backend scan
    await apiClient.scan();

    // 2. Load fresh streams
    const { streams } = await apiClient.streams();

    // 3. Generate all-businesses workspace from business paths
    const businessFolders = streams
        .filter(s => s.parent_id === null && s.type === 'business' && s.absolute_path)
        .map(s => s.absolute_path!);

    if (businessFolders.length > 0) {
        const workspaceManager = new WorkspaceManager(paths.workspacesPath, paths.reposPath);
        await workspaceManager.writeAllBusinessesWorkspace(
            businessFolders,
            paths.allBusinessesWorkspacePath
        );
    }

    return streams;
}

/**
 * Dump streams data to Output channel (debug command).
 */
export async function dumpIndex(apiClient: DuetApiClient): Promise<void> {
    try {
        const { streams } = await apiClient.streams();
        const output = vscode.window.createOutputChannel('Duet Index');
        output.appendLine(JSON.stringify(streams, null, 2));
        output.show();
    } catch (error) {
        vscode.window.showErrorMessage(`Failed to dump index: ${error}`);
    }
}
