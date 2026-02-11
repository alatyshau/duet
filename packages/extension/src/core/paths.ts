import * as path from 'path';
import * as os from 'os';

export class Paths {
    private readonly dataFolder: string;

    constructor(dataFolder?: string) {
        const folder = dataFolder || path.join(os.homedir(), 'DuetData');
        this.dataFolder = this.normalizePath(folder);
    }

    private normalizePath(inputPath: string): string {
        if (inputPath === '~' || inputPath.startsWith('~/') || inputPath.startsWith('~\\')) {
            return path.join(os.homedir(), inputPath.slice(1));
        }
        return path.normalize(inputPath);
    }

    get root(): string {
        return this.dataFolder;
    }

    get configPath(): string {
        return path.join(this.dataFolder, 'config.json');
    }

    get reposPath(): string {
        return path.join(this.dataFolder, 'repos');
    }

    get workspacesPath(): string {
        return path.join(this.dataFolder, 'workspaces');
    }

    get allBusinessesWorkspacePath(): string {
        return path.join(this.dataFolder, 'all-businesses.code-workspace');
    }

    get dbPath(): string {
        return path.join(this.dataFolder, 'data', 'index.db');
    }

    get dbDir(): string {
        return path.join(this.dataFolder, 'data');
    }

    // Backend lifecycle paths

    get backendPath(): string {
        return path.join(this.dataFolder, 'backend');
    }

    get pidPath(): string {
        return path.join(this.dataFolder, '.pid');
    }

    get startupLockPath(): string {
        return path.join(this.dataFolder, '.backend-start.lock');
    }

    get venvPath(): string {
        return path.join(this.dataFolder, '.venv');
    }

    get venvPython(): string {
        return path.join(this.venvPath, 'bin', 'python3');
    }

    get statePath(): string {
        return path.join(this.dataFolder, 'state.json');
    }
}
