import * as vscode from 'vscode';
import { ContextTreeProvider } from './providers/ContextTreeProvider';
import { TreeDecorationProvider } from './providers/TreeDecorationProvider';
import { NotepadDecorationProvider } from './providers/NotepadDecorationProvider';
import { AccordionController } from './providers/AccordionController';
import { ContextProvider, openDataFolderCommand } from './providers/ContextProvider';
import { readPointer, readPort } from '../core/pointer';
import { refreshFromBackend, dumpIndex } from './commands/refresh';
import { openInCurrentWindow, openInNewWindow, disposeGitOutputChannel } from './commands/openFolder';
import { copyAtPath } from './commands/copyAtPath';
import { Paths } from '../core/paths';
import { ContextEntity, DuetApiClient } from '../core/api-client';
import { SidebarStateManager } from '../core/sidebar-state';
import { IntentsRuntime } from './intents/IntentsRuntime';
import { setIntentsRuntime } from './intents/current';
import { ensureNotepad } from './intents/notepad';
import { IntentsProvider } from './providers/IntentsProvider';
import { BinProvider } from './providers/BinProvider';
import { BinActions, switchToIntent } from './commands/intents';
import { TicketNode } from '../core/intents/binTree';
import { ActiveIntent, rowByNumber } from '../core/intents/active';
import { binTitle } from '../core/intents/naming';

let backendOutputChannel: vscode.OutputChannel | null = null;
let sidebarState: SidebarStateManager | null = null;
let intentsRuntime: IntentsRuntime | null = null;

class StubProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
    getTreeItem(element: vscode.TreeItem): vscode.TreeItem { return element; }
    getChildren(): vscode.ProviderResult<vscode.TreeItem[]> { return Promise.resolve([]); }
}

export async function activate(context: vscode.ExtensionContext) {
    console.log('Duet extension is active');

    const pointer = readPointer();
    const dataFolder = pointer?.duetDataPath ?? null;
    const paths = dataFolder ? new Paths(dataFolder) : null;

    // An intent window says it is open first of all — before anything waits on the backend.
    // Intents are an experiment: a failure here must not take the rest of the extension down.
    if (paths) {
        try {
            intentsRuntime = new IntentsRuntime(paths);
            await intentsRuntime.announce();
            setIntentsRuntime(intentsRuntime);
            await registerIntentsView(context, intentsRuntime);
        } catch (e) {
            console.error('[Duet] intents not started:', e);
        }
    }

    // Row decorations: grey separators of «Все Бизнесы», window colours of active intents.
    // Registered here, not with the backend-dependent views: «Активная Работа» needs it with the backend down.
    context.subscriptions.push(
        vscode.window.registerFileDecorationProvider(new TreeDecorationProvider())
    );

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

    console.log('[Duet] pointer:', pointer ? `OK (${dataFolder})` : 'NULL');

    // View visibility: main views require duet.hasPointer && duet.ready (see package.json)
    await vscode.commands.executeCommand('setContext', 'duet.hasPointer', !!pointer);

    if (paths) {
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
            // Noop command — used in TreeItem.command to prevent toggle on label click
            vscode.commands.registerCommand('duet.selectNode', () => {})
        );

        // Deploy the open context's instruction components (skills / instructions)
        // into its Drive folder. Fire-and-forget and debounced: activation,
        // workspace-folder changes and `duet.refresh` can fire near-together;
        // the backend is also idempotent + serialized per context.
        let deployTimer: ReturnType<typeof setTimeout> | undefined;
        const triggerDeployInstructions = (workspacePaths: string[]): void => {
            if (deployTimer) { clearTimeout(deployTimer); }
            deployTimer = setTimeout(() => {
                void apiClient.deployInstructions(workspacePaths)
                    .then(res => {
                        if (res.warnings?.length) {
                            backendOutputChannel?.appendLine(
                                `deploy-instructions warnings: ${res.warnings.join('; ')}`
                            );
                        }
                    })
                    .catch(e => {
                        const msg = e instanceof Error ? e.message : String(e);
                        backendOutputChannel?.appendLine(`deploy-instructions failed: ${msg}`);
                    });
            }, 500);
        };
        context.subscriptions.push({ dispose: () => { if (deployTimer) { clearTimeout(deployTimer); } } });

        try {
            await sidebarState.setInitializing('Подключение к backend...');
            backendOutputChannel.appendLine(`Connecting to http://127.0.0.1:${port}/contexts...`);
            const { contexts } = await apiClient.contexts();

            backendOutputChannel.appendLine(`Backend OK: ${contexts.length} contexts loaded`);

            const initialWorkspacePaths = (vscode.workspace.workspaceFolders ?? []).map(f => f.uri.fsPath);
            triggerDeployInstructions(initialWorkspacePaths);

            const contextTreeProvider = new ContextTreeProvider(contexts);
            const contextProvider = new ContextProvider(contexts);
            let binProvider: BinProvider | null = null;
            try {
                binProvider = intentsRuntime ? registerBinView(context, intentsRuntime, paths, contexts) : null;
            } catch (e) {
                console.error('[Duet] bin view not started:', e);
            }
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
                            binProvider?.updateContexts(newContexts);
                            const currentPaths = (vscode.workspace.workspaceFolders ?? []).map(f => f.uri.fsPath);
                            triggerDeployInstructions(currentPaths);
                        } catch (error) {
                            vscode.window.showErrorMessage(`Scan failed: ${error}`);
                        }
                    });
                }),
                vscode.workspace.onDidChangeWorkspaceFolders(() => {
                    const currentPaths = (vscode.workspace.workspaceFolders ?? []).map(f => f.uri.fsPath);
                    triggerDeployInstructions(currentPaths);
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

/**
 * «Активная Работа» view: the active intents of this program. Needs only the DuetData
 * path, so it is registered before the backend is asked for anything.
 */
async function registerIntentsView(context: vscode.ExtensionContext, runtime: IntentsRuntime): Promise<void> {
    const provider = new IntentsProvider(runtime);
    const notepadColor = new NotepadDecorationProvider(runtime);
    const view = vscode.window.createTreeView('duet.intents', {
        treeDataProvider: provider,
        dragAndDropController: provider
    });
    context.subscriptions.push(
        view,
        provider,
        runtime,
        vscode.commands.registerCommand('duet.intents.refresh', () => runtime.refresh()),
        vscode.commands.registerCommand('duet.intents.switch', (row: ActiveIntent) => switchToIntent(runtime, row, view, provider)),
        // Cmd+1 … Cmd+9: the same switch as a click on the row that shows the number
        vscode.commands.registerCommand('duet.intents.switchByNumber', (number: unknown) =>
            switchToIntent(runtime, rowByNumber(runtime.getActive(), number) ?? undefined, view, provider)),
        notepadColor,
        vscode.window.registerFileDecorationProvider(notepadColor)
    );
    await runtime.watch();
    // Not awaited: the notepad must not hold up activation
    void ensureNotepad(context, runtime, file => notepadColor.setNotepad(file))
        .catch(e => console.error('[Duet] notepad:', e));
}

/**
 * «Корзина» view: the tickets of the window's business. Registered once the
 * backend has answered — the business comes from its `/contexts`.
 */
function registerBinView(
    context: vscode.ExtensionContext,
    runtime: IntentsRuntime,
    paths: Paths,
    contexts: ContextEntity[]
): BinProvider {
    const provider = new BinProvider(contexts, runtime);
    const actions = new BinActions(paths, runtime, provider);
    provider.onDrop = (sourceKey, targetKey) => actions.drop(sourceKey, targetKey);

    const view = vscode.window.createTreeView('duet.bin', {
        treeDataProvider: provider,
        dragAndDropController: provider
    });
    // The title tells whose tickets the view shows: «Корзина DuetLab»
    const showTitle = () => { view.title = binTitle(provider.currentBusiness()?.name); };
    showTitle();
    context.subscriptions.push(
        view,
        provider,
        provider.onDidChangeTreeData(showTitle),
        view.onDidChangeVisibility(event => provider.setVisible(event.visible)),
        vscode.commands.registerCommand('duet.bin.refresh', () => provider.reload()),
        vscode.commands.registerCommand('duet.bin.openHere', (node: TicketNode) => actions.open(node, false)),
        vscode.commands.registerCommand('duet.bin.openNew', (node: TicketNode) => actions.open(node, true)),
        vscode.commands.registerCommand('duet.bin.toBacklog', (node: TicketNode) => actions.toBacklog(node)),
        // Its button is in the title of «Активная Работа», but the business it needs comes from the backend
        vscode.commands.registerCommand('duet.intents.newTicket', () => actions.create())
    );
    if (view.visible) {
        provider.setVisible(true);
    }
    return provider;
}

export function deactivate() {
    intentsRuntime?.removeOwnMarkerSync();
    setIntentsRuntime(null);
    disposeGitOutputChannel();
}
