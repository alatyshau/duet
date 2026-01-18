import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { DatabaseManager } from '../../core/db';
import { Scanner } from '../../core/scanner';
import { ConfigManager } from '../../core/config';
import { Paths } from '../../core/paths';

describe('Scanner & Database', () => {
    let tempDir: string;
    let dbManager: DatabaseManager;
    let scanner: Scanner;
    let filters: ConfigManager;
    let paths: Paths;

    beforeEach(async () => {
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'duet-test-'));
        paths = new Paths(path.join(tempDir, 'DuetData'));
        dbManager = new DatabaseManager(paths);
        filters = new ConfigManager(paths.configPath);
        scanner = new Scanner(dbManager, filters);

        // Mock ConfigManager to return our temp folders
        vi.spyOn(filters, 'read').mockResolvedValue({
            businessFolders: [path.join(tempDir, 'Business1')]
        });
    });

    afterEach(async () => {
        await fs.rm(tempDir, { recursive: true, force: true });
        vi.restoreAllMocks();
    });

    it('should scan businesses, products and projects', async () => {
        // Setup Filesystem
        const bizPath = path.join(tempDir, 'Business1');
        const productPath = path.join(bizPath, 'Product1');
        const projectPath = path.join(productPath, 'projects', 'Project1');

        await fs.mkdir(projectPath, { recursive: true });
        await fs.writeFile(path.join(bizPath, 'business.json'), JSON.stringify({ name: 'Biz1', icon: 'B' }));
        await fs.writeFile(path.join(productPath, 'product.json'), JSON.stringify({ name: 'Prod1', icon: 'P' }));

        // Run Scan
        await scanner.scan();

        // Verify DB
        const dump = dbManager.dump();
        expect(dump).toHaveLength(3);

        const biz = dump.find(r => r.type === 'business');
        expect(biz).toBeDefined();
        expect(biz.name).toBe('Biz1');

        const prod = dump.find(r => r.type === 'product');
        expect(prod).toBeDefined();
        expect(prod.name).toBe('Prod1');
        expect(prod.parent_id).toBe(biz.id);

        const proj = dump.find(r => r.type === 'project');
        expect(proj).toBeDefined();
        expect(proj.name).toBe('Project1');
        expect(proj.parent_id).toBe(prod.id);
    });

    it('should scan streams and their products', async () => {
        // Setup Filesystem
        const bizPath = path.join(tempDir, 'Business1');
        const streamPath = path.join(bizPath, 'Stream1');
        const productPath = path.join(streamPath, 'ProductInStream');

        await fs.mkdir(productPath, { recursive: true });
        await fs.writeFile(path.join(bizPath, 'business.json'), JSON.stringify({ name: 'Biz1', icon: 'B' }));
        await fs.writeFile(path.join(streamPath, 'stream.json'), JSON.stringify({ name: 'Stream1', icon: 'S' }));
        await fs.writeFile(path.join(productPath, 'product.json'), JSON.stringify({ name: 'Prod1', icon: 'P' }));

        // Run Scan
        await scanner.scan();

        // Verify DB
        const dump = dbManager.dump();
        
        const stream = dump.find(r => r.type === 'stream');
        expect(stream).toBeDefined();
        expect(stream.name).toBe('Stream1');
        expect(stream.parent_id).toBeDefined();

        const prod = dump.find(r => r.name === 'Prod1');
        expect(prod).toBeDefined();
        expect(prod.parent_id).toBe(stream.id);
    });

    it('should recursively find products in nested folders', async () => {
        // Setup Filesystem
        const bizPath = path.join(tempDir, 'Business1');
        const deepPath = path.join(bizPath, 'Folder', 'Subfolder', 'DeepProduct');

        await fs.mkdir(deepPath, { recursive: true });
        await fs.writeFile(path.join(bizPath, 'business.json'), JSON.stringify({ name: 'Biz1' }));
        await fs.writeFile(path.join(deepPath, 'product.json'), JSON.stringify({ name: 'DeepProd' }));

        // Run Scan
        await scanner.scan();

        // Verify DB
        const dump = dbManager.dump();
        const prod = dump.find(r => r.name === 'DeepProd');
        expect(prod).toBeDefined();
        expect(prod.name).toBe('DeepProd');
    });

    it('should update DB on re-scan (handle deletions and updates)', async () => {
        const bizPath = path.join(tempDir, 'Business1');
        const prodPath = path.join(bizPath, 'Product1');
        const prod2Path = path.join(bizPath, 'Product2');

        // Initial State: Biz1 -> [Product1, Product2]
        await fs.mkdir(prodPath, { recursive: true });
        await fs.mkdir(prod2Path, { recursive: true });
        await fs.writeFile(path.join(bizPath, 'business.json'), JSON.stringify({ name: 'Biz1' }));
        await fs.writeFile(path.join(prodPath, 'product.json'), JSON.stringify({ name: 'Product1' }));
        await fs.writeFile(path.join(prod2Path, 'product.json'), JSON.stringify({ name: 'Product2' }));

        await scanner.scan();
        let dump = dbManager.dump();
        expect(dump.find(r => r.name === 'Product1')).toBeDefined();
        expect(dump.find(r => r.name === 'Product2')).toBeDefined();

        // Modify: Delete Product2, Rename Product1 -> Product1_Updated
        await fs.rm(prod2Path, { recursive: true });
        await fs.writeFile(path.join(prodPath, 'product.json'), JSON.stringify({ name: 'Product1_Updated' }));

        await scanner.scan();
        dump = dbManager.dump();

        expect(dump.find(r => r.name === 'Product2')).toBeUndefined();
        expect(dump.find(r => r.name === 'Product1_Updated')).toBeDefined();
        expect(dump.find(r => r.name === 'Product1')).toBeUndefined();
    });
});
