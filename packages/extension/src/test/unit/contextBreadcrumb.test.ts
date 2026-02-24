/**
 * Unit tests for ContextBreadcrumb
 *
 * Tests cover:
 * - Empty workspace folders -> empty result
 * - Git repo in repos/ with matching product -> chain
 * - Git repo in repos/ without match -> orphan error
 * - Git repo in repos/ with name conflict -> name_conflict error
 * - Folder on Drive found in streams -> chain
 * - Folder not in streams -> external
 * - Common ancestor merging
 * - Root sorting by leaf type
 */

import { describe, it, expect } from 'vitest';
import * as path from 'path';
import { StreamEntity } from '../../core/api-client';
import { ContextBreadcrumb, ContextNode } from '../../core/tree/contextBreadcrumb';

const REPOS_PATH = '/DuetData/repos';

function makeStream(overrides: Partial<StreamEntity> & { id: string; name: string; type: StreamEntity['type'] }): StreamEntity {
    return {
        icon: null,
        path: '',
        absolute_path: null,
        parent_id: null,
        git_url: null,
        status: null,
        ...overrides,
    };
}

function createBreadcrumb(streams: StreamEntity[]): ContextBreadcrumb {
    return new ContextBreadcrumb({ streams, reposPath: REPOS_PATH });
}

describe('ContextBreadcrumb', () => {
    describe('Empty input', () => {
        it('should return empty array for empty folder list', () => {
            const result = createBreadcrumb([]).build([]);
            expect(result).toEqual([]);
        });
    });

    describe('Git repos in repos/ folder', () => {
        it('should build chain for git repo with matching product', () => {
            const streams = [
                makeStream({ id: '1', type: 'business', name: 'TestBiz', icon: '🔬', absolute_path: '/drive/TestBiz' }),
                makeStream({ id: '2', type: 'product', name: 'MyApp', icon: '📱', absolute_path: '/drive/TestBiz/MyApp', parent_id: '1' }),
            ];
            const bc = createBreadcrumb(streams);
            const gitFolder = path.join(REPOS_PATH, 'MyApp.git');

            const result = bc.build([gitFolder]);

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
            const bc = createBreadcrumb([]);
            const gitFolder = path.join(REPOS_PATH, 'Unknown.git');

            const result = bc.build([gitFolder]);

            expect(result).toHaveLength(1);
            expect(result[0].type).toBe('git');
            expect(result[0].name).toBe('Unknown.git');
            expect(result[0].errorCode).toBe('orphan');
            expect(result[0].children).toHaveLength(1);
            expect(result[0].children[0].type).toBe('error');
            expect(result[0].children[0].errorCode).toBe('orphan');
        });

        it('should return name_conflict error as child of git folder', () => {
            const streams = [
                makeStream({ id: '1', type: 'business', name: 'Conflict', icon: '🔬', absolute_path: '/drive/Conflict' }),
            ];
            const bc = createBreadcrumb(streams);
            const gitFolder = path.join(REPOS_PATH, 'Conflict.git');

            const result = bc.build([gitFolder]);

            expect(result).toHaveLength(1);
            expect(result[0].type).toBe('git');
            expect(result[0].errorCode).toBe('name_conflict');
            expect(result[0].children).toHaveLength(1);
            expect(result[0].children[0].type).toBe('error');
            expect(result[0].children[0].errorCode).toBe('name_conflict');
        });

        it('should treat repos/ folder without .git suffix as external with info child', () => {
            const bc = createBreadcrumb([]);
            const folder = path.join(REPOS_PATH, 'SomeFolder');

            const result = bc.build([folder]);

            expect(result).toHaveLength(1);
            expect(result[0].type).toBe('external');
            expect(result[0].errorCode).toBeUndefined();
            expect(result[0].children).toHaveLength(1);
            expect(result[0].children[0].type).toBe('error');
            expect(result[0].children[0].errorCode).toBe('outside_hierarchy');
            expect(result[0].children[0].icon).toBe('info');
        });
    });

    describe('Folders on Drive (lookup)', () => {
        it('should build chain for folder found in streams', () => {
            const streams = [
                makeStream({ id: '1', type: 'business', name: 'МетаЛаб', icon: '🔬', absolute_path: '/drive/МетаЛаб' }),
                makeStream({ id: '2', type: 'stream', name: 'ТехноЛаб', icon: '💻', absolute_path: '/drive/МетаЛаб/ТехноЛаб', parent_id: '1' }),
                makeStream({ id: '3', type: 'product', name: 'Duet', icon: '🎭', absolute_path: '/drive/МетаЛаб/ТехноЛаб/Duet', parent_id: '2' }),
            ];
            const bc = createBreadcrumb(streams);
            const driveFolder = '/drive/МетаЛаб/ТехноЛаб/Duet';

            const result = bc.build([driveFolder]);

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

        it('should return external for folder not in streams with info child', () => {
            const bc = createBreadcrumb([]);
            const result = bc.build(['/some/random/path']);

            expect(result).toHaveLength(1);
            expect(result[0].type).toBe('external');
            expect(result[0].errorCode).toBeUndefined();
            expect(result[0].children).toHaveLength(1);
            expect(result[0].children[0].type).toBe('error');
            expect(result[0].children[0].errorCode).toBe('outside_hierarchy');
            expect(result[0].children[0].icon).toBe('info');
        });

        it('should match deepest entity for nested path', () => {
            const streams = [
                makeStream({ id: '1', type: 'business', name: 'Biz', icon: 'B', absolute_path: '/drive/Biz' }),
                makeStream({ id: '2', type: 'product', name: 'Prod', icon: 'P', absolute_path: '/drive/Biz/Prod', parent_id: '1' }),
            ];
            const bc = createBreadcrumb(streams);
            const subFolder = '/drive/Biz/Prod/src/components';

            const result = bc.build([subFolder]);

            expect(result).toHaveLength(1);
            expect(result[0].type).toBe('business');
            expect(result[0].children[0].type).toBe('product');
            expect(result[0].children[0].name).toBe('Prod');
        });

        it('should not false-match path with same prefix but different entity', () => {
            const streams = [
                makeStream({ id: '1', type: 'business', name: 'Biz', icon: 'B', absolute_path: '/drive/Biz' }),
                makeStream({ id: '2', type: 'product', name: 'BizExtra', icon: 'P', absolute_path: '/drive/BizExtra' }),
            ];
            const bc = createBreadcrumb(streams);
            // /drive/BizExtra should NOT match /drive/Biz
            const folder = '/drive/BizExtra/something';

            const result = bc.build([folder]);

            expect(result).toHaveLength(1);
            // Should match BizExtra (exact entity), not Biz (false prefix)
            expect(result[0].type).toBe('product');
            expect(result[0].name).toBe('BizExtra');
        });
    });

    describe('Common ancestor merging', () => {
        it('should merge two products from same business into one tree', () => {
            const streams = [
                makeStream({ id: '1', type: 'business', name: 'МетаЛаб', icon: '🔬', absolute_path: '/drive/МетаЛаб' }),
                makeStream({ id: '2', type: 'product', name: 'Duet', icon: '🎭', absolute_path: '/drive/МетаЛаб/Duet', parent_id: '1' }),
                makeStream({ id: '3', type: 'product', name: 'Kreator', icon: '🎨', absolute_path: '/drive/МетаЛаб/Kreator', parent_id: '1' }),
            ];
            const bc = createBreadcrumb(streams);
            const duetRepo = path.join(REPOS_PATH, 'Duet.git');
            const kreatorRepo = path.join(REPOS_PATH, 'Kreator.git');

            const result = bc.build([duetRepo, kreatorRepo]);

            expect(result).toHaveLength(1);
            expect(result[0].type).toBe('business');
            expect(result[0].name).toBe('МетаЛаб');
            expect(result[0].children).toHaveLength(2);

            const productNames = result[0].children.map(c => c.name);
            expect(productNames).toContain('Duet');
            expect(productNames).toContain('Kreator');
        });

        it('should merge products from same stream into one subtree', () => {
            const streams = [
                makeStream({ id: '1', type: 'business', name: 'МетаЛаб', icon: '🔬', absolute_path: '/drive/МетаЛаб' }),
                makeStream({ id: '2', type: 'stream', name: 'ТехноЛаб', icon: '💻', absolute_path: '/drive/МетаЛаб/ТехноЛаб', parent_id: '1' }),
                makeStream({ id: '3', type: 'product', name: 'Duet', icon: '🎭', absolute_path: '/drive/МетаЛаб/ТехноЛаб/Duet', parent_id: '2' }),
                makeStream({ id: '4', type: 'product', name: 'Kreator', icon: '🎨', absolute_path: '/drive/МетаЛаб/ТехноЛаб/Kreator', parent_id: '2' }),
            ];
            const bc = createBreadcrumb(streams);
            const duetRepo = path.join(REPOS_PATH, 'Duet.git');
            const kreatorRepo = path.join(REPOS_PATH, 'Kreator.git');

            const result = bc.build([duetRepo, kreatorRepo]);

            expect(result).toHaveLength(1);
            const stream = result[0].children[0];
            expect(stream.type).toBe('stream');
            expect(stream.children).toHaveLength(2);
        });

        it('should create separate roots for different businesses', () => {
            const streams = [
                makeStream({ id: '1', type: 'business', name: 'Business1', icon: '1️⃣', absolute_path: '/drive/Business1' }),
                makeStream({ id: '2', type: 'business', name: 'Business2', icon: '2️⃣', absolute_path: '/drive/Business2' }),
                makeStream({ id: '3', type: 'product', name: 'Prod1', icon: 'P1', absolute_path: '/drive/Business1/Prod1', parent_id: '1' }),
                makeStream({ id: '4', type: 'product', name: 'Prod2', icon: 'P2', absolute_path: '/drive/Business2/Prod2', parent_id: '2' }),
            ];
            const bc = createBreadcrumb(streams);
            const prod1Repo = path.join(REPOS_PATH, 'Prod1.git');
            const prod2Repo = path.join(REPOS_PATH, 'Prod2.git');

            const result = bc.build([prod1Repo, prod2Repo]);

            expect(result).toHaveLength(2);
            const names = result.map(r => r.name);
            expect(names).toContain('Business1');
            expect(names).toContain('Business2');
        });
    });

    describe('Root sorting', () => {
        it('should sort roots by leaf type: business > stream > product > external', () => {
            const streams = [
                makeStream({ id: '1', type: 'business', name: 'JustBusiness', icon: 'B', absolute_path: '/drive/JustBusiness' }),
                makeStream({ id: '2', type: 'stream', name: 'JustStream', icon: 'S', absolute_path: '/drive/JustBusiness/JustStream', parent_id: '1' }),
                makeStream({ id: '3', type: 'business', name: 'BizWithProduct', icon: 'B', absolute_path: '/drive/BizWithProduct' }),
                makeStream({ id: '4', type: 'product', name: 'TheProduct', icon: 'P', absolute_path: '/drive/BizWithProduct/TheProduct', parent_id: '3' }),
            ];
            const bc = createBreadcrumb(streams);
            const folders = [
                '/drive/JustBusiness/JustStream', // Stream deepest
                '/some/external/folder',          // External
                path.join(REPOS_PATH, 'TheProduct.git'), // Product via git
                '/drive/JustBusiness'             // Business deepest
            ];

            const result = bc.build(folders);

            expect(result.length).toBeGreaterThan(0);
            const lastRoot = result[result.length - 1];
            expect(lastRoot).toBeDefined();
            expect(lastRoot!.type).toBe('external');
        });

        it('should sort alphabetically within same leaf type', () => {
            const bc = createBreadcrumb([]);
            const folders = [
                '/some/path/Zebra',
                '/other/path/Apple'
            ];

            const result = bc.build(folders);

            expect(result).toHaveLength(2);
            expect(result[0].name).toBe('Apple');
            expect(result[1].name).toBe('Zebra');
        });
    });

    describe('Git repo outside repos/ folder', () => {
        it('should return outside_repos error as child of git folder', () => {
            const bc = createBreadcrumb([]);
            const externalGitRepo = '/home/user/projects/SomeRepo.git';

            const result = bc.build([externalGitRepo]);

            expect(result).toHaveLength(1);
            expect(result[0].type).toBe('git');
            expect(result[0].name).toBe('SomeRepo.git');
            expect(result[0].errorCode).toBe('outside_repos');
            expect(result[0].children).toHaveLength(1);
            expect(result[0].children[0].type).toBe('error');
            expect(result[0].children[0].errorCode).toBe('outside_repos');
        });
    });

    describe('Complex scenarios', () => {
        it('should handle mix of valid chains, errors, and externals', () => {
            const streams = [
                makeStream({ id: '1', type: 'business', name: 'ValidBiz', icon: '✓', absolute_path: '/drive/ValidBiz' }),
                makeStream({ id: '2', type: 'product', name: 'ValidProd', icon: 'P', absolute_path: '/drive/ValidBiz/ValidProd', parent_id: '1' }),
            ];
            const bc = createBreadcrumb(streams);
            const folders = [
                path.join(REPOS_PATH, 'ValidProd.git'),  // Valid chain
                path.join(REPOS_PATH, 'Orphan.git'),     // Orphan error
                '/some/random/folder'                     // External
            ];

            const result = bc.build(folders);

            expect(result).toHaveLength(3);

            const validRoot = result.find(r => r.type === 'business');
            const orphan = result.find(r => r.errorCode === 'orphan');
            const external = result.find(r => r.type === 'external');

            expect(validRoot).toBeDefined();
            expect(orphan).toBeDefined();
            expect(external).toBeDefined();
        });

        it('should handle deeply nested hierarchy', () => {
            const streams = [
                makeStream({ id: '1', type: 'business', name: 'DeepBiz', icon: 'B', absolute_path: '/drive/DeepBiz' }),
                makeStream({ id: '2', type: 'stream', name: 'Stream1', icon: 'S1', absolute_path: '/drive/DeepBiz/Stream1', parent_id: '1' }),
                makeStream({ id: '3', type: 'stream', name: 'Stream2', icon: 'S2', absolute_path: '/drive/DeepBiz/Stream1/Stream2', parent_id: '2' }),
                makeStream({ id: '4', type: 'product', name: 'DeepProd', icon: 'P', absolute_path: '/drive/DeepBiz/Stream1/Stream2/DeepProd', parent_id: '3' }),
            ];
            const bc = createBreadcrumb(streams);
            const gitFolder = path.join(REPOS_PATH, 'DeepProd.git');

            const result = bc.build([gitFolder]);

            expect(result).toHaveLength(1);

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

    describe('updateStreams', () => {
        it('should rebuild tree with new data', () => {
            const streams1 = [
                makeStream({ id: '1', type: 'business', name: 'OldBiz', icon: 'O', absolute_path: '/drive/OldBiz' }),
                makeStream({ id: '2', type: 'product', name: 'OldProd', icon: 'P', absolute_path: '/drive/OldBiz/OldProd', parent_id: '1' }),
            ];
            const bc = createBreadcrumb(streams1);

            // Should find OldProd
            const result1 = bc.build([path.join(REPOS_PATH, 'OldProd.git')]);
            expect(result1[0].type).toBe('business');

            // Update streams
            const streams2 = [
                makeStream({ id: '1', type: 'business', name: 'NewBiz', icon: 'N', absolute_path: '/drive/NewBiz' }),
                makeStream({ id: '2', type: 'product', name: 'OldProd', icon: 'P', absolute_path: '/drive/NewBiz/OldProd', parent_id: '1' }),
            ];
            bc.updateStreams(streams2);

            // Should now find under NewBiz
            const result2 = bc.build([path.join(REPOS_PATH, 'OldProd.git')]);
            expect(result2[0].name).toBe('NewBiz');
        });
    });
});
