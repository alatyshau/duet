import { describe, it, expect, beforeEach } from 'vitest';
import * as path from 'path';
import {
    generateContextWithReposWorkspace,
    generateRootContextsWorkspace,
    WorkspaceManager
} from '../../core/workspace';
import { createMockFs } from '../../core/fs';

describe('workspace', () => {
    describe('generateContextWithReposWorkspace', () => {
        it('should put the Drive folder first, then repos in declared order', () => {
            const result = generateContextWithReposWorkspace(
                ['Duet', 'Duet-Instructions'],
                '/Users/test/Drive/МетаЛаб/ТехноЛаб/DuetLab'
            );

            expect(result.folders).toHaveLength(3);
            expect(result.folders[0].path).toBe('/Users/test/Drive/МетаЛаб/ТехноЛаб/DuetLab');
            expect(result.folders[1].path).toBe(path.join('..', 'repos', 'Duet.git'));
            expect(result.folders[2].path).toBe(path.join('..', 'repos', 'Duet-Instructions.git'));
        });

        it('should work with a single alias (Drive first)', () => {
            const result = generateContextWithReposWorkspace(
                ['Duet'],
                '/Users/test/Drive/Duet'
            );

            expect(result.folders).toHaveLength(2);
            expect(result.folders[0].path).toBe('/Users/test/Drive/Duet');
            expect(result.folders[1].path).toBe(path.join('..', 'repos', 'Duet.git'));
        });

        it('should preserve alias order after the Drive folder', () => {
            const result = generateContextWithReposWorkspace(
                ['Zeta', 'Alpha', 'Mu'],
                '/drive/x'
            );

            expect(result.folders.map(f => f.path)).toEqual([
                '/drive/x',
                path.join('..', 'repos', 'Zeta.git'),
                path.join('..', 'repos', 'Alpha.git'),
                path.join('..', 'repos', 'Mu.git'),
            ]);
        });

        it('should not assign names', () => {
            const result = generateContextWithReposWorkspace(['Test'], '/path/to/drive');

            expect(result.folders[0].name).toBeUndefined();
            expect(result.folders[1].name).toBeUndefined();
        });

        it('always puts the Drive context folder first (context-first is the only order)', () => {
            const result = generateContextWithReposWorkspace(['Duet'], '/drive/x');
            expect(result.folders[0].path).toBe('/drive/x');
            expect(result.folders[1].path).toBe(path.join('..', 'repos', 'Duet.git'));
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

        describe('getContextWithReposWorkspacePath', () => {
            it('should return correct path', () => {
                const p = manager.getContextWithReposWorkspacePath('DuetLab');
                expect(p).toBe(path.join('/Users/test/DuetData/workspaces', 'DuetLab.code-workspace'));
            });
        });

        describe('writeContextWithReposWorkspace', () => {
            it('should write workspace file with Drive folder first, then repos', async () => {
                const result = await manager.writeContextWithReposWorkspace(
                    'DuetLab',
                    ['Duet', 'Duet-Instructions'],
                    '/Users/test/Drive/МетаЛаб/ТехноЛаб/DuetLab'
                );

                expect(result).toBe(path.join('/Users/test/DuetData/workspaces', 'DuetLab.code-workspace'));

                const content = writtenFiles.get(result);
                expect(content).toBeDefined();

                const parsed = JSON.parse(content!);
                expect(parsed.folders).toHaveLength(3);
                expect(parsed.folders[0].path).toBe('/Users/test/Drive/МетаЛаб/ТехноЛаб/DuetLab');
                expect(parsed.folders[1].path).toBe(path.join('..', 'repos', 'Duet.git'));
                expect(parsed.folders[2].path).toBe(path.join('..', 'repos', 'Duet-Instructions.git'));
            });

            it('should work with a single alias (Drive first)', async () => {
                const result = await manager.writeContextWithReposWorkspace(
                    'Duet',
                    ['Duet'],
                    '/drive/Duet'
                );
                const content = writtenFiles.get(result);
                const parsed = JSON.parse(content!);
                expect(parsed.folders).toHaveLength(2);
                expect(parsed.folders[0].path).toBe('/drive/Duet');
                expect(parsed.folders[1].path).toBe(path.join('..', 'repos', 'Duet.git'));
            });

            it('should produce platform-normalized repo paths', async () => {
                const result = await manager.writeContextWithReposWorkspace(
                    'Test',
                    ['Test'],
                    '/drive'
                );
                const parsed = JSON.parse(writtenFiles.get(result)!);
                // Drive is folders[0]; the repo is folders[1]. path.join handles separator
                // per-platform; either '../repos/Test.git' or '..\\repos\\Test.git'.
                expect(parsed.folders[1].path).toBe(path.normalize('../repos/Test.git'));
            });

            it('should create workspaces directory if not exists', async () => {
                let mkdirCalled = false;
                const fsWithNoDir = createMockFs({
                    access: async (p) => {
                        if (p.includes('workspaces')) {
                            throw new Error('ENOENT');
                        }
                    },
                    mkdir: async () => {
                        mkdirCalled = true;
                        return undefined;
                    },
                    writeFile: async (p, data) => {
                        writtenFiles.set(p, data);
                    }
                });

                const managerWithNoDir = new WorkspaceManager(
                    '/Users/test/DuetData/workspaces',
                    '/Users/test/DuetData/repos',
                    fsWithNoDir
                );

                await managerWithNoDir.writeContextWithReposWorkspace('Test', ['Test'], '/drive/path');
                expect(mkdirCalled).toBe(true);
            });
        });

        describe('contextWithReposWorkspaceExists', () => {
            it('should return true if file exists', async () => {
                const exists = await manager.contextWithReposWorkspaceExists('DuetLab');
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

                const exists = await managerNoFile.contextWithReposWorkspaceExists('NonExistent');
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
