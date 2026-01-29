import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as path from 'path';

// We need to mock process.platform for Windows tests
// Import the module after setting up mocks

describe('pathUtils', () => {
    describe('isPathInside (Unix)', () => {
        let isPathInside: (childPath: string, parentPath: string) => boolean;

        beforeEach(async () => {
            vi.resetModules();
            // Mock Unix platform
            vi.stubGlobal('process', { ...process, platform: 'darwin' });
            const module = await import('../../core/pathUtils');
            isPathInside = module.isPathInside;
        });

        afterEach(() => {
            vi.unstubAllGlobals();
        });

        it('should return true for direct child', () => {
            expect(isPathInside('/repos/Duet.git', '/repos')).toBe(true);
            expect(isPathInside('/repos/Duet.git', '/repos/')).toBe(true);
        });

        it('should return true for nested child', () => {
            expect(isPathInside('/repos/sub/Duet.git', '/repos')).toBe(true);
        });

        it('should return false for sibling', () => {
            expect(isPathInside('/other/Duet.git', '/repos')).toBe(false);
        });

        it('should return false for parent', () => {
            expect(isPathInside('/repos', '/repos/Duet.git')).toBe(false);
        });

        it('should return false for equal paths', () => {
            expect(isPathInside('/repos', '/repos')).toBe(false);
            expect(isPathInside('/repos/', '/repos')).toBe(false);
        });

        it('should handle trailing separators', () => {
            expect(isPathInside('/repos/Duet.git', '/repos/')).toBe(true);
            expect(isPathInside('/repos/Duet.git/', '/repos')).toBe(true);
        });

        it('should handle paths with similar prefixes', () => {
            // /repos-backup is NOT inside /repos
            expect(isPathInside('/repos-backup/file', '/repos')).toBe(false);
        });
    });

    describe('isPathInside (Windows)', () => {
        let isPathInside: (childPath: string, parentPath: string) => boolean;

        beforeEach(async () => {
            vi.resetModules();
            // Mock Windows platform
            vi.stubGlobal('process', { ...process, platform: 'win32' });
            const module = await import('../../core/pathUtils');
            isPathInside = module.isPathInside;
        });

        afterEach(() => {
            vi.unstubAllGlobals();
        });

        it('should be case-insensitive on Windows', () => {
            // Note: path.normalize on non-Windows still uses forward slashes
            // This test verifies case-insensitivity logic
            expect(isPathInside('/Repos/Duet.git', '/repos')).toBe(true);
            expect(isPathInside('/repos/Duet.git', '/REPOS')).toBe(true);
        });
    });

    describe('normalizePath', () => {
        let normalizePath: (p: string) => string;

        describe('on Unix', () => {
            beforeEach(async () => {
                vi.resetModules();
                vi.stubGlobal('process', { ...process, platform: 'darwin' });
                const module = await import('../../core/pathUtils');
                normalizePath = module.normalizePath;
            });

            afterEach(() => {
                vi.unstubAllGlobals();
            });

            it('should preserve case on Unix', () => {
                expect(normalizePath('/Repos/Duet')).toBe('/Repos/Duet');
            });

            it('should normalize path separators', () => {
                expect(normalizePath('/repos//Duet')).toBe('/repos/Duet');
            });
        });

        describe('on Windows', () => {
            beforeEach(async () => {
                vi.resetModules();
                vi.stubGlobal('process', { ...process, platform: 'win32' });
                const module = await import('../../core/pathUtils');
                normalizePath = module.normalizePath;
            });

            afterEach(() => {
                vi.unstubAllGlobals();
            });

            it('should lowercase on Windows', () => {
                const result = normalizePath('/Repos/Duet');
                expect(result.toLowerCase()).toBe(result);
            });
        });
    });
});
