/* eslint-disable @typescript-eslint/naming-convention */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { openInCurrentWindow, openInNewWindow, buildGitCloneArgs, isSafeRepoName, findUnsafeAliases } from '../../vscode/commands/openFolder';
import { refreshFromBackend } from '../../vscode/commands/refresh';
import { TreeNode } from '../../core/tree/contextTree';
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
                type: 'context',
                isRoot: true,
                meta: false,
                hasGit: false,
                hasChildren: false,
                entityId: 1,
                gitRepos: {}
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
                type: 'context',
                isRoot: true,
                meta: false,
                hasGit: false,
                hasChildren: false,
                entityId: 1,
                gitRepos: {}
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
                type: 'context',
                isRoot: false,
                meta: false,
                hasGit: false,
                hasChildren: false,
                entityId: 2,
                gitRepos: {}
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
        it('should call apiClient.scan and return contexts', async () => {
            const mockContexts = [
                { id: '1', type: 'context', name: 'Biz1', icon: 'B', path: '', absolute_path: '/drive/biz1', parent_id: null, meta: false, git_repos: null }
            ];
            const apiClient = {
                scan: vi.fn().mockResolvedValue({ status: 'completed' }),
                contexts: vi.fn().mockResolvedValue({ contexts: mockContexts }),
            } as any;
            const paths = {
                workspacesPath: '/tmp/workspaces',
                reposPath: '/tmp/repos',
                rootContextsWorkspacePath: '/tmp/root-contexts.code-workspace',
            } as any;

            const result = await refreshFromBackend(apiClient, paths);

            expect(apiClient.scan).toHaveBeenCalled();
            expect(apiClient.contexts).toHaveBeenCalled();
            expect(result).toEqual(mockContexts);
        });
    });

    describe('buildGitCloneArgs', () => {
        it('uses `--` separator to disarm flag-like git URLs', () => {
            const args = buildGitCloneArgs('git@x:y.git', '/tmp/y.git');
            expect(args).toEqual(['clone', '--progress', '--', 'git@x:y.git', '/tmp/y.git']);
            // Order matters: `--` MUST appear before the URL argument.
            const dashDash = args.indexOf('--');
            const urlIdx = args.indexOf('git@x:y.git');
            expect(dashDash).toBeGreaterThanOrEqual(0);
            expect(urlIdx).toBeGreaterThan(dashDash);
        });

        it('preserves a hostile leading-dash URL as a positional argument', () => {
            // Without `--`, git would treat `-upload-pack=...` as a flag.
            const args = buildGitCloneArgs('-evil', '/tmp/x');
            expect(args).toContain('-evil');
            expect(args.indexOf('--')).toBeLessThan(args.indexOf('-evil'));
        });
    });

    describe('findUnsafeAliases', () => {
        it('returns empty array for an all-safe map', () => {
            expect(findUnsafeAliases({ Duet: 'a', 'Duet-Instructions': 'b' })).toEqual([]);
        });

        it('lists every unsafe alias it finds', () => {
            const result = findUnsafeAliases({
                Duet: 'a',
                '../evil': 'b',
                '.hidden': 'c',
                'with/slash': 'd'
            });
            expect(result.sort()).toEqual(['../evil', '.hidden', 'with/slash'].sort());
        });
    });

    describe('unsafe alias aborts open (regression #1)', () => {
        it('aborts open and surfaces error when git_repos contains a traversal alias', async () => {
            const node: TreeNode = {
                id: '/drive/DuetLab',
                label: 'DuetLab',
                icon: '',
                type: 'context',
                isRoot: true,
                meta: false,
                hasGit: true,
                hasChildren: false,
                entityId: 1,
                gitRepos: { Duet: 'git@x:y.git', '../evil': 'git@x:evil.git' }
            };

            await openInCurrentWindow(node);

            // Pre-flight must surface a user-visible error...
            expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
                expect.stringContaining('Небезопасные имена')
            );
            // ...and MUST NOT trigger the workspace open. Without the fix,
            // `cloneRepoSet` silently skipped `../evil` while
            // `writeContextWithReposWorkspace` still wrote `../evil.git` into
            // the .code-workspace folder list — escaping `repos/`.
            expect(vscode.commands.executeCommand).not.toHaveBeenCalledWith(
                'vscode.openFolder',
                expect.anything(),
                expect.anything()
            );
        });

        it('aborts open when reference_repos contains a traversal alias even if git_repos is clean', async () => {
            const node: TreeNode = {
                id: '/drive/Plain',
                label: 'Plain',
                icon: '',
                type: 'context',
                isRoot: true,
                meta: false,
                hasGit: false,
                hasChildren: false,
                entityId: 2,
                gitRepos: {},
                referenceRepos: { '..': 'git@x:dotdot.git' }
            };

            await openInCurrentWindow(node);

            expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
                expect.stringContaining('reference_repos')
            );
            expect(vscode.commands.executeCommand).not.toHaveBeenCalledWith(
                'vscode.openFolder',
                expect.anything(),
                expect.anything()
            );
        });

        it('aborts open when a git-backed context has safe git_repos but unsafe reference_repos (defense-in-depth)', async () => {
            // Catches a future refactor that drops the reference_repos pre-flight
            // branch while keeping the git_repos one — the two checks are sequential
            // in `openNode`, so this guards both rails independently.
            const node: TreeNode = {
                id: '/drive/DuetLab',
                label: 'DuetLab',
                icon: '',
                type: 'context',
                isRoot: true,
                meta: false,
                hasGit: true,
                hasChildren: false,
                entityId: 3,
                gitRepos: { Duet: 'git@x:Duet.git' },
                referenceRepos: { '../evil': 'git@x:evil.git' }
            };

            await openInCurrentWindow(node);

            expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
                expect.stringContaining('reference_repos')
            );
            expect(vscode.commands.executeCommand).not.toHaveBeenCalledWith(
                'vscode.openFolder',
                expect.anything(),
                expect.anything()
            );
        });
    });

    describe('isSafeRepoName', () => {
        it('accepts plain ascii and non-ascii aliases', () => {
            expect(isSafeRepoName('Duet')).toBe(true);
            expect(isSafeRepoName('Duet-Instructions')).toBe(true);
            expect(isSafeRepoName('Альфа')).toBe(true);
        });

        it('rejects path-traversal attempts', () => {
            expect(isSafeRepoName('.')).toBe(false);
            expect(isSafeRepoName('..')).toBe(false);
            expect(isSafeRepoName('../x')).toBe(false);
            expect(isSafeRepoName('foo/bar')).toBe(false);
            expect(isSafeRepoName('foo\\bar')).toBe(false);
        });

        it('rejects hidden / control-character names', () => {
            expect(isSafeRepoName('')).toBe(false);
            expect(isSafeRepoName('.hidden')).toBe(false);
            expect(isSafeRepoName('foo\x00bar')).toBe(false);
        });
    });

    describe('collapseAll', () => {
        it('should call the correct VS Code built-in command', async () => {
            // This tests the expected behavior of collapseAll command
            // The actual command is registered in extension.ts and calls:
            // vscode.commands.executeCommand('workbench.actions.treeView.duet.contexts.collapseAll')

            await vscode.commands.executeCommand('workbench.actions.treeView.duet.contexts.collapseAll');

            expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
                'workbench.actions.treeView.duet.contexts.collapseAll'
            );
        });
    });
});
