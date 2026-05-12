/*
 * Unit тесты для src/core/root-contexts.ts
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'
import { createTestContext, writeTestConfig, type TestContext } from '../../helpers'

import {
  addRootContextFolder,
  enforceMetaInvariant,
  getResolvedRootContextFolders,
  getRootContextFolders,
  normalizePath,
  resolveAliasForPath,
  resolveAliasPath,
  saveRootContextFolders,
  readCachedScan,
  readCachedContexts
} from '../../../src/core/root-contexts'

describe('core/root-contexts', () => {
  let ctx: TestContext

  beforeEach(() => {
    ctx = createTestContext()
    // Write pointer config so readConfig/readSettingsConfig can find files
    writeTestConfig(ctx.configFile, {
      duetDataPath: ctx.duetDataDir,
      duetConfigPath: ctx.duetConfigDir,
      machine: 'test'
    })
  })

  afterEach(() => {
    ctx.cleanup()
  })

  // ===========================================================================
  // normalizePath
  // ===========================================================================

  describe('normalizePath', () => {
    it('strips trailing forward slash', () => {
      expect(normalizePath('/foo/bar/')).toBe('/foo/bar')
    })

    it('strips trailing backslash (Windows)', () => {
      expect(normalizePath('C:\\foo\\bar\\')).toBe('C:\\foo\\bar')
    })

    it('strips multiple trailing separators', () => {
      expect(normalizePath('/foo/bar///')).toBe('/foo/bar')
      expect(normalizePath('C:\\foo\\\\')).toBe('C:\\foo')
    })

    it('preserves path without trailing separator', () => {
      expect(normalizePath('/foo/bar')).toBe('/foo/bar')
    })

    it('NFC-normalizes NFD input (macOS dialog returns NFD)', () => {
      const nfd = 'Й'.normalize('NFD')
      const nfc = 'Й'.normalize('NFC')
      expect(nfd).not.toBe(nfc)
      expect(normalizePath(`/foo/${nfd}`)).toBe(`/foo/${nfc}`)
    })

    it('is idempotent', () => {
      const once = normalizePath('/foo/МетаЛаб/')
      const twice = normalizePath(once)
      expect(twice).toBe(once)
    })
  })

  // ===========================================================================
  // getRootContextFolders
  // ===========================================================================

  describe('getRootContextFolders', () => {
    it('returns empty array when settings.json does not exist', () => {
      expect(getRootContextFolders()).toEqual([])
    })

    it('returns root_context_folders from settings.json', () => {
      const folders = ['/path/to/ctx1', '/path/to/ctx2']
      writeFileSync(
        join(ctx.duetConfigDir, 'settings.json'),
        JSON.stringify({ version: 2, root_context_folders: folders }),
        'utf-8'
      )

      expect(getRootContextFolders()).toEqual(folders)
    })

    it('returns empty array when root_context_folders is not an array', () => {
      writeFileSync(
        join(ctx.duetConfigDir, 'settings.json'),
        JSON.stringify({ version: 2, root_context_folders: 'not-array' }),
        'utf-8'
      )
      expect(getRootContextFolders()).toEqual([])
    })

    it('returns empty array when root_context_folders key is missing', () => {
      writeFileSync(
        join(ctx.duetConfigDir, 'settings.json'),
        JSON.stringify({ other_key: 'value' }),
        'utf-8'
      )
      expect(getRootContextFolders()).toEqual([])
    })
  })

  // ===========================================================================
  // saveRootContextFolders
  // ===========================================================================

  describe('saveRootContextFolders', () => {
    it('saves root_context_folders to settings.json', () => {
      writeFileSync(
        join(ctx.duetConfigDir, 'settings.json'),
        JSON.stringify({
          version: 2,
          root_context_folders: [],
          timestampTZ: { id: 'Z', value: 'UTC' }
        }),
        'utf-8'
      )

      const folders = ['/path/to/ctx1']
      saveRootContextFolders(folders)

      const settings = JSON.parse(readFileSync(join(ctx.duetConfigDir, 'settings.json'), 'utf-8'))
      expect(settings.root_context_folders).toEqual(folders)
      expect(settings.timestampTZ).toEqual({ id: 'Z', value: 'UTC' })
    })

    it('throws if settings.json does not exist (caller must run wizard step 1 first)', () => {
      expect(() => saveRootContextFolders(['/new/path'])).toThrow(/Settings file not found/)
    })

    it('replaces existing root_context_folders entirely', () => {
      writeFileSync(
        join(ctx.duetConfigDir, 'settings.json'),
        JSON.stringify({ root_context_folders: ['/old/path'] }),
        'utf-8'
      )

      saveRootContextFolders(['/new/path1', '/new/path2'])

      const settings = JSON.parse(readFileSync(join(ctx.duetConfigDir, 'settings.json'), 'utf-8'))
      expect(settings.root_context_folders).toEqual(['/new/path1', '/new/path2'])
    })

    it('reorder swaps meta to new first folder atomically', () => {
      const first = join(ctx.tmpDir, 'First')
      const second = join(ctx.tmpDir, 'Second')
      mkdirSync(first, { recursive: true })
      mkdirSync(second, { recursive: true })
      writeFileSync(
        join(first, 'context.json'),
        JSON.stringify({ version: 2, name: 'First', meta: true }),
        'utf-8'
      )
      writeFileSync(
        join(second, 'context.json'),
        JSON.stringify({ version: 2, name: 'Second' }),
        'utf-8'
      )
      writeFileSync(
        join(ctx.duetConfigDir, 'test.json'),
        JSON.stringify({ version: 2, port: 19680, '@First': first, '@Second': second }),
        'utf-8'
      )
      writeFileSync(
        join(ctx.duetConfigDir, 'settings.json'),
        JSON.stringify({ version: 2, root_context_folders: ['@First', '@Second'] }),
        'utf-8'
      )

      // Reorder — Second goes to position 0
      saveRootContextFolders(['@Second', '@First'])

      // Meta swapped on disk
      expect(JSON.parse(readFileSync(join(first, 'context.json'), 'utf-8')).meta).toBeUndefined()
      expect(JSON.parse(readFileSync(join(second, 'context.json'), 'utf-8')).meta).toBe(true)
    })

    it('removing the current meta folder promotes the new first folder to meta', () => {
      const a = join(ctx.tmpDir, 'A')
      const b = join(ctx.tmpDir, 'B')
      mkdirSync(a, { recursive: true })
      mkdirSync(b, { recursive: true })
      writeFileSync(
        join(a, 'context.json'),
        JSON.stringify({ version: 2, name: 'A', meta: true }),
        'utf-8'
      )
      writeFileSync(join(b, 'context.json'), JSON.stringify({ version: 2, name: 'B' }), 'utf-8')
      writeFileSync(
        join(ctx.duetConfigDir, 'test.json'),
        JSON.stringify({ version: 2, port: 19680, '@A': a, '@B': b }),
        'utf-8'
      )
      writeFileSync(
        join(ctx.duetConfigDir, 'settings.json'),
        JSON.stringify({ version: 2, root_context_folders: ['@A', '@B'] }),
        'utf-8'
      )

      // Remove A — B becomes new first, gets meta
      saveRootContextFolders(['@B'])

      expect(JSON.parse(readFileSync(join(b, 'context.json'), 'utf-8')).meta).toBe(true)
    })
  })

  // ===========================================================================
  // resolveAliasForPath (pure)
  // ===========================================================================

  describe('resolveAliasForPath', () => {
    it('reuses existing alias when path is already aliased', () => {
      const aliases = { '@Existing': '/foo/bar' }
      expect(resolveAliasForPath('/foo/bar', aliases)).toEqual({
        alias: '@Existing',
        isNew: false
      })
    })

    it('reuses alias even if its name does not match basename', () => {
      const aliases = { '@MyBaza': '/foo/Baza' }
      expect(resolveAliasForPath('/foo/Baza', aliases)).toEqual({
        alias: '@MyBaza',
        isNew: false
      })
    })

    it('reuses alias across NFD/NFC normalization (macOS Cyrillic)', () => {
      const aliasNFC = '/foo/МетаЛаб'.normalize('NFC')
      const inputNFD = '/foo/МетаЛаб'.normalize('NFD')
      const aliases = { '@МетаЛаб': aliasNFC }
      expect(resolveAliasForPath(inputNFD, aliases)).toEqual({
        alias: '@МетаЛаб',
        isNew: false
      })
    })

    it('reuses alias when input has trailing separator', () => {
      expect(resolveAliasForPath('/foo/Baza/', { '@Baza': '/foo/Baza' })).toEqual({
        alias: '@Baza',
        isNew: false
      })
    })

    it('reuses alias when stored alias has trailing separator', () => {
      expect(resolveAliasForPath('/foo/Baza', { '@Baza': '/foo/Baza/' })).toEqual({
        alias: '@Baza',
        isNew: false
      })
    })

    it('generates @basename for fresh path', () => {
      expect(resolveAliasForPath('/foo/Baza', {})).toEqual({ alias: '@Baza', isNew: true })
    })

    it('handles unicode folder names', () => {
      expect(resolveAliasForPath('/foo/МетаЛаб', {})).toEqual({
        alias: '@МетаЛаб',
        isNew: true
      })
    })

    it('appends _2 on collision with different path', () => {
      expect(resolveAliasForPath('/foo/Baza', { '@Baza': '/other/Baza' })).toEqual({
        alias: '@Baza_2',
        isNew: true
      })
    })

    it('skips taken suffixes until a free one is found', () => {
      const aliases = {
        '@Baza': '/a/Baza',
        '@Baza_2': '/b/Baza',
        '@Baza_3': '/c/Baza'
      }
      expect(resolveAliasForPath('/d/Baza', aliases)).toEqual({
        alias: '@Baza_4',
        isNew: true
      })
    })

    it('throws on degenerate path with empty basename', () => {
      expect(() => resolveAliasForPath('/', {})).toThrow(/empty basename/)
    })
  })

  // ===========================================================================
  // enforceMetaInvariant
  // ===========================================================================

  describe('enforceMetaInvariant', () => {
    /** Создаёт реальную папку с context.json. */
    const createCtx = (
      name: string,
      manifest: Record<string, unknown> = { version: 2, name, icon: '📁' }
    ): { path: string; manifestPath: string } => {
      const path = join(ctx.tmpDir, name)
      mkdirSync(path, { recursive: true })
      const manifestPath = join(path, 'context.json')
      writeFileSync(manifestPath, JSON.stringify(manifest), 'utf-8')
      return { path, manifestPath }
    }

    it('puts meta: true on first folder, removes from others (atomic two-write)', () => {
      const a = createCtx('A')
      const b = createCtx('B', { version: 2, name: 'B', icon: '📁', meta: true })
      const c = createCtx('C', { version: 2, name: 'C', meta: true })

      enforceMetaInvariant([
        { raw: '@A', resolved: a.path, isMeta: false },
        { raw: '@B', resolved: b.path, isMeta: true },
        { raw: '@C', resolved: c.path, isMeta: true }
      ])

      expect(JSON.parse(readFileSync(a.manifestPath, 'utf-8')).meta).toBe(true)
      expect(JSON.parse(readFileSync(b.manifestPath, 'utf-8')).meta).toBeUndefined()
      expect(JSON.parse(readFileSync(c.manifestPath, 'utf-8')).meta).toBeUndefined()
    })

    it('idempotent on already-valid state — does not rewrite files', () => {
      const a = createCtx('A', { version: 2, name: 'A', meta: true })
      const aBefore = readFileSync(a.manifestPath, 'utf-8')

      enforceMetaInvariant([{ raw: '@A', resolved: a.path, isMeta: true }])

      // Even mtime untouched: we only rewrite on actual change.
      expect(readFileSync(a.manifestPath, 'utf-8')).toBe(aBefore)
    })

    it('self-heals missing context.json on first folder (gets meta automatically)', () => {
      const folderPath = join(ctx.tmpDir, 'NoManifest')
      mkdirSync(folderPath, { recursive: true })
      const manifestPath = join(folderPath, 'context.json')
      expect(existsSync(manifestPath)).toBe(false)

      enforceMetaInvariant([{ raw: '@NoManifest', resolved: folderPath, isMeta: false }])

      expect(existsSync(manifestPath)).toBe(true)
      const data = JSON.parse(readFileSync(manifestPath, 'utf-8'))
      expect(data).toMatchObject({ version: 3, name: 'NoManifest', meta: true })
    })

    it('skips folders with invalid JSON without throwing (migration sweep already surfaces error)', () => {
      const broken = join(ctx.tmpDir, 'Broken')
      mkdirSync(broken, { recursive: true })
      writeFileSync(join(broken, 'context.json'), '{ this is not json', 'utf-8')
      const after = createCtx('After')

      // Folder[0] is broken — we don't try to enforce meta on it (invariant temporarily
      // violated, UI shows red); folder[1] gets `meta` cleared just in case.
      enforceMetaInvariant([
        { raw: '@Broken', resolved: broken, isMeta: false },
        { raw: '@After', resolved: after.path, isMeta: false }
      ])

      // Broken file untouched
      expect(readFileSync(join(broken, 'context.json'), 'utf-8')).toBe('{ this is not json')
      // After unchanged (meta wasn't set, no write needed)
      expect(JSON.parse(readFileSync(after.manifestPath, 'utf-8')).meta).toBeUndefined()
    })

    it('preserves other manifest fields when flipping meta', () => {
      const folderPath = join(ctx.tmpDir, 'Rich')
      mkdirSync(folderPath, { recursive: true })
      writeFileSync(
        join(folderPath, 'context.json'),
        JSON.stringify({
          version: 2,
          name: 'Rich',
          icon: '🏢',
          description: 'desc',
          custom: 42
        }),
        'utf-8'
      )

      enforceMetaInvariant([{ raw: '@Rich', resolved: folderPath, isMeta: false }])

      const data = JSON.parse(readFileSync(join(folderPath, 'context.json'), 'utf-8'))
      expect(data).toEqual({
        version: 2,
        name: 'Rich',
        icon: '🏢',
        description: 'desc',
        custom: 42,
        meta: true
      })
    })

    it('no-op on empty list', () => {
      expect(() => enforceMetaInvariant([])).not.toThrow()
    })
  })

  // ===========================================================================
  // addRootContextFolder
  // ===========================================================================

  describe('addRootContextFolder', () => {
    const writeMachineConfig = (config: Record<string, unknown>): void => {
      writeFileSync(join(ctx.duetConfigDir, 'test.json'), JSON.stringify(config), 'utf-8')
    }
    const readMachineFile = (): Record<string, unknown> =>
      JSON.parse(readFileSync(join(ctx.duetConfigDir, 'test.json'), 'utf-8'))
    const readSettingsFile = (): Record<string, unknown> =>
      JSON.parse(readFileSync(join(ctx.duetConfigDir, 'settings.json'), 'utf-8'))
    const createFolder = (name: string): string => {
      const p = join(ctx.tmpDir, name)
      mkdirSync(p, { recursive: true })
      return p
    }

    beforeEach(() => {
      writeMachineConfig({ version: 2, port: 19680 })
      writeFileSync(
        join(ctx.duetConfigDir, 'settings.json'),
        JSON.stringify({ version: 2, root_context_folders: [] }),
        'utf-8'
      )
    })

    it('creates @alias in machine config and adds to root_context_folders', () => {
      const ctxPath = createFolder('Baza')
      const result = addRootContextFolder(ctxPath)

      const mc = readMachineFile()
      expect(mc['@Baza']).toBe(ctxPath)
      expect(mc.port).toBe(19680)

      const settings = readSettingsFile()
      expect(settings.root_context_folders).toEqual(['@Baza'])

      expect(result).toHaveLength(1)
      expect(result[0]).toMatchObject({ raw: '@Baza', resolved: ctxPath })
    })

    it('auto-promotes first added folder to meta (meta-required invariant)', () => {
      const ctxPath = createFolder('FirstCtx')
      const result = addRootContextFolder(ctxPath)

      expect(result).toHaveLength(1)
      expect(result[0].isMeta).toBe(true)
      const manifest = JSON.parse(readFileSync(join(ctxPath, 'context.json'), 'utf-8'))
      expect(manifest.meta).toBe(true)
    })

    it('second add does not steal meta from first (first remains pos 0 = meta)', () => {
      const first = createFolder('First')
      const second = createFolder('Second')

      addRootContextFolder(first)
      const result = addRootContextFolder(second)

      expect(result).toHaveLength(2)
      expect(result[0].raw).toBe('@First')
      expect(result[0].isMeta).toBe(true)
      expect(result[1].raw).toBe('@Second')
      expect(result[1].isMeta).toBe(false)
    })

    it('reuses existing alias for same path (idempotent)', () => {
      const ctxPath = createFolder('Baza')
      writeMachineConfig({ version: 2, port: 19680, '@Baza': ctxPath })
      writeFileSync(
        join(ctx.duetConfigDir, 'settings.json'),
        JSON.stringify({ version: 2, root_context_folders: ['@Baza'] }),
        'utf-8'
      )

      const result = addRootContextFolder(ctxPath)

      const mc = readMachineFile()
      expect(Object.keys(mc).filter((k) => k.startsWith('@'))).toEqual(['@Baza'])
      const settings = readSettingsFile()
      expect(settings.root_context_folders).toEqual(['@Baza'])
      expect(result).toHaveLength(1)
    })

    it('reuses alias across NFD/NFC (macOS): adding NFD when {machine}.json has NFC', () => {
      const nfcName = 'МетаЛаб'.normalize('NFC')
      const nfdName = 'МетаЛаб'.normalize('NFD')
      const folderNFC = createFolder(nfcName)
      writeMachineConfig({ version: 2, port: 19680, '@МетаЛаб': folderNFC })
      writeFileSync(
        join(ctx.duetConfigDir, 'settings.json'),
        JSON.stringify({ version: 2, root_context_folders: ['@МетаЛаб'] }),
        'utf-8'
      )

      const dialogPath = join(ctx.tmpDir, nfdName)
      const result = addRootContextFolder(dialogPath)

      const mc = readMachineFile()
      expect(Object.keys(mc).filter((k) => k.startsWith('@'))).toEqual(['@МетаЛаб'])
      const settings = readSettingsFile()
      expect(settings.root_context_folders).toEqual(['@МетаЛаб'])
      expect(result).toHaveLength(1)
    })

    it('stores normalized path (NFC, no trailing separator) in {machine}.json', () => {
      const ctxPath = createFolder('MyCtx')
      const ugly = (ctxPath + '/').normalize('NFD')

      addRootContextFolder(ugly)

      const mc = readMachineFile()
      expect(mc['@MyCtx']).toBe(ctxPath)
    })

    it('generates suffixed alias on basename collision', () => {
      const oldBaza = createFolder('OldBaza')
      writeMachineConfig({ version: 2, port: 19680, '@Baza': oldBaza })
      writeFileSync(
        join(ctx.duetConfigDir, 'settings.json'),
        JSON.stringify({ version: 2, root_context_folders: ['@Baza'] }),
        'utf-8'
      )

      const newBaza = join(ctx.tmpDir, 'newer', 'Baza')
      mkdirSync(newBaza, { recursive: true })
      const result = addRootContextFolder(newBaza)

      const mc = readMachineFile()
      expect(mc['@Baza']).toBe(oldBaza)
      expect(mc['@Baza_2']).toBe(newBaza)

      const settings = readSettingsFile()
      expect(settings.root_context_folders).toEqual(['@Baza', '@Baza_2'])
      expect(result).toHaveLength(2)
    })

    it('writes root_context_folders into existing settings.json without other keys present', () => {
      writeFileSync(join(ctx.duetConfigDir, 'settings.json'), JSON.stringify({}), 'utf-8')

      const ctxPath = createFolder('Baza')
      addRootContextFolder(ctxPath)

      const settings = readSettingsFile()
      expect(settings.root_context_folders).toEqual(['@Baza'])
    })

    it('throws when duetConfigPath is missing in pointer config', () => {
      writeTestConfig(ctx.configFile, {
        duetDataPath: ctx.duetDataDir,
        machine: 'test'
      })
      expect(() => addRootContextFolder('/some/path')).toThrow(/duetConfigPath/)
    })

    it('throws when machine name is missing in pointer config', () => {
      writeTestConfig(ctx.configFile, {
        duetDataPath: ctx.duetDataDir,
        duetConfigPath: ctx.duetConfigDir
      })
      expect(() => addRootContextFolder('/some/path')).toThrow(/machine/)
    })

    it('throws when machine name is invalid (path-traversal protection)', () => {
      writeTestConfig(ctx.configFile, {
        duetDataPath: ctx.duetDataDir,
        duetConfigPath: ctx.duetConfigDir,
        machine: '../evil'
      })
      expect(() => addRootContextFolder('/some/path')).toThrow(/machine/)
    })
  })

  // ===========================================================================
  // readCachedScan
  // ===========================================================================

  describe('readCachedScan', () => {
    it('returns null when scan.json does not exist', () => {
      expect(readCachedScan(ctx.duetDataDir)).toBeNull()
    })

    it('returns parsed scan result from cache', () => {
      const dataDir = join(ctx.duetDataDir, 'data')
      mkdirSync(dataDir, { recursive: true })
      const scanData = { status: 'ok', entities_count: 5, errors: [] }
      writeFileSync(join(dataDir, 'scan.json'), JSON.stringify(scanData), 'utf-8')

      expect(readCachedScan(ctx.duetDataDir)).toEqual(scanData)
    })

    it('returns null for invalid JSON', () => {
      const dataDir = join(ctx.duetDataDir, 'data')
      mkdirSync(dataDir, { recursive: true })
      writeFileSync(join(dataDir, 'scan.json'), 'not json', 'utf-8')
      expect(readCachedScan(ctx.duetDataDir)).toBeNull()
    })
  })

  // ===========================================================================
  // resolveAliasPath (review issue 4: @alias/subpath)
  // ===========================================================================

  describe('resolveAliasPath', () => {
    it('returns absolute paths as-is', () => {
      expect(resolveAliasPath('/abs/path', {})).toBe('/abs/path')
      expect(resolveAliasPath('C:\\foo', {})).toBe('C:\\foo')
    })

    it('resolves exact `@alias` from machine config', () => {
      expect(resolveAliasPath('@БАЗА', { '@БАЗА': '/foo/Baza' })).toBe('/foo/Baza')
    })

    it('returns null when alias not registered', () => {
      expect(resolveAliasPath('@MissingAlias', {})).toBeNull()
    })

    it('resolves `@alias/sub` by joining alias value + subpath', () => {
      expect(resolveAliasPath('@БАЗА/SomeRoot', { '@БАЗА': '/foo/Baza' })).toBe(
        join('/foo/Baza', 'SomeRoot')
      )
    })

    it('resolves nested `@alias/sub/deeper`', () => {
      expect(resolveAliasPath('@A/b/c', { '@A': '/foo' })).toBe(join('/foo', 'b', 'c'))
    })

    it('handles backslash-separated subpath (Windows-style entries in settings.json)', () => {
      expect(resolveAliasPath('@A\\sub', { '@A': '/foo' })).toBe(join('/foo', 'sub'))
    })

    it('returns null for `@alias/sub` when alias missing', () => {
      expect(resolveAliasPath('@Missing/sub', {})).toBeNull()
    })

    it('ignores non-string alias values (corrupted machine config)', () => {
      expect(resolveAliasPath('@A', { '@A': 123 } as Record<string, unknown>)).toBeNull()
    })
  })

  describe('getResolvedRootContextFolders', () => {
    it('marks unresolved aliases with unresolved: true (review issue 4)', () => {
      writeFileSync(
        join(ctx.duetConfigDir, 'test.json'),
        JSON.stringify({ version: 2, port: 19680 }), // no @aliases
        'utf-8'
      )
      writeFileSync(
        join(ctx.duetConfigDir, 'settings.json'),
        JSON.stringify({ version: 2, root_context_folders: ['@MissingAlias'] }),
        'utf-8'
      )

      const result = getResolvedRootContextFolders()
      expect(result).toHaveLength(1)
      expect(result[0]).toMatchObject({
        raw: '@MissingAlias',
        resolved: '@MissingAlias',
        isMeta: false,
        unresolved: true
      })
    })

    it('resolves `@alias/sub` form to absolute path', () => {
      const baza = join(ctx.tmpDir, 'baza')
      mkdirSync(join(baza, 'SomeRoot'), { recursive: true })
      writeFileSync(
        join(ctx.duetConfigDir, 'test.json'),
        JSON.stringify({ version: 2, port: 19680, '@БАЗА': baza }),
        'utf-8'
      )
      writeFileSync(
        join(ctx.duetConfigDir, 'settings.json'),
        JSON.stringify({ version: 2, root_context_folders: ['@БАЗА/SomeRoot'] }),
        'utf-8'
      )

      const result = getResolvedRootContextFolders()
      expect(result[0].raw).toBe('@БАЗА/SomeRoot')
      expect(result[0].resolved).toBe(join(baza, 'SomeRoot'))
      expect(result[0].unresolved).toBeFalsy()
    })
  })

  // ===========================================================================
  // readCachedContexts
  // ===========================================================================

  describe('readCachedContexts', () => {
    it('returns null when contexts.json does not exist', () => {
      expect(readCachedContexts(ctx.duetDataDir)).toBeNull()
    })

    it('returns parsed contexts from cache', () => {
      const dataDir = join(ctx.duetDataDir, 'data')
      mkdirSync(dataDir, { recursive: true })
      const contextsData = {
        contexts: [
          {
            id: '1',
            type: 'context',
            name: 'TestCtx',
            icon: '\u{1F4C1}',
            path: 'TestCtx',
            absolute_path: '/path/to/TestCtx',
            parent_id: null,
            git_url: null,
            meta: false
          }
        ]
      }
      writeFileSync(join(dataDir, 'contexts.json'), JSON.stringify(contextsData), 'utf-8')

      const result = readCachedContexts(ctx.duetDataDir)
      expect(result).toEqual(contextsData)
      expect(result!.contexts).toHaveLength(1)
      expect(result!.contexts[0].name).toBe('TestCtx')
    })

    it('returns null for invalid JSON', () => {
      const dataDir = join(ctx.duetDataDir, 'data')
      mkdirSync(dataDir, { recursive: true })
      writeFileSync(join(dataDir, 'contexts.json'), 'not json', 'utf-8')
      expect(readCachedContexts(ctx.duetDataDir)).toBeNull()
    })
  })
})
