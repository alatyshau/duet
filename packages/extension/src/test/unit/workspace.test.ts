import { describe, it, expect, beforeEach } from 'vitest';
import {
    generateProductWorkspace,
    generateAllBusinessesWorkspace,
    WorkspaceManager
} from '../../core/workspace';
import { createMockFs } from '../../core/fs';

describe('workspace', () => {
    describe('generateProductWorkspace', () => {
        it('should create workspace with repo and drive paths', () => {
            const result = generateProductWorkspace(
                '../repos/Duet.git',
                '/Users/test/Drive/МетаЛаб/ТехноЛаб/Duet'
            );

            expect(result.folders).toHaveLength(2);
            expect(result.folders[0].path).toBe('../repos/Duet.git');
            expect(result.folders[1].path).toBe('/Users/test/Drive/МетаЛаб/ТехноЛаб/Duet');
        });

        it('should not include names by default', () => {
            const result = generateProductWorkspace(
                '../repos/Test.git',
                '/path/to/drive'
            );

            expect(result.folders[0].name).toBeUndefined();
            expect(result.folders[1].name).toBeUndefined();
        });
    });

    describe('generateAllBusinessesWorkspace', () => {
        it('should create workspace with all business folders', () => {
            const folders = [
                '/Users/test/Drive/МетаЛаб',
                '/Users/test/Drive/Семья',
                '/Users/test/Drive/База'
            ];

            const result = generateAllBusinessesWorkspace(folders);

            expect(result.folders).toHaveLength(3);
            expect(result.folders[0].path).toBe('/Users/test/Drive/МетаЛаб');
            expect(result.folders[1].path).toBe('/Users/test/Drive/Семья');
            expect(result.folders[2].path).toBe('/Users/test/Drive/База');
        });

        it('should include DuetData folder when duetDataPath provided', () => {
            const folders = ['/Users/test/Drive/МетаЛаб'];
            const result = generateAllBusinessesWorkspace(folders, '/Users/test/DuetData');

            expect(result.folders).toHaveLength(2);
            expect(result.folders[0].path).toBe('/Users/test/Drive/МетаЛаб');
            expect(result.folders[1]).toEqual({ path: '/Users/test/DuetData', name: 'DuetData' });
        });

        it('should handle empty array', () => {
            const result = generateAllBusinessesWorkspace([]);
            expect(result.folders).toHaveLength(0);
        });

        it('should handle empty array with duetDataPath', () => {
            const result = generateAllBusinessesWorkspace([], '/Users/test/DuetData');
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

        describe('getProductWorkspacePath', () => {
            it('should return correct path', () => {
                const path = manager.getProductWorkspacePath('Duet');
                expect(path).toBe('/Users/test/DuetData/workspaces/Duet.code-workspace');
            });
        });

        describe('writeProductWorkspace', () => {
            it('should write workspace file with correct content', async () => {
                const result = await manager.writeProductWorkspace(
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

                await managerWithNoDir.writeProductWorkspace('Test', '/drive/path');
                expect(mkdirCalled).toBe(true);
            });
        });

        describe('productWorkspaceExists', () => {
            it('should return true if file exists', async () => {
                const exists = await manager.productWorkspaceExists('Duet');
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

                const exists = await managerNoFile.productWorkspaceExists('NonExistent');
                expect(exists).toBe(false);
            });
        });

        describe('writeAllBusinessesWorkspace', () => {
            it('should write workspace file with business folders', async () => {
                const outputPath = '/Users/test/DuetData/all-businesses.code-workspace';
                const folders = ['/drive/МетаЛаб', '/drive/Семья'];

                await manager.writeAllBusinessesWorkspace(folders, outputPath);

                const content = writtenFiles.get(outputPath);
                expect(content).toBeDefined();

                const parsed = JSON.parse(content!);
                expect(parsed.folders).toHaveLength(2);
                expect(parsed.folders[0].path).toBe('/drive/МетаЛаб');
                expect(parsed.folders[1].path).toBe('/drive/Семья');
            });

            it('should include DuetData folder when duetDataPath provided', async () => {
                const outputPath = '/Users/test/DuetData/all-businesses.code-workspace';
                const folders = ['/drive/МетаЛаб'];

                await manager.writeAllBusinessesWorkspace(folders, outputPath, '/Users/test/DuetData');

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
