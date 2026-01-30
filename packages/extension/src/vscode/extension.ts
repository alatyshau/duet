import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { OnboardingProvider } from './providers/OnboardingProvider';
import { BusinessTreeProvider } from './providers/BusinessTreeProvider';
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

/**
 * Copy MCP server to DuetData for use by Claude Code, Codex, etc.
 */
function deployMcpServer(extensionUri: vscode.Uri, dataFolder: string): void {
    const srcPath = vscode.Uri.joinPath(extensionUri, 'dist', 'mcp-server.js').fsPath;
    const destDir = path.join(dataFolder, 'mcp');
    const destPath = path.join(destDir, 'mcp-server.js');

    try {
        if (!fs.existsSync(destDir)) {
            fs.mkdirSync(destDir, { recursive: true });
        }
        fs.copyFileSync(srcPath, destPath);
        console.log(`Deployed MCP server to ${destPath}`);
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

    // Onboarding View
    const onboardingProvider = new OnboardingProvider();
    context.subscriptions.push(
        vscode.window.registerTreeDataProvider('duet.onboarding', onboardingProvider)
    );

    const config = vscode.workspace.getConfiguration('duet');
    const dataFolder = config.get<string>('data_folder');

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
            const businessProvider = new BusinessTreeProvider(db, wasmPath, paths.reposPath);
            const contextProvider = new ContextProvider(db, paths);
            const projectsProvider = new ProjectsProvider(db);
            context.subscriptions.push(
                vscode.window.registerFileDecorationProvider(new TreeDecorationProvider())
            );
            
            const businessTreeView = vscode.window.createTreeView('duet.businesses', {
                treeDataProvider: businessProvider,
                showCollapseAll: false // Hide native collapse, we use toggle
            });

            // Sync selection in ДЕЛА → ПРОЕКТЫ
            businessTreeView.onDidChangeSelection(e => {
                if (e.selection.length > 0) {
                    const item = e.selection[0];
                    // Filter out VisualRoot and PlaceholderItem (they don't have entityId)
                    if ('entityId' in item) {
                        projectsProvider.setContext((item as TreeNode).id);
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
                   await refresh(context);
                   await businessProvider.refresh();
                   contextProvider.refresh();
                   projectsProvider.refresh();
                }),
                vscode.commands.registerCommand('duet.dumpIndex', () => dumpIndex(context)),
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
                vscode.commands.registerCommand('duet.addBusiness', () => addBusiness(context)),
                vscode.commands.registerCommand('duet.contextSettings', () => openDataFolderCommand(paths)), // Legacy, redirects to open
                vscode.commands.registerCommand('duet.openDataFolder', () => openDataFolderCommand(paths)),
                vscode.commands.registerCommand('duet.changeDataFolder', changeDataFolderCommand),
                vscode.commands.registerCommand('duet.showContextHelp', showContextHelpCommand),
                // Noop command — used in TreeItem.command to prevent toggle on label click
                vscode.commands.registerCommand('duet.selectNode', () => {})
            );
        } catch (e) {
            console.error('Failed to init DB:', e);
            // Fallback to stubs if DB fails
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
        // refresh command is not registered here to avoid collision if dataFolder is set but DB init fails
        // If exact stub needed: use a check or try-catch block wrapping registration
    );
}


export function deactivate() {
    disposeGitOutputChannel();
}
