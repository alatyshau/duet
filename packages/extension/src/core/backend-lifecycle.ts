/**
 * Backend lifecycle management.
 *
 * Handles startup and shutdown of Python backend.
 * Install is handled by Duet Host app.
 * Multi-window safe via lock files.
 */

import * as fs from 'fs';
import * as path from 'path';
import { spawn, ChildProcess } from 'child_process';
import * as vscode from 'vscode';
import { Paths } from './paths';
import { readPort } from './pointer';
import { DuetApiClient } from './api-client';

// Constants
const HEALTH_TIMEOUT_MS = 2_000;
const HEALTH_RETRY_COUNT = 10;
const HEALTH_RETRY_DELAY_MS = 300;

export type BackendStatus =
    | { state: 'ready'; version: string }
    | { state: 'starting'; message: string }
    | { state: 'error'; error: string; recoverable: boolean };

export interface BackendLifecycleOptions {
    paths: Paths;
    outputChannel: vscode.OutputChannel;
    onStatusChange?: (status: BackendStatus) => void;
}

export class BackendLifecycle {
    private readonly paths: Paths;
    private readonly output: vscode.OutputChannel;
    private readonly onStatusChange?: (status: BackendStatus) => void;
    private readonly apiClient: DuetApiClient;

    private backendProcess: ChildProcess | null = null;

    constructor(options: BackendLifecycleOptions) {
        this.paths = options.paths;
        this.output = options.outputChannel;
        this.onStatusChange = options.onStatusChange;

        const port = readPort();
        this.apiClient = new DuetApiClient(`http://127.0.0.1:${port}`);
    }

    /**
     * Ensure backend is running. Main entry point.
     * Returns when backend is ready or throws on unrecoverable error.
     *
     * Install is handled by Duet Host app.
     * Extension only starts the backend process.
     */
    async ensureRunning(): Promise<void> {
        this.log('Ensuring backend is running...');

        // PHASE 1: Check if already running
        const health = await this.checkHealth();
        if (health) {
            this.log(`Backend already running (v${health.version})`);
            this.setStatus({ state: 'ready', version: health.version });
            return;
        }

        // PHASE 2: Verify backend is installed (Host handles installation)
        const installedVersion = this.readVersionFile();
        if (!installedVersion) {
            throw new BackendError(
                'Backend не установлен. Запустите Duet Host для установки.',
                false
            );
        }

        // PHASE 3: Startup
        await this.startup();
    }

    /**
     * Stop the backend gracefully.
     */
    async stop(): Promise<void> {
        this.log('Stopping backend...');

        // Try graceful shutdown via API
        try {
            await this.apiClient.stop();
            await this.sleep(1000);
        } catch {
            // Backend might not be responding
        }

        // Kill process if we spawned it
        if (this.backendProcess) {
            this.backendProcess.kill('SIGTERM');
            this.backendProcess = null;
        }

        // Kill by PID if exists
        await this.killByPid();

        this.log('Backend stopped');
    }

    /**
     * Dispose resources.
     */
    dispose(): void {
        // No-op currently. Reserved for future cleanup.
    }

    // === STARTUP ===

    private async startup(): Promise<void> {
        this.setStatus({ state: 'starting', message: 'Запуск backend...' });

        // Quick check if already running
        const health = await this.checkHealth();
        if (health) {
            this.log(`Backend already running (v${health.version})`);
            this.setStatus({ state: 'ready', version: health.version });
            return;
        }

        // Acquire startup lock
        const lockAcquired = await this.acquireStartupLock();

        if (!lockAcquired) {
            // Another window is starting, wait for health
            this.setStatus({ state: 'starting', message: 'Ожидание запуска в другом окне...' });
            const ready = await this.waitForHealth();
            if (ready) {
                const h = await this.checkHealth();
                this.setStatus({ state: 'ready', version: h?.version || 'unknown' });
                return;
            }
            throw new BackendError('Backend не запустился', true);
        }

        try {
            // Spawn backend process
            await this.spawnBackend();

            // Wait for health
            const ready = await this.waitForHealth();
            if (!ready) {
                throw new BackendError('Backend не ответил после запуска', true);
            }

            const h = await this.checkHealth();
            this.setStatus({ state: 'ready', version: h?.version || 'unknown' });
        } finally {
            await this.releaseStartupLock();
        }
    }

    private async acquireStartupLock(): Promise<boolean> {
        const lockPath = this.paths.startupLockPath;

        try {
            const fd = fs.openSync(lockPath, 'wx');
            fs.writeSync(fd, `${Date.now()}`);
            fs.closeSync(fd);
            return true;
        } catch (e: unknown) {
            if ((e as NodeJS.ErrnoException).code === 'EEXIST') {
                return false;
            }
            throw e;
        }
    }

    private async releaseStartupLock(): Promise<void> {
        try {
            fs.unlinkSync(this.paths.startupLockPath);
        } catch {
            // Lock might not exist
        }
    }

    private async spawnBackend(): Promise<void> {
        const serverPath = path.join(this.paths.backendPath, 'server.py');

        this.log(`Spawning: ${this.paths.venvPython} ${serverPath}`);

        // Backend reads pointer file (~/.org.ve68.duet) to find config.
        // No --data-path needed — backend resolves paths itself.
        // We use stdio: 'ignore' to avoid BrokenPipe/SIGPIPE when Extension closes.
        this.backendProcess = spawn(
            this.paths.venvPython,
            [serverPath],
            {
                cwd: this.paths.backendPath,
                stdio: 'ignore',
                detached: true,
            }
        );

        this.backendProcess.on('error', (err) => {
            this.log(`Backend process error: ${err.message}`);
        });

        this.backendProcess.on('exit', (code) => {
            this.log(`Backend process exited with code ${code}`);
            this.backendProcess = null;
        });

        // Unref so VS Code can exit
        this.backendProcess.unref();
    }

    private async waitForHealth(): Promise<boolean> {
        for (let i = 0; i < HEALTH_RETRY_COUNT; i++) {
            await this.sleep(HEALTH_RETRY_DELAY_MS);
            const health = await this.checkHealth();
            if (health) {
                this.log(`Backend healthy: v${health.version}`);
                return true;
            }
        }
        return false;
    }

    private async checkHealth(): Promise<{ version: string } | null> {
        try {
            const response = await this.apiClient.health(HEALTH_TIMEOUT_MS);
            return { version: response.version };
        } catch {
            return null;
        }
    }

    // === STOP HELPERS ===

    private async killByPid(): Promise<void> {
        const pidPath = this.paths.pidPath;
        if (!fs.existsSync(pidPath)) {
            return;
        }

        try {
            const pid = parseInt(fs.readFileSync(pidPath, 'utf8').trim(), 10);
            if (this.isProcessAlive(pid)) {
                this.log(`Killing process ${pid}...`);
                process.kill(pid, 'SIGTERM');
                await this.sleep(1000);

                if (this.isProcessAlive(pid)) {
                    process.kill(pid, 'SIGKILL');
                    await this.sleep(500);
                }
            }
        } catch {
            // Process might not exist
        }
    }

    private isProcessAlive(pid: number): boolean {
        try {
            process.kill(pid, 0);
            return true;
        } catch {
            return false;
        }
    }

    // === HELPERS ===

    private setStatus(status: BackendStatus): void {
        this.log(`Status: ${JSON.stringify(status)}`);
        this.onStatusChange?.(status);
    }

    private log(message: string): void {
        const timestamp = new Date().toISOString().substring(11, 19);
        this.output.appendLine(`[${timestamp}] ${message}`);
    }

    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    private readVersionFile(): string | null {
        try {
            return fs.readFileSync(
                path.join(this.paths.backendPath, 'VERSION'), 'utf8'
            ).trim();
        } catch {
            return null;
        }
    }
}

export class BackendError extends Error {
    constructor(message: string, public readonly recoverable: boolean) {
        super(message);
        this.name = 'BackendError';
    }
}
