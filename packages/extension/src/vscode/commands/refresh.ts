import * as vscode from 'vscode';
import { DuetApiClient, ContextEntity } from '../../core/api-client';

/**
 * Trigger backend scan and load fresh contexts.
 *
 * Flow: apiClient.scan() → apiClient.contexts().
 * Returns fresh contexts for updating providers.
 */
export async function refreshFromBackend(apiClient: DuetApiClient): Promise<ContextEntity[]> {
    // 1. Trigger backend scan
    await apiClient.scan();

    // 2. Load fresh contexts
    const { contexts } = await apiClient.contexts();

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
