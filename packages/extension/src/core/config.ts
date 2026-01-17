import * as fs from 'fs';
import * as path from 'path';

export interface DuetConfig {
    businessFolders: string[];
}

export interface FileSystem {
    access(path: string): Promise<void>;
    readFile(path: string, options: { encoding: 'utf8' } | 'utf8'): Promise<string>;
    writeFile(path: string, data: string, options: { encoding: 'utf8' } | 'utf8'): Promise<void>;
    mkdir(path: string, options?: { recursive?: boolean }): Promise<string | undefined>;
}

export class ConfigManager {
    private readonly fs: FileSystem;

    constructor(private readonly configPath: string, fileSystem?: FileSystem) {
        this.fs = fileSystem || fs.promises;
    }

    async read(): Promise<DuetConfig> {
        try {
            try {
                await this.fs.access(this.configPath);
            } catch {
                return { businessFolders: [] };
            }

            const content = await this.fs.readFile(this.configPath, 'utf8');
            const data = JSON.parse(content);
            return this.validate(data);
        } catch (error) {
            console.error('Failed to read config:', error);
            return { businessFolders: [] };
        }
    }

    async write(config: DuetConfig): Promise<void> {
        try {
            const dir = path.dirname(this.configPath);
            try {
                await this.fs.access(dir);
            } catch {
                await this.fs.mkdir(dir, { recursive: true });
            }

            const jsonConfig = {
                // eslint-disable-next-line @typescript-eslint/naming-convention
                business_folders: config.businessFolders
            };

            await this.fs.writeFile(this.configPath, JSON.stringify(jsonConfig, null, 2), 'utf8');
        } catch (error) {
            console.error('Failed to write config:', error);
            throw error;
        }
    }

    private validate(data: any): DuetConfig {
        if (!data || typeof data !== 'object') {
            return { businessFolders: [] };
        }

        // Map from JSON snake_case to TS camelCase
        let folders = data.business_folders;
        if (!Array.isArray(folders)) {
            folders = [];
        }

        // Filter strings only
        folders = folders.filter((f: any) => typeof f === 'string');

        return { businessFolders: folders };
    }
}
