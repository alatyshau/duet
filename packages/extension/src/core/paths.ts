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
}
