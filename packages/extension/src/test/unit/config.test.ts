import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as path from 'path';
import * as os from 'os';
import { ConfigManager } from '../../core/config';
import { FileSystem } from '../../core/fs';
import { Paths } from '../../core/paths';

describe('Paths', () => {
    it('should use default data folder if not provided', () => {
        const paths = new Paths();
        expect(paths.configPath).toBe(path.join(os.homedir(), 'DuetData', 'config.json'));
        expect(paths.allBusinessesWorkspacePath).toBe(path.join(os.homedir(), 'DuetData', 'all-businesses.code-workspace'));
        expect(paths.workspacesPath).toBe(path.join(os.homedir(), 'DuetData', 'workspaces'));
    });

    it('should use provided data folder', () => {
        const customPath = '/custom/path';
        const paths = new Paths(customPath);
        expect(paths.configPath).toBe(path.join(customPath, 'config.json'));
    });

    it('should expand tilde in data folder path', () => {
        const paths = new Paths('~/DuetData');
        expect(paths.configPath).toBe(path.join(os.homedir(), 'DuetData', 'config.json'));
    });

    it('should NOT expand tilde in ~someone path', () => {
        const paths = new Paths('~someone/data');
        expect(paths.configPath).toBe(path.normalize('~someone/data/config.json'));
    });
});

describe('ConfigManager', () => {
    const mockConfigPath = '/mock/config.json';
    let configManager: ConfigManager;
    let mockFs: FileSystem;

    beforeEach(() => {
        mockFs = {
            access: vi.fn(),
            readFile: vi.fn(),
            writeFile: vi.fn(),
            mkdir: vi.fn(),
            readdir: vi.fn(), // Not used by ConfigManager, but required by interface
            rename: vi.fn(),  // Not used by ConfigManager, but required by interface
            unlink: vi.fn(),  // Not used by ConfigManager, but required by interface
            atomicWriteFile: vi.fn(), // Used by ConfigManager for atomic writes
        };
        configManager = new ConfigManager(mockConfigPath, mockFs);
    });

    it('should return empty config if file does not exist', async () => {
        vi.mocked(mockFs.access).mockRejectedValue(new Error('ENOENT'));
        const config = await configManager.read();
        expect(config.businessFolders).toEqual([]);
    });

    it('should read and parse config file', async () => {
        vi.mocked(mockFs.access).mockResolvedValue(undefined);
        // eslint-disable-next-line @typescript-eslint/naming-convention
        vi.mocked(mockFs.readFile).mockResolvedValue(JSON.stringify({ business_folders: ['/a', '/b'] }));

        const config = await configManager.read();
        expect(config.businessFolders).toEqual(['/a', '/b']);
    });

    it('should validate and filter invalid entries', async () => {
        vi.mocked(mockFs.access).mockResolvedValue(undefined);
        // Mixed content: valid string, number, null
        // eslint-disable-next-line @typescript-eslint/naming-convention
        vi.mocked(mockFs.readFile).mockResolvedValue(JSON.stringify({ business_folders: ['/a', 123, null] }));

        const config = await configManager.read();
        expect(config.businessFolders).toEqual(['/a']);
    });

    it('should handle broken JSON', async () => {
        vi.mocked(mockFs.access).mockResolvedValue(undefined);
        vi.mocked(mockFs.readFile).mockResolvedValue('{ broken json');

        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => { });

        const config = await configManager.read();
        expect(config.businessFolders).toEqual([]);

        consoleSpy.mockRestore();
    });

    it('should handle missing business_folders field', async () => {
        vi.mocked(mockFs.access).mockResolvedValue(undefined);
        vi.mocked(mockFs.readFile).mockResolvedValue('{}');

        const config = await configManager.read();
        expect(config.businessFolders).toEqual([]);
    });

    it('should create directory and write config file atomically', async () => {
        vi.mocked(mockFs.access).mockRejectedValue(new Error('ENOENT')); // dir does not exist

        await configManager.write({ businessFolders: ['/c'] });

        expect(mockFs.mkdir).toHaveBeenCalledWith(path.dirname(mockConfigPath), { recursive: true });
        // eslint-disable-next-line @typescript-eslint/naming-convention
        expect(mockFs.atomicWriteFile).toHaveBeenCalledWith(
            mockConfigPath,
            // eslint-disable-next-line @typescript-eslint/naming-convention
            JSON.stringify({ business_folders: ['/c'] }, null, 2),
            'utf8'
        );
    });

    it('should write file atomically if directory exists', async () => {
        vi.mocked(mockFs.access).mockResolvedValue(undefined); // dir exists

        await configManager.write({ businessFolders: ['/d'] });

        expect(mockFs.mkdir).not.toHaveBeenCalled();
        // eslint-disable-next-line @typescript-eslint/naming-convention
        expect(mockFs.atomicWriteFile).toHaveBeenCalledWith(
            mockConfigPath,
            // eslint-disable-next-line @typescript-eslint/naming-convention
            JSON.stringify({ business_folders: ['/d'] }, null, 2),
            'utf8'
        );
    });
});
