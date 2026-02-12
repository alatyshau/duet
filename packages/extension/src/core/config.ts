import * as path from 'path';
import { FileSystem, nodeFs } from './fs';

/**
 * Legacy config interface (business_folders only).
 * Used by existing code during migration.
 */
export interface DuetConfig {
    businessFolders: string[];
}

/**
 * Timezone configuration.
 */
export interface TimestampTZ {
    id: string;   // e.g. "M" for Moscow
    value: string; // e.g. "Europe/Moscow"
}

/**
 * Full config.json structure for backend.
 */
export interface FullConfig {
    version?: string;
    port?: number;
    business_folders?: string[];
    timestampTZ?: TimestampTZ;
}

/**
 * Default values for config fields.
 */
export const CONFIG_DEFAULTS: Required<Omit<FullConfig, 'version'>> = {
    port: 19680,
    business_folders: [],
    timestampTZ: { id: 'Z', value: 'UTC' },
};

export class ConfigManager {
    private readonly fs: FileSystem;

    constructor(private readonly configPath: string, fileSystem?: FileSystem) {
        this.fs = fileSystem ?? nodeFs;
    }

    /**
     * Read legacy config (businessFolders only).
     * For backward compatibility with existing code.
     */
    async read(): Promise<DuetConfig> {
        const full = await this.readFull();
        return { businessFolders: full.business_folders ?? [] };
    }

    /**
     * Read full config.json.
     */
    async readFull(): Promise<FullConfig> {
        try {
            try {
                await this.fs.access(this.configPath);
            } catch {
                return {};
            }

            const content = await this.fs.readFile(this.configPath, 'utf8');
            const data = JSON.parse(content);
            return this.validateFull(data);
        } catch (error) {
            // Corrupted config → start fresh. Next writeMerge() overwrites with valid JSON.
            console.warn('Config corrupted, resetting to defaults:', error);
            return {};
        }
    }

    /**
     * Write legacy config (businessFolders only).
     * Merge-aware: preserves other fields.
     */
    async write(config: DuetConfig): Promise<void> {
        await this.writeMerge({ business_folders: config.businessFolders });
    }

    /**
     * Merge-aware write: reads existing config, merges with updates, writes back.
     * Only updates fields that are explicitly provided.
     */
    async writeMerge(updates: FullConfig): Promise<void> {
        try {
            const dir = path.dirname(this.configPath);
            try {
                await this.fs.access(dir);
            } catch {
                await this.fs.mkdir(dir, { recursive: true });
            }

            // Read existing
            const existing = await this.readFull();

            // Merge
            const merged: FullConfig = { ...existing };
            if (updates.version !== undefined) {
                merged.version = updates.version;
            }
            if (updates.port !== undefined) {
                merged.port = updates.port;
            }
            if (updates.business_folders !== undefined) {
                merged.business_folders = updates.business_folders;
            }
            if (updates.timestampTZ !== undefined) {
                merged.timestampTZ = updates.timestampTZ;
            }

            await this.fs.atomicWriteFile(this.configPath, JSON.stringify(merged, null, 2), 'utf8');
        } catch (error) {
            console.error('Failed to write config:', error);
            throw error;
        }
    }

    /**
     * Ensure all required fields are present with defaults.
     * Used before starting backend.
     */
    async ensureDefaults(version: string): Promise<void> {
        const existing = await this.readFull();
        const updates: FullConfig = { version };

        if (existing.port === undefined) {
            updates.port = CONFIG_DEFAULTS.port;
        }
        if (existing.business_folders === undefined) {
            updates.business_folders = CONFIG_DEFAULTS.business_folders;
        }
        if (!this.isValidTimestampTZ(existing.timestampTZ)) {
            updates.timestampTZ = CONFIG_DEFAULTS.timestampTZ;
        }

        await this.writeMerge(updates);
    }

    /**
     * Check if config has all required fields for backend.
     */
    hasRequiredFields(config: FullConfig): boolean {
        return (
            typeof config.port === 'number' &&
            Array.isArray(config.business_folders) &&
            this.isValidTimestampTZ(config.timestampTZ)
        );
    }

    private isValidTimestampTZ(tz: unknown): tz is TimestampTZ {
        return (
            tz !== null &&
            typeof tz === 'object' &&
            typeof (tz as TimestampTZ).id === 'string' &&
            typeof (tz as TimestampTZ).value === 'string'
        );
    }

    private validateFull(data: unknown): FullConfig {
        if (!data || typeof data !== 'object') {
            return {};
        }

        const obj = data as Record<string, unknown>;
        const result: FullConfig = {};

        if (typeof obj.version === 'string') {
            result.version = obj.version;
        }

        if (typeof obj.port === 'number') {
            result.port = obj.port;
        }

        if (Array.isArray(obj.business_folders)) {
            result.business_folders = obj.business_folders.filter(
                (f): f is string => typeof f === 'string'
            );
        }

        if (this.isValidTimestampTZ(obj.timestampTZ)) {
            result.timestampTZ = obj.timestampTZ;
        }

        return result;
    }
}
