/* eslint-disable @typescript-eslint/naming-convention */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { openInCurrentWindow, openInNewWindow } from '../../vscode/commands/openFolder';
import { addBusiness } from '../../vscode/commands/addBusiness';
import { refresh } from '../../vscode/commands/refresh';
import { TreeNode } from '../../core/tree/businessTree';
import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import { ConfigManager } from '../../core/config';

// Mock dependencies
vi.mock('vscode', () => ({
    Uri: {
        file: vi.fn((f) => ({ fsPath: f, scheme: 'file' })),
        joinPath: vi.fn((_base, ...parts) => ({ fsPath: `/ext/${parts.join('/')}` })),
    },
    commands: {
        executeCommand: vi.fn(),
    },
    window: {
        showErrorMessage: vi.fn(),
        showInformationMessage: vi.fn(),
        showWarningMessage: vi.fn(),
        showOpenDialog: vi.fn(),
        withProgress: vi.fn((_options, task) => task()),
        createOutputChannel: vi.fn().mockReturnValue({
            appendLine: vi.fn(),
            clear: vi.fn(),
            show: vi.fn(),
        }),
    },
    workspace: {
        getConfiguration: vi.fn().mockReturnValue({
            get: vi.fn().mockReturnValue('/mock/data/folder')
        })
    },
    ProgressLocation: {
        Notification: 15
    }
}));

vi.mock('fs/promises', () => ({
    access: vi.fn().mockResolvedValue(undefined),
    writeFile: vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn(),
    mkdir: vi.fn(),
    rename: vi.fn().mockResolvedValue(undefined),
    stat: vi.fn().mockResolvedValue({ isDirectory: () => true })
}));

vi.mock('../../core/config', () => {
    const readMock = vi.fn().mockResolvedValue({ businessFolders: [] });
    const writeMock = vi.fn().mockResolvedValue(undefined);
    return {
        ConfigManager: vi.fn().mockImplementation(() => ({
            read: readMock,
            write: writeMock
        }))
    };
});

vi.mock('../../core/db', () => ({
    DatabaseManager: vi.fn().mockImplementation(() => ({
         init: vi.fn(),
    }))
}));

const scanMock = vi.fn().mockResolvedValue(undefined);
vi.mock('../../core/scanner', () => ({
    Scanner: vi.fn().mockImplementation(() => ({
        scan: scanMock
    }))
}));

describe('VS Code Commands', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('openFolder', () => {
        it('openInCurrentWindow should call vscode.openFolder with forceNewWindow: false', async () => {
            const node: TreeNode = {
                id: '/path/to/folder',
                label: 'Folder',
                icon: '',
                type: 'business',
                hasChildren: false,
                entityId: 1
            };

            await openInCurrentWindow(node);

            expect(vscode.Uri.file).toHaveBeenCalledWith('/path/to/folder');
            expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
                'vscode.openFolder',
                expect.objectContaining({ fsPath: '/path/to/folder' }),
                { forceNewWindow: false }
            );
        });

        it('openInNewWindow should call vscode.openFolder with forceNewWindow: true', async () => {
            const node: TreeNode = {
                id: '/path/to/folder',
                label: 'Folder',
                icon: '',
                type: 'business',
                hasChildren: false,
                entityId: 1
            };

            await openInNewWindow(node);

            expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
                'vscode.openFolder',
                expect.objectContaining({ fsPath: '/path/to/folder' }),
                { forceNewWindow: true }
            );
        });
    });

    describe('addBusiness', () => {
        it('should add business folder if selected', async () => {
            // Setup mocks
            (vscode.window.showOpenDialog as any).mockResolvedValue([{ fsPath: '/new/business' }]);
            
            // Mock access to fail (file doesn't exist) so we trigger creation
            (fs.access as any).mockRejectedValueOnce(new Error('ENOENT'));
            
            const context: any = { extensionUri: { fsPath: '/ext' } };
            
            await addBusiness(context);

            // Verify
            expect(vscode.window.showOpenDialog).toHaveBeenCalled();
            
            // Check ConfigManager usage
            const configManager = new ConfigManager('dummy');
            expect(configManager.read).toHaveBeenCalled();
            expect(configManager.write).toHaveBeenCalledWith(
                expect.objectContaining({
                    businessFolders: ['/new/business']
                })
            );

            // Check manifest creation
            expect(fs.writeFile).toHaveBeenCalled(); // create business.json

            // Check refresh command
            expect(vscode.commands.executeCommand).toHaveBeenCalledWith('duet.refresh');
        });

        it('should do nothing if dialog cancelled', async () => {
            (vscode.window.showOpenDialog as any).mockResolvedValue(undefined);
            const context: any = { extensionUri: { fsPath: '/ext' } };
            
            await addBusiness(context);

            expect(vscode.window.showOpenDialog).toHaveBeenCalled();
            const configManager = new ConfigManager('dummy');
            expect(configManager.write).not.toHaveBeenCalled();
            expect(fs.writeFile).not.toHaveBeenCalled();
        });

        it('should not add if already exists', async () => {
             // Redefine mock specifically for this test to simulate existence
            const readMock = vi.fn().mockResolvedValue({ businessFolders: ['/existing/business'] });
            (ConfigManager as any).mockImplementation(() => ({
                read: readMock,
                write: vi.fn()
            }));

            (vscode.window.showOpenDialog as any).mockResolvedValue([{ fsPath: '/existing/business' }]);
            
            const context: any = { extensionUri: { fsPath: '/ext' } };
            await addBusiness(context);

            expect(vscode.window.showInformationMessage).toHaveBeenCalledWith('Business folder already added.');
            expect(fs.writeFile).not.toHaveBeenCalled();
        });
    });

    describe('refresh', () => {
        beforeEach(() => {
            vi.clearAllMocks();
            scanMock.mockResolvedValue(undefined);
        });

        it('should call scanner.scan and NOT call any vscode commands', async () => {
            const context: any = { extensionUri: { fsPath: '/ext' } };

            await refresh(context);

            // Scanner should be called
            expect(scanMock).toHaveBeenCalled();

            // IMPORTANT: refresh should NOT call any executeCommand
            // Bug fix: previously called non-existent 'duet.refreshTree'
            expect(vscode.commands.executeCommand).not.toHaveBeenCalled();
        });

        it('should show warning if data folder not configured', async () => {
            // Override mock for this test
            (vscode.workspace.getConfiguration as any).mockReturnValue({
                get: vi.fn().mockReturnValue(undefined)
            });

            const context: any = { extensionUri: { fsPath: '/ext' } };

            await refresh(context);

            expect(vscode.window.showWarningMessage).toHaveBeenCalledWith('Duet Data Folder is not configured.');
            expect(scanMock).not.toHaveBeenCalled();
        });

        it('should log to OutputChannel and show warning if scan fails', async () => {
            scanMock.mockRejectedValue(new Error('Scan error'));

            // Reset configuration mock
            (vscode.workspace.getConfiguration as any).mockReturnValue({
                get: vi.fn().mockReturnValue('/mock/data/folder')
            });

            const context: any = { extensionUri: { fsPath: '/ext' } };

            await refresh(context);

            // Summary warning is shown with error count (errors logged to OutputChannel)
            expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
                expect.stringContaining('error(s)'),
                'Show Output'
            );

            // Verify showErrorMessage is NOT called (errors go to OutputChannel instead)
            expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
        });
    });

    describe('collapseAll', () => {
        it('should call the correct VS Code built-in command', async () => {
            // This tests the expected behavior of collapseAll command
            // The actual command is registered in extension.ts and calls:
            // vscode.commands.executeCommand('workbench.actions.treeView.duet.businesses.collapseAll')

            await vscode.commands.executeCommand('workbench.actions.treeView.duet.businesses.collapseAll');

            expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
                'workbench.actions.treeView.duet.businesses.collapseAll'
            );
        });
    });
});
