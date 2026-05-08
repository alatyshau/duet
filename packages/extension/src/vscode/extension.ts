import * as vscode from 'vscode';
import { ContextTreeProvider } from './providers/ContextTreeProvider';
import { TreeDecorationProvider } from './providers/TreeDecorationProvider';
import { AccordionController } from './providers/AccordionController';
import { ContextProvider, openDataFolderCommand, showContextHelpCommand } from './providers/ContextProvider';
import { readPointer, readPort } from '../core/pointer';
import { refreshFromBackend, dumpIndex } from './commands/refresh';
import { openInCurrentWindow, openInNewWindow, disposeGitOutputChannel } from './commands/openFolder';
import { copyAtPath } from './commands/copyAtPath';
import { Paths } from '../core/paths';
import { DuetApiClient } from '../core/api-client';
import { SidebarStateManager } from '../core/sidebar-state';

let backendOutputChannel: vscode.OutputChannel | null = null;
let sidebarState: SidebarStateManager | null = null;

class StubProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
    getTreeItem(element: vscode.TreeItem): vscode.TreeItem { return element; }
    getChildren(): vscode.ProviderResult<vscode.TreeItem[]> { return Promise.resolve([]); }
}

export async function activate(context: vscode.ExtensionContext) {
    console.log('Duet extension is active');

    sidebarState = new SidebarStateManager();

    // Status view — shown when backend is not ready (no pointer, backend offline, etc.)
    // Uses viewsWelcome from package.json for content
    context.subscriptions.push(
        vscode.window.registerTreeDataProvider('duet.status', new StubProvider())
    );

    // Workspace-only commands — no pointer or backend required
    context.subscriptions.push(
        vscode.commands.registerCommand('duet.copyAtPath', copyAtPath)
    );

    const pointer = readPointer();
    const dataFolder = pointer?.duetDataPath ?? null;
    console.log('[Duet] pointer:', pointer ? `OK (${dataFolder})` : 'NULL');

    // View visibility: main views require duet.hasPointer && duet.ready (see package.json)
    await vscode.commands.executeCommand('setContext', 'duet.hasPointer', !!pointer);

    if (dataFolder) {
        const paths = new Paths(dataFolder);
        const port = readPort();
        console.log('[Duet] port:', port);
        const apiClient = new DuetApiClient(`http://127.0.0.1:${port}`);

        backendOutputChannel = vscode.window.createOutputChannel('Duet Backend');
        context.subscriptions.push(backendOutputChannel);

        // Register MCP server for Copilot (VS Code 1.102+)
        // Uses Backend HTTP MCP — same endpoint as Claude Code and Codex
        if (vscode.lm?.registerMcpServerDefinitionProvider) {
            context.subscriptions.push(
                vscode.lm.registerMcpServerDefinitionProvider('duet', {
                    provideMcpServerDefinitions: async () => [
                        new vscode.McpHttpServerDefinition(
                            'Duet',
                            vscode.Uri.parse(`http://127.0.0.1:${port}/mcp`)
                        )
                    ]
                })
            );
        }

        // Backend-independent commands — work even when backend is down
        context.subscriptions.push(
            vscode.commands.registerCommand('duet.openAllRootContexts', async () => {
                const workspacePath = paths.rootContextsWorkspacePath;
                await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(workspacePath), { forceNewWindow: true });
            }),
            vscode.commands.registerCommand('duet.openAllRootContextsHere', async () => {
                const workspacePath = paths.rootContextsWorkspacePath;
                await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(workspacePath), { forceNewWindow: false });
            }),
            vscode.commands.registerCommand('duet.openInCurrentWindow', openInCurrentWindow),
            vscode.commands.registerCommand('duet.openInNewWindow', openInNewWindow),
            vscode.commands.registerCommand('duet.contextSettings', () => openDataFolderCommand(paths.reposPath)),
            vscode.commands.registerCommand('duet.openDataFolder', () => openDataFolderCommand(paths.reposPath)),
            vscode.commands.registerCommand('duet.showContextHelp', showContextHelpCommand),
            // Noop command — used in TreeItem.command to prevent toggle on label click
            vscode.commands.registerCommand('duet.selectNode', () => {})
        );

        try {
            await sidebarState.setInitializing('Подключение к backend...');
            backendOutputChannel.appendLine(`Connecting to http://127.0.0.1:${port}/contexts...`);
            const { contexts } = await apiClient.contexts();

            backendOutputChannel.appendLine(`Backend OK: ${contexts.length} contexts loaded`);

            const contextTreeProvider = new ContextTreeProvider(contexts, paths.reposPath);
            const contextProvider = new ContextProvider(contexts, paths.reposPath);
            context.subscriptions.push(
                vscode.window.registerFileDecorationProvider(new TreeDecorationProvider())
            );

            const contextTreeView = vscode.window.createTreeView('duet.contexts', {
                treeDataProvider: contextTreeProvider,
                showCollapseAll: false // Hide native collapse, we use toggle
            });

            // Accordion behavior: only one root expanded at a time, expand to leaves
            const accordion = new AccordionController(contextTreeProvider, contextTreeView);
            context.subscriptions.push(...accordion.registerListeners());
            accordion.autoExpandActive();

            // Track expand state for toggle
            let isExpanded = false;

            // Backend-dependent commands — require live connection
            context.subscriptions.push(
                contextTreeView,
                vscode.window.registerTreeDataProvider('duet.context', contextProvider),
                { dispose: () => contextTreeProvider.dispose() },
                { dispose: () => contextProvider.dispose() },
                vscode.commands.registerCommand('duet.refresh', async () => {
                    await vscode.window.withProgress({
                        location: vscode.ProgressLocation.Notification,
                        title: "Scanning Duet...",
                        cancellable: false
                    }, async () => {
                        try {
                            const newContexts = await refreshFromBackend(apiClient, paths);
                            contextTreeProvider.updateContexts(newContexts);
                            contextProvider.updateContexts(newContexts);
                        } catch (error) {
                            vscode.window.showErrorMessage(`Scan failed: ${error}`);
                        }
                    });
                }),
                vscode.commands.registerCommand('duet.dumpIndex', () => dumpIndex(apiClient)),
                vscode.commands.registerCommand('duet.toggleExpand', async () => {
                    if (isExpanded) {
                        await vscode.commands.executeCommand('workbench.actions.treeView.duet.contexts.collapseAll');
                        isExpanded = false;
                    } else {
                        const nodes = contextTreeProvider.getAllNodes();
                        for (const node of nodes) {
                            try {
                                await contextTreeView.reveal(node, { expand: true, focus: false, select: false });
                            } catch (e) {
                                console.error('Expand error:', e);
                            }
                        }
                        isExpanded = true;
                    }
                })
            );

            // Set ready AFTER providers are registered — views become visible only when providers exist
            await sidebarState.setFromHealthCheck(true);
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            console.error('Failed to connect to backend:', msg);
            await sidebarState.setFromHealthCheck(false);
            backendOutputChannel.appendLine(`Backend offline: ${msg}`);
            backendOutputChannel.show(true); // Show output panel so user sees the error
        }
    }
}

export function deactivate() {
    disposeGitOutputChannel();
}
