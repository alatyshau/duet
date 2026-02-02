import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { OnboardingProvider } from './providers/OnboardingProvider';
import { BusinessSectionProvider } from './providers/BusinessSectionProvider';
import { TreeDecorationProvider } from './providers/TreeDecorationProvider';
import { ContextProvider, openDataFolderCommand, changeDataFolderCommand, showContextHelpCommand } from './providers/ContextProvider';
import { ProjectsProvider } from './providers/ProjectsProvider';
import { TreeNode } from '../core/tree/businessTree';
import { selectDataFolder } from './commands/onboarding';
import { refresh } from './commands/refresh';
import { addBusiness } from './commands/addBusiness';
import { openInCurrentWindow, openInNewWindow, disposeGitOutputChannel } from './commands/openFolder';
import { dumpIndex } from './commands/refresh';
import { DatabaseManager } from '../core/db';
import { Paths } from '../core/paths';
import { BackendLifecycle, BackendError } from '../core/backend-lifecycle';
import { SidebarStateManager } from '../core/sidebar-state';

const MAX_BUSINESS_SECTIONS = 10;

// Global instances for lifecycle management
let backendLifecycle: BackendLifecycle | null = null;
let backendOutputChannel: vscode.OutputChannel | null = null;
let sidebarState: SidebarStateManager | null = null;

/**
 * Copy MCP server to DuetData for use by Claude Code, Codex, etc.
 */
function deployMcpServer(extensionUri: vscode.Uri, dataFolder: string): void {
    const distDir = vscode.Uri.joinPath(extensionUri, 'dist').fsPath;
    const destDir = path.join(dataFolder, 'mcp');

    const files = ['mcp-server.js', 'sql-wasm.wasm'];

    try {
        if (!fs.existsSync(destDir)) {
            fs.mkdirSync(destDir, { recursive: true });
        }
        for (const file of files) {
            fs.copyFileSync(path.join(distDir, file), path.join(destDir, file));
        }
        console.log(`Deployed MCP server to ${destDir}`);
    } catch (e) {
        console.error('Failed to deploy MCP server:', e);
    }
}

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

    const config = vscode.workspace.getConfiguration('duet');
    const dataFolder = config.get<string>('data_folder');

    // Set initial sidebar state
    await sidebarState.setHasDataFolder(!!dataFolder);

    // Initialize backend lifecycle (async, non-blocking)
    if (dataFolder) {
        initBackendLifecycle(context, dataFolder);
    }

    // Register backend-related commands
    context.subscriptions.push(
        vscode.commands.registerCommand('duet.retryBackend', () => retryBackend(context)),
        vscode.commands.registerCommand('duet.showPythonHelp', showPythonHelp),
        vscode.commands.registerCommand('duet.showBackendLogs', showBackendLogs)
    );

    // Register MCP server provider (VS Code 1.102+)
    // Provider reads config dynamically, so it works even if dataFolder changes
    if (vscode.lm?.registerMcpServerDefinitionProvider) {
        const serverPath = vscode.Uri.joinPath(
            context.extensionUri, 'dist', 'mcp-server.js'
        ).fsPath;

        context.subscriptions.push(
            vscode.lm.registerMcpServerDefinitionProvider('duet-ai-kit', {
                provideMcpServerDefinitions: async () => {
                    const currentDataFolder = vscode.workspace
                        .getConfiguration('duet')
                        .get<string>('data_folder');

                    if (!currentDataFolder) {
                        return []; // No server if data folder not configured
                    }

                    return [
                        new vscode.McpStdioServerDefinition(
                            'Duet AI Kit',
                            process.execPath,
                            [serverPath, '--data-dir', currentDataFolder],
                            {},
                            '1.0.0'
                        )
                    ];
                }
            })
        );
        console.log('Duet MCP server provider registered');
    }

    // Deploy MCP server to DuetData for Claude Code, Codex, etc.
    if (dataFolder) {
        deployMcpServer(context.extensionUri, dataFolder);
    }

    // Commands
    context.subscriptions.push(
        vscode.commands.registerCommand('duet.selectDataFolder', selectDataFolder)
    );

    if (dataFolder) {
        const paths = new Paths(dataFolder);
        const db = new DatabaseManager(paths);
        const wasmPath = vscode.Uri.joinPath(context.extensionUri, 'dist', 'sql-wasm.wasm').fsPath;

        try {
            await db.init({ wasmPath });

            // Create 10 business section providers
            const businessProviders: BusinessSectionProvider[] = [];
            const businessTreeViews: vscode.TreeView<unknown>[] = [];

            // Track expand state per view for toggle and accordion functionality
            const expandStates = new Map<number, boolean>();

            // Track if we're processing visibility change (prevent recursion)
            let isProcessingVisibilityChange = false;

            for (let i = 0; i < MAX_BUSINESS_SECTIONS; i++) {
                const provider = new BusinessSectionProvider(db, paths.reposPath, i);
                businessProviders.push(provider);

                const treeView = vscode.window.createTreeView(`duet.business${i}`, {
                    treeDataProvider: provider,
                    showCollapseAll: false // Using custom toggle instead
                });
                businessTreeViews.push(treeView);

                context.subscriptions.push(treeView);
                context.subscriptions.push({ dispose: () => provider.dispose() });

                // Accordion: when this section becomes visible, collapse others
                const viewIndex = i;
                treeView.onDidChangeVisibility(async (e) => {
                    if (!e.visible || isProcessingVisibilityChange) {
                        return;
                    }

                    isProcessingVisibilityChange = true;
                    try {
                        // Collapse all other business sections
                        for (let j = 0; j < businessTreeViews.length; j++) {
                            if (j !== viewIndex && businessTreeViews[j].visible) {
                                await vscode.commands.executeCommand(
                                    `workbench.actions.treeView.duet.business${j}.collapseAll`
                                );
                                expandStates.set(j, false);
                            }
                        }
                        expandStates.set(viewIndex, true);
                    } finally {
                        isProcessingVisibilityChange = false;
                    }
                });
            }

            // Helper to get business by index and open folder
            const openBusinessFolder = (index: number, forceNewWindow: boolean) => {
                const provider = businessProviders[index];
                if (!provider) {
                    return;
                }
                const business = provider.getBusiness();
                if (business) {
                    vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(business.id), { forceNewWindow });
                }
            };

            // Register parametric commands for business workspace opening
            // Note: VS Code may not pass args from menu contribution, fallback to first visible view
            const getBusinessIndex = (args?: { index: number }): number => {
                if (args?.index !== undefined) {
                    return args.index;
                }
                return businessTreeViews.findIndex(v => v.visible);
            };

            context.subscriptions.push(
                vscode.commands.registerCommand('duet.openBusinessWorkspace', (args?: { index: number }) => {
                    const index = getBusinessIndex(args);
                    if (index >= 0) {
                        openBusinessFolder(index, false);
                    }
                }),
                vscode.commands.registerCommand('duet.openBusinessWorkspaceNewWindow', (args?: { index: number }) => {
                    const index = getBusinessIndex(args);
                    if (index >= 0) {
                        openBusinessFolder(index, true);
                    }
                })
            );

            const contextProvider = new ContextProvider(db, paths);
            const projectsProvider = new ProjectsProvider(db);

            context.subscriptions.push(
                vscode.window.registerFileDecorationProvider(new TreeDecorationProvider())
            );

            /**
             * Update business section views: count, titles, descriptions.
             */
            const updateBusinessViews = () => {
                const allBusinesses = db.getEntities(null);
                const count = allBusinesses.length;

                // Set context for when clause
                vscode.commands.executeCommand('setContext', 'duet.businessCount', count);

                // Update each view's title (emoji in title so it's visible when collapsed)
                for (let i = 0; i < MAX_BUSINESS_SECTIONS; i++) {
                    const business = allBusinesses[i];
                    if (business) {
                        businessTreeViews[i].title = `${business.icon} ${business.name}`;
                    }
                }
            };

            // Initial update
            updateBusinessViews();

            // Sync selection in any business section → ПРОЕКТЫ
            for (const treeView of businessTreeViews) {
                treeView.onDidChangeSelection(e => {
                    if (e.selection.length > 0) {
                        const item = e.selection[0];
                        if (item && typeof item === 'object' && 'entityId' in item) {
                            projectsProvider.setContext((item as TreeNode).id);
                        }
                    }
                });
            }

            // Centralized workspace folder change listener (instead of per-provider)
            context.subscriptions.push(
                vscode.workspace.onDidChangeWorkspaceFolders(() => {
                    for (const provider of businessProviders) {
                        provider.notifyRefresh();
                    }
                })
            );

            context.subscriptions.push(
                vscode.window.registerTreeDataProvider('duet.context', contextProvider),
                vscode.window.registerTreeDataProvider('duet.projects', projectsProvider),
                { dispose: () => contextProvider.dispose() },
                vscode.commands.registerCommand('duet.toggleExpand', async (args?: { index: number }) => {
                    // VS Code may not pass args from menu contribution, fallback to first visible view
                    let index = args?.index;
                    if (index === undefined) {
                        index = businessTreeViews.findIndex(v => v.visible);
                        if (index === -1) {
                            return;
                        }
                    }
                    const treeView = businessTreeViews[index];
                    const provider = businessProviders[index];
                    if (!treeView || !provider) {
                        return;
                    }

                    const isExpanded = expandStates.get(index) ?? false;
                    if (isExpanded) {
                        await vscode.commands.executeCommand(`workbench.actions.treeView.duet.business${index}.collapseAll`);
                        expandStates.set(index, false);
                    } else {
                        const nodes = provider.getAllNodes();
                        for (const node of nodes) {
                            try {
                                await treeView.reveal(node, { expand: true, focus: false, select: false });
                            } catch {
                                // Node may not be expandable
                            }
                        }
                        expandStates.set(index, true);
                    }
                }),
                vscode.commands.registerCommand('duet.refresh', async () => {
                    await refresh(context);
                    // Reload DB once, then notify all providers
                    await db.reload({ wasmPath });
                    for (const provider of businessProviders) {
                        provider.notifyRefresh();
                    }
                    updateBusinessViews();
                    contextProvider.refresh();
                    projectsProvider.refresh();
                }),
                vscode.commands.registerCommand('duet.dumpIndex', () => dumpIndex(context)),
                vscode.commands.registerCommand('duet.openInCurrentWindow', openInCurrentWindow),
                vscode.commands.registerCommand('duet.openInNewWindow', openInNewWindow),
                vscode.commands.registerCommand('duet.addBusiness', () => addBusiness(context)),
                vscode.commands.registerCommand('duet.contextSettings', () => openDataFolderCommand(paths)),
                vscode.commands.registerCommand('duet.openDataFolder', () => openDataFolderCommand(paths)),
                vscode.commands.registerCommand('duet.changeDataFolder', changeDataFolderCommand),
                vscode.commands.registerCommand('duet.showContextHelp', showContextHelpCommand),
                vscode.commands.registerCommand('duet.selectNode', () => {})
            );
        } catch (e) {
            console.error('Failed to init DB:', e);
            registerStubs(context);
        }
    } else {
        registerStubs(context);
    }
}

function registerStubs(context: vscode.ExtensionContext) {
    const stubProvider = new StubProvider();

    // Register stubs for all 10 business sections
    for (let i = 0; i < MAX_BUSINESS_SECTIONS; i++) {
        context.subscriptions.push(
            vscode.window.registerTreeDataProvider(`duet.business${i}`, stubProvider)
        );
    }

    context.subscriptions.push(
        vscode.window.registerTreeDataProvider('duet.context', stubProvider),
        vscode.window.registerTreeDataProvider('duet.projects', stubProvider)
    );

    // Set businessCount to 0 so sections are hidden
    vscode.commands.executeCommand('setContext', 'duet.businessCount', 0);
}

// === Backend Lifecycle Functions ===

/**
 * Initialize backend lifecycle (async, non-blocking).
 * Called during activation if data folder is configured.
 */
function initBackendLifecycle(context: vscode.ExtensionContext, dataFolder: string): void {
    const paths = new Paths(dataFolder);

    // Create output channel for backend logs
    backendOutputChannel = vscode.window.createOutputChannel('Duet Backend');
    context.subscriptions.push(backendOutputChannel);

    // Get extension version from package.json
    const extensionVersion = context.extension.packageJSON.version as string;

    // Create lifecycle manager
    backendLifecycle = new BackendLifecycle({
        paths,
        extensionPath: context.extensionPath,
        extensionVersion,
        outputChannel: backendOutputChannel,
        onStatusChange: (status) => {
            sidebarState?.setFromBackendStatus(status);
        },
    });

    context.subscriptions.push({ dispose: () => backendLifecycle?.dispose() });

    // Start backend (async, don't await)
    sidebarState?.setInitializing('Запуск backend...');
    backendLifecycle.ensureRunning().catch((error) => {
        console.error('Backend startup failed:', error);
        if (error instanceof BackendError) {
            sidebarState?.setFromBackendStatus({
                state: 'error',
                error: error.message,
                recoverable: error.recoverable,
            });
        } else {
            sidebarState?.setError(String(error));
        }
    });
}

/**
 * Retry backend startup.
 */
async function retryBackend(context: vscode.ExtensionContext): Promise<void> {
    const dataFolder = vscode.workspace.getConfiguration('duet').get<string>('data_folder');
    if (!dataFolder) {
        vscode.window.showErrorMessage('DuetData folder not configured');
        return;
    }

    // Dispose old lifecycle
    backendLifecycle?.dispose();
    backendLifecycle = null;

    // Re-initialize
    initBackendLifecycle(context, dataFolder);
}

/**
 * Show Python installation help.
 */
function showPythonHelp(): void {
    const message = `Duet требует Python 3.10+

Скопируйте в AI чат:
"My python3 points to an old Python version. I need Python 3.10+ for Duet. Help me fix my PATH."

Или установите Python:
• macOS: brew install python@3.12
• Windows: https://www.python.org/downloads/
• Linux: sudo apt install python3.12`;

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
    backendLifecycle?.dispose();
}
