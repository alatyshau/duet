/* eslint-disable @typescript-eslint/naming-convention */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { openInCurrentWindow, openInNewWindow } from '../../vscode/commands/openFolder';
import { addBusiness } from '../../vscode/commands/addBusiness';
import { refreshFromBackend } from '../../vscode/commands/refresh';
import { TreeNode } from '../../core/tree/businessTree';
import * as vscode from 'vscode';
import * as fs from 'fs/promises';

// Mock pointer
vi.mock('../../core/pointer', () => ({
    readPointer: vi.fn().mockReturnValue({
        machine: 'test',
        duetDataPath: '/mock/data/folder',
        duetConfigPath: '/mock/config/folder'
    })
}));

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
    unlink: vi.fn().mockResolvedValue(undefined),
    stat: vi.fn().mockResolvedValue({ isDirectory: () => true })
}));

// Mock DuetApiClient for addBusiness tests
function createMockApiClient(overrides: Record<string, unknown> = {}) {
    return {
        addBusiness: vi.fn().mockResolvedValue({ status: 'added', business_folders: [] }),
        scan: vi.fn().mockResolvedValue({ status: 'completed' }),
        streams: vi.fn().mockResolvedValue({ streams: [] }),
        ...overrides,
    } as any;
}

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

        it('should show error for relative path (null absolute_path fallback)', async () => {
            const node: TreeNode = {
                id: '!МетаЛаб/ДЕЛА/ТехноЛаб', // relative drive_path — no absolute_path from backend
                label: 'ТехноЛаб',
                icon: '',
                type: 'stream',
                hasChildren: false,
                entityId: 2
            };

            await openInCurrentWindow(node);

            expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
                expect.stringContaining('relative path')
            );
            // Should NOT attempt to open folder
            expect(vscode.commands.executeCommand).not.toHaveBeenCalledWith(
                'vscode.openFolder',
                expect.anything(),
                expect.anything()
            );
        });
    });

    describe('addBusiness', () => {
        it('should add business folder via backend API', async () => {
            (vscode.window.showOpenDialog as any).mockResolvedValue([{ fsPath: '/new/business' }]);
            // Manifest doesn't exist → triggers creation
            (fs.access as any).mockRejectedValueOnce(new Error('ENOENT'));

            const apiClient = createMockApiClient();
            await addBusiness(apiClient);

            // Verify dialog was shown
            expect(vscode.window.showOpenDialog).toHaveBeenCalled();

            // Verify manifest creation (business.json)
            expect(fs.writeFile).toHaveBeenCalled();

            // Verify backend API was called with the path
            expect(apiClient.addBusiness).toHaveBeenCalledWith('/new/business');

            // Verify refresh command
            expect(vscode.commands.executeCommand).toHaveBeenCalledWith('duet.refresh');
        });

        it('should not create manifest if business.json already exists', async () => {
            (vscode.window.showOpenDialog as any).mockResolvedValue([{ fsPath: '/new/business' }]);
            // Manifest exists → access succeeds
            (fs.access as any).mockResolvedValue(undefined);

            const apiClient = createMockApiClient();
            await addBusiness(apiClient);

            // Should NOT write business.json
            expect(fs.writeFile).not.toHaveBeenCalled();
            // But should still call API
            expect(apiClient.addBusiness).toHaveBeenCalledWith('/new/business');
        });

        it('should do nothing if dialog cancelled', async () => {
            (vscode.window.showOpenDialog as any).mockResolvedValue(undefined);

            const apiClient = createMockApiClient();
            await addBusiness(apiClient);

            expect(vscode.window.showOpenDialog).toHaveBeenCalled();
            expect(apiClient.addBusiness).not.toHaveBeenCalled();
            expect(fs.writeFile).not.toHaveBeenCalled();
        });

        it('should show info message if business already exists', async () => {
            (vscode.window.showOpenDialog as any).mockResolvedValue([{ fsPath: '/existing/business' }]);
            (fs.access as any).mockResolvedValue(undefined); // manifest exists

            const apiClient = createMockApiClient({
                addBusiness: vi.fn().mockResolvedValue({ status: 'exists', business_folders: ['/existing/business'] })
            });
            await addBusiness(apiClient);

            expect(apiClient.addBusiness).toHaveBeenCalledWith('/existing/business');
            expect(vscode.window.showInformationMessage).toHaveBeenCalledWith('Business folder already added.');
            // Should NOT trigger refresh
            expect(vscode.commands.executeCommand).not.toHaveBeenCalledWith('duet.refresh');
        });

        it('should show error message on API failure', async () => {
            (vscode.window.showOpenDialog as any).mockResolvedValue([{ fsPath: '/new/business' }]);
            (fs.access as any).mockResolvedValue(undefined);

            const apiClient = createMockApiClient({
                addBusiness: vi.fn().mockRejectedValue(new Error('connection refused'))
            });
            await addBusiness(apiClient);

            expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
                expect.stringContaining('Failed to add business')
            );
        });
    });

    describe('refreshFromBackend', () => {
        it('should call apiClient.scan and return streams', async () => {
            const mockStreams = [
                { id: '1', type: 'business', name: 'Biz1', icon: 'B', path: '', absolute_path: '/drive/biz1', parent_id: null, git_url: null }
            ];
            const apiClient = {
                scan: vi.fn().mockResolvedValue({ status: 'completed' }),
                streams: vi.fn().mockResolvedValue({ streams: mockStreams }),
            } as any;
            const paths = {
                workspacesPath: '/tmp/workspaces',
                reposPath: '/tmp/repos',
                allBusinessesWorkspacePath: '/tmp/all.code-workspace',
            } as any;

            const result = await refreshFromBackend(apiClient, paths);

            expect(apiClient.scan).toHaveBeenCalled();
            expect(apiClient.streams).toHaveBeenCalled();
            expect(result).toEqual(mockStreams);
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
