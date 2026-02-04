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
