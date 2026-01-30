import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { DatabaseManager } from '../../core/db';
import { Scanner } from '../../core/scanner';
import { ConfigManager } from '../../core/config';
import { Paths } from '../../core/paths';
import { FileSystem, nodeFs } from '../../core/fs';

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
        // Create scanner with real filesystem (nodeFs) via DI
        scanner = new Scanner(dbManager, filters, undefined, nodeFs);

        // Mock ConfigManager to return our temp folders
        vi.spyOn(filters, 'read').mockResolvedValue({
            businessFolders: [path.join(tempDir, 'Business1')]
        });
    });

    afterEach(async () => {
        await fs.rm(tempDir, { recursive: true, force: true });
        vi.clearAllMocks();
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

    describe('Name uniqueness (priority-based)', () => {
        it('should add suffix to duplicate names of same type', async () => {
            // Setup: Two businesses with same name product
            const biz1Path = path.join(tempDir, 'Business1');
            const biz2Path = path.join(tempDir, 'Business2');
            const prod1Path = path.join(biz1Path, 'ProductX');
            const prod2Path = path.join(biz2Path, 'ProductX');

            await fs.mkdir(prod1Path, { recursive: true });
            await fs.mkdir(prod2Path, { recursive: true });
            await fs.writeFile(path.join(biz1Path, 'business.json'), JSON.stringify({ name: 'Biz1' }));
            await fs.writeFile(path.join(biz2Path, 'business.json'), JSON.stringify({ name: 'Biz2' }));
            await fs.writeFile(path.join(prod1Path, 'product.json'), JSON.stringify({ name: 'DuplicateName' }));
            await fs.writeFile(path.join(prod2Path, 'product.json'), JSON.stringify({ name: 'DuplicateName' }));

            // Mock config to include both businesses
            vi.spyOn(filters, 'read').mockResolvedValue({
                businessFolders: [biz1Path, biz2Path]
            });

            await scanner.scan();

            const dump = dbManager.dump();
            const products = dump.filter(r => r.type === 'product');

            // One should be 'DuplicateName', the other 'DuplicateName (1)'
            expect(products).toHaveLength(2);
            expect(products.some(p => p.name === 'DuplicateName')).toBe(true);
            expect(products.some(p => p.name === 'DuplicateName (1)')).toBe(true);
        });

        it('should give priority to higher-type entity (business > product)', async () => {
            // Setup: Product scanned first, then business with same name
            // Result: business should keep original name, product should get suffix
            const biz1Path = path.join(tempDir, 'Business1');
            const biz2Path = path.join(tempDir, 'Business2');
            const prodPath = path.join(biz1Path, 'Shared'); // Product named "Shared"

            await fs.mkdir(prodPath, { recursive: true });
            await fs.mkdir(biz2Path, { recursive: true });
            await fs.writeFile(path.join(biz1Path, 'business.json'), JSON.stringify({ name: 'Biz1' }));
            await fs.writeFile(path.join(prodPath, 'product.json'), JSON.stringify({ name: 'Shared' })); // Product "Shared"
            await fs.writeFile(path.join(biz2Path, 'business.json'), JSON.stringify({ name: 'Shared' })); // Business "Shared"

            // Mock config: biz1 first (has product "Shared"), then biz2 (business "Shared")
            vi.spyOn(filters, 'read').mockResolvedValue({
                businessFolders: [biz1Path, biz2Path]
            });

            await scanner.scan();

            const dump = dbManager.dump();

            // Business "Shared" should have the original name (higher priority)
            const business = dump.find(r => r.type === 'business' && r.name === 'Shared');
            expect(business).toBeDefined();

            // Product should have been renamed to "Shared (1)"
            const product = dump.find(r => r.type === 'product');
            expect(product).toBeDefined();
            expect(product.name).toBe('Shared (1)');
        });

        it('should give priority to higher-type entity (stream > project)', async () => {
            // Setup: Project scanned first, then stream with same name
            const bizPath = path.join(tempDir, 'Business1');
            const prodPath = path.join(bizPath, 'Product1');
            const projPath = path.join(prodPath, 'projects', 'MyName'); // Project named "MyName"
            const streamPath = path.join(bizPath, 'MyName'); // Stream named "MyName"

            await fs.mkdir(projPath, { recursive: true });
            await fs.mkdir(streamPath, { recursive: true });
            await fs.writeFile(path.join(bizPath, 'business.json'), JSON.stringify({ name: 'Biz1' }));
            await fs.writeFile(path.join(prodPath, 'product.json'), JSON.stringify({ name: 'Product1' }));
            await fs.writeFile(path.join(streamPath, 'stream.json'), JSON.stringify({ name: 'MyName' }));
            // Project has no manifest - name from folder

            await scanner.scan();

            const dump = dbManager.dump();

            // Stream "MyName" should keep original name (higher priority)
            const stream = dump.find(r => r.type === 'stream' && r.name === 'MyName');
            expect(stream).toBeDefined();

            // Project should have been renamed
            const project = dump.find(r => r.type === 'project');
            expect(project).toBeDefined();
            expect(project.name).toBe('MyName (1)');
        });

        it('should handle multiple duplicates with incrementing suffixes', async () => {
            // Setup: Three items with same name
            const bizPath = path.join(tempDir, 'Business1');
            const stream1Path = path.join(bizPath, 'Stream1');
            const stream2Path = path.join(bizPath, 'Stream2');
            const stream3Path = path.join(bizPath, 'Stream3');

            await fs.mkdir(stream1Path, { recursive: true });
            await fs.mkdir(stream2Path, { recursive: true });
            await fs.mkdir(stream3Path, { recursive: true });
            await fs.writeFile(path.join(bizPath, 'business.json'), JSON.stringify({ name: 'Biz1' }));
            await fs.writeFile(path.join(stream1Path, 'stream.json'), JSON.stringify({ name: 'SameName' }));
            await fs.writeFile(path.join(stream2Path, 'stream.json'), JSON.stringify({ name: 'SameName' }));
            await fs.writeFile(path.join(stream3Path, 'stream.json'), JSON.stringify({ name: 'SameName' }));

            await scanner.scan();

            const dump = dbManager.dump();
            const streams = dump.filter(r => r.type === 'stream');

            expect(streams).toHaveLength(3);
            const names = streams.map(s => s.name).sort();
            expect(names).toEqual(['SameName', 'SameName (1)', 'SameName (2)']);
        });

        it('should handle duplicate project names', async () => {
            // Setup: Two projects with same name in different products
            const bizPath = path.join(tempDir, 'Business1');
            const prod1Path = path.join(bizPath, 'Product1');
            const prod2Path = path.join(bizPath, 'Product2');
            const proj1Path = path.join(prod1Path, 'projects', 'MyProject');
            const proj2Path = path.join(prod2Path, 'projects', 'MyProject');

            await fs.mkdir(proj1Path, { recursive: true });
            await fs.mkdir(proj2Path, { recursive: true });
            await fs.writeFile(path.join(bizPath, 'business.json'), JSON.stringify({ name: 'Biz1' }));
            await fs.writeFile(path.join(prod1Path, 'product.json'), JSON.stringify({ name: 'Product1' }));
            await fs.writeFile(path.join(prod2Path, 'product.json'), JSON.stringify({ name: 'Product2' }));

            await scanner.scan();

            const dump = dbManager.dump();
            const projects = dump.filter(r => r.type === 'project');

            expect(projects).toHaveLength(2);
            expect(projects.some(p => p.name === 'MyProject')).toBe(true);
            expect(projects.some(p => p.name === 'MyProject (1)')).toBe(true);
        });
    });

    describe('Self-healing manifests', () => {
        it('should create business.json if missing at root', async () => {
            // Setup: Business folder without manifest
            const bizPath = path.join(tempDir, 'Business1');
            await fs.mkdir(bizPath, { recursive: true });
            // No business.json created

            await scanner.scan();

            // Verify manifest was created
            const manifestPath = path.join(bizPath, 'business.json');
            const exists = await fs.access(manifestPath).then(() => true).catch(() => false);
            expect(exists).toBe(true);

            const content = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
            expect(content.name).toBe('Business1');
            expect(content.icon).toBe('📁');

            // Verify DB entry
            const dump = dbManager.dump();
            const biz = dump.find(r => r.type === 'business');
            expect(biz).toBeDefined();
            expect(biz.name).toBe('Business1');
        });

        it('should rename stream.json to business.json at root', async () => {
            // Setup: Root folder with stream.json (wrong manifest)
            const bizPath = path.join(tempDir, 'Business1');
            await fs.mkdir(bizPath, { recursive: true });
            await fs.writeFile(path.join(bizPath, 'stream.json'), JSON.stringify({ name: 'WrongManifest', icon: '🌊' }));

            await scanner.scan();

            // Verify stream.json was renamed to business.json
            const businessPath = path.join(bizPath, 'business.json');
            const streamPath = path.join(bizPath, 'stream.json');

            const businessExists = await fs.access(businessPath).then(() => true).catch(() => false);
            const streamExists = await fs.access(streamPath).then(() => true).catch(() => false);

            expect(businessExists).toBe(true);
            expect(streamExists).toBe(false);

            // Verify DB uses the manifest data
            const dump = dbManager.dump();
            const biz = dump.find(r => r.type === 'business');
            expect(biz.name).toBe('WrongManifest');
        });

        it('should rename business.json to stream.json inside chain', async () => {
            // Setup: business.json inside a business (should be stream.json)
            const bizPath = path.join(tempDir, 'Business1');
            const wrongPath = path.join(bizPath, 'WrongFolder');
            await fs.mkdir(wrongPath, { recursive: true });
            await fs.writeFile(path.join(bizPath, 'business.json'), JSON.stringify({ name: 'Biz1' }));
            await fs.writeFile(path.join(wrongPath, 'business.json'), JSON.stringify({ name: 'ShouldBeStream', icon: '🏢' }));

            await scanner.scan();

            // Verify business.json was renamed to stream.json
            const businessPath = path.join(wrongPath, 'business.json');
            const streamPath = path.join(wrongPath, 'stream.json');

            const businessExists = await fs.access(businessPath).then(() => true).catch(() => false);
            const streamExists = await fs.access(streamPath).then(() => true).catch(() => false);

            expect(businessExists).toBe(false);
            expect(streamExists).toBe(true);

            // Verify DB entry is stream type
            const dump = dbManager.dump();
            const stream = dump.find(r => r.name === 'ShouldBeStream');
            expect(stream).toBeDefined();
            expect(stream.type).toBe('stream');
        });
    });

    describe('Git repo projects scanning', () => {
        it('should scan projects from git repo when reposPath is configured', async () => {
            // Setup: Product in drive folder, projects in git repo
            const bizPath = path.join(tempDir, 'Business1');
            const productPath = path.join(bizPath, 'MyProduct');
            const reposPath = path.join(tempDir, 'repos');
            const gitRepoPath = path.join(reposPath, 'MyProduct.git');
            const gitProjectPath = path.join(gitRepoPath, 'projects', 'GitProject');

            await fs.mkdir(productPath, { recursive: true });
            await fs.mkdir(gitProjectPath, { recursive: true });
            await fs.writeFile(path.join(bizPath, 'business.json'), JSON.stringify({ name: 'Biz1' }));
            await fs.writeFile(path.join(productPath, 'product.json'), JSON.stringify({ name: 'MyProduct' }));

            // Create scanner with reposPath
            const scannerWithRepos = new Scanner(dbManager, filters, undefined, nodeFs, reposPath);

            await scannerWithRepos.scan();

            const dump = dbManager.dump();
            const project = dump.find(r => r.type === 'project' && r.name === 'GitProject');
            expect(project).toBeDefined();

            const product = dump.find(r => r.type === 'product' && r.name === 'MyProduct');
            expect(project?.parent_id).toBe(product?.id);
        });

        it('should scan projects from both drive and git repo', async () => {
            // Setup: Projects in both drive folder and git repo
            const bizPath = path.join(tempDir, 'Business1');
            const productPath = path.join(bizPath, 'MyProduct');
            const driveProjectPath = path.join(productPath, 'projects', 'DriveProject');
            const reposPath = path.join(tempDir, 'repos');
            const gitRepoPath = path.join(reposPath, 'MyProduct.git');
            const gitProjectPath = path.join(gitRepoPath, 'projects', 'GitProject');

            await fs.mkdir(driveProjectPath, { recursive: true });
            await fs.mkdir(gitProjectPath, { recursive: true });
            await fs.writeFile(path.join(bizPath, 'business.json'), JSON.stringify({ name: 'Biz1' }));
            await fs.writeFile(path.join(productPath, 'product.json'), JSON.stringify({ name: 'MyProduct' }));

            // Create scanner with reposPath
            const scannerWithRepos = new Scanner(dbManager, filters, undefined, nodeFs, reposPath);

            await scannerWithRepos.scan();

            const dump = dbManager.dump();
            const projects = dump.filter(r => r.type === 'project');
            expect(projects).toHaveLength(2);
            expect(projects.some(p => p.name === 'DriveProject')).toBe(true);
            expect(projects.some(p => p.name === 'GitProject')).toBe(true);
        });

        it('should not fail if git repo does not exist', async () => {
            // Setup: Product in drive folder, no git repo
            const bizPath = path.join(tempDir, 'Business1');
            const productPath = path.join(bizPath, 'MyProduct');
            const reposPath = path.join(tempDir, 'repos');
            // Note: git repo folder NOT created

            await fs.mkdir(productPath, { recursive: true });
            await fs.writeFile(path.join(bizPath, 'business.json'), JSON.stringify({ name: 'Biz1' }));
            await fs.writeFile(path.join(productPath, 'product.json'), JSON.stringify({ name: 'MyProduct' }));

            // Create scanner with reposPath (pointing to non-existent repos folder)
            const scannerWithRepos = new Scanner(dbManager, filters, undefined, nodeFs, reposPath);

            // Should not throw
            await scannerWithRepos.scan();

            const dump = dbManager.dump();
            const product = dump.find(r => r.type === 'product' && r.name === 'MyProduct');
            expect(product).toBeDefined();
        });
    });

    describe('Database findByName and nameExists', () => {
        it('should find entity by name', async () => {
            const bizPath = path.join(tempDir, 'Business1');
            await fs.mkdir(bizPath, { recursive: true });
            await fs.writeFile(path.join(bizPath, 'business.json'), JSON.stringify({ name: 'MyBusiness' }));

            await scanner.scan();

            const entity = dbManager.findByName('MyBusiness');
            expect(entity).not.toBeNull();
            expect(entity?.type).toBe('business');
            expect(entity?.name).toBe('MyBusiness');
        });

        it('should return null for non-existent name', async () => {
            const bizPath = path.join(tempDir, 'Business1');
            await fs.mkdir(bizPath, { recursive: true });
            await fs.writeFile(path.join(bizPath, 'business.json'), JSON.stringify({ name: 'Exists' }));

            await scanner.scan();

            const entity = dbManager.findByName('DoesNotExist');
            expect(entity).toBeNull();
        });

        it('should check if name exists', async () => {
            const bizPath = path.join(tempDir, 'Business1');
            await fs.mkdir(bizPath, { recursive: true });
            await fs.writeFile(path.join(bizPath, 'business.json'), JSON.stringify({ name: 'TestName' }));

            await scanner.scan();

            expect(dbManager.nameExists('TestName')).toBe(true);
            expect(dbManager.nameExists('OtherName')).toBe(false);
        });

        it('should update entity name', async () => {
            const bizPath = path.join(tempDir, 'Business1');
            await fs.mkdir(bizPath, { recursive: true });
            await fs.writeFile(path.join(bizPath, 'business.json'), JSON.stringify({ name: 'OriginalName' }));

            await scanner.scan();

            const entity = dbManager.findByName('OriginalName');
            expect(entity).not.toBeNull();

            dbManager.updateEntityName(entity!.id!, 'NewName');

            expect(dbManager.findByName('OriginalName')).toBeNull();
            expect(dbManager.findByName('NewName')).not.toBeNull();
        });
    });

    describe('Self-healing error handling (DI mock)', () => {
        it('should continue scan and log error if writeFile fails', async () => {
            // Setup: Business folder without manifest (will trigger createBusinessManifest)
            const bizPath = path.join(tempDir, 'Business1');
            await fs.mkdir(bizPath, { recursive: true });

            // Create mock FileSystem that fails on writeFile for business.json
            const mockFs: FileSystem = {
                ...nodeFs,
                writeFile: async (filePath: string) => {
                    if (filePath.includes('business.json')) {
                        throw new Error('Permission denied (mocked)');
                    }
                    return nodeFs.writeFile(filePath, '', 'utf8');
                }
            };

            // Create scanner with error callback and mock filesystem
            const errors: string[] = [];
            const scannerWithMock = new Scanner(dbManager, filters, (msg) => errors.push(msg), mockFs);

            await scannerWithMock.scan();

            // Verify error was logged
            expect(errors.length).toBeGreaterThan(0);
            expect(errors[0]).toContain('Self-healing failed');
            expect(errors[0]).toContain('Permission denied');

            // Scan should still complete (business scanned with fallback name)
            const dump = dbManager.dump();
            expect(dump.find(r => r.type === 'business')).toBeDefined();
        });

        it('should continue scan if rename fails', async () => {
            // Setup: Business folder with stream.json (wrong type at root)
            const bizPath = path.join(tempDir, 'Business1');
            await fs.mkdir(bizPath, { recursive: true });
            await fs.writeFile(path.join(bizPath, 'stream.json'), JSON.stringify({ name: 'WrongType' }));

            // Create mock FileSystem that fails on rename
            const mockFs: FileSystem = {
                ...nodeFs,
                rename: async () => {
                    throw new Error('Rename failed (mocked)');
                }
            };

            const errors: string[] = [];
            const scannerWithMock = new Scanner(dbManager, filters, (msg) => errors.push(msg), mockFs);

            await scannerWithMock.scan();

            // Verify error was logged
            expect(errors.length).toBeGreaterThan(0);
            expect(errors[0]).toContain('Self-healing failed');
            expect(errors[0]).toContain('Rename failed');

            // Scan should still complete (business scanned with fallback name from folder)
            const dump = dbManager.dump();
            expect(dump.find(r => r.type === 'business')).toBeDefined();
        });
    });
});
