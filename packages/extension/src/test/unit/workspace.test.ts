import { describe, it, expect, beforeEach } from 'vitest';
import {
    generateContextWithGitWorkspace,
    generateRootContextsWorkspace,
    WorkspaceManager
} from '../../core/workspace';
import { createMockFs } from '../../core/fs';

describe('workspace', () => {
    describe('generateContextWithGitWorkspace', () => {
        it('should create workspace with repo and drive paths', () => {
            const result = generateContextWithGitWorkspace(
                '../repos/Duet.git',
                '/Users/test/Drive/МетаЛаб/ТехноЛаб/Duet'
            );

            expect(result.folders).toHaveLength(2);
            expect(result.folders[0].path).toBe('../repos/Duet.git');
            expect(result.folders[1].path).toBe('/Users/test/Drive/МетаЛаб/ТехноЛаб/Duet');
        });

        it('should not include names by default', () => {
            const result = generateContextWithGitWorkspace(
                '../repos/Test.git',
                '/path/to/drive'
            );

            expect(result.folders[0].name).toBeUndefined();
            expect(result.folders[1].name).toBeUndefined();
        });
    });

    describe('generateRootContextsWorkspace', () => {
        it('should create workspace with all root context folders', () => {
            const folders = [
                '/Users/test/Drive/МетаЛаб',
                '/Users/test/Drive/Семья',
                '/Users/test/Drive/База'
            ];

            const result = generateRootContextsWorkspace(folders);

            expect(result.folders).toHaveLength(3);
            expect(result.folders[0].path).toBe('/Users/test/Drive/МетаЛаб');
            expect(result.folders[1].path).toBe('/Users/test/Drive/Семья');
            expect(result.folders[2].path).toBe('/Users/test/Drive/База');
        });

        it('should include DuetData folder when duetDataPath provided', () => {
            const folders = ['/Users/test/Drive/МетаЛаб'];
            const result = generateRootContextsWorkspace(folders, '/Users/test/DuetData');

            expect(result.folders).toHaveLength(2);
            expect(result.folders[0].path).toBe('/Users/test/Drive/МетаЛаб');
            expect(result.folders[1]).toEqual({ path: '/Users/test/DuetData', name: 'DuetData' });
        });

        it('should handle empty array', () => {
            const result = generateRootContextsWorkspace([]);
            expect(result.folders).toHaveLength(0);
        });

        it('should handle empty array with duetDataPath', () => {
            const result = generateRootContextsWorkspace([], '/Users/test/DuetData');
            expect(result.folders).toHaveLength(1);
            expect(result.folders[0]).toEqual({ path: '/Users/test/DuetData', name: 'DuetData' });
        });
    });

    describe('WorkspaceManager', () => {
        let manager: WorkspaceManager;
        let mockFs: ReturnType<typeof createMockFs>;
        let writtenFiles: Map<string, string>;

        beforeEach(() => {
            writtenFiles = new Map();
            mockFs = createMockFs({
                access: async () => { /* exists */ },
                mkdir: async () => undefined,
                writeFile: async (path, data) => {
                    writtenFiles.set(path, data);
                }
            });
            manager = new WorkspaceManager(
                '/Users/test/DuetData/workspaces',
                '/Users/test/DuetData/repos',
                mockFs
            );
        });

        describe('getContextWithGitWorkspacePath', () => {
            it('should return correct path', () => {
                const path = manager.getContextWithGitWorkspacePath('Duet');
                expect(path).toBe('/Users/test/DuetData/workspaces/Duet.code-workspace');
            });
        });

        describe('writeContextWithGitWorkspace', () => {
            it('should write workspace file with correct content', async () => {
                const result = await manager.writeContextWithGitWorkspace(
                    'Duet',
                    '/Users/test/Drive/МетаЛаб/ТехноЛаб/Duet'
                );

                expect(result).toBe('/Users/test/DuetData/workspaces/Duet.code-workspace');

                const content = writtenFiles.get(result);
                expect(content).toBeDefined();

                const parsed = JSON.parse(content!);
                expect(parsed.folders).toHaveLength(2);
                expect(parsed.folders[0].path).toBe('../repos/Duet.git');
                expect(parsed.folders[1].path).toBe('/Users/test/Drive/МетаЛаб/ТехноЛаб/Duet');
            });

            it('should create workspaces directory if not exists', async () => {
                let mkdirCalled = false;
                const fsWithNoDir = createMockFs({
                    access: async (path) => {
                        if (path.includes('workspaces')) {
                            throw new Error('ENOENT');
                        }
                    },
                    mkdir: async () => {
                        mkdirCalled = true;
                        return undefined;
                    },
                    writeFile: async (path, data) => {
                        writtenFiles.set(path, data);
                    }
                });

                const managerWithNoDir = new WorkspaceManager(
                    '/Users/test/DuetData/workspaces',
                    '/Users/test/DuetData/repos',
                    fsWithNoDir
                );

                await managerWithNoDir.writeContextWithGitWorkspace('Test', '/drive/path');
                expect(mkdirCalled).toBe(true);
            });
        });

        describe('contextWithGitWorkspaceExists', () => {
            it('should return true if file exists', async () => {
                const exists = await manager.contextWithGitWorkspaceExists('Duet');
                expect(exists).toBe(true);
            });

            it('should return false if file does not exist', async () => {
                const fsNoFile = createMockFs({
                    access: async () => {
                        throw new Error('ENOENT');
                    }
                });

                const managerNoFile = new WorkspaceManager(
                    '/test/workspaces',
                    '/test/repos',
                    fsNoFile
                );

                const exists = await managerNoFile.contextWithGitWorkspaceExists('NonExistent');
                expect(exists).toBe(false);
            });
        });

        describe('writeRootContextsWorkspace', () => {
            it('should write workspace file with root context folders', async () => {
                const outputPath = '/Users/test/DuetData/root-contexts.code-workspace';
                const folders = ['/drive/МетаЛаб', '/drive/Семья'];

                await manager.writeRootContextsWorkspace(folders, outputPath);

                const content = writtenFiles.get(outputPath);
                expect(content).toBeDefined();

                const parsed = JSON.parse(content!);
                expect(parsed.folders).toHaveLength(2);
                expect(parsed.folders[0].path).toBe('/drive/МетаЛаб');
                expect(parsed.folders[1].path).toBe('/drive/Семья');
            });

            it('should include DuetData folder when duetDataPath provided', async () => {
                const outputPath = '/Users/test/DuetData/root-contexts.code-workspace';
                const folders = ['/drive/МетаЛаб'];

                await manager.writeRootContextsWorkspace(folders, outputPath, '/Users/test/DuetData');

                const content = writtenFiles.get(outputPath);
                expect(content).toBeDefined();

                const parsed = JSON.parse(content!);
                expect(parsed.folders).toHaveLength(2);
                expect(parsed.folders[0].path).toBe('/drive/МетаЛаб');
                expect(parsed.folders[1]).toEqual({ path: '/Users/test/DuetData', name: 'DuetData' });
            });
        });
    });
});
