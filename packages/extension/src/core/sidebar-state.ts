/**
 * Sidebar state management for Welcome Views.
 *
 * Uses VS Code setContext to control which view is shown in the sidebar.
 *
 * Context keys used in package.json "when" clauses:
 * - duet.ready        — main views (КОНТЕКСТ, ДЕЛА, ПРОЕКТЫ) visible
 * - duet.initializing — status view shows "Подключение к backend..."
 * - !duet.ready       — status view visible (fallback: "Установите Duet Host")
 */

import * as vscode from 'vscode';

export class SidebarStateManager {
    /**
     * Set initializing state — shows spinner in status view.
     */
    async setInitializing(_message?: string): Promise<void> {
        await Promise.all([
            vscode.commands.executeCommand('setContext', 'duet.initializing', true),
            vscode.commands.executeCommand('setContext', 'duet.ready', false),
        ]);
    }

    /**
     * Transition based on backend availability.
     * - running=true  → duet.ready=true, main views appear
     * - running=false → duet.ready=false, status view with "Установите Duet Host"
     */
    async setFromHealthCheck(running: boolean): Promise<void> {
        await Promise.all([
            vscode.commands.executeCommand('setContext', 'duet.ready', running),
            vscode.commands.executeCommand('setContext', 'duet.initializing', false),
        ]);
    }
}
