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
 * Generates .code-workspace file content for a product.
 * Combines git repo (relative) with Drive folder (absolute).
 *
 * @param repoPath - Relative path to git repo from workspaces dir (e.g., "../repos/Duet.git")
 * @param drivePath - Absolute path to product folder on Drive
 */
export function generateProductWorkspace(repoPath: string, drivePath: string): WorkspaceFile {
    return {
        folders: [
            { path: repoPath },
            { path: drivePath }
        ]
    };
}

/**
 * Generates all-businesses.code-workspace content.
 * Lists all business folders from config, plus DuetData folder.
 *
 * @param businessFolders - Absolute paths to business folders
 * @param duetDataPath - Absolute path to DuetData directory (added as named folder)
 */
export function generateAllBusinessesWorkspace(businessFolders: string[], duetDataPath?: string): WorkspaceFile {
    const folders: WorkspaceFolder[] = businessFolders.map(p => ({ path: p }));
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
     * Gets path to product workspace file.
     */
    getProductWorkspacePath(productName: string): string {
        return path.join(this.workspacesDir, `${productName}.code-workspace`);
    }

    /**
     * Creates or updates product workspace file.
     * Returns path to workspace file.
     *
     * @param productName - Product name (e.g., "Duet")
     * @param drivePath - Absolute path to product folder on Drive
     */
    async writeProductWorkspace(productName: string, drivePath: string): Promise<string> {
        await this.ensureDir();

        const workspacePath = this.getProductWorkspacePath(productName);

        // Relative path from workspaces/ to repos/
        const repoPath = path.join('..', 'repos', `${productName}.git`);

        const workspace = generateProductWorkspace(repoPath, drivePath);
        await this.fs.writeFile(workspacePath, JSON.stringify(workspace, null, 2), 'utf8');

        return workspacePath;
    }

    /**
     * Checks if product workspace file exists.
     */
    async productWorkspaceExists(productName: string): Promise<boolean> {
        try {
            await this.fs.access(this.getProductWorkspacePath(productName));
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Writes all-businesses.code-workspace file.
     *
     * @param businessFolders - Array of absolute paths to business folders
     * @param outputPath - Path to write workspace file
     * @param duetDataPath - Absolute path to DuetData directory
     */
    async writeAllBusinessesWorkspace(businessFolders: string[], outputPath: string, duetDataPath?: string): Promise<void> {
        const dir = path.dirname(outputPath);
        try {
            await this.fs.access(dir);
        } catch {
            await this.fs.mkdir(dir, { recursive: true });
        }

        const workspace = generateAllBusinessesWorkspace(businessFolders, duetDataPath);
        await this.fs.writeFile(outputPath, JSON.stringify(workspace, null, 2), 'utf8');
    }
}
