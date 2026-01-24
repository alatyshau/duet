/**
 * Unit tests for ContextBreadcrumb
 *
 * Tests cover:
 * - Empty workspace folders → empty result
 * - Git repo in repos/ with matching product → chain
 * - Git repo in repos/ without match → orphan error
 * - Git repo in repos/ with name conflict → name_conflict error
 * - Folder on Drive found in DB → chain
 * - Folder not in DB → external
 * - Common ancestor merging
 * - Root sorting by leaf type
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { DatabaseManager, Entity } from '../../core/db';
import { Paths } from '../../core/paths';
import { ContextBreadcrumb, ContextNode } from '../../core/tree/contextBreadcrumb';

describe('ContextBreadcrumb', () => {
    let tempDir: string;
    let dataDir: string;
    let reposPath: string;
    let db: DatabaseManager;
    let breadcrumb: ContextBreadcrumb;

    beforeEach(async () => {
        // Create temp directory structure
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'duet-context-test-'));
        dataDir = path.join(tempDir, 'DuetData');
        reposPath = path.join(dataDir, 'repos');
        await fs.mkdir(reposPath, { recursive: true });

        // Initialize DB
        const paths = new Paths(dataDir);
        db = new DatabaseManager(paths);
        await db.init();

        // Create breadcrumb builder
        breadcrumb = new ContextBreadcrumb({ db, reposPath });
    });

    afterEach(async () => {
        await fs.rm(tempDir, { recursive: true, force: true });
    });

    describe('Empty input', () => {
        it('should return empty array for empty folder list', () => {
            const result = breadcrumb.build([]);
            expect(result).toEqual([]);
        });
    });

    describe('Git repos in repos/ folder', () => {
        it('should build chain for git repo with matching product', () => {
            // Setup DB: Business -> Product
            const bizId = db.insertEntity({
                type: 'business',
                name: 'TestBiz',
                icon: '🔬',
                drivePath: '/drive/TestBiz'
            });
            db.insertEntity({
                type: 'product',
                name: 'MyApp',
                icon: '📱',
                drivePath: '/drive/TestBiz/MyApp',
                parentId: bizId
            });

            // Git repo folder
            const gitFolder = path.join(reposPath, 'MyApp.git');

            const result = breadcrumb.build([gitFolder]);

            expect(result).toHaveLength(1);
            expect(result[0].type).toBe('business');
            expect(result[0].name).toBe('TestBiz');
            expect(result[0].children).toHaveLength(1);

            const product = result[0].children[0];
            expect(product.type).toBe('product');
            expect(product.name).toBe('MyApp');
            expect(product.children).toHaveLength(1);

            const git = product.children[0];
            expect(git.type).toBe('git');
            expect(git.name).toBe('MyApp.git');
            expect(git.path).toBe(gitFolder);
        });

        it('should return orphan error as child of git folder', () => {
            // No entities in DB
            const gitFolder = path.join(reposPath, 'Unknown.git');

            const result = breadcrumb.build([gitFolder]);

            expect(result).toHaveLength(1);
            // Root is the git folder
            expect(result[0].type).toBe('git');
            expect(result[0].name).toBe('Unknown.git');
            expect(result[0].errorCode).toBe('orphan');
            // Error is a child
            expect(result[0].children).toHaveLength(1);
            expect(result[0].children[0].type).toBe('error');
            expect(result[0].children[0].errorCode).toBe('orphan');
        });

        it('should return name_conflict error as child of git folder', () => {
            // Setup DB: Business with same name as repo
            db.insertEntity({
                type: 'business',
                name: 'Conflict',
                icon: '🔬',
                drivePath: '/drive/Conflict'
            });

            const gitFolder = path.join(reposPath, 'Conflict.git');

            const result = breadcrumb.build([gitFolder]);

            expect(result).toHaveLength(1);
            // Root is the git folder
            expect(result[0].type).toBe('git');
            expect(result[0].errorCode).toBe('name_conflict');
            // Error is a child
            expect(result[0].children).toHaveLength(1);
            expect(result[0].children[0].type).toBe('error');
            expect(result[0].children[0].errorCode).toBe('name_conflict');
        });

        it('should treat repos/ folder without .git suffix as external with info child', () => {
            const folder = path.join(reposPath, 'SomeFolder');

            const result = breadcrumb.build([folder]);

            expect(result).toHaveLength(1);
            expect(result[0].type).toBe('external');
            // No errorCode on parent - only child is clickable
            expect(result[0].errorCode).toBeUndefined();
            // Info child for help
            expect(result[0].children).toHaveLength(1);
            expect(result[0].children[0].type).toBe('error');
            expect(result[0].children[0].errorCode).toBe('outside_hierarchy');
            expect(result[0].children[0].icon).toBe('info');
        });
    });

    describe('Folders on Drive (DB lookup)', () => {
        it('should build chain for folder found in DB', () => {
            // Setup DB: Business -> Stream -> Product
            const bizId = db.insertEntity({
                type: 'business',
                name: 'МетаЛаб',
                icon: '🔬',
                drivePath: '/drive/МетаЛаб'
            });
            const streamId = db.insertEntity({
                type: 'stream',
                name: 'ТехноЛаб',
                icon: '💻',
                drivePath: '/drive/МетаЛаб/ТехноЛаб',
                parentId: bizId
            });
            db.insertEntity({
                type: 'product',
                name: 'Duet',
                icon: '🎭',
                drivePath: '/drive/МетаЛаб/ТехноЛаб/Duet',
                parentId: streamId
            });

            // Open product folder on Drive
            const driveFolder = '/drive/МетаЛаб/ТехноЛаб/Duet';

            const result = breadcrumb.build([driveFolder]);

            expect(result).toHaveLength(1);
            expect(result[0].type).toBe('business');
            expect(result[0].name).toBe('МетаЛаб');

            const stream = result[0].children[0];
            expect(stream.type).toBe('stream');
            expect(stream.name).toBe('ТехноЛаб');

            const product = stream.children[0];
            expect(product.type).toBe('product');
            expect(product.name).toBe('Duet');
        });

        it('should return external for folder not in DB with info child', () => {
            const unknownFolder = '/some/random/path';

            const result = breadcrumb.build([unknownFolder]);

            expect(result).toHaveLength(1);
            expect(result[0].type).toBe('external');
            // No errorCode on parent - only child is clickable
            expect(result[0].errorCode).toBeUndefined();
            // Info child for help
            expect(result[0].children).toHaveLength(1);
            expect(result[0].children[0].type).toBe('error');
            expect(result[0].children[0].errorCode).toBe('outside_hierarchy');
            expect(result[0].children[0].icon).toBe('info');
        });

        it('should match deepest entity for nested path', () => {
            // Setup DB: Business -> Product
            const bizId = db.insertEntity({
                type: 'business',
                name: 'Biz',
                icon: 'B',
                drivePath: '/drive/Biz'
            });
            db.insertEntity({
                type: 'product',
                name: 'Prod',
                icon: 'P',
                drivePath: '/drive/Biz/Prod',
                parentId: bizId
            });

            // Open subfolder of product
            const subFolder = '/drive/Biz/Prod/src/components';

            const result = breadcrumb.build([subFolder]);

            expect(result).toHaveLength(1);
            // Should match Product (deepest) and build chain to Business
            expect(result[0].type).toBe('business');
            expect(result[0].children[0].type).toBe('product');
            expect(result[0].children[0].name).toBe('Prod');
        });
    });

    describe('Common ancestor merging', () => {
        it('should merge two products from same business into one tree', () => {
            // Setup DB: Business -> [Product1, Product2]
            const bizId = db.insertEntity({
                type: 'business',
                name: 'МетаЛаб',
                icon: '🔬',
                drivePath: '/drive/МетаЛаб'
            });
            db.insertEntity({
                type: 'product',
                name: 'Duet',
                icon: '🎭',
                drivePath: '/drive/МетаЛаб/Duet',
                parentId: bizId
            });
            db.insertEntity({
                type: 'product',
                name: 'Kreator',
                icon: '🎨',
                drivePath: '/drive/МетаЛаб/Kreator',
                parentId: bizId
            });

            // Open both git repos
            const duetRepo = path.join(reposPath, 'Duet.git');
            const kreatorRepo = path.join(reposPath, 'Kreator.git');

            const result = breadcrumb.build([duetRepo, kreatorRepo]);

            // Should be ONE root (МетаЛаб) with TWO product children
            expect(result).toHaveLength(1);
            expect(result[0].type).toBe('business');
            expect(result[0].name).toBe('МетаЛаб');
            expect(result[0].children).toHaveLength(2);

            const productNames = result[0].children.map(c => c.name);
            expect(productNames).toContain('Duet');
            expect(productNames).toContain('Kreator');
        });

        it('should merge products from same stream into one subtree', () => {
            // Setup DB: Business -> Stream -> [Product1, Product2]
            const bizId = db.insertEntity({
                type: 'business',
                name: 'МетаЛаб',
                icon: '🔬',
                drivePath: '/drive/МетаЛаб'
            });
            const streamId = db.insertEntity({
                type: 'stream',
                name: 'ТехноЛаб',
                icon: '💻',
                drivePath: '/drive/МетаЛаб/ТехноЛаб',
                parentId: bizId
            });
            db.insertEntity({
                type: 'product',
                name: 'Duet',
                icon: '🎭',
                drivePath: '/drive/МетаЛаб/ТехноЛаб/Duet',
                parentId: streamId
            });
            db.insertEntity({
                type: 'product',
                name: 'Kreator',
                icon: '🎨',
                drivePath: '/drive/МетаЛаб/ТехноЛаб/Kreator',
                parentId: streamId
            });

            const duetRepo = path.join(reposPath, 'Duet.git');
            const kreatorRepo = path.join(reposPath, 'Kreator.git');

            const result = breadcrumb.build([duetRepo, kreatorRepo]);

            // One root -> one stream -> two products
            expect(result).toHaveLength(1);
            const stream = result[0].children[0];
            expect(stream.type).toBe('stream');
            expect(stream.children).toHaveLength(2);
        });

        it('should create separate roots for different businesses', () => {
            // Setup DB: Two separate businesses with products
            const biz1Id = db.insertEntity({
                type: 'business',
                name: 'Business1',
                icon: '1️⃣',
                drivePath: '/drive/Business1'
            });
            const biz2Id = db.insertEntity({
                type: 'business',
                name: 'Business2',
                icon: '2️⃣',
                drivePath: '/drive/Business2'
            });
            db.insertEntity({
                type: 'product',
                name: 'Prod1',
                icon: 'P1',
                drivePath: '/drive/Business1/Prod1',
                parentId: biz1Id
            });
            db.insertEntity({
                type: 'product',
                name: 'Prod2',
                icon: 'P2',
                drivePath: '/drive/Business2/Prod2',
                parentId: biz2Id
            });

            const prod1Repo = path.join(reposPath, 'Prod1.git');
            const prod2Repo = path.join(reposPath, 'Prod2.git');

            const result = breadcrumb.build([prod1Repo, prod2Repo]);

            // Two separate roots
            expect(result).toHaveLength(2);
            const names = result.map(r => r.name);
            expect(names).toContain('Business1');
            expect(names).toContain('Business2');
        });
    });

    describe('Root sorting', () => {
        it('should sort roots by leaf type: business > stream > product > external', () => {
            // Setup: Various entity types as deepest match
            const bizId = db.insertEntity({
                type: 'business',
                name: 'JustBusiness',
                icon: 'B',
                drivePath: '/drive/JustBusiness'
            });
            db.insertEntity({
                type: 'stream',
                name: 'JustStream',
                icon: 'S',
                drivePath: '/drive/JustBusiness/JustStream',
                parentId: bizId
            });
            const biz2Id = db.insertEntity({
                type: 'business',
                name: 'BizWithProduct',
                icon: 'B',
                drivePath: '/drive/BizWithProduct'
            });
            db.insertEntity({
                type: 'product',
                name: 'TheProduct',
                icon: 'P',
                drivePath: '/drive/BizWithProduct/TheProduct',
                parentId: biz2Id
            });

            const folders = [
                '/drive/JustBusiness/JustStream', // Stream deepest
                '/some/external/folder',          // External
                path.join(reposPath, 'TheProduct.git'), // Product via git
                '/drive/JustBusiness'             // Business deepest
            ];

            const result = breadcrumb.build(folders);

            // External should be sorted last
            expect(result.length).toBeGreaterThan(0);
            const lastRoot = result[result.length - 1];
            expect(lastRoot).toBeDefined();
            expect(lastRoot!.type).toBe('external');
        });

        it('should sort alphabetically within same leaf type', () => {
            // Two external folders with different names
            const folders = [
                '/some/path/Zebra',
                '/other/path/Apple'
            ];

            const result = breadcrumb.build(folders);

            expect(result).toHaveLength(2);
            // Should be sorted alphabetically: Apple before Zebra
            expect(result[0].name).toBe('Apple');
            expect(result[1].name).toBe('Zebra');
        });
    });

    describe('Git repo outside repos/ folder', () => {
        it('should return outside_repos error as child of git folder', () => {
            // A git repo outside the DuetData/repos folder
            const externalGitRepo = '/home/user/projects/SomeRepo.git';

            const result = breadcrumb.build([externalGitRepo]);

            expect(result).toHaveLength(1);
            // Root is the git folder
            expect(result[0].type).toBe('git');
            expect(result[0].name).toBe('SomeRepo.git');
            expect(result[0].errorCode).toBe('outside_repos');
            // Error is a child
            expect(result[0].children).toHaveLength(1);
            expect(result[0].children[0].type).toBe('error');
            expect(result[0].children[0].errorCode).toBe('outside_repos');
        });
    });

    describe('Complex scenarios', () => {
        it('should handle mix of valid chains, errors, and externals', () => {
            // Setup DB
            const bizId = db.insertEntity({
                type: 'business',
                name: 'ValidBiz',
                icon: '✓',
                drivePath: '/drive/ValidBiz'
            });
            db.insertEntity({
                type: 'product',
                name: 'ValidProd',
                icon: 'P',
                drivePath: '/drive/ValidBiz/ValidProd',
                parentId: bizId
            });

            const folders = [
                path.join(reposPath, 'ValidProd.git'),  // Valid chain
                path.join(reposPath, 'Orphan.git'),     // Orphan error
                '/some/random/folder'                   // External
            ];

            const result = breadcrumb.build(folders);

            expect(result).toHaveLength(3);

            // Find each type
            const validRoot = result.find(r => r.type === 'business');
            const orphan = result.find(r => r.errorCode === 'orphan');
            const external = result.find(r => r.type === 'external');

            expect(validRoot).toBeDefined();
            expect(orphan).toBeDefined();
            expect(external).toBeDefined();
        });

        it('should handle deeply nested hierarchy', () => {
            // Business -> Stream1 -> Stream2 -> Product
            const bizId = db.insertEntity({
                type: 'business',
                name: 'DeepBiz',
                icon: 'B',
                drivePath: '/drive/DeepBiz'
            });
            const s1Id = db.insertEntity({
                type: 'stream',
                name: 'Stream1',
                icon: 'S1',
                drivePath: '/drive/DeepBiz/Stream1',
                parentId: bizId
            });
            const s2Id = db.insertEntity({
                type: 'stream',
                name: 'Stream2',
                icon: 'S2',
                drivePath: '/drive/DeepBiz/Stream1/Stream2',
                parentId: s1Id
            });
            db.insertEntity({
                type: 'product',
                name: 'DeepProd',
                icon: 'P',
                drivePath: '/drive/DeepBiz/Stream1/Stream2/DeepProd',
                parentId: s2Id
            });

            const gitFolder = path.join(reposPath, 'DeepProd.git');

            const result = breadcrumb.build([gitFolder]);

            expect(result).toHaveLength(1);

            // Verify full chain
            let node = result[0];
            expect(node.type).toBe('business');
            expect(node.name).toBe('DeepBiz');

            node = node.children[0];
            expect(node.type).toBe('stream');
            expect(node.name).toBe('Stream1');

            node = node.children[0];
            expect(node.type).toBe('stream');
            expect(node.name).toBe('Stream2');

            node = node.children[0];
            expect(node.type).toBe('product');
            expect(node.name).toBe('DeepProd');

            node = node.children[0];
            expect(node.type).toBe('git');
        });
    });
});

// Helper function to get deepest node type (for sorting verification)
function getDeepestType(node: ContextNode): string {
    if (node.children.length === 0) {
        return node.type;
    }
    const nonGit = node.children.filter(c => c.type !== 'git');
    if (nonGit.length > 0) {
        return getDeepestType(nonGit[0]);
    }
    return node.type;
}
