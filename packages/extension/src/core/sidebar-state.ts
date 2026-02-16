/**
 * Sidebar state management for Welcome Views.
 *
 * Uses VS Code setContext to control which Welcome View is shown.
 * States: NO_DATA_FOLDER → INITIALIZING → READY
 */

import * as vscode from 'vscode';

/**
 * Context keys for sidebar states.
 * Used in package.json "when" clauses.
 */
export const CONTEXT_KEYS = {
    hasDataFolder: 'duet.hasDataFolder',
    initializing: 'duet.initializing',
    initFailed: 'duet.initFailed',
    initFailedPython: 'duet.initFailed.python',
    ready: 'duet.ready',
    errorMessage: 'duet.errorMessage',
} as const;

export type SidebarState =
    | 'NO_DATA_FOLDER'
    | 'INITIALIZING'
    | 'READY'
    | 'ERROR_PYTHON'
    | 'ERROR_OTHER';

export class SidebarStateManager {
    private currentState: SidebarState = 'NO_DATA_FOLDER';

    /**
     * Set state based on data folder presence.
     */
    async setHasDataFolder(hasFolder: boolean): Promise<void> {
        await vscode.commands.executeCommand(
            'setContext',
            CONTEXT_KEYS.hasDataFolder,
            hasFolder
        );

        if (!hasFolder) {
            this.currentState = 'NO_DATA_FOLDER';
            await this.clearOtherStates();
        }
    }

    /**
     * Set state based on backend health check result.
     * Called by extension on activation and manual retry.
     */
    async setFromHealthCheck(running: boolean): Promise<void> {
        if (running) {
            await this.setReady();
        } else {
            await this.setError('Backend не запущен. Запустите Duet Host.');
        }
    }

    /**
     * Set initializing state with message.
     */
    async setInitializing(message?: string): Promise<void> {
        this.currentState = 'INITIALIZING';

        await Promise.all([
            vscode.commands.executeCommand('setContext', CONTEXT_KEYS.initializing, true),
            vscode.commands.executeCommand('setContext', CONTEXT_KEYS.ready, false),
            vscode.commands.executeCommand('setContext', CONTEXT_KEYS.initFailed, false),
            vscode.commands.executeCommand('setContext', CONTEXT_KEYS.initFailedPython, false),
        ]);

        if (message) {
            await vscode.commands.executeCommand('setContext', CONTEXT_KEYS.errorMessage, message);
        }
    }

    /**
     * Set ready state.
     */
    async setReady(): Promise<void> {
        this.currentState = 'READY';

        await Promise.all([
            vscode.commands.executeCommand('setContext', CONTEXT_KEYS.ready, true),
            vscode.commands.executeCommand('setContext', CONTEXT_KEYS.initializing, false),
            vscode.commands.executeCommand('setContext', CONTEXT_KEYS.initFailed, false),
            vscode.commands.executeCommand('setContext', CONTEXT_KEYS.initFailedPython, false),
            vscode.commands.executeCommand('setContext', CONTEXT_KEYS.errorMessage, ''),
        ]);
    }

    /**
     * Set Python error state.
     */
    async setErrorPython(message: string): Promise<void> {
        this.currentState = 'ERROR_PYTHON';

        await Promise.all([
            vscode.commands.executeCommand('setContext', CONTEXT_KEYS.initFailed, true),
            vscode.commands.executeCommand('setContext', CONTEXT_KEYS.initFailedPython, true),
            vscode.commands.executeCommand('setContext', CONTEXT_KEYS.initializing, false),
            vscode.commands.executeCommand('setContext', CONTEXT_KEYS.ready, false),
            vscode.commands.executeCommand('setContext', CONTEXT_KEYS.errorMessage, message),
        ]);
    }

    /**
     * Set generic error state.
     */
    async setError(message: string): Promise<void> {
        this.currentState = 'ERROR_OTHER';

        await Promise.all([
            vscode.commands.executeCommand('setContext', CONTEXT_KEYS.initFailed, true),
            vscode.commands.executeCommand('setContext', CONTEXT_KEYS.initFailedPython, false),
            vscode.commands.executeCommand('setContext', CONTEXT_KEYS.initializing, false),
            vscode.commands.executeCommand('setContext', CONTEXT_KEYS.ready, false),
            vscode.commands.executeCommand('setContext', CONTEXT_KEYS.errorMessage, message),
        ]);
    }

    /**
     * Get current state.
     */
    getState(): SidebarState {
        return this.currentState;
    }

    private async clearOtherStates(): Promise<void> {
        await Promise.all([
            vscode.commands.executeCommand('setContext', CONTEXT_KEYS.initializing, false),
            vscode.commands.executeCommand('setContext', CONTEXT_KEYS.ready, false),
            vscode.commands.executeCommand('setContext', CONTEXT_KEYS.initFailed, false),
            vscode.commands.executeCommand('setContext', CONTEXT_KEYS.initFailedPython, false),
        ]);
    }
}
