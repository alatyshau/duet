/**
 * Unit tests for ContextBreadcrumb
 *
 * Tests cover:
 * - Empty workspace folders -> empty result
 * - Git repo in repos/ with matching git-backed context -> chain
 * - Git repo in repos/ without match -> orphan error
 * - Git repo in repos/ with name conflict (no git_url) -> name_conflict error
 * - Folder on Drive found in contexts -> chain
 * - Folder not in contexts -> external
 * - Common ancestor merging
 * - Root sorting by leaf flavor (meta > root > regular > with-git > git > external)
 */

import { describe, it, expect } from 'vitest';
import * as path from 'path';
import { ContextEntity } from '../../core/api-client';
import { ContextBreadcrumb } from '../../core/tree/contextBreadcrumb';

const REPOS_PATH = '/DuetData/repos';

function makeContext(overrides: Partial<ContextEntity> & { id: string; name: string }): ContextEntity {
    return {
        type: 'context',
        icon: null,
        path: '',
        absolute_path: null,
        parent_id: null,
        meta: false,
        git_url: null,
        ...overrides,
    };
}

function createBreadcrumb(contexts: ContextEntity[]): ContextBreadcrumb {
    return new ContextBreadcrumb({ contexts, reposPath: REPOS_PATH });
}

describe('ContextBreadcrumb', () => {
    describe('Empty input', () => {
        it('should return empty array for empty folder list', () => {
            const result = createBreadcrumb([]).build([]);
            expect(result).toEqual([]);
        });
    });

    describe('Git repos in repos/ folder', () => {
        it('should build chain for git repo with matching git-backed context', () => {
            const contexts = [
                makeContext({ id: '1', name: 'TestBiz', icon: '🔬', absolute_path: '/drive/TestBiz' }),
                makeContext({ id: '2', name: 'MyApp', icon: '📱', absolute_path: '/drive/TestBiz/MyApp', parent_id: '1', git_url: 'git@x:y.git' }),
            ];
            const bc = createBreadcrumb(contexts);
            const gitFolder = path.join(REPOS_PATH, 'MyApp.git');

            const result = bc.build([gitFolder]);

            expect(result).toHaveLength(1);
            expect(result[0].type).toBe('context');
            expect(result[0].name).toBe('TestBiz');
            expect(result[0].isRoot).toBe(true);
            expect(result[0].children).toHaveLength(1);

            const product = result[0].children[0];
            expect(product.type).toBe('context');
            expect(product.name).toBe('MyApp');
            expect(product.hasGit).toBe(true);
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

        it('should return name_conflict error when matching context has no git_url', () => {
            const contexts = [
                makeContext({ id: '1', name: 'Conflict', icon: '🔬', absolute_path: '/drive/Conflict' }),
            ];
            const bc = createBreadcrumb(contexts);
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
        it('should build chain for folder found in contexts', () => {
            const contexts = [
                makeContext({ id: '1', name: 'МетаЛаб', icon: '🔬', absolute_path: '/drive/МетаЛаб' }),
                makeContext({ id: '2', name: 'ТехноЛаб', icon: '💻', absolute_path: '/drive/МетаЛаб/ТехноЛаб', parent_id: '1' }),
                makeContext({ id: '3', name: 'Duet', icon: '🎭', absolute_path: '/drive/МетаЛаб/ТехноЛаб/Duet', parent_id: '2', git_url: 'git@x:y.git' }),
            ];
            const bc = createBreadcrumb(contexts);
            const driveFolder = '/drive/МетаЛаб/ТехноЛаб/Duet';

            const result = bc.build([driveFolder]);

            expect(result).toHaveLength(1);
            expect(result[0].type).toBe('context');
            expect(result[0].name).toBe('МетаЛаб');

            const stream = result[0].children[0];
            expect(stream.type).toBe('context');
            expect(stream.name).toBe('ТехноЛаб');

            const product = stream.children[0];
            expect(product.type).toBe('context');
            expect(product.name).toBe('Duet');
            expect(product.hasGit).toBe(true);
        });

        it('should return external for folder not in contexts with info child', () => {
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
            const contexts = [
                makeContext({ id: '1', name: 'Biz', icon: 'B', absolute_path: '/drive/Biz' }),
                makeContext({ id: '2', name: 'Prod', icon: 'P', absolute_path: '/drive/Biz/Prod', parent_id: '1', git_url: 'git@x:y.git' }),
            ];
            const bc = createBreadcrumb(contexts);
            const subFolder = '/drive/Biz/Prod/src/components';

            const result = bc.build([subFolder]);

            expect(result).toHaveLength(1);
            expect(result[0].type).toBe('context');
            expect(result[0].children[0].type).toBe('context');
            expect(result[0].children[0].name).toBe('Prod');
        });

        it('should not false-match path with same prefix but different entity', () => {
            const contexts = [
                makeContext({ id: '1', name: 'Biz', icon: 'B', absolute_path: '/drive/Biz' }),
                makeContext({ id: '2', name: 'BizExtra', icon: 'P', absolute_path: '/drive/BizExtra' }),
            ];
            const bc = createBreadcrumb(contexts);
            // /drive/BizExtra should NOT match /drive/Biz
            const folder = '/drive/BizExtra/something';

            const result = bc.build([folder]);

            expect(result).toHaveLength(1);
            // Should match BizExtra (exact entity), not Biz (false prefix)
            expect(result[0].type).toBe('context');
            expect(result[0].name).toBe('BizExtra');
        });
    });

    describe('Common ancestor merging', () => {
        it('should merge two git-backed children of the same root into one tree', () => {
            const contexts = [
                makeContext({ id: '1', name: 'МетаЛаб', icon: '🔬', absolute_path: '/drive/МетаЛаб' }),
                makeContext({ id: '2', name: 'Duet', icon: '🎭', absolute_path: '/drive/МетаЛаб/Duet', parent_id: '1', git_url: 'git@x:y.git' }),
                makeContext({ id: '3', name: 'Kreator', icon: '🎨', absolute_path: '/drive/МетаЛаб/Kreator', parent_id: '1', git_url: 'git@x:k.git' }),
            ];
            const bc = createBreadcrumb(contexts);
            const duetRepo = path.join(REPOS_PATH, 'Duet.git');
            const kreatorRepo = path.join(REPOS_PATH, 'Kreator.git');

            const result = bc.build([duetRepo, kreatorRepo]);

            expect(result).toHaveLength(1);
            expect(result[0].type).toBe('context');
            expect(result[0].name).toBe('МетаЛаб');
            expect(result[0].children).toHaveLength(2);

            const productNames = result[0].children.map(c => c.name);
            expect(productNames).toContain('Duet');
            expect(productNames).toContain('Kreator');
        });

        it('should merge git-backed siblings under the same intermediate context', () => {
            const contexts = [
                makeContext({ id: '1', name: 'МетаЛаб', icon: '🔬', absolute_path: '/drive/МетаЛаб' }),
                makeContext({ id: '2', name: 'ТехноЛаб', icon: '💻', absolute_path: '/drive/МетаЛаб/ТехноЛаб', parent_id: '1' }),
                makeContext({ id: '3', name: 'Duet', icon: '🎭', absolute_path: '/drive/МетаЛаб/ТехноЛаб/Duet', parent_id: '2', git_url: 'git@x:d.git' }),
                makeContext({ id: '4', name: 'Kreator', icon: '🎨', absolute_path: '/drive/МетаЛаб/ТехноЛаб/Kreator', parent_id: '2', git_url: 'git@x:k.git' }),
            ];
            const bc = createBreadcrumb(contexts);
            const duetRepo = path.join(REPOS_PATH, 'Duet.git');
            const kreatorRepo = path.join(REPOS_PATH, 'Kreator.git');

            const result = bc.build([duetRepo, kreatorRepo]);

            expect(result).toHaveLength(1);
            const stream = result[0].children[0];
            expect(stream.type).toBe('context');
            expect(stream.children).toHaveLength(2);
        });

        it('should create separate roots for different root contexts', () => {
            const contexts = [
                makeContext({ id: '1', name: 'Business1', icon: '1️⃣', absolute_path: '/drive/Business1' }),
                makeContext({ id: '2', name: 'Business2', icon: '2️⃣', absolute_path: '/drive/Business2' }),
                makeContext({ id: '3', name: 'Prod1', icon: 'P1', absolute_path: '/drive/Business1/Prod1', parent_id: '1', git_url: 'git@x:1.git' }),
                makeContext({ id: '4', name: 'Prod2', icon: 'P2', absolute_path: '/drive/Business2/Prod2', parent_id: '2', git_url: 'git@x:2.git' }),
            ];
            const bc = createBreadcrumb(contexts);
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
        it('should sort by leaf flavor: meta > root > regular > with-git > external', () => {
            const contexts = [
                makeContext({ id: 'm', name: 'BASE', icon: 'M', absolute_path: '/drive/BASE', meta: true }),
                makeContext({ id: '1', name: 'JustRoot', icon: 'R', absolute_path: '/drive/JustRoot' }),
                makeContext({ id: '2', name: 'Reg', icon: 'r', absolute_path: '/drive/JustRoot/Reg', parent_id: '1' }),
                makeContext({ id: '3', name: 'BizWithProduct', icon: 'B', absolute_path: '/drive/BizWithProduct' }),
                makeContext({ id: '4', name: 'TheProduct', icon: 'P', absolute_path: '/drive/BizWithProduct/TheProduct', parent_id: '3', git_url: 'git@x:y.git' }),
            ];
            const bc = createBreadcrumb(contexts);
            const folders = [
                '/drive/JustRoot/Reg',                    // regular context (parent has parent)
                '/some/external/folder',                  // external
                path.join(REPOS_PATH, 'TheProduct.git'),  // chain ending with-git
                '/drive/JustRoot',                        // root context
                '/drive/BASE'                             // meta-context
            ];

            const result = bc.build(folders);

            expect(result.length).toBeGreaterThan(0);
            expect(result[0].name).toBe('BASE'); // meta first
            const lastRoot = result[result.length - 1];
            expect(lastRoot).toBeDefined();
            expect(lastRoot!.type).toBe('external');
        });

        it('should sort alphabetically within same leaf flavor', () => {
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
            const contexts = [
                makeContext({ id: '1', name: 'ValidBiz', icon: '✓', absolute_path: '/drive/ValidBiz' }),
                makeContext({ id: '2', name: 'ValidProd', icon: 'P', absolute_path: '/drive/ValidBiz/ValidProd', parent_id: '1', git_url: 'git@x:y.git' }),
            ];
            const bc = createBreadcrumb(contexts);
            const folders = [
                path.join(REPOS_PATH, 'ValidProd.git'),  // Valid chain
                path.join(REPOS_PATH, 'Orphan.git'),     // Orphan error
                '/some/random/folder'                     // External
            ];

            const result = bc.build(folders);

            expect(result).toHaveLength(3);

            const validRoot = result.find(r => r.type === 'context');
            const orphan = result.find(r => r.errorCode === 'orphan');
            const external = result.find(r => r.type === 'external');

            expect(validRoot).toBeDefined();
            expect(orphan).toBeDefined();
            expect(external).toBeDefined();
        });

        it('should handle deeply nested hierarchy', () => {
            const contexts = [
                makeContext({ id: '1', name: 'DeepBiz', icon: 'B', absolute_path: '/drive/DeepBiz' }),
                makeContext({ id: '2', name: 'Stream1', icon: 'S1', absolute_path: '/drive/DeepBiz/Stream1', parent_id: '1' }),
                makeContext({ id: '3', name: 'Stream2', icon: 'S2', absolute_path: '/drive/DeepBiz/Stream1/Stream2', parent_id: '2' }),
                makeContext({ id: '4', name: 'DeepProd', icon: 'P', absolute_path: '/drive/DeepBiz/Stream1/Stream2/DeepProd', parent_id: '3', git_url: 'git@x:y.git' }),
            ];
            const bc = createBreadcrumb(contexts);
            const gitFolder = path.join(REPOS_PATH, 'DeepProd.git');

            const result = bc.build([gitFolder]);

            expect(result).toHaveLength(1);

            let node = result[0];
            expect(node.type).toBe('context');
            expect(node.name).toBe('DeepBiz');

            node = node.children[0];
            expect(node.type).toBe('context');
            expect(node.name).toBe('Stream1');

            node = node.children[0];
            expect(node.type).toBe('context');
            expect(node.name).toBe('Stream2');

            node = node.children[0];
            expect(node.type).toBe('context');
            expect(node.name).toBe('DeepProd');
            expect(node.hasGit).toBe(true);

            node = node.children[0];
            expect(node.type).toBe('git');
        });
    });

    describe('updateContexts', () => {
        it('should rebuild tree with new data', () => {
            const contexts1 = [
                makeContext({ id: '1', name: 'OldBiz', icon: 'O', absolute_path: '/drive/OldBiz' }),
                makeContext({ id: '2', name: 'OldProd', icon: 'P', absolute_path: '/drive/OldBiz/OldProd', parent_id: '1', git_url: 'git@x:y.git' }),
            ];
            const bc = createBreadcrumb(contexts1);

            // Should find OldProd
            const result1 = bc.build([path.join(REPOS_PATH, 'OldProd.git')]);
            expect(result1[0].type).toBe('context');

            // Update contexts
            const contexts2 = [
                makeContext({ id: '1', name: 'NewBiz', icon: 'N', absolute_path: '/drive/NewBiz' }),
                makeContext({ id: '2', name: 'OldProd', icon: 'P', absolute_path: '/drive/NewBiz/OldProd', parent_id: '1', git_url: 'git@x:y.git' }),
            ];
            bc.updateContexts(contexts2);

            // Should now find under NewBiz
            const result2 = bc.build([path.join(REPOS_PATH, 'OldProd.git')]);
            expect(result2[0].name).toBe('NewBiz');
        });
    });
});
