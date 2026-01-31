/**
 * Backend lifecycle management.
 *
 * Handles install, startup, and shutdown of Python backend.
 * Multi-window safe via lock files.
 */

import * as fs from 'fs';
import * as path from 'path';
import { spawn, execSync, ChildProcess } from 'child_process';
import * as vscode from 'vscode';
import { Paths } from './paths';
import { ConfigManager, CONFIG_DEFAULTS } from './config';
import { DuetApiClient } from './api-client';

// Constants from topic_core_architecture.md
const BACKEND_RELATIVE_PATH = 'dist/backend';
const INSTALL_TIMEOUT_MS = 60_000;
const INSTALL_STALE_MS = 60_000;
const HEALTH_TIMEOUT_MS = 2_000;
const HEALTH_RETRY_COUNT = 10;
const HEALTH_RETRY_DELAY_MS = 300;
const HEARTBEAT_INTERVAL_MS = 30_000;
const MIN_PYTHON_VERSION = [3, 10];

export type BackendStatus =
    | { state: 'ready'; version: string }
    | { state: 'installing'; message: string }
    | { state: 'starting'; message: string }
    | { state: 'error'; error: string; recoverable: boolean };

export interface BackendLifecycleOptions {
    paths: Paths;
    extensionPath: string;
    extensionVersion: string;
    outputChannel: vscode.OutputChannel;
    onStatusChange?: (status: BackendStatus) => void;
}

export class BackendLifecycle {
    private readonly paths: Paths;
    private readonly extensionPath: string;
    private readonly extensionVersion: string;
    private readonly output: vscode.OutputChannel;
    private readonly onStatusChange?: (status: BackendStatus) => void;
    private readonly configManager: ConfigManager;
    private readonly apiClient: DuetApiClient;

    private backendProcess: ChildProcess | null = null;
    private heartbeatInterval: NodeJS.Timeout | null = null;

    constructor(options: BackendLifecycleOptions) {
        this.paths = options.paths;
        this.extensionPath = options.extensionPath;
        this.extensionVersion = options.extensionVersion;
        this.output = options.outputChannel;
        this.onStatusChange = options.onStatusChange;
        this.configManager = new ConfigManager(this.paths.configPath);

        const config = this.readConfigSync();
        const port = config.port ?? CONFIG_DEFAULTS.port;
        this.apiClient = new DuetApiClient(`http://127.0.0.1:${port}`);
    }

    /**
     * Ensure backend is running. Main entry point.
     * Returns when backend is ready or throws on unrecoverable error.
     */
    async ensureRunning(): Promise<void> {
        this.log('Ensuring backend is running...');

        // PHASE 1: Check if already running with correct version
        const config = await this.configManager.readFull();

        if (config.version === this.extensionVersion && this.configManager.hasRequiredFields(config)) {
            // Config looks good, check if backend is running
            const health = await this.checkHealth();
            if (health && health.version === this.extensionVersion) {
                this.log(`Backend already running (v${health.version})`);
                this.setStatus({ state: 'ready', version: health.version });
                return;
            }
        }

        // PHASE 2: Install if needed
        await this.install();

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
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }
    }

    // === PHASE 2: INSTALL ===

    private async install(): Promise<void> {
        this.setStatus({ state: 'installing', message: 'Проверка Python...' });

        // Check Python version
        const pythonOk = await this.checkPython();
        if (!pythonOk) {
            throw new BackendError(
                'Python 3.10+ не найден. Установите Python и добавьте в PATH.',
                true
            );
        }

        // Try to acquire install lock
        const lockAcquired = await this.acquireInstallLock();

        if (!lockAcquired) {
            // Another window is installing, wait for it
            this.setStatus({ state: 'installing', message: 'Ожидание установки в другом окне...' });
            await this.waitForInstallLock();

            // Re-check config after wait
            const config = await this.configManager.readFull();
            if (config.version === this.extensionVersion && this.configManager.hasRequiredFields(config)) {
                return; // Other window installed successfully
            }
            throw new BackendError('Установка не удалась в другом окне VS Code', true);
        }

        try {
            // Stop running backend
            await this.stopRunningBackend();

            // Copy backend files
            this.setStatus({ state: 'installing', message: 'Копирование backend...' });
            await this.copyBackend();

            // Setup venv
            this.setStatus({ state: 'installing', message: 'Настройка Python окружения...' });
            await this.setupVenv();

            // Update config with version and defaults
            this.setStatus({ state: 'installing', message: 'Обновление конфигурации...' });
            await this.configManager.ensureDefaults(this.extensionVersion);

            this.log('Installation complete');
        } finally {
            await this.releaseInstallLock();
        }
    }

    private async checkPython(): Promise<boolean> {
        try {
            const output = execSync('python3 --version', { encoding: 'utf8' });
            const match = output.match(/Python (\d+)\.(\d+)/);
            if (!match) {
                this.log(`Python version parse failed: ${output}`);
                return false;
            }

            const major = parseInt(match[1], 10);
            const minor = parseInt(match[2], 10);

            if (major < MIN_PYTHON_VERSION[0] ||
                (major === MIN_PYTHON_VERSION[0] && minor < MIN_PYTHON_VERSION[1])) {
                this.log(`Python ${major}.${minor} is too old (need ${MIN_PYTHON_VERSION.join('.')}+)`);
                return false;
            }

            this.log(`Python ${major}.${minor} found`);
            return true;
        } catch (e) {
            this.log(`Python check failed: ${e}`);
            return false;
        }
    }

    private async acquireInstallLock(): Promise<boolean> {
        const lockPath = this.paths.installLockPath;
        const windowName = vscode.workspace.name || 'VS Code';

        try {
            // Check if lock exists and is stale
            if (fs.existsSync(lockPath)) {
                const content = fs.readFileSync(lockPath, 'utf8');
                const [timestamp] = content.split(':');
                const startedAt = parseInt(timestamp, 10);

                if (Date.now() - startedAt > INSTALL_STALE_MS) {
                    this.log('Removing stale install lock');
                    fs.unlinkSync(lockPath);
                } else {
                    return false; // Lock is fresh, held by another window
                }
            }

            // Try to create lock exclusively
            const fd = fs.openSync(lockPath, 'wx');
            fs.writeSync(fd, `${Date.now()}:${windowName}`);
            fs.closeSync(fd);

            // Start heartbeat
            this.heartbeatInterval = setInterval(() => {
                try {
                    fs.writeFileSync(lockPath, `${Date.now()}:${windowName}`);
                } catch {
                    // Lock might be released
                }
            }, HEARTBEAT_INTERVAL_MS);

            return true;
        } catch (e: unknown) {
            if ((e as NodeJS.ErrnoException).code === 'EEXIST') {
                return false;
            }
            throw e;
        }
    }

    private async releaseInstallLock(): Promise<void> {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }

        try {
            fs.unlinkSync(this.paths.installLockPath);
        } catch {
            // Lock might not exist
        }
    }

    private async waitForInstallLock(): Promise<void> {
        const start = Date.now();
        while (fs.existsSync(this.paths.installLockPath)) {
            if (Date.now() - start > INSTALL_TIMEOUT_MS) {
                throw new BackendError('Таймаут ожидания установки', true);
            }
            await this.sleep(500);
        }
    }

    private async stopRunningBackend(): Promise<void> {
        // Try API stop
        try {
            const health = await this.checkHealth();
            if (health) {
                this.log('Stopping running backend via API...');
                await this.apiClient.stop();
                await this.sleep(3000);
            }
        } catch {
            // Backend not responding
        }

        // Kill by PID
        await this.killByPid();
    }

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

    private async copyBackend(): Promise<void> {
        const src = path.join(this.extensionPath, BACKEND_RELATIVE_PATH);
        const dst = this.paths.backendPath;
        const dstNew = `${dst}.new`;
        const dstOld = `${dst}.old`;

        // Cleanup
        this.rmrf(dstOld);
        this.rmrf(dstNew);

        // Copy to temp
        this.copyDir(src, dstNew);

        // Atomic switch
        if (fs.existsSync(dst)) {
            fs.renameSync(dst, dstOld);
        }
        fs.renameSync(dstNew, dst);
        this.rmrf(dstOld);

        this.log(`Backend copied to ${dst}`);
    }

    private copyDir(src: string, dst: string): void {
        fs.mkdirSync(dst, { recursive: true });

        for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
            const srcPath = path.join(src, entry.name);
            const dstPath = path.join(dst, entry.name);

            if (entry.isDirectory()) {
                this.copyDir(srcPath, dstPath);
            } else {
                fs.copyFileSync(srcPath, dstPath);
            }
        }
    }

    private rmrf(dir: string): void {
        if (fs.existsSync(dir)) {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    }

    private async setupVenv(): Promise<void> {
        const venvPath = this.paths.venvPath;
        const requirementsPath = path.join(this.paths.backendPath, 'requirements.txt');

        if (!fs.existsSync(venvPath)) {
            this.log('Creating Python venv...');
            execSync(`python3 -m venv "${venvPath}"`, { encoding: 'utf8' });
        }

        this.log('Installing dependencies...');
        execSync(`"${this.paths.venvPython}" -m pip install -q -r "${requirementsPath}"`, {
            encoding: 'utf8',
        });
    }

    // === PHASE 3: STARTUP ===

    private async startup(): Promise<void> {
        this.setStatus({ state: 'starting', message: 'Запуск backend...' });

        // Quick check if already running
        const health = await this.checkHealth();
        if (health && health.version === this.extensionVersion) {
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
                this.setStatus({ state: 'ready', version: this.extensionVersion });
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

            this.setStatus({ state: 'ready', version: this.extensionVersion });
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

        this.log(`Spawning: ${this.paths.venvPython} ${serverPath} --data-path ${this.paths.root}`);

        // Backend writes logs to DuetData/backend.log (RotatingFileHandler).
        // We use stdio: 'ignore' to avoid BrokenPipe/SIGPIPE when Extension closes.
        this.backendProcess = spawn(
            this.paths.venvPython,
            [serverPath, '--data-path', this.paths.root],
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

    // === Helpers ===

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

    private readConfigSync(): { port?: number } {
        try {
            const content = fs.readFileSync(this.paths.configPath, 'utf8');
            return JSON.parse(content);
        } catch {
            return {};
        }
    }
}

export class BackendError extends Error {
    constructor(message: string, public readonly recoverable: boolean) {
        super(message);
        this.name = 'BackendError';
    }
}
