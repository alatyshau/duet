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
 * Generates .code-workspace file content for a context that has a git repo.
 * Combines git repo (relative) with Drive folder (absolute).
 *
 * @param repoPath - Relative path to git repo from workspaces dir (e.g., "../repos/Duet.git")
 * @param drivePath - Absolute path to context's Drive folder
 */
export function generateContextWithGitWorkspace(repoPath: string, drivePath: string): WorkspaceFile {
    return {
        folders: [
            { path: repoPath },
            { path: drivePath }
        ]
    };
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
     * Gets path to workspace file for a context-with-git.
     */
    getContextWithGitWorkspacePath(contextName: string): string {
        return path.join(this.workspacesDir, `${contextName}.code-workspace`);
    }

    /**
     * Creates or updates a context-with-git workspace file.
     * Returns path to the workspace file.
     *
     * @param contextName - Context name (e.g., "Duet")
     * @param drivePath - Absolute path to context's Drive folder
     */
    async writeContextWithGitWorkspace(contextName: string, drivePath: string): Promise<string> {
        await this.ensureDir();

        const workspacePath = this.getContextWithGitWorkspacePath(contextName);

        // Relative path from workspaces/ to repos/
        const repoPath = path.join('..', 'repos', `${contextName}.git`);

        const workspace = generateContextWithGitWorkspace(repoPath, drivePath);
        await this.fs.writeFile(workspacePath, JSON.stringify(workspace, null, 2), 'utf8');

        return workspacePath;
    }

    /**
     * Checks if context-with-git workspace file exists.
     */
    async contextWithGitWorkspaceExists(contextName: string): Promise<boolean> {
        try {
            await this.fs.access(this.getContextWithGitWorkspacePath(contextName));
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
