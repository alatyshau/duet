import * as fs from 'fs/promises';
import * as path from 'path';
import { DatabaseManager } from './db';
import { ConfigManager } from './config';

interface Manifest {
    name: string;
    icon?: string;
    gitUrl?: string;
}

export class Scanner {
    private scanInProgress = false;

    constructor(
        private readonly db: DatabaseManager,
        private readonly config: ConfigManager,
        private readonly onError?: (message: string) => void
    ) {}

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

    private async scanBusiness(folderPath: string): Promise<void> {
        if (!await this.exists(folderPath)) { return; }

        const manifest = await this.readManifest(folderPath, 'business.json');
        const name = manifest?.name || path.basename(folderPath);
        const icon = manifest?.icon || '📁';

        const businessId = this.db.insertEntity({
            type: 'business',
            name,
            icon,
            drivePath: folderPath
        });

        // Scan children (Stream or Product)
        const entries = await fs.readdir(folderPath, { withFileTypes: true });
        for (const entry of entries) {
            if (!entry.isDirectory() || entry.name.startsWith('.')) { continue; }
            
            const childPath = path.join(folderPath, entry.name);
            await this.scanStreamOrProduct(childPath, businessId);
        }
    }

    private async scanStreamOrProduct(folderPath: string, parentId: number): Promise<void> {
        // Check for stream.json
        const streamManifest = await this.readManifest(folderPath, 'stream.json');
        if (streamManifest) {
            const streamId = this.db.insertEntity({
                type: 'stream',
                name: streamManifest.name,
                icon: streamManifest.icon || '🌊',
                drivePath: folderPath,
                parentId: parentId
            });
            
            // Scan products inside stream recursively
            const entries = await fs.readdir(folderPath, { withFileTypes: true });
            for (const entry of entries) {
                if (!entry.isDirectory() || entry.name.startsWith('.')) { continue; }
                await this.scanProductRecursive(path.join(folderPath, entry.name), streamId);
            }
            return;
        }

        // Check for product.json
        const productManifest = await this.readManifest(folderPath, 'product.json');
        if (productManifest) {
            await this.saveProduct(folderPath, parentId, productManifest);
            return;
        }

        // Use recursion to find deep items (Stream or Product)
        try {
            const entries = await fs.readdir(folderPath, { withFileTypes: true });
            for (const entry of entries) {
                if (!entry.isDirectory() || entry.name.startsWith('.')) { continue; }
                await this.scanStreamOrProduct(path.join(folderPath, entry.name), parentId);
            }
        } catch {
            // Ignore access errors during recursion
        }
    }

    private async scanProductRecursive(folderPath: string, parentId: number): Promise<void> {
        const manifest = await this.readManifest(folderPath, 'product.json');
        if (manifest) { 
            await this.saveProduct(folderPath, parentId, manifest);
            return; 
        }

        try {
            const entries = await fs.readdir(folderPath, { withFileTypes: true });
            for (const entry of entries) {
                if (!entry.isDirectory() || entry.name.startsWith('.')) { continue; }
                await this.scanProductRecursive(path.join(folderPath, entry.name), parentId);
            }
        } catch {
            // Ignore access errors
        }
    }

    private async saveProduct(folderPath: string, parentId: number, manifest: Manifest): Promise<void> {
        const productId = this.db.insertEntity({
            type: 'product',
            name: manifest.name,
            icon: manifest.icon || '📦',
            drivePath: folderPath,
            parentId: parentId,
            gitUrl: manifest.gitUrl
        });

        // Check for projects
        const projectsPath = path.join(folderPath, 'projects');
        if (await this.exists(projectsPath)) {
            const entries = await fs.readdir(projectsPath, { withFileTypes: true });
            for (const entry of entries) {
                if (entry.isDirectory() && !entry.name.startsWith('.')) {
                    this.db.insertEntity({
                        type: 'project',
                        name: entry.name, // Project name from folder name
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
            content = await fs.readFile(filePath, 'utf8');
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

    private async exists(path: string): Promise<boolean> {
        try {
            await fs.access(path);
            return true;
        } catch {
            return false;
        }
    }
}
