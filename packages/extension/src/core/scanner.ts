import * as path from 'path';
import { DatabaseManager } from './db';
import { ConfigManager } from './config';
import { FileSystem, nodeFs } from './fs';

interface Manifest {
    name: string;
    icon?: string;
    gitUrl?: string;
}

/**
 * Scanner: scans Google Drive business folders and builds index.db.
 *
 * Key behaviors:
 * - Global name uniqueness: priority-based (business > stream > product > project)
 * - Self-healing: auto-creates/renames manifests to match hierarchy rules
 * - Hierarchy: root=business, intermediate=stream, leaf with git_url=product
 * - Deterministic order: readdir results sorted by name
 */
export class Scanner {
    private scanInProgress = false;
    private readonly fs: FileSystem;

    /**
     * Type priorities: lower number = higher priority.
     * When name conflict occurs, higher-priority entity keeps the original name.
     */
    private static readonly typePriorities: Record<string, number> = {
        business: 1,
        stream: 2,
        product: 3,
        project: 4
    };

    constructor(
        private readonly db: DatabaseManager,
        private readonly config: ConfigManager,
        private readonly onError?: (message: string) => void,
        fileSystem?: FileSystem
    ) {
        this.fs = fileSystem ?? nodeFs;
    }

    /**
     * Find first available name with suffix (1), (2), etc.
     */
    private findAvailableName(baseName: string): string {
        let counter = 1;
        let name = `${baseName} (${counter})`;
        while (this.db.nameExists(name)) {
            counter++;
            name = `${baseName} (${counter})`;
        }
        return name;
    }

    /**
     * Resolve name for a new entity using priority-based algorithm.
     *
     * If name exists:
     * - Compare priorities (lower = higher priority)
     * - If new entity has higher priority → rename existing, return original name
     * - If new entity has lower/equal priority → return suffixed name
     */
    private resolveUniqueName(baseName: string, newType: string): string {
        const existing = this.db.findByName(baseName);

        if (!existing) {
            return baseName;
        }

        const newPriority = Scanner.typePriorities[newType] ?? 99;
        const existingPriority = Scanner.typePriorities[existing.type] ?? 99;

        if (newPriority < existingPriority) {
            // New entity has higher priority → rename existing, claim original name
            const suffixedName = this.findAvailableName(baseName);
            this.db.updateEntityName(existing.id!, suffixedName);
            console.log(`Name conflict: "${baseName}" - ${newType} claims name, ${existing.type} renamed to "${suffixedName}"`);
            return baseName;
        } else {
            // New entity has lower/equal priority → get suffixed name
            const suffixedName = this.findAvailableName(baseName);
            console.log(`Name conflict: "${baseName}" - ${newType} gets "${suffixedName}"`);
            return suffixedName;
        }
    }

    /**
     * Self-healing: create business.json if missing at root.
     * Returns true on success, false on failure.
     */
    private async createBusinessManifest(folderPath: string): Promise<boolean> {
        const manifest = {
            name: path.basename(folderPath),
            icon: '📁'
        };
        const filePath = path.join(folderPath, 'business.json');
        try {
            await this.fs.writeFile(filePath, JSON.stringify(manifest, null, 2), 'utf8');
            console.log(`Self-healing: created ${filePath}`);
            return true;
        } catch (error) {
            const msg = `Self-healing failed: could not create ${filePath}: ${error}`;
            if (this.onError) {
                this.onError(msg);
            } else {
                console.error(msg);
            }
            return false;
        }
    }

    /**
     * Self-healing: rename stream.json to business.json at root.
     * Returns true on success, false on failure.
     */
    private async renameStreamToBusiness(folderPath: string): Promise<boolean> {
        const streamPath = path.join(folderPath, 'stream.json');
        const businessPath = path.join(folderPath, 'business.json');
        try {
            await this.fs.rename(streamPath, businessPath);
            console.log(`Self-healing: renamed ${streamPath} to ${businessPath}`);
            return true;
        } catch (error) {
            const msg = `Self-healing failed: could not rename ${streamPath} to ${businessPath}: ${error}`;
            if (this.onError) {
                this.onError(msg);
            } else {
                console.error(msg);
            }
            return false;
        }
    }

    /**
     * Self-healing: rename business.json to stream.json inside chain.
     * Returns true on success, false on failure.
     */
    private async renameBusinessToStream(folderPath: string): Promise<boolean> {
        const businessPath = path.join(folderPath, 'business.json');
        const streamPath = path.join(folderPath, 'stream.json');
        try {
            await this.fs.rename(businessPath, streamPath);
            console.log(`Self-healing: renamed ${businessPath} to ${streamPath}`);
            return true;
        } catch (error) {
            const msg = `Self-healing failed: could not rename ${businessPath} to ${streamPath}: ${error}`;
            if (this.onError) {
                this.onError(msg);
            } else {
                console.error(msg);
            }
            return false;
        }
    }

    async scan(): Promise<void> {
        if (this.scanInProgress) {
            console.log('Scan already in progress, skipping');
            return;
        }

        try {
            this.scanInProgress = true;
            await this.db.init();

            // Start transaction-like behavior by clearing and rebuilding
            // Note: sql.js is in-memory, so modify and save at the end is atomic enough
            this.db.clear();

            const duetConfig = await this.config.read();
            for (const folder of duetConfig.businessFolders) {
                await this.scanBusiness(folder);
            }

            await this.db.save();
        } finally {
            this.scanInProgress = false;
        }
    }

    /**
     * Read directory entries sorted by name for deterministic scan order.
     */
    private async readdirSorted(folderPath: string) {
        const entries = await this.fs.readdir(folderPath, { withFileTypes: true });
        return entries.sort((a, b) => a.name.localeCompare(b.name));
    }

    /**
     * Scan a business folder (root level in business_folders).
     * Self-healing: creates business.json if missing, renames stream.json to business.json.
     */
    private async scanBusiness(folderPath: string): Promise<void> {
        if (!await this.exists(folderPath)) { return; }

        // Self-healing: check for manifest issues at root
        let manifest = await this.readManifest(folderPath, 'business.json');
        let selfHealingSucceeded = true;

        if (!manifest) {
            // Check if stream.json exists (wrong manifest type at root)
            const streamManifest = await this.readManifest(folderPath, 'stream.json');
            if (streamManifest) {
                // Rename stream.json to business.json
                selfHealingSucceeded = await this.renameStreamToBusiness(folderPath);
                if (selfHealingSucceeded) {
                    manifest = streamManifest;
                }
            } else {
                // No manifest at all - create business.json
                selfHealingSucceeded = await this.createBusinessManifest(folderPath);
            }

            // Use fallback manifest if self-healing failed or no manifest read
            if (!manifest) {
                manifest = {
                    name: path.basename(folderPath),
                    icon: '📁'
                };
            }
        }

        const baseName = manifest.name || path.basename(folderPath);
        const uniqueName = this.resolveUniqueName(baseName, 'business');
        const icon = manifest.icon || '📁';

        const businessId = this.db.insertEntity({
            type: 'business',
            name: uniqueName,
            icon,
            drivePath: folderPath
        });

        // Scan children (Stream or Product) - sorted for determinism
        const entries = await this.readdirSorted(folderPath);
        for (const entry of entries) {
            if (!entry.isDirectory() || entry.name.startsWith('.')) { continue; }

            const childPath = path.join(folderPath, entry.name);
            await this.scanStreamOrProduct(childPath, businessId);
        }
    }

    /**
     * Scan a folder that could be stream or product (inside business).
     * Self-healing: renames business.json to stream.json if found inside chain.
     */
    private async scanStreamOrProduct(folderPath: string, parentId: number): Promise<void> {
        // Check for stream.json first
        let streamManifest = await this.readManifest(folderPath, 'stream.json');

        // Self-healing: check for business.json inside chain (should be stream.json)
        if (!streamManifest) {
            const businessManifest = await this.readManifest(folderPath, 'business.json');
            if (businessManifest) {
                // Rename business.json to stream.json
                const success = await this.renameBusinessToStream(folderPath);
                if (success) {
                    streamManifest = businessManifest;
                }
                // If rename failed, we don't use the manifest (file is still business.json)
            }
        }

        if (streamManifest) {
            const baseName = streamManifest.name || path.basename(folderPath);
            const uniqueName = this.resolveUniqueName(baseName, 'stream');

            const streamId = this.db.insertEntity({
                type: 'stream',
                name: uniqueName,
                icon: streamManifest.icon || '🌊',
                drivePath: folderPath,
                parentId: parentId
            });

            // Scan children inside stream (can be nested streams or products) - sorted
            const entries = await this.readdirSorted(folderPath);
            for (const entry of entries) {
                if (!entry.isDirectory() || entry.name.startsWith('.')) { continue; }
                // Recursive call - streams can contain streams or products
                await this.scanStreamOrProduct(path.join(folderPath, entry.name), streamId);
            }
            return;
        }

        // Check for product.json
        const productManifest = await this.readManifest(folderPath, 'product.json');
        if (productManifest) {
            await this.saveProduct(folderPath, parentId, productManifest);
            return;
        }

        // No manifest - recurse to find deeper items
        try {
            const entries = await this.readdirSorted(folderPath);
            for (const entry of entries) {
                if (!entry.isDirectory() || entry.name.startsWith('.')) { continue; }
                await this.scanStreamOrProduct(path.join(folderPath, entry.name), parentId);
            }
        } catch {
            // Ignore access errors during recursion
        }
    }

    /**
     * Save a product entity and scan for projects inside it.
     * Products are terminal nodes - we don't scan deeper for manifests.
     */
    private async saveProduct(folderPath: string, parentId: number, manifest: Manifest): Promise<void> {
        const baseName = manifest.name || path.basename(folderPath);
        const uniqueName = this.resolveUniqueName(baseName, 'product');

        const productId = this.db.insertEntity({
            type: 'product',
            name: uniqueName,
            icon: manifest.icon || '📦',
            drivePath: folderPath,
            parentId: parentId,
            gitUrl: manifest.gitUrl
        });

        // Scan for projects (folders inside /projects/) - sorted for determinism
        const projectsPath = path.join(folderPath, 'projects');
        if (await this.exists(projectsPath)) {
            const entries = await this.readdirSorted(projectsPath);
            for (const entry of entries) {
                if (entry.isDirectory() && !entry.name.startsWith('.')) {
                    const projectBaseName = entry.name;
                    const projectUniqueName = this.resolveUniqueName(projectBaseName, 'project');

                    this.db.insertEntity({
                        type: 'project',
                        name: projectUniqueName,
                        icon: '📋',
                        drivePath: path.join(projectsPath, entry.name),
                        parentId: productId
                    });
                }
            }
        }
    }

    private async readManifest(folderPath: string, filename: string): Promise<Manifest | null> {
        const filePath = path.join(folderPath, filename);
        let content: string;
        try {
            content = await this.fs.readFile(filePath, 'utf8');
        } catch {
            return null;
        }

        try {
            const json = JSON.parse(content);
            return {
                name: json.name,
                icon: json.icon,
                gitUrl: json.git_url
            };
        } catch (error) {
            const msg = `Failed to parse ${filename} at ${folderPath}: ${error}`;
            if (this.onError) {
                this.onError(msg);
            } else {
                console.error(msg);
            }
            return null;
        }
    }

    private async exists(filePath: string): Promise<boolean> {
        try {
            await this.fs.access(filePath);
            return true;
        } catch {
            return false;
        }
    }
}
