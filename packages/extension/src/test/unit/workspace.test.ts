import { describe, it, expect, beforeEach } from 'vitest';
import * as path from 'path';
import {
    generateContextWithReposWorkspace,
    metaExtraFolders,
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

        it('without settings the file is folders only, as it always was', () => {
            const result = generateContextWithReposWorkspace(['Duet'], '/drive/x');
            expect(Object.keys(result)).toEqual(['folders']);
        });

        it('carries a settings block when one is given — the colour of the business window', () => {
            // eslint-disable-next-line @typescript-eslint/naming-convention
            const settings = { 'workbench.colorCustomizations': { 'titleBar.activeBackground': '#1f6f43' } };
            const result = generateContextWithReposWorkspace(['Duet'], '/drive/x', settings);
            expect(result.settings).toEqual(settings);
            expect(result.folders.map(f => f.path)).toEqual(['/drive/x', path.join('..', 'repos', 'Duet.git')]);
        });

        it('always puts the Drive context folder first (context-first is the only order)', () => {
            const result = generateContextWithReposWorkspace(['Duet'], '/drive/x');
            expect(result.folders[0].path).toBe('/drive/x');
            expect(result.folders[1].path).toBe(path.join('..', 'repos', 'Duet.git'));
        });
    });

    describe('metaExtraFolders', () => {
        const ventures = ['/drive/База', '/drive/МетаЛаб', '/drive/Семья'];

        it('should give no folders to a business that is not meta', () => {
            expect(metaExtraFolders(false, '/drive/МетаЛаб', ventures, '/data/DuetData')).toEqual([]);
        });

        it('should give a meta business the other ventures in tree order, then DuetData', () => {
            expect(metaExtraFolders(true, '/drive/База', ventures, '/data/DuetData')).toEqual([
                { path: '/drive/МетаЛаб' },
                { path: '/drive/Семья' },
                { path: '/data/DuetData', name: 'DuetData' }
            ]);
        });

        it('should still add DuetData when the ventures are not known yet', () => {
            expect(metaExtraFolders(true, '/drive/База', [], '/data/DuetData')).toEqual([
                { path: '/data/DuetData', name: 'DuetData' }
            ]);
        });

        it('should come after the business folder and its repos in the workspace file', () => {
            const extra = metaExtraFolders(true, '/drive/База', ventures, '/data/DuetData');
            const result = generateContextWithReposWorkspace(['Duet'], '/drive/База', undefined, extra);

            expect(result.folders.map(f => f.path)).toEqual([
                '/drive/База',
                path.join('..', 'repos', 'Duet.git'),
                '/drive/МетаЛаб',
                '/drive/Семья',
                '/data/DuetData'
            ]);
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

            it('should write .kimi-code/local.toml with repos as additional_dir (Kimi multi-root workaround)', async () => {
                await manager.writeContextWithReposWorkspace(
                    'DuetLab',
                    ['Duet', 'Duet-Instructions'],
                    '/Users/test/Drive/DuetLab'
                );

                const localTomlPath = path.join('/Users/test/Drive/DuetLab', '.kimi-code', 'local.toml');
                const content = writtenFiles.get(localTomlPath);
                expect(content).toBeDefined();
                expect(content).toContain('AUTO-GENERATED by Duet');
                expect(content).toContain('[workspace]');
                // Absolute repo paths in declared alias order
                const duetDir = path.join('/Users/test/DuetData/repos', 'Duet.git');
                const instrDir = path.join('/Users/test/DuetData/repos', 'Duet-Instructions.git');
                expect(content).toContain(`additional_dir = [${JSON.stringify(duetDir)}, ${JSON.stringify(instrDir)}]`);
            });

            it('should NOT write local.toml when context declares no repos', async () => {
                await manager.writeContextWithReposWorkspace('Plain', [], '/drive/Plain');

                const localTomlPath = path.join('/drive/Plain', '.kimi-code', 'local.toml');
                expect(writtenFiles.has(localTomlPath)).toBe(false);
            });

            it('should write the additional folders of a meta business into the file and into local.toml', async () => {
                const extra = [{ path: '/drive/МетаЛаб' }, { path: '/Users/test/DuetData', name: 'DuetData' }];
                const workspacePath = await manager.writeContextWithReposWorkspace('База', [], '/drive/База', undefined, extra);

                expect(JSON.parse(writtenFiles.get(workspacePath)!).folders).toEqual([{ path: '/drive/База' }, ...extra]);
                const content = writtenFiles.get(path.join('/drive/База', '.kimi-code', 'local.toml'));
                expect(content).toContain('additional_dir = ["/drive/МетаЛаб", "/Users/test/DuetData"]');
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
    });
});
