/**
 * Read Duet pointer file (~/.org.ve68.duet).
 *
 * Pointer file is a minimal JSON that tells all Duet components
 * where to find DuetData (local cache) and DuetConfig (cloud source of truth).
 *
 * For tests: env DUET_POINTER_FILE overrides the default path.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface Pointer {
    machine: string;
    duetDataPath: string;
    duetConfigPath: string;
}

/**
 * Get path to pointer file.
 * Uses DUET_POINTER_FILE env for testing, otherwise ~/.org.ve68.duet
 */
export function getPointerPath(): string {
    return process.env.DUET_POINTER_FILE || path.join(os.homedir(), '.org.ve68.duet');
}

/**
 * Read and validate pointer file.
 * Returns null if file not found, unreadable, or missing required fields.
 */
export function readPointer(): Pointer | null {
    const pointerPath = getPointerPath();
    try {
        const content = fs.readFileSync(pointerPath, 'utf-8');
        const data = JSON.parse(content);
        if (
            typeof data.machine === 'string' &&
            typeof data.duetDataPath === 'string' &&
            typeof data.duetConfigPath === 'string'
        ) {
            return data as Pointer;
        }
        return null;
    } catch {
        return null;
    }
}

/**
 * Read {machine}.json from DuetConfig.
 * Returns null if pointer or machine config is missing/unreadable.
 */
export function readMachineConfig(): Record<string, unknown> | null {
    const pointer = readPointer();
    if (!pointer) {
        return null;
    }
    const configPath = path.join(pointer.duetConfigPath, `${pointer.machine}.json`);
    try {
        const content = fs.readFileSync(configPath, 'utf-8');
        return JSON.parse(content);
    } catch {
        return null;
    }
}

/**
 * Read port from machine config.
 * Returns 19680 (default) if config is missing or port is not set.
 */
export function readPort(): number {
    const config = readMachineConfig();
    const port = config?.port;
    return typeof port === 'number' ? port : 19680;
}
