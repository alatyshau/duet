/*
 * Unit тесты для src/core/schema-migrations.ts
 *
 * Покрытие:
 * - applyMigrations: pure transform v1 → v2 (settings/machine) и v1 → v3 (context).
 * - loadOrUpgradeSettings/MachineConfig: idempotent reload, future-version критичны.
 * - loadOrUpgradeManifests:
 *   - legacy → v3 для каждого имени файла (business/stream/product) с правилом root → meta.
 *   - orphan resolution когда context.json и legacy сосуществуют.
 *   - self-heal на пустой root-папке.
 *   - future-version manifest помечен как per-context error, файл не трогается.
 *   - dot-folder skip + терминал на git_repos.
 * - CONTEXT_SCHEMA v2 → v3: git_url → git_repos map.
 * - atomicWriteJson: пишет через .tmp + rename.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { writeFileSync, readFileSync, mkdirSync, existsSync, readdirSync } from 'fs'
import { join } from 'path'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'

import {
  applyMigrations,
  atomicWriteJson,
  CONTEXT_SCHEMA,
  loadOrUpgradeManifests,
  loadOrUpgradeMachineConfig,
  loadOrUpgradeSettings,
  MACHINE_SCHEMA,
  SETTINGS_SCHEMA
} from '../../../src/core/schema-migrations'

interface TestRoot {
  tmpDir: string
  cleanup: () => void
}

function makeTmp(): TestRoot {
  const tmpDir = mkdtempSync(join(tmpdir(), 'duet-schema-test-'))
  return {
    tmpDir,
    cleanup: () => rmSync(tmpDir, { recursive: true, force: true })
  }
}

describe('core/schema-migrations', () => {
  // =============================================================================
  // applyMigrations — pure
  // =============================================================================
  describe('applyMigrations', () => {
    it('SETTINGS_SCHEMA: v1 → v2 renames business_folders, adds version, preserves other keys', () => {
      const v1 = {
        business_folders: ['@A', '@B'],
        timestampTZ: { id: 'Z', value: 'UTC' },
        custom: 42
      }
      const result = applyMigrations(SETTINGS_SCHEMA, v1)
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data).toEqual({
          version: 2,
          root_context_folders: ['@A', '@B'],
          timestampTZ: { id: 'Z', value: 'UTC' },
          custom: 42
        })
        expect(result.fromVersion).toBe(1)
      }
    })

    it('SETTINGS_SCHEMA: v2 input is no-op', () => {
      const v2 = {
        version: 2,
        root_context_folders: ['@A'],
        timestampTZ: { id: 'Z', value: 'UTC' }
      }
      const result = applyMigrations(SETTINGS_SCHEMA, v2)
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data).toEqual(v2)
        expect(result.fromVersion).toBe(2)
      }
    })

    it('SETTINGS_SCHEMA: v3 future-version → not ok', () => {
      const v3 = { version: 3, root_context_folders: [] }
      const result = applyMigrations(SETTINGS_SCHEMA, v3)
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.reason).toBe('future_version')
      }
    })

    it('MACHINE_SCHEMA: v1 → v2 just adds version, preserves all keys including aliases', () => {
      const v1 = { port: 19680, '@МетаЛаб': '/foo/bar', pythonPath: '/usr/bin/python' }
      const result = applyMigrations(MACHINE_SCHEMA, v1)
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data).toEqual({
          version: 2,
          port: 19680,
          '@МетаЛаб': '/foo/bar',
          pythonPath: '/usr/bin/python'
        })
      }
    })

    it('CONTEXT_SCHEMA: business.json with root → context.json with meta (v1→v3 chain)', () => {
      const v1 = { name: 'БАЗА', root: true, icon: '🏠' }
      const result = applyMigrations(CONTEXT_SCHEMA, v1, { sourceFilename: 'business.json' })
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data).toEqual({ version: 3, name: 'БАЗА', icon: '🏠', meta: true })
      }
    })

    it('CONTEXT_SCHEMA: business.json without root → no meta (v1→v3)', () => {
      const v1 = { name: 'МетаЛаб' }
      const result = applyMigrations(CONTEXT_SCHEMA, v1, { sourceFilename: 'business.json' })
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data).toEqual({ version: 3, name: 'МетаЛаб' })
      }
    })

    it('CONTEXT_SCHEMA: stream.json → git_url collapsed into git_repos (v1→v3)', () => {
      const v1 = {
        name: 'ТехноЛаб',
        git_url: 'git@github.com:foo/bar.git',
        reference_repos: { cookbook: 'https://github.com/anthropics/anthropic-cookbook.git' },
        description: 'Описание'
      }
      const result = applyMigrations(CONTEXT_SCHEMA, v1, { sourceFilename: 'stream.json' })
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data).toEqual({
          version: 3,
          name: 'ТехноЛаб',
          git_repos: { ТехноЛаб: 'git@github.com:foo/bar.git' },
          reference_repos: { cookbook: 'https://github.com/anthropics/anthropic-cookbook.git' },
          description: 'Описание'
        })
        expect(result.data.git_url).toBeUndefined()
      }
    })

    it('CONTEXT_SCHEMA: product.json with git_url → git_repos {name: url}, no meta (v1→v3)', () => {
      const v1 = { name: 'Duet', git_url: 'git@github.com:owner/repo.git', icon: '📦' }
      const result = applyMigrations(CONTEXT_SCHEMA, v1, { sourceFilename: 'product.json' })
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data).toEqual({
          version: 3,
          name: 'Duet',
          icon: '📦',
          git_repos: { Duet: 'git@github.com:owner/repo.git' }
        })
      }
    })

    it('CONTEXT_SCHEMA: preserves unknown user-added fields (forward-compat)', () => {
      const v1 = { name: 'X', myCustomField: 'survives' }
      const result = applyMigrations(CONTEXT_SCHEMA, v1, { sourceFilename: 'business.json' })
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data).toMatchObject({ version: 3, name: 'X', myCustomField: 'survives' })
      }
    })

    it('CONTEXT_SCHEMA: future-version → not ok', () => {
      const result = applyMigrations(CONTEXT_SCHEMA, { version: 99, name: 'X' })
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.reason).toBe('future_version')
        expect(result.fromVersion).toBe(99)
      }
    })

    // === v2 → v3 specific (review issue 1: §5 design-doc) ===

    it('CONTEXT_SCHEMA: v2 → v3 converts git_url into git_repos map keyed by name', () => {
      const v2 = { version: 2, name: 'Duet', git_url: 'git@github.com:owner/repo.git', icon: '📦' }
      const result = applyMigrations(CONTEXT_SCHEMA, v2)
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data).toEqual({
          version: 3,
          name: 'Duet',
          icon: '📦',
          git_repos: { Duet: 'git@github.com:owner/repo.git' }
        })
        expect(result.fromVersion).toBe(2)
        expect(result.data.git_url).toBeUndefined()
      }
    })

    it('CONTEXT_SCHEMA: v2 → v3 with no git_url just bumps version', () => {
      const v2 = { version: 2, name: 'МетаЛаб', icon: '🧪' }
      const result = applyMigrations(CONTEXT_SCHEMA, v2)
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data).toEqual({ version: 3, name: 'МетаЛаб', icon: '🧪' })
        expect(result.data.git_repos).toBeUndefined()
      }
    })

    it('CONTEXT_SCHEMA: v3 input is no-op (idempotent)', () => {
      const v3 = {
        version: 3,
        name: 'DuetLab',
        git_repos: {
          Duet: 'git@github.com:owner/duet.git',
          'Duet-Instructions': 'git@github.com:owner/instr.git'
        }
      }
      const result = applyMigrations(CONTEXT_SCHEMA, v3)
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data).toEqual(v3)
        expect(result.fromVersion).toBe(3)
      }
    })

    it('CONTEXT_SCHEMA: v2 with empty git_url string drops field, no git_repos created', () => {
      const v2 = { version: 2, name: 'NoRepo', git_url: '' }
      const result = applyMigrations(CONTEXT_SCHEMA, v2)
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data).toEqual({ version: 3, name: 'NoRepo' })
        expect(result.data.git_url).toBeUndefined()
        expect(result.data.git_repos).toBeUndefined()
      }
    })

    it('CONTEXT_SCHEMA: v2 with git_url but missing name drops git_url, no git_repos', () => {
      // Malformed v2 (name is required), but a hand-written file can hit this shape.
      // We refuse to invent an alias from a missing name; git_url is still dropped so the
      // resulting v3 file is internally consistent.
      const v2 = { version: 2, git_url: 'git@github.com:foo/bar.git' }
      const result = applyMigrations(CONTEXT_SCHEMA, v2)
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data).toEqual({ version: 3 })
        expect(result.data.git_url).toBeUndefined()
        expect(result.data.git_repos).toBeUndefined()
      }
    })

    it('CONTEXT_SCHEMA: v2 with git_url and empty name string drops git_url, no git_repos', () => {
      // Same as the missing-name case: empty string is treated as no alias.
      const v2 = { version: 2, name: '', git_url: 'git@github.com:foo/bar.git' }
      const result = applyMigrations(CONTEXT_SCHEMA, v2)
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data).toEqual({ version: 3, name: '' })
        expect(result.data.git_url).toBeUndefined()
        expect(result.data.git_repos).toBeUndefined()
      }
    })
  })

  // =============================================================================
  // atomicWriteJson
  // =============================================================================
  describe('atomicWriteJson', () => {
    let tr: TestRoot
    beforeEach(() => {
      tr = makeTmp()
    })
    afterEach(() => tr.cleanup())

    it('writes JSON to file atomically via tmp + rename', () => {
      const filePath = join(tr.tmpDir, 'test.json')
      atomicWriteJson(filePath, { foo: 'bar' })
      expect(JSON.parse(readFileSync(filePath, 'utf-8'))).toEqual({ foo: 'bar' })
      // No tmp left over
      expect(existsSync(`${filePath}.tmp`)).toBe(false)
    })

    it('overwrites existing file', () => {
      const filePath = join(tr.tmpDir, 'test.json')
      writeFileSync(filePath, '{"old":true}', 'utf-8')
      atomicWriteJson(filePath, { fresh: true })
      expect(JSON.parse(readFileSync(filePath, 'utf-8'))).toEqual({ fresh: true })
    })

    it('appends trailing newline', () => {
      const filePath = join(tr.tmpDir, 'test.json')
      atomicWriteJson(filePath, { foo: 'bar' })
      const raw = readFileSync(filePath, 'utf-8')
      expect(raw.endsWith('\n')).toBe(true)
    })

    it('does NOT leave a half-written target on the filesystem', () => {
      // Sanity that the rename'd target replaces the previous file in one step.
      const filePath = join(tr.tmpDir, 'replace.json')
      writeFileSync(filePath, JSON.stringify({ before: true }))
      atomicWriteJson(filePath, { after: true })
      expect(JSON.parse(readFileSync(filePath, 'utf-8'))).toEqual({ after: true })
      // No tmp file lingers
      expect(existsSync(`${filePath}.tmp`)).toBe(false)
    })
  })

  // =============================================================================
  // loadOrUpgradeSettings / loadOrUpgradeMachineConfig
  // =============================================================================
  describe('loadOrUpgradeSettings', () => {
    let tr: TestRoot
    beforeEach(() => (tr = makeTmp()))
    afterEach(() => tr.cleanup())

    it('returns null critical and migrated=false when settings.json absent', () => {
      const result = loadOrUpgradeSettings(tr.tmpDir)
      expect(result.critical).toBeNull()
      expect(result.migrated).toBe(false)
    })

    it('upgrades v1 settings to v2 in place', () => {
      const filePath = join(tr.tmpDir, 'settings.json')
      writeFileSync(
        filePath,
        JSON.stringify({ business_folders: ['@A'], timestampTZ: { id: 'Z', value: 'UTC' } }),
        'utf-8'
      )
      const result = loadOrUpgradeSettings(tr.tmpDir)
      expect(result.critical).toBeNull()
      expect(result.migrated).toBe(true)
      const updated = JSON.parse(readFileSync(filePath, 'utf-8'))
      expect(updated.version).toBe(2)
      expect(updated.root_context_folders).toEqual(['@A'])
      expect(updated.business_folders).toBeUndefined()
      expect(updated.timestampTZ).toEqual({ id: 'Z', value: 'UTC' })
    })

    it('idempotent on already-v2 settings (no rewrite, no migrated)', () => {
      const filePath = join(tr.tmpDir, 'settings.json')
      const v2 = {
        version: 2,
        root_context_folders: ['@A'],
        timestampTZ: { id: 'Z', value: 'UTC' }
      }
      writeFileSync(filePath, JSON.stringify(v2, null, 2) + '\n', 'utf-8')
      const before = readFileSync(filePath, 'utf-8')

      const result = loadOrUpgradeSettings(tr.tmpDir)
      expect(result.migrated).toBe(false)
      expect(readFileSync(filePath, 'utf-8')).toBe(before) // unchanged
    })

    it('returns critical on future-version', () => {
      const filePath = join(tr.tmpDir, 'settings.json')
      writeFileSync(filePath, JSON.stringify({ version: 99, root_context_folders: [] }), 'utf-8')

      const result = loadOrUpgradeSettings(tr.tmpDir)
      expect(result.critical).not.toBeNull()
      expect(result.critical?.file).toBe('settings')
      expect(result.critical?.reason_code).toBe('future_version')
      // File untouched
      expect(JSON.parse(readFileSync(filePath, 'utf-8')).version).toBe(99)
    })

    it('returns critical on invalid JSON', () => {
      const filePath = join(tr.tmpDir, 'settings.json')
      writeFileSync(filePath, '{ this is not json', 'utf-8')

      const result = loadOrUpgradeSettings(tr.tmpDir)
      expect(result.critical).not.toBeNull()
      expect(result.critical?.reason_code).toBe('invalid_json')
    })
  })

  describe('loadOrUpgradeMachineConfig', () => {
    let tr: TestRoot
    beforeEach(() => (tr = makeTmp()))
    afterEach(() => tr.cleanup())

    it('upgrades v1 machine config (no version field) to v2 with version: 2', () => {
      const filePath = join(tr.tmpDir, 'mac_pro.json')
      writeFileSync(filePath, JSON.stringify({ port: 19680, '@МетаЛаб': '/foo/bar' }), 'utf-8')
      const result = loadOrUpgradeMachineConfig(tr.tmpDir, 'mac_pro')
      expect(result.critical).toBeNull()
      expect(result.migrated).toBe(true)
      const updated = JSON.parse(readFileSync(filePath, 'utf-8'))
      expect(updated.version).toBe(2)
      expect(updated.port).toBe(19680)
      expect(updated['@МетаЛаб']).toBe('/foo/bar')
    })

    it('returns critical on future-version machine config', () => {
      const filePath = join(tr.tmpDir, 'mac_pro.json')
      writeFileSync(filePath, JSON.stringify({ version: 99, port: 19680 }), 'utf-8')
      const result = loadOrUpgradeMachineConfig(tr.tmpDir, 'mac_pro')
      expect(result.critical?.file).toBe('machine')
      expect(result.critical?.reason_code).toBe('future_version')
    })
  })

  // =============================================================================
  // loadOrUpgradeManifests — manifest walk
  // =============================================================================
  describe('loadOrUpgradeManifests', () => {
    let tr: TestRoot
    beforeEach(() => (tr = makeTmp()))
    afterEach(() => tr.cleanup())

    const writeManifest = (folderPath: string, name: string, data: object): void => {
      mkdirSync(folderPath, { recursive: true })
      writeFileSync(join(folderPath, name), JSON.stringify(data), 'utf-8')
    }

    it('migrates business.json with root: true → context.json v3 with meta: true (root folder)', () => {
      const root = join(tr.tmpDir, 'baza')
      writeManifest(root, 'business.json', { name: 'БАЗА', root: true })

      const { contextErrors, migratedCount } = loadOrUpgradeManifests([root])

      expect(contextErrors).toEqual([])
      expect(migratedCount).toBe(1)
      expect(existsSync(join(root, 'business.json'))).toBe(false)
      const ctx = JSON.parse(readFileSync(join(root, 'context.json'), 'utf-8'))
      expect(ctx).toEqual({ version: 3, name: 'БАЗА', meta: true })
    })

    it('migrates business.json without root → context.json v3 without meta', () => {
      const root = join(tr.tmpDir, 'metalab')
      writeManifest(root, 'business.json', { name: 'МетаЛаб', icon: '🧪' })

      loadOrUpgradeManifests([root])

      const ctx = JSON.parse(readFileSync(join(root, 'context.json'), 'utf-8'))
      expect(ctx).toEqual({ version: 3, name: 'МетаЛаб', icon: '🧪' })
      expect(ctx.meta).toBeUndefined()
    })

    it('migrates stream.json (inside chain) → context.json v3 without meta', () => {
      const root = join(tr.tmpDir, 'metalab')
      writeManifest(root, 'business.json', { name: 'МетаЛаб' })
      const child = join(root, 'tehnolab')
      writeManifest(child, 'stream.json', { name: 'ТехноЛаб' })

      loadOrUpgradeManifests([root])

      const ctx = JSON.parse(readFileSync(join(child, 'context.json'), 'utf-8'))
      expect(ctx).toEqual({ version: 3, name: 'ТехноЛаб' })
    })

    it('migrates business.json (inside chain, legacy mistake) → context.json v3 without meta', () => {
      const root = join(tr.tmpDir, 'metalab')
      writeManifest(root, 'business.json', { name: 'МетаЛаб' })
      const child = join(root, 'inner')
      // Old self-heal would rename business.json → stream.json. Now it's just upgraded to context.json.
      writeManifest(child, 'business.json', { name: 'Inner', root: false })

      loadOrUpgradeManifests([root])

      const ctx = JSON.parse(readFileSync(join(child, 'context.json'), 'utf-8'))
      expect(ctx).toEqual({ version: 3, name: 'Inner' })
      expect(existsSync(join(child, 'business.json'))).toBe(false)
    })

    it('migrates product.json with git_url → context.json v3 with git_repos, stops recursion', () => {
      const root = join(tr.tmpDir, 'metalab')
      writeManifest(root, 'business.json', { name: 'МетаЛаб' })
      const product = join(root, 'duet')
      writeManifest(product, 'product.json', {
        name: 'Duet',
        git_url: 'git@github.com:foo/bar.git'
      })
      // Drive-side product folder may contain a child folder that should NOT be walked into.
      const subFolderInProduct = join(product, 'drafts')
      writeManifest(subFolderInProduct, 'context.json', { version: 99 }) // future-version, would error if walked

      const { contextErrors } = loadOrUpgradeManifests([root])

      const ctx = JSON.parse(readFileSync(join(product, 'context.json'), 'utf-8'))
      expect(ctx.version).toBe(3)
      expect(ctx.git_repos).toEqual({ Duet: 'git@github.com:foo/bar.git' })
      expect(ctx.git_url).toBeUndefined()
      // Subfolder under terminal context should NOT have been walked → no error reported for it.
      expect(contextErrors.find((e) => e.path === subFolderInProduct)).toBeUndefined()
    })

    it('terminates recursion when v2 context.json with git_url is migrated to v3 with git_repos', () => {
      // v2 manifest sitting on disk before sweep: after migration becomes v3 with git_repos,
      // and walk must respect the post-migration terminal flag (not the legacy git_url field).
      const root = join(tr.tmpDir, 'wrapper')
      writeManifest(root, 'context.json', { version: 2, name: 'Wrapper' })
      const child = join(root, 'duet')
      writeManifest(child, 'context.json', {
        version: 2,
        name: 'Duet',
        git_url: 'git@github.com:foo/bar.git'
      })
      // Sub-folder INSIDE the terminal product. If recursion didn't stop, this future-version
      // manifest would be flagged as a per-context error.
      const subFolder = join(child, 'drafts')
      writeManifest(subFolder, 'context.json', { version: 99 })

      const { contextErrors } = loadOrUpgradeManifests([root])

      const ctx = JSON.parse(readFileSync(join(child, 'context.json'), 'utf-8'))
      expect(ctx.version).toBe(3)
      expect(ctx.git_repos).toEqual({ Duet: 'git@github.com:foo/bar.git' })
      expect(ctx.git_url).toBeUndefined()
      // Recursion stopped at the post-migration terminal → no error for the future-version sub-folder.
      expect(contextErrors.find((e) => e.path === subFolder)).toBeUndefined()
    })

    it('orphan resolution: context.json wins over coexisting legacy file, deletes legacy', () => {
      const root = join(tr.tmpDir, 'mixed')
      writeManifest(root, 'context.json', { version: 3, name: 'Mixed' })
      writeManifest(root, 'business.json', { name: 'OldName', root: true })

      loadOrUpgradeManifests([root])

      const ctx = JSON.parse(readFileSync(join(root, 'context.json'), 'utf-8'))
      expect(ctx.name).toBe('Mixed') // context.json kept its data
      expect(ctx.version).toBe(3)
      expect(existsSync(join(root, 'business.json'))).toBe(false)
    })

    it('self-heals empty root folder by creating context.json v3 without meta', () => {
      const root = join(tr.tmpDir, 'NewRoot')
      mkdirSync(root, { recursive: true })

      const { migratedCount } = loadOrUpgradeManifests([root])

      expect(migratedCount).toBe(1)
      const ctx = JSON.parse(readFileSync(join(root, 'context.json'), 'utf-8'))
      expect(ctx).toEqual({ version: 3, name: 'NewRoot' })
      expect(ctx.meta).toBeUndefined()
    })

    it('does NOT self-heal non-root folders without manifest (just recurses)', () => {
      const root = join(tr.tmpDir, 'metalab')
      writeManifest(root, 'context.json', { version: 3, name: 'МетаЛаб' })
      const child = join(root, 'no-manifest')
      mkdirSync(child, { recursive: true })

      loadOrUpgradeManifests([root])

      // Child folder should remain manifest-less
      expect(existsSync(join(child, 'context.json'))).toBe(false)
      expect(existsSync(join(child, 'business.json'))).toBe(false)
    })

    it('reports per-context error for future-version manifest, leaves file untouched', () => {
      const root = join(tr.tmpDir, 'baza')
      writeManifest(root, 'context.json', { version: 99, name: 'BazaFromFuture' })

      const { contextErrors } = loadOrUpgradeManifests([root])

      expect(contextErrors).toHaveLength(1)
      expect(contextErrors[0].path).toBe(root)
      expect(contextErrors[0].root_context_path).toBe(root)
      expect(contextErrors[0].reason_code).toBe('future_version')
      // File untouched
      const ctx = JSON.parse(readFileSync(join(root, 'context.json'), 'utf-8'))
      expect(ctx.version).toBe(99)
    })

    it('reports per-context error for invalid JSON in context.json', () => {
      const root = join(tr.tmpDir, 'broken')
      mkdirSync(root, { recursive: true })
      writeFileSync(join(root, 'context.json'), '{ broken', 'utf-8')

      const { contextErrors } = loadOrUpgradeManifests([root])

      expect(contextErrors).toHaveLength(1)
      expect(contextErrors[0].reason_code).toBe('invalid_json')
    })

    it('skips dot-prefixed directories (.git, .venv) during recursion', () => {
      const root = join(tr.tmpDir, 'metalab')
      writeManifest(root, 'context.json', { version: 3, name: 'МетаЛаб' })
      const dotGit = join(root, '.git')
      writeManifest(dotGit, 'business.json', { name: 'WouldBeMigrated' })

      loadOrUpgradeManifests([root])

      // .git/business.json should NOT have been touched
      expect(existsSync(join(dotGit, 'business.json'))).toBe(true)
      expect(existsSync(join(dotGit, 'context.json'))).toBe(false)
    })

    it('idempotent on second run (no re-write of already-v3 files)', () => {
      const root = join(tr.tmpDir, 'metalab')
      writeManifest(root, 'business.json', { name: 'МетаЛаб' })

      loadOrUpgradeManifests([root])
      const after1 = readFileSync(join(root, 'context.json'), 'utf-8')

      const second = loadOrUpgradeManifests([root])
      const after2 = readFileSync(join(root, 'context.json'), 'utf-8')

      expect(after1).toBe(after2)
      expect(second.migratedCount).toBe(0)
    })

    it('migrates pre-existing v2 context.json on disk up to v3 (full chain via sweep)', () => {
      const root = join(tr.tmpDir, 'metalab')
      writeManifest(root, 'context.json', { version: 2, name: 'МетаЛаб' })

      const { migratedCount, contextErrors } = loadOrUpgradeManifests([root])

      expect(contextErrors).toEqual([])
      expect(migratedCount).toBe(1)
      const ctx = JSON.parse(readFileSync(join(root, 'context.json'), 'utf-8'))
      expect(ctx).toEqual({ version: 3, name: 'МетаЛаб' })
    })

    it('migrates pre-existing v2 context.json with git_url → v3 with git_repos', () => {
      const root = join(tr.tmpDir, 'metalab')
      writeManifest(root, 'context.json', {
        version: 2,
        name: 'Duet',
        git_url: 'git@github.com:owner/duet.git'
      })

      loadOrUpgradeManifests([root])

      const ctx = JSON.parse(readFileSync(join(root, 'context.json'), 'utf-8'))
      expect(ctx.version).toBe(3)
      expect(ctx.git_repos).toEqual({ Duet: 'git@github.com:owner/duet.git' })
      expect(ctx.git_url).toBeUndefined()
    })

    it('idempotent on pre-existing v3 context.json (byte-identical on second read)', () => {
      const root = join(tr.tmpDir, 'duetlab')
      mkdirSync(root, { recursive: true })
      const v3 = {
        version: 3,
        name: 'DuetLab',
        git_repos: {
          Duet: 'git@github.com:o/duet.git',
          'Duet-Instructions': 'git@github.com:o/instr.git'
        }
      }
      // Match the formatting that atomicWriteJson would produce so the byte-equality check is fair.
      writeFileSync(join(root, 'context.json'), JSON.stringify(v3, null, 2) + '\n', 'utf-8')

      const before = readFileSync(join(root, 'context.json'), 'utf-8')
      const { migratedCount, contextErrors } = loadOrUpgradeManifests([root])

      expect(contextErrors).toEqual([])
      expect(migratedCount).toBe(0)
      expect(readFileSync(join(root, 'context.json'), 'utf-8')).toBe(before)
    })

    it('skips non-existing root context paths without crashing', () => {
      const result = loadOrUpgradeManifests([join(tr.tmpDir, 'does-not-exist')])
      expect(result.contextErrors).toEqual([])
      expect(result.migratedCount).toBe(0)
    })

    it('handles multiple root contexts in one sweep', () => {
      const a = join(tr.tmpDir, 'A')
      const b = join(tr.tmpDir, 'B')
      writeManifest(a, 'business.json', { name: 'A', root: true })
      writeManifest(b, 'business.json', { name: 'B' })

      const { contextErrors, migratedCount } = loadOrUpgradeManifests([a, b])

      expect(contextErrors).toEqual([])
      expect(migratedCount).toBe(2)
      expect(JSON.parse(readFileSync(join(a, 'context.json'), 'utf-8')).meta).toBe(true)
      expect(JSON.parse(readFileSync(join(b, 'context.json'), 'utf-8')).meta).toBeUndefined()
    })

    it('reports a non-empty directory listing — sanity that walk executed', () => {
      const root = join(tr.tmpDir, 'metalab')
      writeManifest(root, 'business.json', { name: 'МетаЛаб', root: true })
      // After migration, root should contain only context.json + (no children created).
      loadOrUpgradeManifests([root])
      expect(readdirSync(root).sort()).toEqual(['context.json'])
    })

    // === Review #2 — Issue 1: target context.json with missing/non-int version is malformed ===

    it('refuses to migrate context.json without integer `version` (review issue 1)', () => {
      // Looks like v1 to a naive parser, but it's a *target* file → must be left untouched.
      const root = join(tr.tmpDir, 'noversion')
      mkdirSync(root, { recursive: true })
      const filePath = join(root, 'context.json')
      writeFileSync(filePath, JSON.stringify({ name: 'X' }), 'utf-8')

      const before = readFileSync(filePath, 'utf-8')
      const { contextErrors, migratedCount } = loadOrUpgradeManifests([root])

      expect(contextErrors).toHaveLength(1)
      expect(contextErrors[0].reason_code).toBe('invalid_json')
      expect(migratedCount).toBe(0)
      expect(readFileSync(filePath, 'utf-8')).toBe(before) // byte-identical
    })

    it('refuses to migrate context.json with non-int `version` (e.g. "3" string)', () => {
      const root = join(tr.tmpDir, 'stringversion')
      mkdirSync(root, { recursive: true })
      const filePath = join(root, 'context.json')
      writeFileSync(filePath, JSON.stringify({ version: '3', name: 'X' }), 'utf-8')

      const before = readFileSync(filePath, 'utf-8')
      const { contextErrors } = loadOrUpgradeManifests([root])

      expect(contextErrors).toHaveLength(1)
      expect(contextErrors[0].reason_code).toBe('invalid_json')
      expect(readFileSync(filePath, 'utf-8')).toBe(before)
    })

    it('legacy business.json without `version` still migrates (different code path)', () => {
      const root = join(tr.tmpDir, 'legacynoversion')
      writeManifest(root, 'business.json', { name: 'OK' })

      const { contextErrors, migratedCount } = loadOrUpgradeManifests([root])

      expect(contextErrors).toEqual([])
      expect(migratedCount).toBe(1)
      const ctx = JSON.parse(readFileSync(join(root, 'context.json'), 'utf-8'))
      expect(ctx).toEqual({ version: 3, name: 'OK' })
    })

    // === Orphan resolution: blind delete (per stabilize-taxonomy-migration decision) ===

    it('orphan resolution: deletes coexisting legacy regardless of payload (blind delete)', () => {
      const root = join(tr.tmpDir, 'divergent')
      // Self-healed bare context.json
      writeManifest(root, 'context.json', { version: 3, name: 'divergent' })
      // Richer legacy with hand-edited fields — by design (§7) it loses to context.json
      // and is removed without comparison. Equivalence-aware logic was overengineering for
      // a single-machine install and was removed by user decision.
      writeManifest(root, 'product.json', {
        name: 'divergent',
        git_url: 'git@github.com:user/repo.git',
        description: 'Hand-written description'
      })

      const { contextErrors } = loadOrUpgradeManifests([root])

      expect(contextErrors).toEqual([])
      expect(existsSync(join(root, 'product.json'))).toBe(false)
      // No `.legacy-conflict.json` artefact left behind
      expect(existsSync(join(root, 'product.json.legacy-conflict.json'))).toBe(false)
    })

    it('orphan resolution: unparseable legacy is also removed (no special handling)', () => {
      const root = join(tr.tmpDir, 'broken-legacy')
      writeManifest(root, 'context.json', { version: 3, name: 'broken-legacy' })
      writeFileSync(join(root, 'business.json'), '{ corrupted', 'utf-8')

      const { contextErrors } = loadOrUpgradeManifests([root])

      expect(contextErrors).toEqual([])
      expect(existsSync(join(root, 'business.json'))).toBe(false)
    })

    it('multiple legacy siblings: first wins by priority, others removed silently', () => {
      const root = join(tr.tmpDir, 'multi-legacy')
      mkdirSync(root, { recursive: true })
      writeFileSync(join(root, 'business.json'), JSON.stringify({ name: 'multi-legacy' }), 'utf-8')
      writeFileSync(
        join(root, 'stream.json'),
        JSON.stringify({ name: 'DIFFERENT', icon: '🌊' }),
        'utf-8'
      )

      const { contextErrors } = loadOrUpgradeManifests([root])

      // business.json wins (deterministic priority).
      expect(JSON.parse(readFileSync(join(root, 'context.json'), 'utf-8')).name).toBe(
        'multi-legacy'
      )
      expect(existsSync(join(root, 'business.json'))).toBe(false)
      expect(existsSync(join(root, 'stream.json'))).toBe(false)
      expect(existsSync(join(root, 'stream.json.legacy-conflict.json'))).toBe(false)
      expect(contextErrors).toEqual([])
    })
  })
})
