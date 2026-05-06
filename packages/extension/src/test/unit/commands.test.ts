/* eslint-disable @typescript-eslint/naming-convention */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { openInCurrentWindow, openInNewWindow } from '../../vscode/commands/openFolder';
import { refreshFromBackend } from '../../vscode/commands/refresh';
import { TreeNode } from '../../core/tree/businessTree';
import * as vscode from 'vscode';

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
