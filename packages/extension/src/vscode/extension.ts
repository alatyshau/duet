import * as vscode from 'vscode';
import { OnboardingProvider } from './providers/OnboardingProvider';
import { BusinessTreeProvider } from './providers/BusinessTreeProvider';
import { TreeDecorationProvider } from './providers/TreeDecorationProvider';
import { AccordionController } from './providers/AccordionController';
import { ContextProvider, openDataFolderCommand, showContextHelpCommand } from './providers/ContextProvider';
import { ProjectsProvider } from './providers/ProjectsProvider';
import { TreeNode } from '../core/tree/businessTree';
import { installHost } from './commands/onboarding';
import { readPointer, readPort } from '../core/pointer';
import { refreshFromBackend, dumpIndex } from './commands/refresh';
import { addBusiness } from './commands/addBusiness';
import { openInCurrentWindow, openInNewWindow, disposeGitOutputChannel } from './commands/openFolder';
import { Paths } from '../core/paths';
import { DuetApiClient } from '../core/api-client';
import { SidebarStateManager } from '../core/sidebar-state';

// Global instances for lifecycle management
let backendOutputChannel: vscode.OutputChannel | null = null;
let sidebarState: SidebarStateManager | null = null;
let lastHealthOk: boolean | null = null;

class StubProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
    getTreeItem(element: vscode.TreeItem): vscode.TreeItem { return element; }
    getChildren(): vscode.ProviderResult<vscode.TreeItem[]> { return Promise.resolve([]); }
}

export async function activate(context: vscode.ExtensionContext) {
    console.log('Duet extension is active');

    // Initialize sidebar state manager
    sidebarState = new SidebarStateManager();

    // Onboarding View
    const onboardingProvider = new OnboardingProvider();
    context.subscriptions.push(
        vscode.window.registerTreeDataProvider('duet.onboarding', onboardingProvider)
    );

    // Read pointer file (~/.org.ve68.duet)
    const pointer = readPointer();
    const dataFolder = pointer?.duetDataPath ?? null;

    // Set context for view visibility (package.json uses duet.hasPointer / duet.noPointer)
    await vscode.commands.executeCommand('setContext', 'duet.hasPointer', !!pointer);
    await vscode.commands.executeCommand('setContext', 'duet.noPointer', !pointer);

    // Set initial sidebar state
    await sidebarState.setHasDataFolder(!!dataFolder);

    // Register backend-related commands
    context.subscriptions.push(
        vscode.commands.registerCommand('duet.retryBackend', retryBackend),
        vscode.commands.registerCommand('duet.showPythonHelp', showPythonHelp),
        vscode.commands.registerCommand('duet.showBackendLogs', showBackendLogs)
    );

    // Commands
    context.subscriptions.push(
        vscode.commands.registerCommand('duet.installHost', installHost)
    );

    if (dataFolder) {
        const paths = new Paths(dataFolder);
        const port = readPort();
        const apiClient = new DuetApiClient(`http://127.0.0.1:${port}`);

        // Create output channel for backend logs
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

        try {
            // Load initial data from backend
            await sidebarState.setInitializing('Подключение к backend...');
            const { streams } = await apiClient.streams();

            // Backend is up — update state
            lastHealthOk = true;
            await sidebarState.setFromHealthCheck(true);
            backendOutputChannel.appendLine(`Backend OK: ${streams.length} streams loaded`);

            const businessProvider = new BusinessTreeProvider(streams, paths.reposPath);
            const contextProvider = new ContextProvider(streams, paths.reposPath);
            const projectsProvider = new ProjectsProvider(apiClient);
            context.subscriptions.push(
                vscode.window.registerFileDecorationProvider(new TreeDecorationProvider())
            );

            const businessTreeView = vscode.window.createTreeView('duet.businesses', {
                treeDataProvider: businessProvider,
                showCollapseAll: false // Hide native collapse, we use toggle
            });

            // Accordion behavior: only one business expanded at a time, expand to leaves
            const accordion = new AccordionController(businessProvider, businessTreeView);
            context.subscriptions.push(...accordion.registerListeners());
            accordion.autoExpandActive();

            // Sync selection in ДЕЛА → ПРОЕКТЫ
            businessTreeView.onDidChangeSelection(e => {
                if (e.selection.length > 0) {
                    const item = e.selection[0];
                    // Filter out VisualRoot and PlaceholderItem (they don't have entityId)
                    if ('entityId' in item) {
                        projectsProvider.setContext((item as TreeNode).entityId);
                    }
                }
            });

            // Track expand state for toggle
            let isExpanded = false;

            context.subscriptions.push(
                businessTreeView,
                vscode.window.registerTreeDataProvider('duet.context', contextProvider),
                vscode.window.registerTreeDataProvider('duet.projects', projectsProvider),
                // Add disposables
                { dispose: () => businessProvider.dispose() },
                { dispose: () => contextProvider.dispose() },
                vscode.commands.registerCommand('duet.refresh', async () => {
                    await vscode.window.withProgress({
                        location: vscode.ProgressLocation.Notification,
                        title: "Scanning Duet...",
                        cancellable: false
                    }, async () => {
                        try {
                            const newStreams = await refreshFromBackend(apiClient, paths);
                            businessProvider.updateStreams(newStreams);
                            contextProvider.updateStreams(newStreams);
                            projectsProvider.refresh();
                        } catch (error) {
                            vscode.window.showErrorMessage(`Scan failed: ${error}`);
                        }
                    });
                }),
                vscode.commands.registerCommand('duet.dumpIndex', () => dumpIndex(apiClient)),
                vscode.commands.registerCommand('duet.toggleExpand', async () => {
                    if (isExpanded) {
                        await vscode.commands.executeCommand('workbench.actions.treeView.duet.businesses.collapseAll');
                        isExpanded = false;
                    } else {
                        const nodes = businessProvider.getAllNodes();
                        for (const node of nodes) {
                            try {
                                await businessTreeView.reveal(node, { expand: true, focus: false, select: false });
                            } catch (e) {
                                console.error('Expand error:', e);
                            }
                        }
                        isExpanded = true;
                    }
                }),
                vscode.commands.registerCommand('duet.openAllBusinesses', async () => {
                    // Open multi-root workspace with all businesses in new window
                    const workspacePath = paths.allBusinessesWorkspacePath;
                    await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(workspacePath), { forceNewWindow: true });
                }),
                vscode.commands.registerCommand('duet.openAllBusinessesHere', async () => {
                    // Open multi-root workspace with all businesses in current window
                    const workspacePath = paths.allBusinessesWorkspacePath;
                    await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(workspacePath), { forceNewWindow: false });
                }),
                vscode.commands.registerCommand('duet.openInCurrentWindow', openInCurrentWindow),
                vscode.commands.registerCommand('duet.openInNewWindow', openInNewWindow),
                vscode.commands.registerCommand('duet.addBusiness', () => addBusiness(apiClient)),
                vscode.commands.registerCommand('duet.contextSettings', () => openDataFolderCommand(paths.reposPath)), // Legacy, redirects to open
                vscode.commands.registerCommand('duet.openDataFolder', () => openDataFolderCommand(paths.reposPath)),
                vscode.commands.registerCommand('duet.showContextHelp', showContextHelpCommand),
                // Noop command — used in TreeItem.command to prevent toggle on label click
                vscode.commands.registerCommand('duet.selectNode', () => {})
            );
        } catch (e) {
            console.error('Failed to connect to backend:', e);
            lastHealthOk = false;
            await sidebarState.setFromHealthCheck(false);
            backendOutputChannel.appendLine(`Backend offline: ${e}`);
            // Fallback to stubs if backend unavailable
            registerStubs(context);
        }
    } else {
        registerStubs(context);
    }
}

function registerStubs(context: vscode.ExtensionContext) {
    const stubProvider = new StubProvider();
    context.subscriptions.push(
        vscode.window.registerTreeDataProvider('duet.businesses', stubProvider),
        vscode.window.registerTreeDataProvider('duet.context', stubProvider),
        vscode.window.registerTreeDataProvider('duet.projects', stubProvider)
        // refresh command is not registered here to avoid collision if dataFolder is set but backend is down
    );
}

// === Backend Health Monitoring ===

/**
 * Check backend health and update sidebar state.
 */
async function checkBackendHealth(apiClient: DuetApiClient): Promise<void> {
    try {
        const health = await apiClient.health();
        // Log only on transition (down→up) to avoid spam
        if (lastHealthOk !== true) {
            backendOutputChannel?.appendLine(`Backend OK: v${health.version}, uptime ${Math.round(health.uptime_seconds)}s`);
        }
        lastHealthOk = true;
        await sidebarState?.setFromHealthCheck(true);
    } catch {
        if (lastHealthOk !== false) {
            backendOutputChannel?.appendLine('Backend offline');
        }
        lastHealthOk = false;
        await sidebarState?.setFromHealthCheck(false);
    }
}

/**
 * Retry backend health check.
 */
async function retryBackend(): Promise<void> {
    const retryPointer = readPointer();
    if (!retryPointer?.duetDataPath) {
        vscode.window.showErrorMessage('Duet не настроен. Запустите Duet Host.');
        return;
    }

    const port = readPort();
    const apiClient = new DuetApiClient(`http://127.0.0.1:${port}`);

    await sidebarState?.setInitializing('Проверка backend...');
    await checkBackendHealth(apiClient);
}

/**
 * Show Python installation help.
 * Kept for backward compatibility with package.json welcome views.
 */
function showPythonHelp(): void {
    const message = `Python управляется через Duet Host.

Откройте Duet Host для настройки Python и backend.`;

    vscode.window.showInformationMessage(message, { modal: true });
}

/**
 * Show backend logs in output channel.
 */
function showBackendLogs(): void {
    backendOutputChannel?.show();
}

export function deactivate() {
    disposeGitOutputChannel();
}
