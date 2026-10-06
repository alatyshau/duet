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

    get reposPath(): string {
        return path.join(this.dataFolder, 'repos');
    }

    get workspacesPath(): string {
        return path.join(this.dataFolder, 'workspaces');
    }

    get rootContextsWorkspacePath(): string {
        return path.join(this.dataFolder, 'root-contexts.code-workspace');
    }

    /** Window markers and the order of active intents, one subfolder per program. */
    get intentsPath(): string {
        return path.join(this.dataFolder, 'intents');
    }

    /** `intents/<program>/` — the only intents folder a window of that program reads and writes. */
    intentsProgramPath(program: string): string {
        return path.join(this.intentsPath, program);
    }

    /** `workspaces/<business>/<ticket folder>.code-workspace` — the workspace file of an intent. */
    intentWorkspacePath(businessName: string, ticketFolder: string): string {
        return path.join(this.workspacesPath, businessName, `${ticketFolder}.code-workspace`);
    }
}
