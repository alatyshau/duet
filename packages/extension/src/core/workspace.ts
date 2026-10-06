import * as path from 'path';
import { FileSystem, nodeFs } from './fs';
import { normalizePath } from './pathUtils';

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
 * (relative path `../repos/<alias>.git` from the workspaces dir) plus the
 * Drive folder (absolute path).
 *
 * The Drive context folder is always first (primary): it is the project root
 * clients treat as cwd and instruction-files source. The cloned repos follow, in
 * declared alias order, so the multi-root layout is deterministic across
 * machines.
 *
 * `extraFolders` come last: the additional folders of a meta business
 * (`metaExtraFolders`), empty for every other business.
 */
export function generateContextWithReposWorkspace(
    aliases: string[],
    drivePath: string,
    settings?: Record<string, unknown>,
    extraFolders: WorkspaceFolder[] = []
): WorkspaceFile {
    const repoFolders: WorkspaceFolder[] = aliases.map(alias => ({
        path: path.join('..', 'repos', `${alias}.git`)
    }));
    const driveFolder: WorkspaceFolder = { path: drivePath };
    const folders = [driveFolder, ...repoFolders, ...extraFolders];
    // Without settings the file is what it always was: folders only
    return settings ? { folders, settings } : { folders };
}

/**
 * Additional folders of the window of a meta business (`meta: true` in its
 * `context.json`): the folders of all the other ventures, in the order of the
 * tree, then DuetData. They follow the business's own folder and repos, so the
 * business folder stays the primary one and the business works as any other —
 * the window only shows more. A business that is not meta gets none.
 *
 * @param isMeta - the `meta` flag of the business being opened
 * @param businessPath - absolute path of its folder; left out of the list
 * @param ventureFolders - absolute paths of all venture (root business) folders
 * @param duetDataPath - absolute path of DuetData (added as a named folder)
 */
export function metaExtraFolders(
    isMeta: boolean,
    businessPath: string,
    ventureFolders: string[],
    duetDataPath: string
): WorkspaceFolder[] {
    if (!isMeta) {
        return [];
    }
    const own = normalizePath(businessPath);
    const folders: WorkspaceFolder[] = ventureFolders
        .filter(p => normalizePath(p) !== own)
        .map(p => ({ path: p }));
    folders.push({ path: duetDataPath, name: 'DuetData' });
    return folders;
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
     * Also (re)generates the Kimi Code multi-root workaround
     * (`<drivePath>/.kimi-code/local.toml`) — the workspace file is where the
     * folder set and order are decided, so the workaround belongs to the same
     * write.
     *
     * @param contextName - Context name (e.g., "DuetLab"); used as workspace file basename.
     * @param aliases - `git_repos` keys in declared order; each becomes a folder pointing at `../repos/<alias>.git`.
     * @param drivePath - Absolute path to the context's Drive folder (always the primary/first folder).
     * @param settings - `settings` block of the file: the colour of the business window
     *                   (`core/intents/workspaceFile.ts:planBusinessColor`). Omitted — folders only.
     * @param extraFolders - additional folders of a meta business (`metaExtraFolders`), absolute paths.
     */
    async writeContextWithReposWorkspace(
        contextName: string,
        aliases: string[],
        drivePath: string,
        settings?: Record<string, unknown>,
        extraFolders: WorkspaceFolder[] = []
    ): Promise<string> {
        await this.ensureDir();

        const workspacePath = this.getContextWithReposWorkspacePath(contextName);
        const workspace = generateContextWithReposWorkspace(aliases, drivePath, settings, extraFolders);
        await this.fs.writeFile(workspacePath, JSON.stringify(workspace, null, 2), 'utf8');

        await this.writeKimiCodeLocalToml(drivePath, aliases, extraFolders.map(f => f.path));

        return workspacePath;
    }

    /**
     * Kimi Code multi-root workaround.
     *
     * Kimi's VS Code extension is blind to multi-root workspaces — it sees
     * only the primary folder. The documented mechanism to grant it access to
     * the remaining roots is project-local `<project>/.kimi-code/local.toml`
     * with `[workspace] additional_dir` (written interactively by `/add-dir`).
     * Duet generates it alongside the workspace file: the Drive folder is the
     * project root, the cloned repos become `additional_dir` entries
     * (absolute, in declared alias order), followed by the additional folders
     * of a meta business.
     *
     * Duet-managed: rewritten wholesale on every workspace (re)generation.
     * Absolute machine-specific paths — the file must not be committed.
     */
    private async writeKimiCodeLocalToml(drivePath: string, aliases: string[], extraDirs: string[] = []): Promise<void> {
        if (aliases.length === 0 && extraDirs.length === 0) {
            return;
        }
        const dir = path.join(drivePath, '.kimi-code');
        await this.fs.mkdir(dir, { recursive: true });
        const dirs = [...aliases.map(alias => path.join(this.reposDir, `${alias}.git`)), ...extraDirs];
        const content = [
            '# AUTO-GENERATED by Duet · Kimi Code multi-root workaround · do not edit',
            '# Gives Kimi access to the workspace folders beyond the primary one.',
            '# Absolute machine-specific paths — do not commit.',
            '[workspace]',
            `additional_dir = [${dirs.map(d => JSON.stringify(d)).join(', ')}]`,
            ''
        ].join('\n');
        await this.fs.writeFile(path.join(dir, 'local.toml'), content, 'utf8');
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
}
