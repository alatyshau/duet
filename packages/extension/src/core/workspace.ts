import * as path from 'path';
import { FileSystem, nodeFs } from './fs';

export interface WorkspaceFolder {
    path: string;
    name?: string;
}

export interface WorkspaceFile {
    folders: WorkspaceFolder[];
    settings?: Record<string, unknown>;
}

/**
 * Generates `.code-workspace` content for a context that declares one or more
 * git repos (`git_repos` map). Produces N folders pointing at each cloned repo
 * (relative path `../repos/<alias>.git` from the workspaces dir) followed by
 * the Drive folder (absolute path).
 *
 * Aliases keep their declared order so the multi-root layout in VS Code is
 * deterministic across machines.
 */
export function generateContextWithReposWorkspace(aliases: string[], drivePath: string): WorkspaceFile {
    const folders: WorkspaceFolder[] = aliases.map(alias => ({
        path: path.join('..', 'repos', `${alias}.git`)
    }));
    folders.push({ path: drivePath });
    return { folders };
}

/**
 * Generates root-contexts.code-workspace content.
 * Lists all root context folders, plus DuetData folder.
 *
 * @param rootContextFolders - Absolute paths to root context folders
 * @param duetDataPath - Absolute path to DuetData directory (added as named folder)
 */
export function generateRootContextsWorkspace(rootContextFolders: string[], duetDataPath?: string): WorkspaceFile {
    const folders: WorkspaceFolder[] = rootContextFolders.map(p => ({ path: p }));
    if (duetDataPath) {
        folders.push({ path: duetDataPath, name: 'DuetData' });
    }
    return { folders };
}

export class WorkspaceManager {
    private readonly fs: FileSystem;

    constructor(
        private readonly workspacesDir: string,
        private readonly reposDir: string,
        fileSystem?: FileSystem
    ) {
        this.fs = fileSystem ?? nodeFs;
    }

    /**
     * Ensures workspaces directory exists.
     */
    async ensureDir(): Promise<void> {
        try {
            await this.fs.access(this.workspacesDir);
        } catch {
            await this.fs.mkdir(this.workspacesDir, { recursive: true });
        }
    }

    /**
     * Gets path to workspace file for a context-with-repos.
     */
    getContextWithReposWorkspacePath(contextName: string): string {
        return path.join(this.workspacesDir, `${contextName}.code-workspace`);
    }

    /**
     * Creates or updates a context-with-repos workspace file.
     * Returns path to the workspace file.
     *
     * @param contextName - Context name (e.g., "DuetLab"); used as workspace file basename.
     * @param aliases - `git_repos` keys in declared order; each becomes a folder pointing at `../repos/<alias>.git`.
     * @param drivePath - Absolute path to the context's Drive folder; added as the last folder.
     */
    async writeContextWithReposWorkspace(
        contextName: string,
        aliases: string[],
        drivePath: string
    ): Promise<string> {
        await this.ensureDir();

        const workspacePath = this.getContextWithReposWorkspacePath(contextName);
        const workspace = generateContextWithReposWorkspace(aliases, drivePath);
        await this.fs.writeFile(workspacePath, JSON.stringify(workspace, null, 2), 'utf8');

        return workspacePath;
    }

    /**
     * Checks if context-with-repos workspace file exists.
     */
    async contextWithReposWorkspaceExists(contextName: string): Promise<boolean> {
        try {
            await this.fs.access(this.getContextWithReposWorkspacePath(contextName));
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Writes root-contexts.code-workspace file.
     *
     * @param rootContextFolders - Absolute paths to root context folders
     * @param outputPath - Path to write workspace file
     * @param duetDataPath - Absolute path to DuetData directory
     */
    async writeRootContextsWorkspace(rootContextFolders: string[], outputPath: string, duetDataPath?: string): Promise<void> {
        const dir = path.dirname(outputPath);
        try {
            await this.fs.access(dir);
        } catch {
            await this.fs.mkdir(dir, { recursive: true });
        }

        const workspace = generateRootContextsWorkspace(rootContextFolders, duetDataPath);
        await this.fs.writeFile(outputPath, JSON.stringify(workspace, null, 2), 'utf8');
    }
}
